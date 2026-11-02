import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import QRCode from 'qrcode'

import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import { paymentAPI } from '@/api/payment'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { usePaymentStore } from '@/stores/payment'
import type { PaymentOrder } from '@/types/payment'
import { extractI18nErrorMessage } from '@/utils/apiError'
import alipayIcon from '@/assets/icons/alipay.svg'
import wxpayIcon from '@/assets/icons/wxpay.svg'
import { currencySymbol } from './currency'
import { getPaymentPopupFeatures, isBuiltInAlipayMethod, isBuiltInWxpayMethod } from './providerConfig'
import { drawQRLogo, formatCountdown, secondsUntil } from './qrCanvas'
import ui from './paymentUi.module.css'

export interface PaymentQRDialogProps {
  show: boolean
  orderId: number
  qrCode: string
  expiresAt: string
  paymentType: string
  /** URL for reopening the payment popup window */
  payUrl?: string
  onClose?: () => void
  onSuccess?: () => void
}

const VERIFY_RETRY_INTERVAL_MS = 15000
const VERIFY_RETRY_MAX_ATTEMPTS = 6

function paymentAmountSymbol(order: PaymentOrder): string {
  return currencySymbol(order.currency)
}

export default function PaymentQRDialog(props: PaymentQRDialogProps) {
  const { show, orderId, qrCode, expiresAt, paymentType, payUrl } = props
  const { t } = useI18n()

  const latest = useRef(props)
  useLayoutEffect(() => {
    latest.current = props
  })

  const qrCanvas = useRef<HTMLCanvasElement | null>(null)
  const timers = useRef<{
    poll: ReturnType<typeof setInterval> | null
    countdown: ReturnType<typeof setInterval> | null
  }>({ poll: null, countdown: null })

  const [qrUrl, setQrUrl] = useState('')
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [expired, setExpired] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [success, setSuccess] = useState(false)
  const [paidOrder, setPaidOrder] = useState<PaymentOrder | null>(null)
  const creditedAmountSymbol = currencySymbol('USD')

  // 对应 Vue 版 watch(show)：打开时重置状态（计时器在下面的 effect 中启动）
  const [prevShow, setPrevShow] = useState(false)
  if (show !== prevShow) {
    setPrevShow(show)
    if (show) {
      const seconds = Math.max(0, secondsUntil(expiresAt))
      setSuccess(false)
      setPaidOrder(null)
      setExpired(seconds <= 0)
      setCancelling(false)
      setQrUrl(qrCode)
      setRemainingSeconds(seconds)
    }
  }

  const isAlipay = isBuiltInAlipayMethod(paymentType)
  const isWxpay = isBuiltInWxpayMethod(paymentType)

  let dialogTitle = t('payment.qr.scanToPay')
  if (success) dialogTitle = t('payment.result.success')
  else if (!qrUrl) dialogTitle = t('payment.qr.payInNewWindow')
  else if (isAlipay) dialogTitle = t('payment.qr.scanAlipay')
  else if (isWxpay) dialogTitle = t('payment.qr.scanWxpay')

  const scanHint = isAlipay
    ? t('payment.qr.scanAlipayHint')
    : isWxpay ? t('payment.qr.scanWxpayHint') : ''

  function cleanup() {
    const current = timers.current
    if (current.poll) { clearInterval(current.poll); current.poll = null }
    if (current.countdown) { clearInterval(current.countdown); current.countdown = null }
  }

  useEffect(() => {
    if (!show) return
    const { orderId: id, expiresAt: expiry, paymentType: type } = latest.current
    const isWxpayMethod = isBuiltInWxpayMethod(type)
    let verifyAttempts = 0
    let lastVerifyAt = 0

    async function tryRecoverPendingOrder(order: PaymentOrder): Promise<PaymentOrder> {
      if (!isWxpayMethod) return order
      const outTradeNo = String(order.out_trade_no || '').trim()
      if (!outTradeNo) return order
      const normalizedStatus = String(order.status || '').trim().toUpperCase()
      if (normalizedStatus !== 'PENDING') return order
      const now = Date.now()
      if (verifyAttempts >= VERIFY_RETRY_MAX_ATTEMPTS || now - lastVerifyAt < VERIFY_RETRY_INTERVAL_MS) {
        return order
      }

      lastVerifyAt = now
      verifyAttempts += 1
      try {
        const result = await paymentAPI.verifyOrder(outTradeNo)
        return result.data ?? order
      } catch {
        return order
      }
    }

    async function pollStatus() {
      if (!id) return
      let order = await usePaymentStore.getState().pollOrderStatus(id)
      if (!order) return
      order = await tryRecoverPendingOrder(order)
      if (order.status === 'COMPLETED' || order.status === 'PAID') {
        cleanup()
        setPaidOrder(order)
        setSuccess(true)
        latest.current.onSuccess?.()
      } else if (order.status === 'EXPIRED' || order.status === 'CANCELLED' || order.status === 'FAILED') {
        cleanup()
        setExpired(true)
      }
    }

    const seconds = Math.max(0, secondsUntil(expiry))
    const deadline = Date.now() + seconds * 1000
    if (seconds > 0) {
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
  }, [show])

  // 二维码绘制（带品牌 logo）
  useEffect(() => {
    const canvas = qrCanvas.current
    if (!show || success || !canvas || !qrUrl) return
    const logoSrc = isAlipay ? alipayIcon : isWxpay ? wxpayIcon : null
    let cancelled = false
    void QRCode.toCanvas(canvas, qrUrl, {
      width: 220,
      margin: 2,
      errorCorrectionLevel: logoSrc ? 'M' : 'L',
    }).then(() => {
      if (!cancelled && logoSrc) drawQRLogo(canvas, logoSrc, { logoSize: 40, pad: 4, radius: 5 })
    })
    return () => {
      cancelled = true
    }
  }, [show, success, qrUrl, isAlipay, isWxpay])

  function reopenPopup() {
    if (payUrl) {
      window.open(payUrl, 'paymentPopup', getPaymentPopupFeatures())
    }
  }

  async function handleCancel() {
    if (!orderId || cancelling) return
    setCancelling(true)
    try {
      await paymentAPI.cancelOrder(orderId)
      cleanup()
      latest.current.onClose?.()
    } catch (err: unknown) {
      useAppStore.getState().showError(extractI18nErrorMessage(err, t, 'payment.errors', t('common.error')))
    } finally {
      setCancelling(false)
    }
  }

  function handleClose() {
    cleanup()
    latest.current.onClose?.()
  }

  const footer = (
    <>
      {!success && !expired && (
        <Button type="button" variant="secondary" disabled={cancelling} onClick={handleCancel}>
          {cancelling ? t('common.processing') : t('payment.qr.cancelOrder')}
        </Button>
      )}
      {success && <Button type="button" onClick={handleClose}>{t('common.confirm')}</Button>}
      {expired && <Button type="button" onClick={handleClose}>{t('payment.result.backToRecharge')}</Button>}
    </>
  )

  return (
    <BaseDialog show={show} title={dialogTitle} width="narrow" onClose={handleClose} footer={footer}>
      {!success ? (
        <div className={ui.centeredTight}>
          {qrUrl ? (
            <>
              <div className={ui.qrFrame}>
                <canvas ref={qrCanvas} className={ui.qrCanvas} />
              </div>
              {scanHint && <p className={ui.hint}>{scanHint}</p>}
            </>
          ) : (
            /* Popup window waiting mode (no QR code) */
            <div className={ui.centered}>
              <div className={ui.spinner} role="status" aria-label={t('payment.qr.waitingPayment')} />
              <p className={ui.hint}>{t('payment.qr.payInNewWindowHint')}</p>
              {payUrl && (
                <Button type="button" variant="secondary" size="sm" onClick={reopenPopup}>
                  {t('payment.qr.openPayWindow')}
                </Button>
              )}
            </div>
          )}
          {/* Countdown */}
          {expired ? (
            <p className={ui.error}>{t('payment.qr.expired')}</p>
          ) : (
            <div>
              <p className={ui.hint}>{qrUrl ? t('payment.qr.expiresIn') : ''}</p>
              <p className={ui.countdown}>{formatCountdown(remainingSeconds)}</p>
              <p className={ui.fine}>{t('payment.qr.waitingPayment')}</p>
            </div>
          )}
        </div>
      ) : (
        /* Success State */
        <div className={ui.centered}>
          <div className={ui.statusIcon} data-tone="success"><Check size={28} aria-hidden="true" /></div>
          <p className={ui.title}>{t('payment.result.success')}</p>
          {paidOrder && (
            <div className={ui.details}>
              <div className={ui.row}>
                <span className={ui.rowLabel}>{t('payment.orders.orderId')}</span>
                <span className={ui.rowValue}>#{paidOrder.id}</span>
              </div>
              <div className={ui.row}>
                <span className={ui.rowLabel}>{t('payment.orders.amount')}</span>
                <span className={ui.rowValue}>{creditedAmountSymbol}{paidOrder.amount.toFixed(2)}</span>
              </div>
              <div className={ui.row}>
                <span className={ui.rowLabel}>{t('payment.orders.payAmount')}</span>
                <span className={ui.rowValue}>{paymentAmountSymbol(paidOrder)}{paidOrder.pay_amount.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </BaseDialog>
  )
}
