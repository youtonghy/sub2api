import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { AlertCircle, Check } from 'lucide-react'
import type { Stripe, StripeElements } from '@stripe/stripe-js'

import { Button } from '@/components/arc/button/button'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { formatPaymentAmount, normalizePaymentCurrency } from '@/components/payment/currency'
import { PAYMENT_RECOVERY_STORAGE_KEY, readPaymentRecoverySnapshot } from '@/components/payment/paymentFlow'
import { stripeAppearance } from '@/components/payment/stripeAppearance'
import ui from '@/components/payment/paymentUi.module.css'
import { paymentAPI } from '@/api/payment'
import { useI18n } from '@/i18n/useI18n'
import { usePaymentStore } from '@/stores/payment'
import type { PaymentOrder } from '@/types/payment'
import { extractI18nErrorMessage } from '@/utils/apiError'
import { isMobileDevice } from '@/utils/device'
import styles from './StripePaymentView.module.css'

type StripeWithWechatPay = Stripe & {
  confirmWechatPayPayment: (cs: string, opts: Record<string, unknown>) => Promise<{ paymentIntent?: { status: string; next_action?: { wechat_pay_display_qr_code?: { image_data_url?: string } } }; error?: { message?: string } }>
}

/**
 * Stripe 落地页。路由使用独立布局（layout: none）：带 method 参数时作为弹窗页，
 * 不带时渲染完整 Payment Element。
 */
