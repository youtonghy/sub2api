import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { Gift } from 'lucide-react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

import '@/styles/announcement-markdown.css'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import BaseDialog from '@/components/common/BaseDialog'
import AmountInput from '@/components/payment/AmountInput'
import PaymentMethodSelector, { type PaymentMethodOption } from '@/components/payment/PaymentMethodSelector'
import PaymentStatusPanel from '@/components/payment/PaymentStatusPanel'
import SubscriptionPlanCard from '@/components/payment/SubscriptionPlanCard'
import { METHOD_ORDER, getPaymentPopupFeatures } from '@/components/payment/providerConfig'
import {
  PAYMENT_RECOVERY_STORAGE_KEY,
  buildCreateOrderPayload,
  clearPaymentRecoverySnapshot,
  decidePaymentLaunch,
  getVisibleMethods,
  normalizeVisibleMethod,
  readPaymentRecoverySnapshot,
  type PaymentRecoverySnapshot,
  writePaymentRecoverySnapshot,
} from '@/components/payment/paymentFlow'
import { DEFAULT_PAYMENT_CURRENCY, formatPaymentAmount, normalizePaymentCurrency } from '@/components/payment/currency'
import { planValiditySuffix as validitySuffixOf } from '@/components/payment/validity'
import { paymentAPI } from '@/api/payment'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { usePaymentStore } from '@/stores/payment'
import { useSubscriptionStore } from '@/stores/subscriptions'
import type { SubscriptionPlan, CheckoutInfoResponse, CreateOrderResult, OrderType } from '@/types/payment'
import { extractApiErrorMessage, extractI18nErrorMessage } from '@/utils/apiError'
import { isMobileDevice } from '@/utils/device'
import { FeatureFlags, resolveFeatureFlag } from '@/utils/featureFlags'
import { renderSanitizedMarkdown } from '@/utils/markdown'
import { hasPeakRate, formatPeakRateWindow, serverTimezoneLabel, type PeakRateFields } from '@/utils/peak-rate'
import { platformAccentColor, platformLabel } from '@/utils/platformColors'
import { formatRechargeBonusNumber, normalizeRechargeBonusMode, normalizeRechargeBonusTiers, quoteRechargeBonus } from '@/utils/rechargeBonus'
import { buildPaymentErrorToastMessage, describePaymentScenarioError } from './paymentUx'
import {
  hasWechatResumeQuery,
  parseWechatResumeRoute,
  queryToSearch,
  searchParamsToQuery,
  stripWechatResumeQuery,
  type RouteQuery,
} from './paymentWechatResume'
import styles from './PaymentView.module.css'

type TabKey = 'recharge' | 'subscription'

interface CreateOrderOptions {
  openid?: string
  wechatResumeToken?: string
  paymentType?: string
  isResume?: boolean
  mobileQrFallbackAttempted?: boolean
}

interface MobileQrFallbackContext {
  orderAmount: number
  orderType: OrderType
  planId?: number
  paymentType: string
  attempted: boolean
}

interface WeixinJSBridgeLike {
  invoke(
    action: string,
    payload: Record<string, unknown>,
    callback: (result: Record<string, unknown>) => void,
  ): void
}

const QUICK_AMOUNTS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]

const EMPTY_CHECKOUT: CheckoutInfoResponse = {
  methods: {}, global_min: 0, global_max: 0,
  plans: [], balance_disabled: false, balance_recharge_multiplier: 1, subscription_usd_to_cny_rate: 0, recharge_fee_rate: 0, help_text: '', help_image_url: '', stripe_publishable_key: '',
  recharge_bonus_tiers: [], recharge_bonus_mode: 'bonus', recharge_bonus_notice: '',
}

function emptyPaymentState(): PaymentRecoverySnapshot {
  return {
    orderId: 0,
    amount: 0,
    qrCode: '',
    expiresAt: '',
    paymentType: '',
    payUrl: '',
    outTradeNo: '',
    clientSecret: '',
    intentId: '',
    currency: '',
    countryCode: '',
    paymentEnv: '',
    payAmount: 0,
    orderType: '',
    paymentMode: '',
    resumeToken: '',
    alipayMobilePrecreateDeepLink: false,
    createdAt: 0,
  }
}

