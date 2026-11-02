import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, CheckCircle2, Clock, Download, ExternalLink, X } from 'lucide-react'
import QRCode from 'qrcode'

import { Button } from '@/components/arc/button/button'
import { paymentAPI } from '@/api/payment'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { usePaymentStore } from '@/stores/payment'
import type { PaymentOrder } from '@/types/payment'
import { extractI18nErrorMessage } from '@/utils/apiError'
import alipayIcon from '@/assets/icons/alipay.svg'
import wxpayIcon from '@/assets/icons/wxpay.svg'
import paymentIcon from '@/assets/icons/payment.svg'
import {
  createAlipayDeepLinkLauncher,
  type AlipayDeepLinkLauncher,
  type AlipayDeepLinkState,
} from './alipayDeepLink'
import { currencySymbol, formatPaymentAmount, normalizePaymentCurrency } from './currency'
import { getPaymentPopupFeatures, isBuiltInAlipayMethod, isBuiltInWxpayMethod } from './providerConfig'
import { formatCountdown, secondsUntil } from './qrCanvas'
import ui from './paymentUi.module.css'

export type PaymentOutcome = 'success' | 'cancelled' | 'expired'

export interface PaymentStatusPanelProps {
  orderId: number
  amount?: number
  payAmount?: number
  qrCode: string
  expiresAt: string
  paymentType: string
  payUrl?: string
  orderType?: string
  currency?: string
  outTradeNo?: string
  mobileAlipayDeepLink?: boolean
  onDone?: () => void
  onSuccess?: () => void
  onSettled?: (outcome: PaymentOutcome) => void
}

const VERIFY_RETRY_INTERVAL_MS = 15000
const VERIFY_RETRY_MAX_ATTEMPTS = 6

function isSuccessStatus(status: string | null | undefined): boolean {
  return status === 'COMPLETED' || status === 'PAID' || status === 'RECHARGING'
}

/**
 * 支付进行中的状态面板（PaymentView 内联使用）：二维码 / 弹窗等待 / 移动端支付宝唤起，
 * 每 3 秒轮询订单状态，进入终态后展示结果，由用户点击返回。
 * 二维码内容、订单号等在挂载时确定；换单时父组件应以新的 key 重新挂载。
 */
