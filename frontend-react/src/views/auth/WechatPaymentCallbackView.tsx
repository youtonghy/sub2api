import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import styles from './authView.module.css'

function parseFragmentParams(): URLSearchParams {
  const raw = typeof window !== 'undefined' ? window.location.hash : ''
  const hash = raw.startsWith('#') ? raw.slice(1) : raw
  return new URLSearchParams(hash)
}

function normalizeRedirectPath(path: string | null | undefined): string {
  const value = (path || '').trim()
  if (!value) return '/purchase'
  if (!value.startsWith('/')) return '/purchase'
  if (value.startsWith('//') || value.includes('://')) return '/purchase'
  if (value === '/payment') return '/purchase'
  if (value.startsWith('/payment?')) return '/purchase' + value.slice('/payment'.length)
  return value
}

function appendQueryParam(query: Record<string, string>, key: string, value: string) {
  if (value) {
    query[key] = value
  }
}

/** 微信内 JSAPI 支付授权回调：把恢复令牌带回购买页 */
export default function WechatPaymentCallbackView() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (errorMessage) {
      useAppStore.getState().showError(errorMessage)
    }
  }, [errorMessage])

  function goBackToPayment() {
    void navigate('/purchase', { replace: true })
  }

  useMountOnce(async () => {
    const fragment = parseFragmentParams()
    const readParam = (key: string) => fragment.get(key) || searchParams.get(key) || ''

    const error = readParam('error') || readParam('err_msg') || readParam('errmsg')
    const errorDescription = readParam('error_description') || readParam('message')

    if (error) {
      setErrorMessage(errorDescription || error)
      return
    }

    const resumeToken = readParam('wechat_resume_token')
    const openid = readParam('openid')
    const redirectURL = new URL(normalizeRedirectPath(readParam('redirect')), window.location.origin)

    if (!resumeToken && !openid) {
      setErrorMessage(t('auth.wechatPayment.callbackMissingResumeToken'))
      return
    }

    const query: Record<string, string> = {
      ...Object.fromEntries(redirectURL.searchParams.entries()),
      wechat_resume: '1',
    }

    if (resumeToken) {
      query.wechat_resume_token = resumeToken
    } else {
      query.openid = openid
      appendQueryParam(query, 'state', readParam('state'))
      appendQueryParam(query, 'scope', readParam('scope'))
      appendQueryParam(query, 'payment_type', readParam('payment_type'))
      appendQueryParam(query, 'amount', readParam('amount'))
      appendQueryParam(query, 'order_type', readParam('order_type'))
      appendQueryParam(query, 'plan_id', readParam('plan_id'))
    }

    await navigate(
      { pathname: redirectURL.pathname, search: `?${new URLSearchParams(query).toString()}` },
      { replace: true }
    )
  })

  return (
    <div className={styles.standalone}>
      <div className={styles.standaloneInner}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h1 className={styles.panelTitle}>{t('auth.wechatPayment.callbackTitle')}</h1>
            <p className={styles.panelText}>{errorMessage || t('auth.wechatPayment.callbackProcessing')}</p>
          </div>

          {!errorMessage ? (
            <div className={styles.loader} role="status">
              <Loader2 className={styles.spinner} size={28} strokeWidth={1.75} aria-hidden="true" />
            </div>
          ) : (
            <>
              <Alert tone="warning" title={errorMessage} />
              <div>
                <Button type="button" onClick={goBackToPayment}>
                  {t('auth.wechatPayment.backToPayment')}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
