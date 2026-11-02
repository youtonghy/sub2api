import { useEffect, useRef, useState } from 'react'

import { userAPI } from '@/api'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import Input from '@/components/common/Input'
import Toggle from '@/components/common/Toggle'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { NotifyEmailEntry, User } from '@/types'
import { extractApiErrorMessage } from '@/utils/apiError'
import styles from './ProfileBalanceNotifyCard.module.css'
import shared from './Profile.module.css'

const maxTotalEmails = 3

interface PendingEmail {
  id: number
  email: string
  codeSent: boolean
  code: string
  sending: boolean
  verifying: boolean
  countdown: number
}

export interface ProfileBalanceNotifyCardProps {
  enabled: boolean
  threshold: number | null
  extraEmails: NotifyEmailEntry[]
  systemDefaultThreshold: number
  userEmail: string
}

/** 余额不足提醒设置（开关、阈值、额外通知邮箱及其验证），对应 Vue 版 ProfileBalanceNotifyCard.vue */
export default function ProfileBalanceNotifyCard({
  enabled,
  threshold,
  extraEmails,
  systemDefaultThreshold,
  userEmail
}: ProfileBalanceNotifyCardProps) {
  const { t } = useI18n()
  const [notifyEnabled, setNotifyEnabled] = useState(enabled)
  const [customThreshold, setCustomThreshold] = useState<number | null>(threshold)
  const [emailEntries, setEmailEntries] = useState<NotifyEmailEntry[]>(() => [...extraEmails])
  const [pendingEmails, setPendingEmails] = useState<PendingEmail[]>([])
  // When list is empty on mount, pre-fill the add input with user's email
  const [newEmail, setNewEmail] = useState(() => (extraEmails.length === 0 && userEmail ? userEmail : ''))
  const [savingThreshold, setSavingThreshold] = useState(false)

  // State for verifying saved unverified emails
  const [verifyingEmail, setVerifyingEmail] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [verifyingSaved, setVerifyingSaved] = useState(false)
  const [sendingSavedCode, setSendingSavedCode] = useState(false)
  const [verifyCountdown, setVerifyCountdown] = useState(0)

  const verifyTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const pendingTimers = useRef(new Map<number, ReturnType<typeof setInterval>>())
  const pendingRef = useRef<PendingEmail[]>([])
  const nextPendingId = useRef(1)
  const disposed = useRef(false)

  // 对应 Vue 版 watch(enabled / threshold / extraEmails)
  const [prevProps, setPrevProps] = useState({ enabled, threshold, extraEmails })
  if (prevProps.enabled !== enabled || prevProps.threshold !== threshold || prevProps.extraEmails !== extraEmails) {
    if (prevProps.enabled !== enabled) setNotifyEnabled(enabled)
    if (prevProps.threshold !== threshold) setCustomThreshold(threshold)
    if (prevProps.extraEmails !== extraEmails) setEmailEntries([...extraEmails])
    setPrevProps({ enabled, threshold, extraEmails })
  }

  useEffect(() => {
    disposed.current = false
    const timers = pendingTimers.current
    return () => {
      disposed.current = true
      for (const timer of timers.values()) clearInterval(timer)
      timers.clear()
      if (verifyTimer.current) clearInterval(verifyTimer.current)
      verifyTimer.current = null
    }
  }, [])

  function updatePending(updater: (list: PendingEmail[]) => PendingEmail[]) {
    pendingRef.current = updater(pendingRef.current)
    setPendingEmails(pendingRef.current)
  }
  function patchPending(id: number, patch: Partial<PendingEmail>) {
    updatePending((list) => list.map((pe) => (pe.id === id ? { ...pe, ...patch } : pe)))
  }
  function removePending(id: number) {
    const timer = pendingTimers.current.get(id)
    if (timer) clearInterval(timer)
    pendingTimers.current.delete(id)
    updatePending((list) => list.filter((pe) => pe.id !== id))
  }

  const canAddMore = emailEntries.length + pendingEmails.length < maxTotalEmails

  function setUser(updated: User) {
    useAuthStore.setState({ user: updated })
  }

  const handleToggle = async (value: boolean) => {
    setNotifyEnabled(value)
    try {
      const updated = await userAPI.updateProfile({ balance_notify_enabled: value })
      setUser(updated)
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
      setNotifyEnabled(!value)
    }
  }

  const handleThresholdUpdate = async () => {
    setSavingThreshold(true)
    try {
      const value = customThreshold && customThreshold > 0 ? customThreshold : 0
      const updated = await userAPI.updateProfile({ balance_notify_threshold: value })
      setUser(updated)
      useAppStore.getState().showSuccess(t('common.saved'))
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      setSavingThreshold(false)
    }
  }

  async function handleEmailToggle(entry: NotifyEmailEntry) {
    try {
      const updated = await userAPI.toggleNotifyEmail(entry.email, !entry.disabled)
      setUser(updated)
      setEmailEntries([...updated.balance_notify_extra_emails])
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    }
  }

  function addPendingEmail() {
    const email = newEmail.trim()
    if (!email) return
    // Check duplicates
    const isDuplicate =
      emailEntries.some((e) => e.email.toLowerCase() === email.toLowerCase()) ||
      pendingRef.current.some((p) => p.email.toLowerCase() === email.toLowerCase())
    if (isDuplicate) {
      useAppStore.getState().showError(t('profile.balanceNotify.emailDuplicate'))
      return
    }
    const id = nextPendingId.current++
    updatePending((list) => [
      ...list,
      { id, email, codeSent: false, code: '', sending: false, verifying: false, countdown: 0 }
    ])
    setNewEmail('')
  }

  async function sendCodeFor(id: number) {
    const pe = pendingRef.current.find((item) => item.id === id)
    if (!pe) return
    patchPending(id, { sending: true })
    try {
      await userAPI.sendNotifyEmailCode(pe.email)
      if (disposed.current || !pendingRef.current.some((item) => item.id === id)) return
      patchPending(id, { codeSent: true, countdown: 60 })
      const existing = pendingTimers.current.get(id)
      if (existing) clearInterval(existing)
      const timer = setInterval(() => {
        const current = pendingRef.current.find((item) => item.id === id)
        const next = (current?.countdown ?? 0) - 1
        if (current) patchPending(id, { countdown: next })
        if (next <= 0) {
          clearInterval(timer)
          pendingTimers.current.delete(id)
        }
      }, 1000)
      pendingTimers.current.set(id, timer)
      useAppStore.getState().showSuccess(t('profile.balanceNotify.codeSent'))
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      if (!disposed.current) patchPending(id, { sending: false })
    }
  }

  async function verifyPending(id: number) {
    const pe = pendingRef.current.find((item) => item.id === id)
    if (!pe || !pe.code || pe.code.length !== 6) return
    patchPending(id, { verifying: true })
    try {
      await userAPI.verifyNotifyEmail(pe.email, pe.code)
      removePending(id)
      useAppStore.getState().showSuccess(t('profile.balanceNotify.verifySuccess'))
      const updated = await userAPI.getProfile()
      setUser(updated)
      setEmailEntries([...updated.balance_notify_extra_emails])
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      if (!disposed.current) patchPending(id, { verifying: false })
    }
  }

  const handleRemoveEmail = async (email: string) => {
    try {
      await userAPI.removeNotifyEmail(email)
      useAppStore.getState().showSuccess(t('profile.balanceNotify.removeSuccess'))
      const updated = await userAPI.getProfile()
      setUser(updated)
      setEmailEntries([...updated.balance_notify_extra_emails])
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    }
  }

  // Verify saved unverified emails
  async function sendCodeForSaved(email: string) {
    setSendingSavedCode(true)
    try {
      await userAPI.sendNotifyEmailCode(email)
      if (disposed.current) return
      setVerifyingEmail(email)
      setVerifyCode('')
      setVerifyCountdown(60)
      if (verifyTimer.current) clearInterval(verifyTimer.current)
      let remaining = 60
      verifyTimer.current = setInterval(() => {
        remaining -= 1
        setVerifyCountdown(remaining)
        if (remaining <= 0 && verifyTimer.current) {
          clearInterval(verifyTimer.current)
          verifyTimer.current = null
        }
      }, 1000)
      useAppStore.getState().showSuccess(t('profile.balanceNotify.codeSent'))
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      if (!disposed.current) setSendingSavedCode(false)
    }
  }

  async function verifySavedEmail(email: string) {
    if (!verifyCode || verifyCode.length !== 6) return
    setVerifyingSaved(true)
    try {
      await userAPI.verifyNotifyEmail(email, verifyCode)
      setVerifyingEmail('')
      setVerifyCode('')
      if (verifyTimer.current) {
        clearInterval(verifyTimer.current)
        verifyTimer.current = null
      }
      useAppStore.getState().showSuccess(t('profile.balanceNotify.verifySuccess'))
      const updated = await userAPI.getProfile()
      setUser(updated)
      setEmailEntries([...updated.balance_notify_extra_emails])
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      if (!disposed.current) setVerifyingSaved(false)
    }
  }

  const thresholdPlaceholder =
    systemDefaultThreshold > 0
      ? `${t('profile.balanceNotify.systemDefault')} $${systemDefaultThreshold}`
      : t('profile.balanceNotify.thresholdPlaceholder')

  return (
    <section className={shared.panel}>
      <div className={shared.panelHeader}>
        <div>
          <h2 className={shared.panelTitle}>{t('profile.balanceNotify.title')}</h2>
          <p className={shared.panelDescription}>{t('profile.balanceNotify.description')}</p>
        </div>
      </div>
      <div className={`${shared.panelBody} ${styles.body}`}>
        {/* Enable toggle */}
        <div className={styles.toggleRow}>
          <span className={shared.label}>{t('profile.balanceNotify.enabled')}</span>
          <Toggle
            value={notifyEnabled}
            aria-label={t('profile.balanceNotify.enabled')}
            onChange={(value) => void handleToggle(value)}
          />
        </div>

        {notifyEnabled && (
          <>
            {/* Custom threshold with save button */}
            <div className={styles.field}>
              <span className={shared.label}>
                {t('profile.balanceNotify.threshold')}
                <span className={styles.labelHint}>{t('profile.balanceNotify.thresholdHint')}</span>
              </span>
              <div className={styles.thresholdRow}>
                <span className={shared.hint}>$</span>
                <div className={styles.grow}>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    aria-label={t('profile.balanceNotify.threshold')}
                    placeholder={thresholdPlaceholder}
                    value={customThreshold ?? ''}
                    onChange={(value) => setCustomThreshold(value === '' ? null : Number(value))}
                  />
                </div>
                <Button type="button" size="sm" disabled={savingThreshold} onClick={() => void handleThresholdUpdate()}>
                  {savingThreshold ? t('common.saving') : t('common.save')}
                </Button>
              </div>
            </div>

            {/* Email list with toggles */}
            <div className={styles.field}>
              <span className={shared.label}>{t('profile.balanceNotify.extraEmails')}</span>
              <p className={`${shared.hint} ${shared.warningText}`}>{t('profile.balanceNotify.extraEmailsHint')}</p>

              {/* Saved email entries */}
              {emailEntries.length > 0 && (
                <div className={styles.list}>
                  {emailEntries.map((entry, idx) => (
                    <div key={idx} className={styles.entry}>
                      <div className={styles.entryMain}>
                        <Toggle
                          value={!entry.disabled}
                          aria-label={entry.email}
                          onChange={() => void handleEmailToggle(entry)}
                        />
                        <span className={styles.entryEmail}>{entry.email}</span>
                      </div>
                      <div className={styles.entryActions}>
                        {!entry.verified ? (
                          verifyingEmail === entry.email ? (
                            <>
                              {/* Inline verify flow for saved unverified emails */}
                              <input
                                type="text"
                                maxLength={6}
                                className={styles.codeInput}
                                aria-label={t('profile.balanceNotify.codePlaceholder')}
                                placeholder={t('profile.balanceNotify.codePlaceholder')}
                                value={verifyCode}
                                onChange={(event) => setVerifyCode(event.target.value)}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={!verifyCode || verifyCode.length !== 6 || verifyingSaved}
                                onClick={() => void verifySavedEmail(entry.email)}
                              >
                                {t('profile.balanceNotify.verify')}
                              </Button>
                              {verifyCountdown > 0 ? (
                                <span className={shared.hint}>{verifyCountdown}s</span>
                              ) : (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={sendingSavedCode}
                                  onClick={() => void sendCodeForSaved(entry.email)}
                                >
                                  {t('profile.balanceNotify.resend')}
                                </Button>
                              )}
                              <Button type="button" variant="ghost" size="sm" onClick={() => setVerifyingEmail('')}>
                                {t('common.cancel')}
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={sendingSavedCode}
                                onClick={() => void sendCodeForSaved(entry.email)}
                              >
                                {t('profile.balanceNotify.verify')}
                              </Button>
                              <Badge size="sm" tone="warning">
                                {t('profile.balanceNotify.unverified')}
                              </Badge>
                            </>
                          )
                        ) : (
                          <Badge size="sm" tone="success">
                            {t('profile.balanceNotify.verified')}
                          </Badge>
                        )}
                        <Button type="button" variant="ghost" size="sm" onClick={() => void handleRemoveEmail(entry.email)}>
                          {t('profile.balanceNotify.removeEmail')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Pending (unverified) emails in verification flow */}
              {pendingEmails.length > 0 && (
                <div className={styles.list}>
                  {pendingEmails.map((pe) => (
                    <div key={pe.id} className={styles.pending} data-testid="balance-notify-pending-row">
                      <span className={styles.entryEmail}>{pe.email}</span>
                      {!pe.codeSent ? (
                        <div className={styles.entryActions}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={pe.sending}
                            onClick={() => void sendCodeFor(pe.id)}
                          >
                            {t('profile.balanceNotify.sendCode')}
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => removePending(pe.id)}>
                            {t('profile.balanceNotify.removeEmail')}
                          </Button>
                        </div>
                      ) : (
                        <div className={styles.entryActions}>
                          <input
                            type="text"
                            maxLength={6}
                            className={styles.codeInput}
                            aria-label={t('profile.balanceNotify.codePlaceholder')}
                            placeholder={t('profile.balanceNotify.codePlaceholder')}
                            value={pe.code}
                            onChange={(event) => patchPending(pe.id, { code: event.target.value })}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={!pe.code || pe.code.length !== 6 || pe.verifying}
                            onClick={() => void verifyPending(pe.id)}
                          >
                            {t('profile.balanceNotify.verify')}
                          </Button>
                          {pe.countdown > 0 ? (
                            <span className={shared.hint}>{pe.countdown}s</span>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={pe.sending}
                              onClick={() => void sendCodeFor(pe.id)}
                            >
                              {t('profile.balanceNotify.resend')}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Add new email input (hidden when at limit) */}
              {canAddMore ? (
                <div className={styles.addRow}>
                  <div className={styles.grow}>
                    <Input
                      type="email"
                      aria-label={t('profile.balanceNotify.emailPlaceholder')}
                      placeholder={t('profile.balanceNotify.emailPlaceholder')}
                      value={newEmail}
                      onChange={setNewEmail}
                      onEnter={addPendingEmail}
                    />
                  </div>
                  <Button type="button" variant="secondary" disabled={!newEmail} onClick={addPendingEmail}>
                    {t('common.add')}
                  </Button>
                </div>
              ) : (
                <p className={shared.hint}>{t('profile.balanceNotify.maxEmailsReached')}</p>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