export default function PaymentStatusPanel(props: PaymentStatusPanelProps) {
  const {
    orderId,
    amount,
    payAmount,
    qrCode,
    expiresAt,
    paymentType,
    payUrl,
    orderType,
    currency,
    outTradeNo,
    mobileAlipayDeepLink,
  } = props
  const { t, locale } = useI18n()

  const latest = useRef(props)
  useLayoutEffect(() => {
    latest.current = props
  })

  const qrCanvas = useRef<HTMLCanvasElement | null>(null)
  // 二维码内容在挂载时确定（与 Vue 版初始化时读取 props.qrCode 一致）
  const [qrUrl] = useState(qrCode)
  const [initialSeconds] = useState(() => Math.max(0, secondsUntil(expiresAt)))
  const [remainingSeconds, setRemainingSeconds] = useState(initialSeconds)
  const [cancelling, setCancelling] = useState(false)
  const [paidOrder, setPaidOrder] = useState<PaymentOrder | null>(null)
  const [deepLinkState, setDeepLinkState] = useState<AlipayDeepLinkState>('idle')
  const [deepLinkFallbackVisible, setDeepLinkFallbackVisible] = useState(false)
  // Terminal outcome: null = still active, 'success' | 'cancelled' | 'expired'
  // 挂载时已过期则直接进入 expired 终态
  const [outcome, setOutcomeState] = useState<PaymentOutcome | null>(initialSeconds <= 0 ? 'expired' : null)

  const outcomeRef = useRef<PaymentOutcome | null>(outcome)
  const timers = useRef<{
    poll: ReturnType<typeof setInterval> | null
    countdown: ReturnType<typeof setInterval> | null
  }>({ poll: null, countdown: null })
  const alipayLauncher = useRef<AlipayDeepLinkLauncher | null>(null)

  const paymentCurrency = normalizePaymentCurrency(currency)
  const creditedAmountSymbol = currencySymbol('USD')
  const isAlipay = isBuiltInAlipayMethod(paymentType)
  const isWxpay = isBuiltInWxpayMethod(paymentType)
  const isMobileAlipayDeepLink = mobileAlipayDeepLink === true && isAlipay && !!qrUrl
  const showQRCode = !!qrUrl && (!isMobileAlipayDeepLink || deepLinkFallbackVisible)
  const brand = isAlipay ? 'alipay' : isWxpay ? 'wxpay' : undefined
  const qrLogoIcon = isAlipay ? alipayIcon : isWxpay ? wxpayIcon : paymentIcon

  const scanTitle = isAlipay
    ? t('payment.qr.scanAlipay')
    : isWxpay ? t('payment.qr.scanWxpay') : t('payment.qr.scanToPay')
  const scanHint = isAlipay
    ? t('payment.qr.scanAlipayHint')
    : isWxpay ? t('payment.qr.scanWxpayHint') : ''
  const countdownDisplay = formatCountdown(remainingSeconds)

  function formatGatewayAmount(value: number, valueCurrency?: string | null): string {
    return formatPaymentAmount(value, valueCurrency || paymentCurrency, locale)
  }

  const displayPaymentAmount = formatGatewayAmount(payAmount || amount || 0)
  const displayOrderNumber = outTradeNo || `#${orderId}`

  function cleanup() {
    const current = timers.current
    if (current.poll) { clearInterval(current.poll); current.poll = null }
    if (current.countdown) { clearInterval(current.countdown); current.countdown = null }
    alipayLauncher.current?.dispose()
    alipayLauncher.current = null
  }

  function setOutcome(next: PaymentOutcome) {
    if (outcomeRef.current === next) return
    outcomeRef.current = next
    setOutcomeState(next)
    latest.current.onSettled?.(next)
  }

  // 挂载时启动倒计时与轮询；移动端支付宝唤起在挂载后执行
  useEffect(() => {
    let verifyAttempts = 0
    let lastVerifyAt = 0
    let pollInFlight = false
    const isAlipayMethod = isBuiltInAlipayMethod(paymentType)
    const isWxpayMethod = isBuiltInWxpayMethod(paymentType)

    async function tryRecoverPendingOrder(order: PaymentOrder): Promise<PaymentOrder> {
      if (!isWxpayMethod && !isAlipayMethod) return order
      const tradeNo = String(order.out_trade_no || '').trim()
      if (!tradeNo) return order
      const normalizedStatus = String(order.status || '').trim().toUpperCase()
      if (normalizedStatus !== 'PENDING') return order
      const now = Date.now()
      if (verifyAttempts >= VERIFY_RETRY_MAX_ATTEMPTS || now - lastVerifyAt < VERIFY_RETRY_INTERVAL_MS) {
        return order
      }

      lastVerifyAt = now
      verifyAttempts += 1
      try {
        const result = await paymentAPI.verifyOrder(tradeNo)
        return result.data ?? order
      } catch {
        return order
      }
    }

    async function pollStatus() {
      if (!orderId || outcomeRef.current) return
      // 防重入：接口（含 verifyOrder 二次确认）响应慢于 3 秒轮询间隔时避免并发重叠请求。
      if (pollInFlight) return
      pollInFlight = true
      try {
        let order = await usePaymentStore.getState().pollOrderStatus(orderId)
        if (!order) return
        // 已进入终态则不再处理迟到的响应。
        if (outcomeRef.current) return
        order = await tryRecoverPendingOrder(order)
        if (outcomeRef.current) return
        if (isSuccessStatus(order.status)) {
          cleanup()
          setPaidOrder(order)
          setOutcome('success')
          latest.current.onSuccess?.()
        } else if (order.status === 'CANCELLED') {
          cleanup()
          setOutcome('cancelled')
        } else if (order.status === 'EXPIRED' || order.status === 'FAILED') {
          cleanup()
          setOutcome('expired')
        }
      } finally {
        pollInFlight = false
      }
    }

    const seconds = initialSeconds
    const deadline = Date.now() + seconds * 1000
    if (seconds <= 0) {
      latest.current.onSettled?.('expired')
    } else {
      timers.current.countdown = setInterval(() => {
        const remaining = Math.max(0, Math.floor((deadline - Date.now()) / 1000))
        setRemainingSeconds(remaining)
        if (remaining <= 0) { setOutcome('expired'); cleanup() }
      }, 1000)
    }
    timers.current.poll = setInterval(pollStatus, 3000)

    if (mobileAlipayDeepLink === true && isAlipayMethod && !!qrCode) {
      alipayLauncher.current = createAlipayDeepLinkLauncher({
        qrCode,
        document,
        lifecycleTarget: window,
        userAgent: window.navigator.userAgent,
        assignLocation: (url) => window.location.assign(url),
        onStateChange: (state) => {
          setDeepLinkState(state)
          if (state === 'fallback') {
            setDeepLinkFallbackVisible(true)
          } else if (state === 'backgrounded') {
            setDeepLinkFallbackVisible(false)
          }
        },
      })
      alipayLauncher.current.launch()
    }

    return cleanup
    // 只在挂载时初始化（Vue 版在 setup 中执行一次）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 二维码区域出现或内容变化时绘制
  useEffect(() => {
    const canvas = qrCanvas.current
    if (!showQRCode || !canvas || !qrUrl) return
    void QRCode.toCanvas(canvas, qrUrl, {
      width: 220, margin: 2,
      errorCorrectionLevel: 'M',
    })
  }, [showQRCode, qrUrl])

  function reopenPopup() {
    if (payUrl) {
      const win = window.open(payUrl, 'paymentPopup', getPaymentPopupFeatures())
      if (!win || win.closed) {
        window.location.href = payUrl
      }
    }
  }

  function reopenAlipay() {
    alipayLauncher.current?.launch()
  }

  function saveQRCode() {
    const canvas = qrCanvas.current
    if (!canvas) return
    const link = document.createElement('a')
    link.href = canvas.toDataURL('image/png')
    link.download = `alipay-${outTradeNo || orderId}.png`
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  async function handleCancel() {
    if (!orderId || cancelling) return
    setCancelling(true)
    try {
      await paymentAPI.cancelOrder(orderId)
      cleanup()
      setOutcome('cancelled')
    } catch (err: unknown) {
      useAppStore.getState().showError(extractI18nErrorMessage(err, t, 'payment.errors', t('common.error')))
    } finally {
      setCancelling(false)
    }
  }

  function handleDone() {
    cleanup()
    latest.current.onDone?.()
  }

  const qrBlock = (
    <div className={ui.qrFrame} data-brand={brand}>
      <canvas ref={qrCanvas} className={ui.qrCanvas} />
      {/* Brand logo overlay */}
      <div className={ui.qrLogo}>
        <span className={ui.qrLogoBadge} data-brand={brand}>
          <img src={qrLogoIcon} alt="" />
        </span>
      </div>
    </div>
  )

  const countdownRegion = (withLabel: boolean) => (
    <div className={`${ui.regionCompact} ${ui.centeredTight}`}>
      <div>
        {withLabel && <p className={ui.hint}>{t('payment.qr.expiresIn')}</p>}
        <p className={ui.countdown}>{countdownDisplay}</p>
        <p className={ui.fine}>{t('payment.qr.waitingPayment')}</p>
      </div>
    </div>
  )

  const cancelButton = (
    <Button type="button" variant="secondary" className={ui.fullWidth} disabled={cancelling} onClick={handleCancel}>
      {cancelling ? t('common.processing') : t('payment.qr.cancelOrder')}
    </Button>
  )

  // ═══ Terminal States: show result, user clicks to return ═══
  if (outcome === 'success') {
    return (
      <div className={ui.stack}>
        <div className={ui.region}>
          <div className={ui.centered}>
            <div className={ui.statusIcon} data-tone="success"><Check size={28} aria-hidden="true" /></div>
            <p className={ui.title}>
              {orderType === 'subscription' ? t('payment.result.subscriptionSuccess') : t('payment.result.success')}
            </p>
            {paidOrder && (
              <div className={ui.details}>
                <div className={ui.row}>
                  <span className={ui.rowLabel}>{t('payment.orders.orderId')}</span>
                  <span className={ui.rowValue}>#{paidOrder.id}</span>
                </div>
                {paidOrder.out_trade_no && (
                  <div className={ui.row}>
                    <span className={ui.rowLabel}>{t('payment.orders.orderNo')}</span>
                    <span className={ui.rowValue}>{paidOrder.out_trade_no}</span>
                  </div>
                )}
                <div className={ui.row}>
                  <span className={ui.rowLabel}>{t('payment.orders.amount')}</span>
                  <span className={ui.rowValue}>
                    {creditedAmountSymbol}{paidOrder.amount.toFixed(2)}
                    {(paidOrder.bonus_amount ?? 0) > 0 && (
                      <span className={ui.bonusNote}>
                        ({t('payment.orders.bonusIncluded', { amount: creditedAmountSymbol + (paidOrder.bonus_amount ?? 0).toFixed(2) })})
                      </span>
                    )}
                  </span>
                </div>
                <div className={ui.row}>
                  <span className={ui.rowLabel}>{t('payment.orders.payAmount')}</span>
                  <span className={ui.rowValue}>{formatGatewayAmount(paidOrder.pay_amount, paidOrder.currency)}</span>
                </div>
              </div>
            )}
            <Button type="button" onClick={handleDone}>{t('common.confirm')}</Button>
          </div>
        </div>
      </div>
    )
  }

  if (outcome === 'cancelled') {
    return (
      <div className={ui.stack}>
        <div className={ui.region}>
          <div className={ui.centered}>
            <div className={ui.statusIcon}><X size={28} aria-hidden="true" /></div>
            <p className={ui.title}>{t('payment.qr.cancelled')}</p>
            <p className={ui.hint}>{t('payment.qr.cancelledDesc')}</p>
            <Button type="button" onClick={handleDone}>{t('common.confirm')}</Button>
          </div>
        </div>
      </div>
    )
  }

  if (outcome === 'expired') {
    return (
      <div className={ui.stack}>
        <div className={ui.region}>
          <div className={ui.centered}>
            <div className={ui.statusIcon} data-tone="warning"><Clock size={28} aria-hidden="true" /></div>
            <p className={ui.title}>{t('payment.qr.expired')}</p>
            <p className={ui.hint}>{t('payment.qr.expiredDesc')}</p>
            <Button type="button" onClick={handleDone}>{t('common.confirm')}</Button>
          </div>
        </div>
      </div>
    )
  }

  // ═══ Active States: QR or Popup waiting ═══

  // Mobile Alipay app handoff. The QR fallback stays hidden until launch timeout.
  if (isMobileAlipayDeepLink) {
    if (!deepLinkFallbackVisible) {
      return (
        <div className={ui.stack}>
          <div className={ui.region}>
            <div className={ui.centered}>
              {deepLinkState === 'launching' ? (
                <div className={ui.spinner} role="status" aria-label={t('payment.qr.alipayOpening')} />
              ) : (
                <div className={ui.statusIcon} data-tone="accent"><CheckCircle2 size={28} aria-hidden="true" /></div>
              )}
              <p className={ui.title}>
                {deepLinkState === 'backgrounded' ? t('payment.qr.alipayContinueInApp') : t('payment.qr.alipayOpening')}
              </p>
              <p className={ui.hint}>{t('payment.qr.alipayWaitingHint')}</p>
              {deepLinkState === 'backgrounded' && (
                <Button type="button" size="sm" data-test="reopen-alipay" onClick={reopenAlipay}>
                  <ExternalLink size={16} aria-hidden="true" />
                  {t('payment.qr.reopenAlipay')}
                </Button>
              )}
            </div>
          </div>
          {countdownRegion(true)}
        </div>
      )
    }
    return (
      <div className={ui.stack}>
        <div data-test="alipay-qr-fallback" className={ui.region}>
          <div className={ui.centeredTight}>
            <div>
              <p className={ui.title}>{t('payment.qr.alipayFallbackTitle')}</p>
              <p className={ui.hint}>{t('payment.qr.alipayFallbackHint')}</p>
            </div>
            <div className={ui.detailsDivided}>
              <div className={ui.row}>
                <span className={ui.rowLabel}>{t('payment.orders.payAmount')}</span>
                <span className={ui.rowValue}>{displayPaymentAmount}</span>
              </div>
              <div className={ui.row}>
                <span className={ui.rowLabel}>{t('payment.orders.orderNo')}</span>
                <span className={`${ui.rowValue} ${ui.mono}`}>{displayOrderNumber}</span>
              </div>
              <div className={ui.row}>
                <span className={ui.rowLabel}>{t('payment.qr.expiresIn')}</span>
                <span className={ui.rowValue}>{countdownDisplay}</span>
              </div>
            </div>
            {qrBlock}
            <p className={ui.hint}>{t('payment.qr.alipaySaveAndScanHint')}</p>
            <div className={ui.actionsGrid}>
              <Button type="button" data-test="reopen-alipay" onClick={reopenAlipay}>
                <ExternalLink size={16} aria-hidden="true" />
                {t('payment.qr.reopenAlipay')}
              </Button>
              <Button type="button" variant="secondary" data-test="save-alipay-qr" onClick={saveQRCode}>
                <Download size={16} aria-hidden="true" />
                {t('payment.qr.saveQRCode')}
              </Button>
            </div>
            <Button type="button" variant="secondary" className={ui.fullWidth} onClick={handleDone}>
              {t('payment.result.backToRecharge')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // QR Code Mode
  if (showQRCode) {
    return (
      <div className={ui.stack}>
        <div className={ui.region}>
          <div className={ui.centeredTight}>
            <p className={ui.title}>{scanTitle}</p>
            {qrBlock}
            {scanHint && <p className={ui.hint}>{scanHint}</p>}
            {payUrl && (
              <Button type="button" variant="secondary" size="sm" onClick={reopenPopup}>
                {t('payment.qr.openPayWindow')}
              </Button>
            )}
          </div>
        </div>
        {countdownRegion(true)}
        {cancelButton}
      </div>
    )
  }

  // Waiting for Popup/Redirect Mode
  return (
    <div className={ui.stack}>
      <div className={ui.region}>
        <div className={ui.centered}>
          <div className={ui.spinner} role="status" aria-label={t('payment.qr.waitingPayment')} />
          <p className={ui.hint}>{t('payment.qr.payInNewWindowHint')}</p>
          {payUrl && (
            <Button type="button" variant="secondary" size="sm" onClick={reopenPopup}>
              {t('payment.qr.openPayWindow')}
            </Button>
          )}
        </div>
      </div>
      {countdownRegion(false)}
      {cancelButton}
    </div>
  )
}