function getDaysRemaining(expiresAt: string): number {
  const diff = new Date(expiresAt).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

function isWechatBrowser(): boolean {
  return typeof window !== 'undefined' && /MicroMessenger/i.test(window.navigator.userAgent)
}

function getWeixinJSBridge(): WeixinJSBridgeLike | undefined {
  return (window as Window & { WeixinJSBridge?: WeixinJSBridgeLike }).WeixinJSBridge
}

function waitForWeixinJSBridge(timeoutMs = 4000): Promise<WeixinJSBridgeLike | null> {
  const existing = getWeixinJSBridge()
  if (existing) return Promise.resolve(existing)

  return new Promise((resolve) => {
    let settled = false
    const finish = (bridge: WeixinJSBridgeLike | null) => {
      if (settled) return
      settled = true
      document.removeEventListener('WeixinJSBridgeReady', handleReady)
      document.removeEventListener('onWeixinJSBridgeReady', handleReady)
      window.clearTimeout(timer)
      resolve(bridge)
    }
    const handleReady = () => finish(getWeixinJSBridge() ?? null)
    const timer = window.setTimeout(() => finish(getWeixinJSBridge() ?? null), timeoutMs)
    document.addEventListener('WeixinJSBridgeReady', handleReady, false)
    document.addEventListener('onWeixinJSBridgeReady', handleReady, false)
  })
}

async function invokeWechatJsapiPayment(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const bridge = await waitForWeixinJSBridge()
  if (!bridge) {
    throw new Error('WECHAT_JSAPI_UNAVAILABLE')
  }
  return new Promise((resolve) => {
    bridge.invoke('getBrandWCPayRequest', payload, (result) => resolve(result || {}))
  })
}

function persistRecoverySnapshot(snapshot: PaymentRecoverySnapshot) {
  if (typeof window === 'undefined' || !snapshot.orderId) return
  writePaymentRecoverySnapshot(window.localStorage, snapshot, PAYMENT_RECOVERY_STORAGE_KEY)
}

function removeRecoverySnapshot() {
  if (typeof window === 'undefined') return
  clearPaymentRecoverySnapshot(window.localStorage, PAYMENT_RECOVERY_STORAGE_KEY)
}

function buildWechatOAuthAuthorizeUrl(
  authorizeUrl: string,
  context: { paymentType: string; orderType: OrderType; planId?: number; orderAmount: number },
): string {
  const normalizedUrl = authorizeUrl.trim()
  if (!normalizedUrl || typeof window === 'undefined') {
    return normalizedUrl
  }

  try {
    const targetUrl = new URL(normalizedUrl, window.location.origin)
    const redirectPath = targetUrl.searchParams.get('redirect') || '/purchase'
    const redirectUrl = new URL(redirectPath, window.location.origin)
    const paymentType = normalizeVisibleMethod(context.paymentType) || context.paymentType.trim() || 'wxpay'

    redirectUrl.searchParams.set('payment_type', paymentType)
    redirectUrl.searchParams.set('order_type', context.orderType)

    if (context.planId) {
      redirectUrl.searchParams.set('plan_id', String(context.planId))
    } else {
      redirectUrl.searchParams.delete('plan_id')
    }

    if (context.orderAmount > 0) {
      redirectUrl.searchParams.set('amount', String(context.orderAmount))
    } else {
      redirectUrl.searchParams.delete('amount')
    }

    targetUrl.searchParams.set('redirect', `${redirectUrl.pathname}${redirectUrl.search}`)
    return targetUrl.toString()
  } catch {
    return normalizedUrl
  }
}

function shouldFallbackToDesktopQr(err: unknown, paymentMethod: string, attempted: boolean): boolean {
  if (attempted || !isMobileDevice()) {
    return false
  }

  const normalizedMethod = normalizeVisibleMethod(paymentMethod) || paymentMethod
  const reason = typeof err === 'object' && err && 'reason' in err && typeof err.reason === 'string'
    ? err.reason
    : ''
  const message = err instanceof Error
    ? err.message
    : (typeof err === 'object' && err && 'message' in err && typeof err.message === 'string'
      ? err.message
      : '')
  const normalizedMessage = message.toLowerCase()

  if (normalizedMethod === 'wxpay') {
    return reason === 'WECHAT_H5_NOT_AUTHORIZED'
      || reason === 'WECHAT_PAYMENT_MP_NOT_CONFIGURED'
      || reason === 'WECHAT_JSAPI_FAILED'
      || reason === 'PAYMENT_GATEWAY_ERROR'
      || reason === 'UNHANDLED_PAYMENT_SCENARIO'
      || normalizedMessage.includes('weixinjsbridge is unavailable')
      || normalizedMessage.includes('wechat_jsapi_unavailable')
  }

  if (normalizedMethod === 'alipay') {
    return reason === 'PAYMENT_GATEWAY_ERROR' || reason === 'UNHANDLED_PAYMENT_SCENARIO'
  }

  return false
}

function currencyFractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

function roundPaymentAmount(value: number, currency: string): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** currencyFractionDigits(currency)
  return Math.round(value * factor) / factor
}

function ceilPaymentAmount(value: number, currency: string): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** currencyFractionDigits(currency)
  return Math.ceil(value * factor) / factor
}

/** 解析路由 query 中的 Stripe / Airwallex 落地页地址（对应 Vue 版 router.resolve(...).href） */
function resolveHref(path: string, query: RouteQuery): string {
  return path + queryToSearch(query)
}

