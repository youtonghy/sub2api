import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import type { Stripe, StripeElements } from '@stripe/stripe-js'

import { Button } from '@/components/arc/button/button'
import { paymentAPI } from '@/api/payment'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { extractI18nErrorMessage } from '@/utils/apiError'
import { currencySymbol } from './currency'
import { getPaymentPopupFeatures } from './providerConfig'
import { stripeAppearance } from './stripeAppearance'
import ui from './paymentUi.module.css'

// Stripe payment methods that open a popup (redirect or QR code)
const POPUP_METHODS = new Set(['alipay', 'wechat_pay'])

export interface StripePaymentInlineProps {
  orderId: number
  amount: number
  clientSecret: string
  orderType?: 'balance' | 'subscription'
  publishableKey: string
  payAmount: number
  currency?: string
  onSuccess?: () => void
  onDone?: () => void
  onBack?: () => void
  onRedirect?: (orderId: number, payUrl: string) => void
}

export default function StripePaymentInline(props: StripePaymentInlineProps) {
  const { orderId, amount, payAmount, currency } = props
  const { t } = useI18n()

  const latest = useRef(props)
  useLayoutEffect(() => {
    latest.current = props
  })

  const stripeMount = useRef<HTMLDivElement | null>(null)
  const stripeInstance = useRef<Stripe | null>(null)
  const elementsInstance = useRef<StripeElements | null>(null)
  const selectedType = useRef('')

  const [loading, setLoading] = useState(true)
  const [initError, setInitError] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [success, setSuccess] = useState(false)
  const [ready, setReady] = useState(false)
  const creditedAmountSymbol = currencySymbol('USD')
  const paymentAmountSymbol = currencySymbol(currency)

  // 加载 Stripe 并创建 Payment Element；挂载点在 loading 结束后才渲染，因此分两步
  useEffect(() => {
    let disposed = false
    const { publishableKey } = latest.current
    void (async () => {
      try {
        const { loadStripe } = await import('@stripe/stripe-js/pure')
        const stripe = await loadStripe(publishableKey)
        if (disposed) return
        if (!stripe) { setInitError(t('payment.stripeLoadFailed')); return }
        stripeInstance.current = stripe
      } catch (err: unknown) {
        if (!disposed) setInitError(extractI18nErrorMessage(err, t, 'payment.errors', t('payment.stripeLoadFailed')))
      } finally {
        if (!disposed) setLoading(false)
      }
    })()
    return () => {
      disposed = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const stripe = stripeInstance.current
    const mountNode = stripeMount.current
    if (loading || initError || !stripe || !mountNode || elementsInstance.current) return
    try {
      const elements = stripe.elements({
        clientSecret: latest.current.clientSecret,
        appearance: stripeAppearance(),
      })
      elementsInstance.current = elements
      const paymentElement = elements.create('payment', {
        layout: 'tabs',
        paymentMethodOrder: ['alipay', 'wechat_pay', 'card', 'link'],
      } as Record<string, unknown>)
      paymentElement.mount(mountNode)
      paymentElement.on('ready', () => { setReady(true) })
      paymentElement.on('change', (event: { value: { type: string } }) => {
        selectedType.current = event.value.type
      })
    } catch (err: unknown) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载 Stripe Element 失败时展示错误
      setInitError(extractI18nErrorMessage(err, t, 'payment.errors', t('payment.stripeLoadFailed')))
    }
  }, [loading, initError, t])

  async function handlePay() {
    const stripe = stripeInstance.current
    const elements = elementsInstance.current
    if (!stripe || !elements || submitting) return
    const { clientSecret, publishableKey } = latest.current

    // Alipay / WeChat Pay: open popup for redirect or QR display
    if (POPUP_METHODS.has(selectedType.current)) {
      const query = new URLSearchParams({
        order_id: String(orderId),
        method: selectedType.current,
        amount: String(payAmount),
      })
      const popupUrl = `/payment/stripe-popup?${query.toString()}`
      const popup = window.open(popupUrl, 'paymentPopup', getPaymentPopupFeatures())

      const onReady = (event: MessageEvent) => {
        if (event.source !== popup || event.data?.type !== 'STRIPE_POPUP_READY') return
        window.removeEventListener('message', onReady)
        popup?.postMessage({
          type: 'STRIPE_POPUP_INIT',
          clientSecret,
          publishableKey,
        }, window.location.origin)
      }
      window.addEventListener('message', onReady)

      latest.current.onRedirect?.(orderId, popupUrl)
      return
    }

    // Card / Link: confirm inline
    setSubmitting(true)
    setError('')
    try {
      const { error: stripeError } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.origin + '/payment/result?order_id=' + orderId + '&status=success',
        },
        redirect: 'if_required',
      })
      if (stripeError) {
        setError(stripeError.message || t('payment.result.failed'))
      } else {
        setSuccess(true)
        latest.current.onSuccess?.()
      }
    } catch (err: unknown) {
      setError(extractI18nErrorMessage(err, t, 'payment.errors', t('payment.result.failed')))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel() {
    if (!orderId || cancelling) return
    setCancelling(true)
    try {
      await paymentAPI.cancelOrder(orderId)
      latest.current.onBack?.()
    } catch (err: unknown) {
      useAppStore.getState().showError(extractI18nErrorMessage(err, t, 'payment.errors', t('common.error')))
    } finally {
      setCancelling(false)
    }
  }

  if (loading) {
    return (
      <div className={ui.stack}>
        <div className={ui.centered}>
          <div className={ui.spinner} role="status" aria-label={t('common.loading')} />
        </div>
      </div>
    )
  }

  if (initError) {
    return (
      <div className={ui.stack}>
        <div className={`${ui.region} ${ui.centered}`}>
          <p className={ui.error}>{initError}</p>
          <Button type="button" variant="secondary" onClick={() => latest.current.onBack?.()}>
            {t('payment.result.backToRecharge')}
          </Button>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className={ui.stack}>
        <div className={ui.region}>
          <div className={ui.centered}>
            <div className={ui.statusIcon} data-tone="success"><Check size={28} aria-hidden="true" /></div>
            <p className={ui.title}>{t('payment.result.success')}</p>
            <div className={ui.details}>
              <div className={ui.row}>
                <span className={ui.rowLabel}>{t('payment.orders.orderId')}</span>
                <span className={ui.rowValue}>#{orderId}</span>
              </div>
              {amount > 0 && (
                <div className={ui.row}>
                  <span className={ui.rowLabel}>{t('payment.orders.amount')}</span>
                  <span className={ui.rowValue}>{creditedAmountSymbol}{amount.toFixed(2)}</span>
                </div>
              )}
              <div className={ui.row}>
                <span className={ui.rowLabel}>{t('payment.orders.payAmount')}</span>
                <span className={ui.rowValue}>{paymentAmountSymbol}{payAmount.toFixed(2)}</span>
              </div>
            </div>
            <Button type="button" onClick={() => latest.current.onDone?.()}>{t('common.confirm')}</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={ui.stack}>
      {/* Amount */}
      <div className={ui.amountHeader}>
        <p className={ui.hint}>{t('payment.actualPay')}</p>
        <p className={ui.amountValue}>{paymentAmountSymbol}{payAmount.toFixed(2)}</p>
      </div>
      {/* Stripe Payment Element */}
      <div className={`${ui.region} ${ui.stack}`}>
        <div ref={stripeMount} className={ui.mount} />
        {error && <p className={ui.error}>{error}</p>}
        <Button
          type="button"
          size="lg"
          className={ui.fullWidth}
          disabled={!ready}
          loading={submitting}
          onClick={handlePay}
        >
          {submitting ? t('common.processing') : t('payment.stripePay')}
        </Button>
      </div>
      {/* Cancel order */}
      <Button type="button" variant="secondary" className={ui.fullWidth} disabled={cancelling} onClick={handleCancel}>
        {cancelling ? t('common.processing') : t('payment.qr.cancelOrder')}
      </Button>
    </div>
  )
}
