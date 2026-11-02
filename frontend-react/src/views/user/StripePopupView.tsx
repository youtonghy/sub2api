import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Check } from 'lucide-react'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import ui from '@/components/payment/paymentUi.module.css'
import { buildApiUrl } from '@/api/client'
import { useI18n } from '@/i18n/useI18n'
import { extractI18nErrorMessage } from '@/utils/apiError'
import { isMobileDevice } from '@/utils/device'
import styles from './StripePopupView.module.css'

interface StripeWithWechatPay {
  confirmWechatPayPayment(clientSecret: string, options: Record<string, unknown>): Promise<{ error?: { message?: string }; paymentIntent?: { status: string } }>
}

function closeWindow() { window.close() }

/**
 * Stripe 支付宝 / 微信支付弹窗。父窗口（StripePaymentInline）通过 postMessage 握手下发 client_secret：
 * 弹窗就绪后发 STRIPE_POPUP_READY，收到 STRIPE_POPUP_INIT 后初始化 Stripe。
 */
export default function StripePopupView() {
  const { t } = useI18n()
  const [searchParams] = useSearchParams()

  const [{ orderId, method, amount }] = useState(() => ({
    orderId: searchParams.get('order_id') ?? '',
    method: searchParams.get('method') || 'alipay',
    amount: searchParams.get('amount') ?? '',
  }))

  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [hint, setHint] = useState(() => t('payment.stripePopup.redirecting'))

  useEffect(() => {
    let disposed = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let initTimeoutTimer: ReturnType<typeof setTimeout> | null = null
    let settled = false

    function clearInitTimeout() {
      if (initTimeoutTimer) {
        clearTimeout(initTimeoutTimer)
        initTimeoutTimer = null
      }
    }

    function fail(message: string) {
      if (disposed) return
      settled = true
      setError(message)
    }

    function succeed() {
      if (disposed) return
      settled = true
      setSuccess(true)
    }

    function startPolling() {
      let inFlight = false
      pollTimer = setInterval(async () => {
        // 防重入：接口响应慢于轮询间隔时避免并发重叠请求。
        if (inFlight) return
        inFlight = true
        try {
          // access token 存储在 localStorage 的 'auth_token' 键下（见 api/client.ts），
          // 之前误读 'token' 导致轮询请求不带认证、永远 401，支付成功无法被检测到。
          const token = localStorage.getItem('auth_token') || ''
          const res = await fetch(buildApiUrl(`/payment/orders/${orderId}`), {
            headers: token ? { Authorization: 'Bearer ' + token } : {},
            credentials: 'include',
          })
          if (!res.ok) return
          const data = await res.json()
          const status = data?.data?.status
          if (status === 'COMPLETED' || status === 'PAID') {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
            succeed()
            setTimeout(closeWindow, 2000)
          }
        } catch { /* ignore */ } finally {
          inFlight = false
        }
      }, 3000)
    }

    async function initStripe(clientSecret: string, publishableKey: string) {
      if (!clientSecret || !publishableKey) {
        fail(t('payment.stripeMissingParams'))
        return
      }
      try {
        const { loadStripe } = await import('@stripe/stripe-js/pure')
        const stripe = await loadStripe(publishableKey)
        if (disposed) return
        if (!stripe) { fail(t('payment.stripeLoadFailed')); return }

        const returnUrl = window.location.origin + '/payment/result?order_id=' + orderId + '&status=success'

        if (method === 'alipay') {
          // Alipay: redirect this popup to Alipay payment page
          const { error: err } = await stripe.confirmAlipayPayment(clientSecret, { return_url: returnUrl })
          if (err) fail(err.message || t('payment.result.failed'))
        } else if (method === 'wechat_pay') {
          // WeChat: Stripe shows its built-in QR dialog, user scans, promise resolves
          setHint(t('payment.stripePopup.loadingQr'))
          const result = await (stripe as unknown as StripeWithWechatPay).confirmWechatPayPayment(clientSecret, {
            payment_method_options: { wechat_pay: { client: isMobileDevice() ? 'mobile_web' : 'web' } },
          })
          if (disposed) return
          if (result.error) {
            fail(result.error.message || t('payment.result.failed'))
          } else if (result.paymentIntent?.status === 'succeeded') {
            succeed()
            setTimeout(closeWindow, 2000)
          } else {
            // Payment not completed (user closed QR dialog)
            startPolling()
          }
        }
      } catch (err: unknown) {
        fail(extractI18nErrorMessage(err, t, 'payment.errors', t('payment.stripeLoadFailed')))
      }
    }

    const messageHandler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'STRIPE_POPUP_INIT') return
      // INIT 已到达，取消兜底超时，避免长时间的扫码支付被误判为超时。
      clearInitTimeout()
      window.removeEventListener('message', messageHandler)
      void initStripe(event.data.clientSecret, event.data.publishableKey)
    }
    window.addEventListener('message', messageHandler)

    if (window.opener) {
      window.opener.postMessage({ type: 'STRIPE_POPUP_READY' }, window.location.origin)
    }

    // 仅兜底“父窗口始终未发 STRIPE_POPUP_INIT”的场景。
    initTimeoutTimer = setTimeout(() => {
      if (!settled) {
        fail(t('payment.stripePopup.timeout'))
      }
    }, 15000)

    return () => {
      disposed = true
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
      clearInitTimeout()
      window.removeEventListener('message', messageHandler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        {/* Amount + Order ID */}
        {amount && (
          <div className={styles.amountBlock}>
            <p className={ui.amountValue}>¥{amount}</p>
            {orderId && <p className={ui.hint}>{t('payment.orders.orderId')}: {orderId}</p>}
          </div>
        )}

        {error ? (
          <div className={ui.stack}>
            <Alert tone="danger" title={error} />
            <Button type="button" variant="ghost" className={ui.fullWidth} onClick={closeWindow}>{t('common.close')}</Button>
          </div>
        ) : success ? (
          <div className={ui.centered}>
            <div className={ui.statusIcon} data-tone="success"><Check size={28} aria-hidden="true" /></div>
            <p className={ui.hint}>{t('payment.result.success')}</p>
            <Button type="button" variant="ghost" onClick={closeWindow}>{t('common.close')}</Button>
          </div>
        ) : (
          /* Loading / Redirecting */
          <div className={styles.loading}>
            <div className={ui.spinner} role="status" aria-label={hint} />
            <span className={ui.hint}>{hint}</span>
          </div>
        )}
      </div>
    </div>
  )
}
