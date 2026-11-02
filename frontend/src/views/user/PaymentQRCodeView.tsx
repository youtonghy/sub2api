import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import QRCode from 'qrcode'

import { Button } from '@/components/arc/button/button'
import { isBuiltInAlipayMethod, isBuiltInWxpayMethod } from '@/components/payment/providerConfig'
import { drawQRLogo, formatCountdown, secondsUntil } from '@/components/payment/qrCanvas'
import ui from '@/components/payment/paymentUi.module.css'
import { paymentAPI } from '@/api/payment'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { usePaymentStore } from '@/stores/payment'
import { extractI18nErrorMessage } from '@/utils/apiError'
import alipayIcon from '@/assets/icons/alipay.svg'
import wxpayIcon from '@/assets/icons/wxpay.svg'
import styles from './PaymentQRCodeView.module.css'

export default function PaymentQRCodeView() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // 订单参数在挂载时从 URL 读取一次（与 Vue 版 onMounted 一致）
  const [params] = useState(() => ({
    orderId: Number(searchParams.get('order_id')) || 0,
    qrUrl: searchParams.get('qr') ?? '',
    payUrl: searchParams.get('pay_url') ?? '',
    paymentType: searchParams.get('payment_type') ?? '',
    expiresAt: searchParams.get('expires_at') ?? '',
  }))
  const { orderId, qrUrl, payUrl, paymentType } = params
  const [initialSeconds] = useState(() => Math.max(0, secondsUntil(params.expiresAt)))

  const qrCanvas = useRef<HTMLCanvasElement | null>(null)
  const timers = useRef<{
    poll: ReturnType<typeof setInterval> | null
    countdown: ReturnType<typeof setInterval> | null
  }>({ poll: null, countdown: null })
  const [remainingSeconds, setRemainingSeconds] = useState(initialSeconds)
  const [expired, setExpired] = useState(initialSeconds <= 0)
  const [cancelling, setCancelling] = useState(false)

  const isAlipay = isBuiltInAlipayMethod(paymentType)
  const isWxpay = isBuiltInWxpayMethod(paymentType)
  const scanTitle = isAlipay
    ? t('payment.qr.scanAlipay')
    : isWxpay ? t('payment.qr.scanWxpay') : t('payment.qr.scanToPay')
  const scanHint = isAlipay
    ? t('payment.qr.scanAlipayHint')
    : isWxpay ? t('payment.qr.scanWxpayHint') : ''

  function cleanup() {
    const current = timers.current
    if (current.poll) { clearInterval(current.poll); current.poll = null }
    if (current.countdown) { clearInterval(current.countdown); current.countdown = null }
  }

  useEffect(() => {
    let pollInFlight = false

    async function pollStatus() {
      if (!orderId) return
      // 防重入：接口响应慢于 3 秒轮询间隔时避免并发重叠请求与重复跳转。
      if (pollInFlight) return
      pollInFlight = true
      try {
        const order = await usePaymentStore.getState().pollOrderStatus(orderId)
        if (!order) return
        // 定时器已被 cleanup 清除时不再执行终态跳转（响应可能在 cleanup 后才回来）。
        if (!timers.current.poll) return
        if (order.status === 'COMPLETED' || order.status === 'PAID') {
          cleanup()
          void navigate(`/payment/result?order_id=${encodeURIComponent(String(orderId))}&status=success`)
        } else if (order.status === 'EXPIRED' || order.status === 'CANCELLED' || order.status === 'FAILED') {
          cleanup()
          setExpired(true)
        }
      } finally {
        pollInFlight = false
      }
    }

    const deadline = Date.now() + initialSeconds * 1000
    if (initialSeconds > 0) {
      timers.current.countdown = setInterval(() => {
        const remaining = Math.max(0, Math.floor((deadline - Date.now()) / 1000))
        setRemainingSeconds(remaining)
        if (remaining <= 0) {
          setExpired(true)
          cleanup()
        }
      }, 1000)
    }
    timers.current.poll = setInterval(pollStatus, 3000)
    return cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 二维码绘制：中等纠错级别以支持中心 logo
  useEffect(() => {
    const canvas = qrCanvas.current
    if (!canvas || !qrUrl) return
    const logoSrc = isAlipay ? alipayIcon : isWxpay ? wxpayIcon : null
    let cancelled = false
    void QRCode.toCanvas(canvas, qrUrl, {
      width: 256,
      margin: 2,
      errorCorrectionLevel: logoSrc ? 'M' : 'L',
    }).then(() => {
      if (!cancelled && logoSrc) drawQRLogo(canvas, logoSrc, { logoSize: 48, pad: 5, radius: 6 })
    })
    return () => {
      cancelled = true
    }
  }, [qrUrl, isAlipay, isWxpay])

  async function handleCancel() {
    if (!orderId || cancelling) return
    setCancelling(true)
    try {
      await paymentAPI.cancelOrder(orderId)
      cleanup()
      void navigate('/purchase')
    } catch (err: unknown) {
      useAppStore.getState().showError(extractI18nErrorMessage(err, t, 'payment.errors', t('common.error')))
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className={styles.page}>
      <h2 className={ui.title}>{qrUrl ? scanTitle : t('payment.qr.payInNewWindow')}</h2>
      {qrUrl && (
        <div className={ui.qrFrame}>
          <canvas ref={qrCanvas} className={ui.qrCanvas} />
        </div>
      )}
      {/* Scan prompt for QR code */}
      {qrUrl && !expired && scanHint && <p className={ui.hint}>{scanHint}</p>}
      {expired ? (
        <div className={ui.centeredTight}>
          <p className={styles.expired}>{t('payment.qr.expired')}</p>
          <Button type="button" onClick={() => navigate('/purchase')}>{t('payment.result.backToRecharge')}</Button>
        </div>
      ) : (
        <div className={styles.countdownBlock}>
          <p className={ui.hint}>{qrUrl ? t('payment.qr.expiresIn') : t('payment.qr.payInNewWindowHint')}</p>
          <p className={ui.countdown}>{formatCountdown(remainingSeconds)}</p>
          <p className={ui.hint}>{t('payment.qr.waitingPayment')}</p>
        </div>
      )}
      {payUrl && !qrUrl && !expired && (
        <a href={payUrl} target="_blank" rel="noopener noreferrer" className={styles.linkButton}>
          {t('payment.qr.openPayWindow')}
        </a>
      )}
      {/* Cancel button */}
      {!expired && !!orderId && (
        <Button type="button" variant="secondary" className={ui.fullWidth} disabled={cancelling} onClick={handleCancel}>
          {cancelling ? t('common.processing') : t('payment.qr.cancelOrder')}
        </Button>
      )}
    </div>
  )
}