export default function StripePaymentView() {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // 弹窗模式：指定支付宝或微信方式时（Vue 版此时跳过 AppLayout）
  const isPopup = !!searchParams.get('method')
  const routeOrderId = searchParams.get('order_id') ?? ''

  const [loading, setLoading] = useState(true)
  const [initError, setInitError] = useState('')
  const [stripeError, setStripeError] = useState('')
  const [stripeSubmitting, setStripeSubmitting] = useState(false)
  const [stripeSuccess, setStripeSuccess] = useState(false)
  const [stripeReady, setStripeReady] = useState(false)
  const [order, setOrder] = useState<PaymentOrder | null>(null)
  const [currency, setCurrency] = useState('CNY')
  const [wechatQrUrl, setWechatQrUrl] = useState('')
  const [redirecting, setRedirecting] = useState(false)
  const [showPaymentElement, setShowPaymentElement] = useState(false)

  const mountNode = useRef<HTMLDivElement | null>(null)
  const runtime = useRef<{
    disposed: boolean
    generation: number
    stripe: Stripe | null
    elements: StripeElements | null
    clientSecret: string
    pollTimer: ReturnType<typeof setInterval> | null
    redirectTimer: ReturnType<typeof setTimeout> | null
  }>({ disposed: false, generation: 0, stripe: null, elements: null, clientSecret: '', pollTimer: null, redirectTimer: null })

  function formatGatewayAmount(value: number): string {
    return formatPaymentAmount(value, currency, locale)
  }

  function scheduleClose() {
    const state = runtime.current
    if (state.disposed) return
    if (window.opener) {
      state.redirectTimer = setTimeout(() => { window.close() }, 2000)
    } else {
      state.redirectTimer = setTimeout(() => {
        void navigate(`/payment/result?order_id=${encodeURIComponent(routeOrderId)}&status=success`)
      }, 2000)
    }
  }

  function startPolling() {
    const state = runtime.current
    const orderId = Number(routeOrderId)
    if (!orderId || state.disposed) return
    state.pollTimer = setInterval(async () => {
      const o = await usePaymentStore.getState().pollOrderStatus(orderId)
      if (!o) return
      if (o.status === 'COMPLETED' || o.status === 'PAID') {
        if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null }
        setStripeSuccess(true)
        setWechatQrUrl('')
        scheduleClose()
      }
    }, 3000)
  }

  async function confirmAlipay(stripe: Stripe, clientSecret: string, orderId: number) {
    setRedirecting(true)
    const returnUrl = window.location.origin + '/payment/result?order_id=' + orderId + '&status=success'
    const { error } = await stripe.confirmAlipayPayment(clientSecret, { return_url: returnUrl })
    if (error) {
      setRedirecting(false)
      setStripeError(error.message || t('payment.result.failed'))
    }
    // 无错误时 Stripe 会自动跳转
  }

  async function confirmWechatPay(stripe: Stripe, clientSecret: string) {
    const { paymentIntent, error } = await (stripe as StripeWithWechatPay).confirmWechatPayPayment(clientSecret, {
      payment_method_options: { wechat_pay: { client: isMobileDevice() ? 'mobile_web' : 'web' } },
    })
    if (runtime.current.disposed) return

    if (error) {
      setStripeError(error.message || t('payment.result.failed'))
      return
    }

    // 从 next_action 中提取二维码
    const qrData = paymentIntent?.next_action?.wechat_pay_display_qr_code?.image_data_url
    if (qrData) {
      setWechatQrUrl(qrData)
      // 轮询支付完成状态
      startPolling()
    } else if (paymentIntent?.status === 'succeeded') {
      setStripeSuccess(true)
      scheduleClose()
    } else {
      setStripeError(t('payment.result.failed'))
    }
  }

  useEffect(() => {
    const state = runtime.current
    state.disposed = false
    // StrictMode 下 effect 会重复执行：只让最新一轮的异步流程继续
    const generation = ++state.generation
    const alive = () => !state.disposed && state.generation === generation
    const orderId = Number(searchParams.get('order_id'))
    const method = searchParams.get('method') ?? ''
    const resumeToken = searchParams.get('resume_token') ?? undefined

    void (async () => {
      // client_secret 只从本浏览器下单时写入的恢复快照读取，且快照订单必须与 URL 订单一致：
      // 不信任 URL 中的 client_secret，避免页面展示的订单与实际收款的 PaymentIntent 被拼接错绑。
      const restored = typeof window !== 'undefined'
        ? readPaymentRecoverySnapshot(window.localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY), { resumeToken })
        : null
      const clientSecret = orderId && restored?.orderId === orderId ? restored.clientSecret : ''

      if (!orderId || !clientSecret) {
        setLoading(false)
        setInitError(t('payment.stripeMissingParams'))
        return
      }

      try {
        setCurrency(normalizePaymentCurrency(restored?.currency))
        const res = await paymentAPI.getOrder(orderId)
        if (!alive()) return
        setOrder(res.data)
        if (res.data.currency) {
          setCurrency(normalizePaymentCurrency(res.data.currency))
        }

        const paymentStore = usePaymentStore.getState()
        await paymentStore.fetchConfig()
        if (!alive()) return
        const publishableKey = usePaymentStore.getState().config?.stripe_publishable_key
        if (!publishableKey) { setInitError(t('payment.stripeNotConfigured')); return }

        const { loadStripe } = await import('@stripe/stripe-js/pure')
        const stripe = await loadStripe(publishableKey)
        if (!alive()) return
        if (!stripe) { setInitError(t('payment.stripeLoadFailed')); return }

        state.stripe = stripe
        state.clientSecret = clientSecret
        setLoading(false)

        // 指定方式直接确认，无需渲染完整 Payment Element
        if (method === 'alipay') {
          await confirmAlipay(stripe, clientSecret, orderId)
        } else if (method === 'wechat_pay') {
          await confirmWechatPay(stripe, clientSecret)
        } else {
          // 未指定方式时渲染完整 Payment Element（挂载点出现后由下面的 effect 挂载）
          setShowPaymentElement(true)
        }
      } catch (err: unknown) {
        if (alive()) setInitError(extractI18nErrorMessage(err, t, 'payment.errors', t('payment.stripeLoadFailed')))
      } finally {
        if (alive()) setLoading(false)
      }
    })()

    return () => {
      state.disposed = true
      if (state.redirectTimer) clearTimeout(state.redirectTimer)
      if (state.pollTimer) clearInterval(state.pollTimer)
      state.redirectTimer = null
      state.pollTimer = null
    }
    // 只在挂载时初始化（与 Vue 版 onMounted 一致）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const state = runtime.current
    const node = mountNode.current
    if (!showPaymentElement || !node || !state.stripe || state.elements || state.disposed) return
    const elements = state.stripe.elements({
      clientSecret: state.clientSecret,
      appearance: stripeAppearance(),
    })
    state.elements = elements
    const paymentElement = elements.create('payment', {
      layout: 'tabs',
      paymentMethodOrder: ['alipay', 'wechat_pay', 'card', 'link'],
    } as Record<string, unknown>)
    paymentElement.mount(node)
    paymentElement.on('ready', () => { setStripeReady(true) })
  }, [showPaymentElement])

  async function handleGenericPay() {
    const { stripe, elements } = runtime.current
    if (!stripe || !elements || stripeSubmitting) return
    setStripeSubmitting(true)
    setStripeError('')
    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.origin + '/payment/result?order_id=' + routeOrderId + '&status=success',
        },
        redirect: 'if_required',
      })
      if (error) {
        setStripeError(error.message || t('payment.result.failed'))
      } else {
        setStripeSuccess(true)
        scheduleClose()
      }
    } catch (err: unknown) {
      setStripeError(extractI18nErrorMessage(err, t, 'payment.errors', t('payment.result.failed')))
    } finally {
      setStripeSubmitting(false)
    }
  }

  const backToRecharge = () => navigate('/purchase')

  return (
    <div className={styles.screen} data-popup={isPopup ? '' : undefined}>
      <div className={styles.column}>
        {loading ? (
          <Skeleton lines={4} label={t('common.loading')} />
        ) : initError ? (
          <div className={ui.region}>
            <div className={ui.centered}>
              <div className={ui.statusIcon} data-tone="danger"><AlertCircle size={28} aria-hidden="true" /></div>
              <h1 className={ui.title}>{t('payment.stripeLoadFailed')}</h1>
              <p className={ui.hint}>{initError}</p>
              <Button type="button" onClick={backToRecharge}>{t('payment.result.backToRecharge')}</Button>
            </div>
          </div>
        ) : (
          <>
            {/* 金额头部 */}
            {order && (
              <div className={ui.amountHeader}>
                <p className={ui.hint}>{t('payment.actualPay')}</p>
                <p className={ui.amountValue}>{formatGatewayAmount(order.pay_amount)}</p>
              </div>
            )}

            {wechatQrUrl ? (
              /* 微信二维码展示 */
              <>
                <div className={ui.region}>
                  <div className={ui.centeredTight}>
                    <p className={ui.title}>{t('payment.qr.scanWxpay')}</p>
                    <div className={ui.qrFrame} data-brand="wxpay">
                      <img src={wechatQrUrl} alt="WeChat Pay QR" className={styles.wechatQr} />
                    </div>
                    <p className={ui.hint}>{t('payment.qr.scanWxpayHint')}</p>
                  </div>
                </div>
                <div className={`${ui.regionCompact} ${ui.centeredTight}`}>
                  <p className={ui.hint}>{t('payment.qr.waitingPayment')}</p>
                </div>
              </>
            ) : redirecting ? (
              /* 支付宝跳转状态 */
              <div className={ui.region}>
                <div className={ui.centered}>
                  <div className={ui.spinner} role="status" aria-label={t('payment.qr.payInNewWindowHint')} />
                  <p className={ui.hint}>{t('payment.qr.payInNewWindowHint')}</p>
                </div>
              </div>
            ) : stripeSuccess ? (
              /* 成功状态 */
              <div className={ui.region}>
                <div className={ui.centered}>
                  <div className={ui.statusIcon} data-tone="success"><Check size={28} aria-hidden="true" /></div>
                  <p className={ui.title}>{t('payment.result.success')}</p>
                  <p className={ui.hint}>{t('payment.stripeSuccessProcessing')}</p>
                </div>
              </div>
            ) : showPaymentElement ? (
              /* 无指定方式或未知方式时展示完整 Payment Element */
              <>
                <div className={`${ui.region} ${ui.stack}`}>
                  <div ref={mountNode} id="stripe-payment-element" className={ui.mount} />
                  {stripeError && <p className={ui.error}>{stripeError}</p>}
                  <Button
                    type="button"
                    size="lg"
                    className={ui.fullWidth}
                    disabled={!stripeReady}
                    loading={stripeSubmitting}
                    onClick={handleGenericPay}
                  >
                    {stripeSubmitting ? t('common.processing') : t('payment.stripePay')}
                  </Button>
                </div>
                <div className={styles.center}>
                  <Button type="button" variant="secondary" onClick={backToRecharge}>{t('payment.result.backToRecharge')}</Button>
                </div>
              </>
            ) : null}

            {/* 错误状态 */}
            {stripeError && !showPaymentElement && (
              <div className={`${ui.regionCompact} ${ui.stack}`}>
                <p className={ui.error}>{stripeError}</p>
                <Button type="button" variant="secondary" className={ui.fullWidth} onClick={backToRecharge}>
                  {t('payment.result.backToRecharge')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