export default function PaymentView() {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const user = useAuthStore((s) => s.user)
  const activeSubscriptions = useSubscriptionStore((s) => s.activeSubscriptions)
  const publicSettings = useAppStore((s) => s.cachedPublicSettings)

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>('recharge')
  const [amount, setAmountState] = useState<number | null>(null)
  const [selectedMethod, setSelectedMethodState] = useState('')
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null)
  const [previewImage, setPreviewImage] = useState('')
  const [paymentPhase, setPaymentPhase] = useState<'select' | 'paying'>('select')
  const [paymentState, setPaymentState] = useState<PaymentRecoverySnapshot>(emptyPaymentState)
  // All checkout data from single API call
  const [checkout, setCheckoutState] = useState<CheckoutInfoResponse>(EMPTY_CHECKOUT)
  // Renewal modal state
  const [showRenewalModal, setShowRenewalModal] = useState(false)
  const [renewGroupId, setRenewGroupId] = useState<number | null>(null)

  // 异步下单流程（含挂载时的微信回跳续付）需要读取最新值：状态同时镜像到 ref
  const checkoutRef = useRef(checkout)
  const selectedMethodRef = useRef(selectedMethod)
  const amountRef = useRef(amount)
  // 错误文案只用于拼接 toast，不在页面上展示
  const errorMessage = useRef('')
  const errorHintMessage = useRef('')

  function setCheckout(value: CheckoutInfoResponse) {
    checkoutRef.current = value
    setCheckoutState(value)
  }
  function setSelectedMethod(value: string) {
    selectedMethodRef.current = value
    setSelectedMethodState(value)
  }
  function setAmount(value: number | null) {
    amountRef.current = value
    setAmountState(value)
  }

  function subscriptionHasPeakRate(sub: { group?: PeakRateFields | null }): boolean {
    return hasPeakRate(sub.group)
  }

  function subscriptionPeakRateLabel(sub: { group?: PeakRateFields | null }): string {
    return formatPeakRateWindow(sub.group, serverTimezoneLabel(publicSettings?.server_utc_offset))
  }

  const renderedHelpText = useMemo(() => DOMPurify.sanitize(
    marked.parse(checkout.help_text || '', { async: false, gfm: true, breaks: false }),
  ), [checkout.help_text])

  // 充值赠送活动文案：后台 Markdown 配置，空字符串时金额卡顶部不渲染
  const renderedBonusNotice = useMemo(() => {
    const raw = (checkout.recharge_bonus_notice || '').trim()
    if (!raw) return ''
    return renderSanitizedMarkdown(raw)
  }, [checkout.recharge_bonus_notice])

  // 订阅功能开关（public settings 的 subscription_enabled，opt-out）。关闭后购买页只保留充值：
  // 不再渲染「订阅」tab，只剩单个 tab 时顶部切换器也随之隐藏。
  const subscriptionEnabled = resolveFeatureFlag(publicSettings, FeatureFlags.subscription)
  const subscriptionEnabledRef = useRef(subscriptionEnabled)
  useEffect(() => {
    subscriptionEnabledRef.current = subscriptionEnabled
  }, [subscriptionEnabled])

  const tabs: { key: TabKey; label: string }[] = []
  if (!checkout.balance_disabled) tabs.push({ key: 'recharge', label: t('payment.tabTopUp') })
  if (subscriptionEnabled) tabs.push({ key: 'subscription', label: t('payment.tabSubscribe') })

  // tab 列表随 checkout（balance_disabled）与订阅开关变化。当前 tab 不在列表里时收敛到第一个可用 tab，
  // 两个方向都覆盖：关闭订阅 → 回到充值；仅订阅站点重新打开订阅 → 进入订阅。列表为空时模板展示不可用提示。
  if (!tabs.some((tab) => tab.key === activeTab)) {
    const next = tabs[0]?.key ?? 'recharge'
    if (next !== activeTab) {
      setActiveTab(next)
      if (activeTab === 'subscription') setSelectedPlan(null)
    }
  }

  const visibleMethods = useMemo(() => getVisibleMethods(checkout.methods), [checkout.methods])
  const enabledMethods = Object.keys(visibleMethods)
  const validAmount = amount ?? 0
  const balanceRechargeMultiplier = Number.isFinite(checkout.balance_recharge_multiplier) && checkout.balance_recharge_multiplier > 0
    ? checkout.balance_recharge_multiplier
    : 1
  // 订阅 CNY 换算汇率（1 USD = X CNY）。0 = 未配置，订阅保持 price 直付（与后端 opt-in 条件严格镜像）。
  const subscriptionUsdToCnyRate = Number.isFinite(checkout.subscription_usd_to_cny_rate) && checkout.subscription_usd_to_cny_rate > 0
    ? checkout.subscription_usd_to_cny_rate
    : 0
  const rechargeBonusTiers = useMemo(() => normalizeRechargeBonusTiers(checkout.recharge_bonus_tiers), [checkout.recharge_bonus_tiers])
  const rechargeBonusMode = normalizeRechargeBonusMode(checkout.recharge_bonus_mode)

  // Adaptive grid: 2-col for up to 2 plans, 3-col for 3+
  const planGridColumns = checkout.plans.length <= 2 ? 2 : 3

  // Check if an amount fits a method's [min, max]. 0 = no limit.
  function amountFitsMethod(amt: number, methodType: string): boolean {
    if (amt <= 0) return true
    const ml = visibleMethods[methodType]
    if (!ml) return false
    if (ml.single_min > 0 && amt < ml.single_min) return false
    if (ml.single_max > 0 && amt > ml.single_max) return false
    return true
  }

  // Visible methods decide the amount range shown to users.
  const limits = Object.values(visibleMethods)
  const globalMinAmount = limits.length === 0 || limits.some((limit) => limit.single_min <= 0)
    ? 0
    : Math.min(...limits.map((limit) => limit.single_min))
  const globalMaxAmount = limits.length === 0 || limits.some((limit) => limit.single_max <= 0)
    ? 0
    : Math.max(...limits.map((limit) => limit.single_max))

  // Selected method's limits (for validation and error messages)
  const selectedLimit = visibleMethods[selectedMethod]
  const selectedCurrency = normalizePaymentCurrency(selectedLimit?.currency)

  function subscriptionPaymentAmountForCurrency(value: number, currency: string): number {
    const rate = subscriptionUsdToCnyRate
    if (rate <= 0 || currency !== DEFAULT_PAYMENT_CURRENCY) return roundPaymentAmount(value, currency)
    return roundPaymentAmount(value * rate, currency)
  }

  function formatSelectedPaymentAmount(value: number): string {
    return formatPaymentAmount(value, selectedCurrency, locale)
  }

  function formatSelectedSubscriptionPaymentAmount(value: number): string {
    return formatSelectedPaymentAmount(subscriptionPaymentAmountForCurrency(value, selectedCurrency))
  }

  // 充值优惠：阈值按输入金额命中；赠金模式按到账基数（输入 × 倍率）加赠送，折扣模式按百分比减实付。
  // 与后端 quoteRechargeBonus 一致；渠道限额、手续费、实付都按折后基数（payBaseAmount）计算，提交仍发送输入金额。
  const bonusQuote = quoteRechargeBonus(rechargeBonusTiers, validAmount, {
    multiplier: balanceRechargeMultiplier,
    mode: rechargeBonusMode,
    currencyDigits: currencyFractionDigits(selectedCurrency),
  })
  const payBaseAmount = bonusQuote.payBase
  const discountAmount = roundPaymentAmount(validAmount - payBaseAmount, selectedCurrency)
  const creditedAmount = bonusQuote.credited
  const showBonusRow = bonusQuote.mode !== 'discount' && bonusQuote.bonus > 0
  const showCreditedBalance = balanceRechargeMultiplier !== 1 || bonusQuote.percent > 0

  const methodOptions: PaymentMethodOption[] = enabledMethods.map((type) => {
    const ml = visibleMethods[type]
    return {
      type,
      display_name: ml?.display_name,
      fee_rate: ml?.fee_rate ?? 0,
      available: ml?.available !== false && amountFitsMethod(payBaseAmount, type),
    }
  })

  const feeRate = checkout.recharge_fee_rate ?? 0
  const feeAmount = feeRate > 0 && payBaseAmount > 0
    ? Math.ceil(((payBaseAmount * feeRate) / 100) * 100) / 100
    : 0
  const totalAmount = feeRate > 0 && payBaseAmount > 0
    ? Math.round((payBaseAmount + feeAmount) * 100) / 100
    : payBaseAmount
  const showActualPay = feeRate > 0 || discountAmount > 0

  let amountError = ''
  if (validAmount > 0) {
    if (!enabledMethods.some((m) => amountFitsMethod(payBaseAmount, m))) {
      // No method can handle this amount
      amountError = t('payment.amountNoMethod')
    } else if (selectedLimit) {
      // Selected method can't handle this amount (but others can)
      if (selectedLimit.single_min > 0 && payBaseAmount < selectedLimit.single_min) {
        amountError = t('payment.amountTooLow', { min: formatSelectedPaymentAmount(selectedLimit.single_min) })
      } else if (selectedLimit.single_max > 0 && payBaseAmount > selectedLimit.single_max) {
        amountError = t('payment.amountTooHigh', { max: formatSelectedPaymentAmount(selectedLimit.single_max) })
      }
    }
  }

  const canSubmit = validAmount > 0
    && amountFitsMethod(payBaseAmount, selectedMethod)
    && selectedLimit?.available !== false

  const subPaymentAmount = subscriptionPaymentAmountForCurrency(selectedPlan?.price ?? 0, selectedCurrency)
  const subFeeAmount = feeRate <= 0 || subPaymentAmount <= 0
    ? 0
    : ceilPaymentAmount((subPaymentAmount * feeRate) / 100, selectedCurrency)
  const subTotalAmount = feeRate <= 0 || subPaymentAmount <= 0
    ? subPaymentAmount
    : roundPaymentAmount(subPaymentAmount + subFeeAmount, selectedCurrency)

  function subscriptionTotalAmountForCurrency(value: number, currency: string): number {
    const paymentAmount = subscriptionPaymentAmountForCurrency(value, currency)
    if (feeRate <= 0 || paymentAmount <= 0) return paymentAmount
    const fee = ceilPaymentAmount((paymentAmount * feeRate) / 100, currency)
    return roundPaymentAmount(paymentAmount + fee, currency)
  }

  // Subscription-specific: method options based on gateway pay amount
  const subMethodOptions: PaymentMethodOption[] = enabledMethods.map((type) => {
    const ml = visibleMethods[type]
    const currency = normalizePaymentCurrency(ml?.currency)
    return {
      type,
      display_name: ml?.display_name,
      fee_rate: ml?.fee_rate ?? 0,
      available: ml?.available !== false && amountFitsMethod(subscriptionTotalAmountForCurrency(selectedPlan?.price ?? 0, currency), type),
    }
  })

  const canSubmitSubscription = selectedPlan !== null
    && amountFitsMethod(subTotalAmount, selectedMethod)
    && selectedLimit?.available !== false

  // Auto-switch to first available method when current selection can't handle the amount
  useEffect(() => {
    if (payBaseAmount <= 0 || amountFitsMethod(payBaseAmount, selectedMethod)) return
    const available = enabledMethods.find((m) => amountFitsMethod(payBaseAmount, m))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 对应 Vue 版 watch：金额或方式变化时切换到可用方式
    if (available) setSelectedMethod(available)
    // 与 Vue 版 watch([payBaseAmount, selectedMethod]) 一致：只在这两个值变化时检查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payBaseAmount, selectedMethod])

  const renewalPlans = renewGroupId == null ? [] : checkout.plans.filter((p) => p.group_id === renewGroupId)
  const planValiditySuffix = selectedPlan ? validitySuffixOf(selectedPlan, t) : ''

  function planPeakRateLabel(plan: SubscriptionPlan): string {
    return formatPeakRateWindow(plan, serverTimezoneLabel(publicSettings?.server_utc_offset))
  }

  function resetPayment() {
    setPaymentPhase('select')
    setPaymentState(emptyPaymentState())
    removeRecoverySnapshot()
  }

  async function redirectToPaymentResult(state: PaymentRecoverySnapshot): Promise<void> {
    const query: RouteQuery = {}
    if (state.orderId > 0) {
      query.order_id = String(state.orderId)
    }
    if (state.outTradeNo) {
      query.out_trade_no = state.outTradeNo
    }
    if (state.resumeToken) {
      query.resume_token = state.resumeToken
    }
    await navigate('/payment/result' + queryToSearch(query))
  }

  function onPaymentDone() {
    const wasSubscription = paymentState.orderType === 'subscription'
    resetPayment()
    setSelectedPlan(null)
    if (wasSubscription) {
      useSubscriptionStore.getState().fetchActiveSubscriptions(true).catch(() => {})
    }
  }

  async function onPaymentSuccess() {
    const completedPayment = { ...paymentState }
    removeRecoverySnapshot()
    void useAuthStore.getState().refreshUser().catch(() => {})
    if (paymentState.orderType === 'subscription') {
      useSubscriptionStore.getState().fetchActiveSubscriptions(true).catch(() => {})
    }
    await redirectToPaymentResult(completedPayment)
  }

  function onPaymentSettled() {
    removeRecoverySnapshot()
  }

  function selectPlan(plan: SubscriptionPlan) {
    setSelectedPlan(plan)
    errorMessage.current = ''
  }

  function selectPlanFromModal(plan: SubscriptionPlan) {
    setShowRenewalModal(false)
    setRenewGroupId(null)
    setSelectedPlan(plan)
    errorMessage.current = ''
  }

  function closeRenewalModal() {
    setShowRenewalModal(false)
    setRenewGroupId(null)
  }

  function applyScenarioError(err: unknown, paymentMethod: string): boolean {
    const descriptor = describePaymentScenarioError(err, {
      paymentMethod,
      isMobile: isMobileDevice(),
      isWechatBrowser: isWechatBrowser(),
    })
    if (!descriptor) {
      errorMessage.current = ''
      errorHintMessage.current = ''
      return false
    }
    errorMessage.current = t(descriptor.messageKey)
    errorHintMessage.current = descriptor.hintKey ? t(descriptor.hintKey) : ''
    useAppStore.getState().showError(buildPaymentErrorToastMessage(errorMessage.current, errorHintMessage.current))
    return true
  }

  async function attemptMobileQrFallback(err: unknown, context: MobileQrFallbackContext): Promise<boolean> {
    if (!shouldFallbackToDesktopQr(err, context.paymentType, context.attempted)) {
      return false
    }

    try {
      const visibleMethod = normalizeVisibleMethod(context.paymentType) || context.paymentType
      const payload = buildCreateOrderPayload({
        amount: context.orderAmount,
        paymentType: visibleMethod,
        orderType: context.orderType,
        planId: context.planId,
        origin: typeof window !== 'undefined' ? window.location.origin : '',
        isMobile: false,
        isWechatBrowser: false,
      })
      const result = await usePaymentStore.getState().createOrder(payload) as CreateOrderResult & { resume_token?: string }
      const stripeMethod = visibleMethod === 'wxpay' ? 'wechat_pay' : 'alipay'
      const stripeRouteUrl = result.client_secret
        ? resolveHref('/payment/stripe', {
          order_id: String(result.order_id),
          method: stripeMethod,
          resume_token: result.resume_token || undefined,
        })
        : ''
      const decision = decidePaymentLaunch(result, {
        visibleMethod,
        orderType: context.orderType,
        isMobile: false,
        isWechatBrowser: false,
        stripePopupUrl: stripeRouteUrl,
        stripeRouteUrl,
      })

      if (decision.kind !== 'qr_waiting' || !decision.paymentState.qrCode) {
        return false
      }

      errorMessage.current = ''
      errorHintMessage.current = ''
      setPaymentState(decision.paymentState)
      setPaymentPhase('paying')
      persistRecoverySnapshot(decision.recovery)
      useAppStore.getState().showWarning(t('payment.errors.mobilePaymentFallbackToQr'))
      return true
    } catch {
      return false
    }
  }

  async function createOrder(orderAmount: number, orderType: OrderType, planId?: number, options: CreateOrderOptions = {}) {
    const currentCheckout = checkoutRef.current
    const currentMethod = selectedMethodRef.current
    setSubmitting(true)
    errorMessage.current = ''
    errorHintMessage.current = ''
    const requestType = normalizeVisibleMethod(options.paymentType || currentMethod) || options.paymentType || currentMethod
    try {
      const payload = buildCreateOrderPayload({
        amount: orderAmount,
        paymentType: requestType,
        orderType,
        planId,
        origin: typeof window !== 'undefined' ? window.location.origin : '',
        isMobile: isMobileDevice(),
        isWechatBrowser: isWechatBrowser(),
        forceQRCode: !!(currentCheckout.alipay_force_qrcode && normalizeVisibleMethod(requestType) === 'alipay'),
        mobilePrecreateDeepLink: currentCheckout.alipay_mobile_precreate_deep_link === true,
      })
      if (options.openid) {
        payload.openid = options.openid
      }
      if (options.wechatResumeToken) {
        payload.wechat_resume_token = options.wechatResumeToken
      }

      const result = await usePaymentStore.getState().createOrder(payload) as CreateOrderResult & { resume_token?: string }
      const openWindow = (url: string) => {
        const win = window.open(url, 'paymentPopup', getPaymentPopupFeatures())
        if (!win || win.closed) {
          window.location.href = url
        }
      }
      const visibleMethod = normalizeVisibleMethod(requestType) || requestType
      // When user clicks the dedicated Stripe button, leave method blank so the
      // landing page renders Stripe's full Payment Element (card/link/alipay/wxpay).
      const stripeMethod = visibleMethod === 'stripe'
        ? ''
        : visibleMethod === 'wxpay' ? 'wechat_pay' : 'alipay'
      const stripeRouteUrl = result.client_secret && visibleMethod !== 'airwallex'
        ? resolveHref('/payment/stripe', {
          order_id: String(result.order_id),
          method: stripeMethod || undefined,
          resume_token: result.resume_token || undefined,
        })
        : ''
      const airwallexRouteUrl = result.client_secret && result.intent_id
        ? resolveHref('/payment/airwallex', {
          order_id: String(result.order_id),
          out_trade_no: result.out_trade_no || undefined,
          resume_token: result.resume_token || undefined,
        })
        : ''
      const decision = decidePaymentLaunch(result, {
        visibleMethod,
        orderType,
        isMobile: isMobileDevice(),
        isWechatBrowser: isWechatBrowser(),
        forceQRCode: !!(currentCheckout.alipay_force_qrcode && visibleMethod === 'alipay'),
        mobilePrecreateDeepLink: currentCheckout.alipay_mobile_precreate_deep_link === true,
        stripePopupUrl: stripeRouteUrl,
        stripeRouteUrl,
        airwallexRouteUrl,
      })

      if (decision.kind === 'wechat_oauth' && decision.oauth?.authorize_url) {
        window.location.href = buildWechatOAuthAuthorizeUrl(decision.oauth.authorize_url, {
          paymentType: visibleMethod,
          orderType,
          planId,
          orderAmount,
        })
        return
      }

      if (decision.kind === 'unhandled') {
        applyScenarioError({ reason: 'UNHANDLED_PAYMENT_SCENARIO' }, visibleMethod)
        return
      }

      setPaymentState(decision.paymentState)
      setPaymentPhase('paying')
      persistRecoverySnapshot(decision.recovery)

      if (decision.kind === 'stripe_popup') {
        openWindow(decision.paymentState.payUrl)
        return
      }
      if (decision.kind === 'stripe_route') {
        window.location.href = decision.paymentState.payUrl
        return
      }
      if (decision.kind === 'airwallex_route') {
        window.location.href = decision.paymentState.payUrl
        return
      }
      if (decision.kind === 'wechat_jsapi' && decision.jsapi) {
        try {
          const jsapiResult = await invokeWechatJsapiPayment(decision.jsapi as Record<string, unknown>)
          const errMsg = String(jsapiResult.err_msg || '').toLowerCase()
          if (errMsg.includes('cancel')) {
            useAppStore.getState().showInfo(t('payment.qr.cancelled'))
            resetPayment()
          } else if (errMsg && !errMsg.includes('ok')) {
            resetPayment()
            const fallbackApplied = await attemptMobileQrFallback(
              { reason: 'WECHAT_JSAPI_FAILED', message: errMsg },
              {
                orderAmount,
                orderType,
                planId,
                paymentType: visibleMethod,
                attempted: options.mobileQrFallbackAttempted === true,
              },
            )
            if (!fallbackApplied) {
              applyScenarioError({ reason: 'WECHAT_JSAPI_FAILED', message: errMsg }, visibleMethod)
            }
          } else {
            const resultState = { ...decision.paymentState }
            resetPayment()
            await redirectToPaymentResult(resultState)
          }
        } catch (err: unknown) {
          resetPayment()
          const fallbackApplied = await attemptMobileQrFallback(err, {
            orderAmount,
            orderType,
            planId,
            paymentType: visibleMethod,
            attempted: options.mobileQrFallbackAttempted === true,
          })
          if (!fallbackApplied) {
            throw err
          }
        }
        return
      }
      if (decision.kind === 'redirect_waiting' && decision.paymentState.payUrl) {
        if (isMobileDevice()) {
          window.location.href = decision.paymentState.payUrl
          return
        }
        openWindow(decision.paymentState.payUrl)
      }
    } catch (err: unknown) {
      const apiErr = err as Record<string, unknown>
      if (apiErr.reason === 'TOO_MANY_PENDING') {
        const metadata = apiErr.metadata as Record<string, unknown> | undefined
        errorMessage.current = t('payment.errors.tooManyPending', { max: metadata?.max || '' })
        errorHintMessage.current = ''
      } else if (apiErr.reason === 'CANCEL_RATE_LIMITED') {
        errorMessage.current = t('payment.errors.cancelRateLimited')
        errorHintMessage.current = ''
      } else if (await attemptMobileQrFallback(err, {
        orderAmount,
        orderType,
        planId,
        paymentType: requestType,
        attempted: options.mobileQrFallbackAttempted === true,
      })) {
        return
      } else {
        const handled = applyScenarioError(
          err,
          normalizeVisibleMethod(options.paymentType || selectedMethodRef.current) || selectedMethodRef.current,
        )
        if (!handled) {
          errorMessage.current = extractI18nErrorMessage(err, t, 'payment.errors', extractApiErrorMessage(err, t('payment.result.failed')))
          errorHintMessage.current = ''
        }
        if (handled) {
          return
        }
      }
      useAppStore.getState().showError(buildPaymentErrorToastMessage(errorMessage.current, errorHintMessage.current))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmitRecharge() {
    if (!canSubmit || submitting) return
    await createOrder(validAmount, 'balance')
  }

  async function confirmSubscribe() {
    if (!selectedPlan || submitting) return
    await createOrder(selectedPlan.price, 'subscription', selectedPlan.id)
  }

  // 挂载时加载结算信息、恢复进行中的支付、处理微信回跳与续费跳转（只执行一次）
  useEffect(() => {
    let cancelled = false
    const query = searchParamsToQuery(searchParams)
    const path = location.pathname

    async function resumeWechatPaymentFromQuery(plans: SubscriptionPlan[]) {
      const resume = parseWechatResumeRoute(query, plans, amountRef.current ?? 0)
      if (!resume) {
        return
      }

      setSelectedMethod(resume.paymentType)
      if (resume.orderType === 'balance' && resume.orderAmount > 0) {
        setAmount(resume.orderAmount)
      }
      if (resume.orderType === 'subscription' && resume.planId) {
        setSelectedPlan(plans.find((plan) => plan.id === resume.planId) ?? null)
      }

      await navigate(path + queryToSearch(stripWechatResumeQuery(query)), { replace: true })

      if (resume.wechatResumeToken) {
        await createOrder(0, resume.orderType, resume.planId, {
          wechatResumeToken: resume.wechatResumeToken,
          paymentType: resume.paymentType,
          isResume: true,
        })
        return
      }

      if (resume.orderAmount > 0 && resume.openid) {
        await createOrder(resume.orderAmount, resume.orderType, resume.planId, {
          openid: resume.openid,
          paymentType: resume.paymentType,
          isResume: true,
        })
      }
    }

    void (async () => {
      try {
        const res = await paymentAPI.getCheckoutInfo()
        if (cancelled) return
        const data = res.data
        setCheckout(data)
        const methods = getVisibleMethods(data.methods)
        const enabled = Object.keys(methods)
        if (enabled.length) {
          const order: readonly string[] = METHOD_ORDER
          const sorted = [...enabled].sort((a, b) => {
            const ai = order.indexOf(a)
            const bi = order.indexOf(b)
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
          })
          setSelectedMethod(sorted[0])
        }
        if (typeof window !== 'undefined') {
          if (hasWechatResumeQuery(query)) {
            removeRecoverySnapshot()
          }
          const routeResumeToken = typeof query.resume_token === 'string'
            ? query.resume_token
            : typeof query.wechat_resume_token === 'string'
              ? query.wechat_resume_token
              : undefined
          const restored = readPaymentRecoverySnapshot(
            window.localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY),
            { resumeToken: routeResumeToken },
          )
          if (restored) {
            setPaymentState(restored)
            setPaymentPhase('paying')
            const restoredMethod = normalizeVisibleMethod(restored.paymentType)
              || (methods[restored.paymentType] ? restored.paymentType : '')
            if (restoredMethod) {
              setSelectedMethod(restoredMethod)
            }
          } else {
            removeRecoverySnapshot()
          }
        }
        await resumeWechatPaymentFromQuery(data.plans)
        if (cancelled) return
        // balance_disabled → the tab invariant above moves activeTab to the subscription tab (when enabled).
        // Handle renewal navigation: ?tab=subscription&group=123 (ignored when subscriptions are disabled)
        if (query.tab === 'subscription' && subscriptionEnabledRef.current) {
          setActiveTab('subscription')
          if (query.group) {
            const groupId = Number(query.group)
            const groupPlans = data.plans.filter((p) => p.group_id === groupId)
            if (groupPlans.length === 1) {
              setSelectedPlan(groupPlans[0])
            } else if (groupPlans.length > 1) {
              setRenewGroupId(groupId)
              setShowRenewalModal(true)
            }
          }
        }
      } catch (err: unknown) {
        if (!cancelled) useAppStore.getState().showError(extractI18nErrorMessage(err, t, 'payment.errors', t('common.error')))
      } finally {
        if (!cancelled) setLoading(false)
      }
      if (cancelled) return
      // Fetch active subscriptions (uses cache, non-blocking); skipped when the subscription feature is off
      if (subscriptionEnabledRef.current) {
        useSubscriptionStore.getState().fetchActiveSubscriptions().catch(() => {})
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 图片预览：Escape 关闭
  useEffect(() => {
    if (!previewImage) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewImage('')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [previewImage])

  const submitLabel = (total: number) => (submitting
    ? t('common.processing')
    : `${t('payment.createOrder')} ${formatSelectedPaymentAmount(total)}`)

  function renderRechargeTab() {
    return (
      <>
        {/* Recharge Account Card */}
        <section className={styles.region}>
          <p className={styles.caption}>{t('payment.rechargeAccount')}</p>
          <p className={styles.account}>{user?.username || ''}</p>
          <p className={styles.balance}>{t('payment.currentBalance')}: {user?.balance?.toFixed(2) || '0.00'}</p>
        </section>
        {enabledMethods.length === 0 ? (
          <section className={`${styles.region} ${styles.emptyRegion}`}>
            <p className={styles.muted}>{t('payment.notAvailable')}</p>
          </section>
        ) : (
          <>
            <section className={styles.region}>
              {/* 充值赠送活动文案（后台 Markdown 配置，空则不渲染） */}
              {renderedBonusNotice && (
                <div
                  className={`markdown-body ${styles.bonusNotice}`}
                  data-testid="recharge-bonus-notice"
                  dangerouslySetInnerHTML={{ __html: renderedBonusNotice }}
                />
              )}
              <AmountInput
                value={amount}
                onChange={setAmount}
                amounts={QUICK_AMOUNTS}
                min={globalMinAmount}
                max={globalMaxAmount}
                bonusTiers={rechargeBonusTiers}
                bonusMode={rechargeBonusMode}
                multiplier={balanceRechargeMultiplier}
                currency={selectedCurrency}
              />
              {amountError && <p className={styles.amountError}>{amountError}</p>}
            </section>
            {enabledMethods.length >= 1 && (
              <section className={styles.region}>
                <PaymentMethodSelector methods={methodOptions} selected={selectedMethod} onSelect={setSelectedMethod} />
              </section>
            )}
            {validAmount > 0 && (
              <section className={styles.region}>
                <div className={styles.summary}>
                  <div className={styles.summaryRow}>
                    <span className={styles.summaryLabel}>{t('payment.paymentAmount')}</span>
                    <span className={discountAmount > 0 ? styles.struck : styles.summaryValue}>{formatSelectedPaymentAmount(validAmount)}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className={styles.summaryRow} data-testid="recharge-discount-row">
                      <span className={styles.summaryLabel}>{t('payment.rechargeBonus.discountLabelWithPercent', { percent: formatRechargeBonusNumber(bonusQuote.percent) })}</span>
                      <span className={styles.danger}>-{formatSelectedPaymentAmount(discountAmount)}</span>
                    </div>
                  )}
                  {feeRate > 0 && (
                    <div className={styles.summaryRow}>
                      <span className={styles.summaryLabel}>{t('payment.fee')} ({feeRate}%)</span>
                      <span className={styles.summaryValue}>{formatSelectedPaymentAmount(feeAmount)}</span>
                    </div>
                  )}
                  {showActualPay && (
                    <div className={`${styles.summaryRow} ${styles.divided}`}>
                      <span className={styles.totalLabel}>{t('payment.actualPay')}</span>
                      <span className={styles.total}>{formatSelectedPaymentAmount(totalAmount)}</span>
                    </div>
                  )}
                  {showBonusRow && (
                    <div className={`${styles.summaryRow} ${!showActualPay ? styles.divided : ''}`} data-testid="recharge-bonus-row">
                      <span className={styles.summaryLabel}>{t('payment.rechargeBonus.amountLabelWithPercent', { percent: formatRechargeBonusNumber(bonusQuote.percent) })}</span>
                      <span className={styles.danger}>+${bonusQuote.bonus.toFixed(2)}</span>
                    </div>
                  )}
                  {showCreditedBalance && (
                    <div className={`${styles.summaryRow} ${!showActualPay && !showBonusRow ? styles.divided : ''}`} data-testid="recharge-credited-row">
                      <span className={styles.summaryLabel}>{t('payment.creditedBalance')}</span>
                      <span className={styles.summaryValue}>${creditedAmount.toFixed(2)}</span>
                    </div>
                  )}
                  {balanceRechargeMultiplier !== 1 && (
                    <p className={`${styles.rate} ${styles.divided}`}>
                      {t('payment.rechargeRatePreview', { currency: selectedCurrency, usd: balanceRechargeMultiplier.toFixed(2) })}
                    </p>
                  )}
                </div>
              </section>
            )}
            <Button type="button" size="lg" className={styles.submit} disabled={!canSubmit} loading={submitting} onClick={handleSubmitRecharge}>
              {submitLabel(totalAmount)}
            </Button>
          </>
        )}
      </>
    )
  }

  function renderSubscriptionConfirm(plan: SubscriptionPlan) {
    const accentStyle = { '--plan-accent': platformAccentColor(plan.group_platform || '') } as CSSProperties
    return (
      <>
        <section className={`${styles.region} ${styles.planConfirm}`} style={accentStyle}>
          {/* Header: platform badge + plan name */}
          <div className={styles.planHeader}>
            <Badge size="sm">{platformLabel(plan.group_platform || '')}</Badge>
            <h2 className={styles.planName}>{plan.name}</h2>
          </div>
          {/* Price */}
          <div className={styles.planPrice}>
            {!!plan.original_price && (
              <span className={styles.struck}>{formatSelectedSubscriptionPaymentAmount(plan.original_price)}</span>
            )}
            <span className={styles.planPriceValue}>{formatSelectedSubscriptionPaymentAmount(plan.price)}</span>
            <span className={styles.muted}>/ {planValiditySuffix}</span>
          </div>
          {/* Description */}
          {plan.description && <p className={styles.planDescription}>{plan.description}</p>}
          {/* Rate + Limits grid */}
          <dl className={styles.planFacts}>
            <div>
              <dt>{t('payment.planCard.rate')}</dt>
              <dd>×{plan.rate_multiplier ?? 1}</dd>
            </div>
            {hasPeakRate(plan) && (
              <div>
                <dt>{t('payment.planCard.peakRate')}</dt>
                <dd className={styles.peak}>{planPeakRateLabel(plan)}</dd>
              </div>
            )}
            {plan.daily_limit_usd != null && (
              <div>
                <dt>{t('payment.planCard.dailyLimit')}</dt>
                <dd>${plan.daily_limit_usd}</dd>
              </div>
            )}
            {plan.weekly_limit_usd != null && (
              <div>
                <dt>{t('payment.planCard.weeklyLimit')}</dt>
                <dd>${plan.weekly_limit_usd}</dd>
              </div>
            )}
            {plan.monthly_limit_usd != null && (
              <div>
                <dt>{t('payment.planCard.monthlyLimit')}</dt>
                <dd>${plan.monthly_limit_usd}</dd>
              </div>
            )}
            {plan.daily_limit_usd == null && plan.weekly_limit_usd == null && plan.monthly_limit_usd == null && (
              <div>
                <dt>{t('payment.planCard.quota')}</dt>
                <dd>{t('payment.planCard.unlimited')}</dd>
              </div>
            )}
          </dl>
        </section>
        {enabledMethods.length >= 1 && (
          <section className={styles.region}>
            <PaymentMethodSelector methods={subMethodOptions} selected={selectedMethod} onSelect={setSelectedMethod} />
          </section>
        )}
        {feeRate > 0 && plan.price > 0 && (
          <section className={styles.region}>
            <div className={styles.summary}>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>{t('payment.amountLabel')}</span>
                <span className={styles.summaryValue}>{formatSelectedPaymentAmount(subPaymentAmount)}</span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>{t('payment.fee')} ({feeRate}%)</span>
                <span className={styles.summaryValue}>{formatSelectedPaymentAmount(subFeeAmount)}</span>
              </div>
              <div className={`${styles.summaryRow} ${styles.divided}`}>
                <span className={styles.totalLabel}>{t('payment.actualPay')}</span>
                <span className={styles.total}>{formatSelectedPaymentAmount(subTotalAmount)}</span>
              </div>
            </div>
          </section>
        )}
        <Button type="button" size="lg" className={styles.submit} disabled={!canSubmitSubscription} loading={submitting} onClick={confirmSubscribe}>
          {submitLabel(subTotalAmount)}
        </Button>
        <Button type="button" variant="secondary" className={styles.submit} onClick={() => setSelectedPlan(null)}>
          {t('common.cancel')}
        </Button>
      </>
    )
  }

  function renderPlanList() {
    return (
      <>
        {checkout.plans.length === 0 ? (
          <section className={`${styles.region} ${styles.emptyRegion}`}>
            <Gift size={32} className={styles.emptyIcon} aria-hidden="true" />
            <p className={styles.muted}>{t('payment.noPlans')}</p>
          </section>
        ) : (
          <div className={styles.planGrid} data-columns={planGridColumns} data-testid="plan-grid">
            {checkout.plans.map((plan) => (
              <SubscriptionPlanCard key={plan.id} plan={plan} activeSubscriptions={activeSubscriptions} onSelect={selectPlan} />
            ))}
          </div>
        )}
        {/* Active subscriptions (compact, below plan list) */}
        {activeSubscriptions.length > 0 && (
          <section className={styles.activeSection}>
            <h2 className={styles.sectionTitle}>{t('payment.activeSubscription')}</h2>
            <ul className={styles.activeList}>
              {activeSubscriptions.map((sub) => {
                const platform = sub.group?.platform || ''
                return (
                  <li
                    key={sub.id}
                    className={styles.activeItem}
                    style={{ '--plan-accent': platformAccentColor(platform) } as CSSProperties}
                  >
                    <span className={styles.activeBar} aria-hidden="true" />
                    <div className={styles.activeBody}>
                      <div className={styles.activeTitle}>
                        <span className={styles.activeName}>{sub.group?.name || t('payment.groupFallback', { id: sub.group_id })}</span>
                        <Badge size="sm">{platformLabel(platform)}</Badge>
                      </div>
                      <div className={styles.activeMeta}>
                        <span>{t('payment.planCard.rate')}: ×{sub.group?.rate_multiplier ?? 1}</span>
                        {subscriptionHasPeakRate(sub) && <span>{t('payment.planCard.peakRate')}: {subscriptionPeakRateLabel(sub)}</span>}
                        {sub.group?.daily_limit_usd == null && sub.group?.weekly_limit_usd == null && sub.group?.monthly_limit_usd == null && (
                          <span>{t('payment.planCard.quota')}: {t('payment.planCard.unlimited')}</span>
                        )}
                        {sub.expires_at
                          ? <span>{t('userSubscriptions.daysRemaining', { days: getDaysRemaining(sub.expires_at) })}</span>
                          : <span>{t('userSubscriptions.noExpiration')}</span>}
                      </div>
                    </div>
                    <Badge tone="success" size="sm">{t('userSubscriptions.status.active')}</Badge>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </>
    )
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <Skeleton lines={2} label={t('common.loading')} />
        <Skeleton lines={5} label={t('common.loading')} />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {/* Tab Switcher (hide during payment and subscription confirm) */}
      {tabs.length > 1 && paymentPhase === 'select' && !selectedPlan && (
        <SegmentedControl
          className={styles.tabs}
          options={tabs.map((tab) => ({ value: tab.key, label: tab.label }))}
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as TabKey)}
        />
      )}
      {paymentPhase === 'paying' ? (
        /* Payment in progress (shared by recharge and subscription) */
        <PaymentStatusPanel
          key={paymentState.orderId}
          orderId={paymentState.orderId}
          amount={paymentState.amount}
          payAmount={paymentState.payAmount}
          qrCode={paymentState.qrCode}
          expiresAt={paymentState.expiresAt}
          paymentType={paymentState.paymentType}
          payUrl={paymentState.payUrl}
          orderType={paymentState.orderType}
          currency={paymentState.currency || selectedCurrency}
          outTradeNo={paymentState.outTradeNo}
          mobileAlipayDeepLink={paymentState.alipayMobilePrecreateDeepLink}
          onDone={onPaymentDone}
          onSuccess={onPaymentSuccess}
          onSettled={onPaymentSettled}
        />
      ) : tabs.length === 0 ? (
        /* Neither top-up nor subscriptions available (balance recharge disabled via API while subscriptions are off) */
        <section className={`${styles.region} ${styles.emptyRegion}`}>
          <p className={styles.muted}>{t('payment.billingUnavailable')}</p>
        </section>
      ) : activeTab === 'recharge' ? (
        renderRechargeTab()
      ) : activeTab === 'subscription' ? (
        selectedPlan ? renderSubscriptionConfirm(selectedPlan) : renderPlanList()
      ) : null}

      {(checkout.help_text || checkout.help_image_url) && paymentPhase === 'select' && !selectedPlan && (
        <section className={`${styles.region} ${styles.help}`}>
          {checkout.help_image_url && (
            <img
              src={checkout.help_image_url}
              alt=""
              className={styles.helpImage}
              onClick={() => setPreviewImage(checkout.help_image_url)}
            />
          )}
          {checkout.help_text && (
            <div className={`markdown-body ${styles.helpText}`} dangerouslySetInnerHTML={{ __html: renderedHelpText }} />
          )}
        </section>
      )}

      {/* Renewal Plan Selection Modal */}
      <BaseDialog show={showRenewalModal} title={t('payment.selectPlan')} onClose={closeRenewalModal} closeOnClickOutside>
        <div className={styles.renewalList}>
          {renewalPlans.map((plan) => (
            <SubscriptionPlanCard key={plan.id} plan={plan} activeSubscriptions={activeSubscriptions} onSelect={selectPlanFromModal} />
          ))}
        </div>
      </BaseDialog>

      {/* Image Preview Overlay */}
      {previewImage && typeof document !== 'undefined' && createPortal(
        <div className={styles.previewOverlay} onClick={() => setPreviewImage('')} data-testid="help-image-preview">
          <img src={previewImage} alt="" className={styles.previewImage} />
        </div>,
        document.body,
      )}
    </div>
  )
}
