/**
 * Codex 推荐邀请：可用次数查询与发送邀请，对应 Vue 版 OpenAIReferralCell.vue。
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { refreshOpenAIReferrals, sendOpenAIReferralInvite } from '@/api/admin/accounts'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { Input } from '@/components/arc/input/input'
import BaseDialog from '@/components/common/BaseDialog'
import { useI18n } from '@/i18n/useI18n'
import type { Account } from '@/types'
import type { OpenAIReferralEligibility } from '@/types/openaiReferrals'
import shared from './usageCells.module.css'
import styles from './OpenAIReferralCell.module.css'

export interface OpenAIReferralCellProps {
  account: Account
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 切换账号时整体重建，丢弃进行中的查询与表单（Vue 版 watch(account.id) 重置） */
export default function OpenAIReferralCell(props: OpenAIReferralCellProps) {
  return <OpenAIReferralCellInner key={props.account.id} {...props} />
}

function OpenAIReferralCellInner({ account }: OpenAIReferralCellProps) {
  const { t } = useI18n()
  const [eligibility, setEligibility] = useState<OpenAIReferralEligibility | null>(
    () => account.extra?.codex_referral_snapshot ?? null
  )
  const [show, setShow] = useState(false)
  const [loading, setLoadingState] = useState(false)
  const [sending, setSendingState] = useState(false)
  const [fresh, setFresh] = useState(false)
  const [email, setEmail] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [sentEmail, setSentEmail] = useState('')
  // 同一事件里重复提交时读取最新值，避免重复发送
  const loadingRef = useRef(false)
  const sendingRef = useRef(false)
  const generation = useRef(0)

  useEffect(() => {
    const gen = generation
    return () => {
      gen.current++
    }
  }, [])

  const setLoading = (value: boolean) => {
    loadingRef.current = value
    setLoadingState(value)
  }
  const setSending = (value: boolean) => {
    sendingRef.current = value
    setSendingState(value)
  }

  const isShadow = account.parent_account_id != null
  const formID = `codex-referral-form-${account.id}`
  const emailID = `codex-referral-email-${account.id}`
  const count = (() => {
    const value = eligibility?.available_invites
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
  })()
  const countDisplay = count ?? '—'
  const countTitle = eligibility?.fetched_at
    ? t('admin.accounts.openaiReferral.checkedAt', { time: new Date(eligibility.fetched_at * 1000).toLocaleString() })
    : t('admin.accounts.openaiReferral.queryHint')
  const programLabel = t(
    eligibility?.program_id === 'codex_referral_workspace'
      ? 'admin.accounts.openaiReferral.workspace'
      : 'admin.accounts.openaiReferral.personal'
  )
  const needsConsent = eligibility?.requires_explicit_confirmation !== false
  const canSend =
    fresh &&
    !isShadow &&
    !loading &&
    !sending &&
    eligibility?.should_show === true &&
    count !== null &&
    count > 0 &&
    EMAIL_PATTERN.test(email.trim()) &&
    (!needsConsent || confirmed)

  function errorMessage(value: unknown, duringSend = false): string {
    const err = value as { status?: number; reason?: string; code?: string; message?: string }
    const key = err.reason || err.code || ''
    // The server may have sent the email before the response was lost. Only
    // sends have an uncertain outcome; a failed eligibility query is read-only.
    if (duringSend && (err.status === 0 || ['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK', 'ERR_CANCELED'].includes(key))) {
      return t('admin.accounts.openaiReferral.sendUnknown')
    }
    const keys: Record<string, string> = {
      OPENAI_REFERRAL_UNAVAILABLE: 'unavailable',
      OPENAI_REFERRAL_FORBIDDEN: 'unavailable',
      OPENAI_REFERRAL_INVALID_EMAIL: 'invalidEmail',
      OPENAI_REFERRAL_REJECTED: 'rejected',
      OPENAI_REFERRAL_ALREADY_EXISTS: 'alreadyInvited',
      OPENAI_REFERRAL_RATE_LIMITED: 'rateLimited',
      OPENAI_REFERRAL_SEND_UNKNOWN: 'sendUnknown',
      OPENAI_REFERRAL_PROGRAM_CHANGED: 'programChanged',
      OPENAI_REFERRAL_CONFIRMATION_REQUIRED: 'consentRequired'
    }
    return keys[key] ? t(`admin.accounts.openaiReferral.${keys[key]}`) : err.message || t('common.error')
  }

  async function refresh() {
    if (loadingRef.current || sendingRef.current) return
    const current = generation.current
    setLoading(true)
    setFresh(false)
    setError('')
    setWarning('')
    try {
      const result = await refreshOpenAIReferrals(account.id)
      if (current !== generation.current) return
      setEligibility(result.eligibility)
      setFresh(result.eligibility !== null)
      if (!result.cache_persisted) setWarning(t('admin.accounts.openaiReferral.cacheFailed'))
    } catch (err) {
      if (current === generation.current) setError(errorMessage(err))
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }

  function openDialog() {
    if (isShadow || sendingRef.current) return
    setShow(true)
    setEmail('')
    setConfirmed(false)
    setSentEmail('')
    void refresh()
  }

  function closeDialog() {
    if (!sendingRef.current) setShow(false)
  }

  // 修改收件人时清除已勾选的确认（Vue 版 watch(email)）
  function updateEmail(value: string) {
    setEmail(value)
    setConfirmed(false)
  }

  async function sendInvite(event?: FormEvent) {
    event?.preventDefault()
    if (!canSend || !eligibility || sendingRef.current) return
    const current = generation.current
    setSending(true)
    setError('')
    setWarning('')
    setSentEmail('')
    try {
      const result = await sendOpenAIReferralInvite(account.id, {
        email: email.trim(),
        program_id: eligibility.program_id,
        confirmed
      })
      if (current !== generation.current) return
      if (!result.sent) throw { code: 'OPENAI_REFERRAL_SEND_UNKNOWN' }
      setEligibility(result.eligibility)
      setFresh(!result.refresh_failed && result.eligibility !== null)
      setSentEmail(result.email)
      setEmail('')
      setConfirmed(false)
      if (result.refresh_failed) setWarning(t('admin.accounts.openaiReferral.refreshFailed'))
      else if (!result.cache_persisted) setWarning(t('admin.accounts.openaiReferral.cacheFailed'))
    } catch (err) {
      if (current !== generation.current) return
      setFresh(false)
      setError(errorMessage(err, true))
    } finally {
      if (current === generation.current) setSending(false)
    }
  }

  return (
    <div className={shared.actionsRow}>
      <button
        type="button"
        data-testid="referral-count"
        className={shared.action}
        disabled={loading || sending}
        title={countTitle}
        onClick={() => void refresh()}
      >
        {t('admin.accounts.openaiReferral.available')} {countDisplay}
      </button>
      <button
        type="button"
        data-testid="referral-open"
        className={shared.action}
        disabled={sending || isShadow}
        title={isShadow ? t('admin.accounts.openaiReferral.shadowHint') : undefined}
        onClick={openDialog}
      >
        {t('admin.accounts.openaiReferral.invite')}
      </button>
      {error && !show ? (
        <span className={styles.inlineError} title={error}>
          {error}
        </span>
      ) : null}
      {warning && !show ? (
        <span className={styles.inlineWarning} title={warning}>
          {warning}
        </span>
      ) : null}
      {show ? (
        <BaseDialog
          show={show}
          title={t('admin.accounts.openaiReferral.invite')}
          showCloseButton={!sending}
          closeOnEscape={!sending}
          onClose={closeDialog}
          footer={
            <>
              <Button type="button" variant="secondary" disabled={sending} onClick={closeDialog}>
                {t('common.close')}
              </Button>
              <Button type="submit" form={formID} disabled={!canSend} data-testid="referral-send">
                {sending ? t('admin.accounts.openaiReferral.sending') : t('admin.accounts.openaiReferral.send')}
              </Button>
            </>
          }
        >
          <form id={formID} className={styles.form} onSubmit={(event) => void sendInvite(event)}>
            <p className={styles.text}>
              {t('admin.accounts.openaiReferral.fromAccount')} <strong>{account.name}</strong>
            </p>
            <div className={styles.program}>
              <div>
                <p className={styles.programLabel}>{programLabel}</p>
                <p className={styles.text}>
                  {t('admin.accounts.openaiReferral.available')} {countDisplay}
                </p>
              </div>
              <Button type="button" variant="secondary" size="sm" disabled={loading || sending} onClick={() => void refresh()}>
                {loading ? t('common.loading') : t('common.refresh')}
              </Button>
            </div>
            {eligibility?.title || eligibility?.description || eligibility?.rules?.length ? (
              <div className={styles.rules}>
                {eligibility.title ? <p className={styles.rulesTitle}>{eligibility.title}</p> : null}
                {eligibility.description ? <p>{eligibility.description}</p> : null}
                {eligibility.rules?.length ? (
                  <ul className={styles.ruleList}>
                    {eligibility.rules.map((rule, index) => (
                      <li key={index}>{rule}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {fresh && (!eligibility?.should_show || count === null || count <= 0) ? (
              <p className={styles.warning}>{t('admin.accounts.openaiReferral.unavailable')}</p>
            ) : null}
            <Input
              id={emailID}
              label={t('admin.accounts.openaiReferral.email')}
              type="email"
              autoComplete="off"
              maxLength={254}
              required
              disabled={sending}
              placeholder="friend@example.com"
              data-testid="referral-email"
              value={email}
              onChange={(event) => updateEmail(event.target.value)}
            />
            {needsConsent ? (
              <Checkbox
                label={t('admin.accounts.openaiReferral.consent')}
                checked={confirmed}
                disabled={sending}
                data-testid="referral-consent"
                onCheckedChange={(value) => setConfirmed(value === true)}
              />
            ) : null}
            {error ? (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            ) : null}
            {sentEmail ? (
              <p role="status" className={styles.success}>
                {t('admin.accounts.openaiReferral.sent', { email: sentEmail })}
              </p>
            ) : null}
            {warning ? (
              <p role="status" className={styles.warning}>
                {warning}
              </p>
            ) : null}
          </form>
        </BaseDialog>
      ) : null}
    </div>
  )
}
