import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { AlertCircle } from 'lucide-react'

import { Button } from '@/components/arc/button/button'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import {
  PAYMENT_RECOVERY_STORAGE_KEY,
  readPaymentRecoverySnapshot,
  type PaymentRecoverySnapshot,
} from '@/components/payment/paymentFlow'
import ui from '@/components/payment/paymentUi.module.css'
import { useI18n } from '@/i18n/useI18n'
import styles from './AirwallexPaymentView.module.css'

export default function AirwallexPaymentView() {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  function queryString(key: string): string {
    return searchParams.get(key) ?? ''
  }

  function buildSuccessUrl(snapshot: PaymentRecoverySnapshot): string {
    const url = new URL('/payment/result', window.location.origin)
    const orderId = queryString('order_id')
    const outTradeNo = queryString('out_trade_no')
    const resumeToken = queryString('resume_token')

    if (orderId || snapshot.orderId > 0) url.searchParams.set('order_id', orderId || String(snapshot.orderId))
    if (outTradeNo || snapshot.outTradeNo) url.searchParams.set('out_trade_no', outTradeNo || snapshot.outTradeNo)
    if (resumeToken || snapshot.resumeToken) url.searchParams.set('resume_token', resumeToken || snapshot.resumeToken)
    return url.toString()
  }

  function restoreAirwallexSnapshot(): PaymentRecoverySnapshot | null {
    if (typeof window === 'undefined') {
      return null
    }

    const orderId = Number(queryString('order_id')) || 0
    const outTradeNo = queryString('out_trade_no')
    const resumeToken = queryString('resume_token')
    const snapshot = readPaymentRecoverySnapshot(
      window.localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY),
      resumeToken ? { resumeToken } : {},
    )

    if (!snapshot || snapshot.paymentType !== 'airwallex') {
      return null
    }
    if (orderId > 0 && snapshot.orderId !== orderId) {
      return null
    }
    if (outTradeNo && snapshot.outTradeNo !== outTradeNo) {
      return null
    }
    if (!snapshot.intentId || !snapshot.clientSecret) {
      return null
    }
    return snapshot
  }

  // 支付参数只从本地恢复快照读取（挂载时一次），避免在 URL 中暴露 client_secret
  const [snapshot] = useState(restoreAirwallexSnapshot)
  const [loading, setLoading] = useState(snapshot !== null)
  const [errorMessage, setErrorMessage] = useState(() => (snapshot ? '' : t('payment.airwallexMissingParams')))

  useEffect(() => {
    if (!snapshot) return
    let disposed = false
    const checkoutLocale = locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'

    void (async () => {
      try {
        const airwallex = await import('@airwallex/components-sdk')
        if (disposed) return
        const result = await airwallex.init({
          env: snapshot.paymentEnv === 'prod' ? 'prod' : 'demo',
          enabledElements: ['payments'],
          locale: checkoutLocale,
        })
        if (disposed) return

        setLoading(false)
        const checkoutOptions = {
          intent_id: snapshot.intentId,
          client_secret: snapshot.clientSecret,
          currency: snapshot.currency || 'CNY',
          country_code: snapshot.countryCode || 'CN',
          successUrl: buildSuccessUrl(snapshot),
        }
        if (!result.payments) {
          throw new Error(t('payment.airwallexLoadFailed'))
        }
        const redirectResult = result.payments.redirectToCheckout(checkoutOptions)

        if (typeof redirectResult === 'string' && redirectResult) {
          window.location.assign(redirectResult)
        }
      } catch (err: unknown) {
        if (disposed) return
        setLoading(false)
        setErrorMessage(err instanceof Error && err.message
          ? err.message
          : t('payment.airwallexLoadFailed'))
      }
    })()

    return () => {
      disposed = true
    }
    // 只在挂载时初始化（与 Vue 版 onMounted 一致）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={styles.page}>
      {loading ? (
        <Skeleton lines={3} label={t('common.loading')} />
      ) : errorMessage ? (
        <div className={ui.region}>
          <div className={ui.centered}>
            <div className={ui.statusIcon} data-tone="danger"><AlertCircle size={28} aria-hidden="true" /></div>
            <h2 className={ui.title}>{t('payment.airwallexLoadFailed')}</h2>
            <p className={ui.hint}>{errorMessage}</p>
            <Button type="button" onClick={() => navigate('/purchase')}>{t('payment.result.backToRecharge')}</Button>
          </div>
        </div>
      ) : (
        <div className={ui.region}>
          <div className={ui.centered}>
            <div className={ui.spinner} role="status" aria-label={t('payment.qr.payInNewWindowHint')} />
            <p className={ui.hint}>{t('payment.qr.payInNewWindowHint')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
