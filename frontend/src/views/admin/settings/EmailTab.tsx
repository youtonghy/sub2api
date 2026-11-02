/** 邮件 Tab：SMTP、测试邮件、订阅到期提醒、邮件模板、余额不足与账号限额通知 */
import { useState } from 'react'
import { Mail, Plus, X } from 'lucide-react'

import { adminAPI } from '@/api'
import { Button } from '@/components/arc/button/button'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { Field, SettingSwitch, SettingsRegion, ToggleRow } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { cx, numberInputValue } from '@/components/admin/settings/settingsUtils'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores'
import type { NotifyEmailEntry } from '@/types'
import { extractApiErrorMessage } from '@/utils/apiError'
import EmailTemplateEditor from './EmailTemplateEditor'
import { useSettings } from './settingsContext'

const currentOrigin = typeof window !== 'undefined' ? window.location.origin : ''

function SmtpSection() {
  const { t } = useI18n()
  const { form, updateForm, ui, updateUi, loadFailed } = useSettings()
  const [testingSmtp, setTestingSmtp] = useState(false)
  const [sendingTestEmail, setSendingTestEmail] = useState(false)
  const [testEmailAddress, setTestEmailAddress] = useState('')

  async function testSmtpConnection() {
    setTestingSmtp(true)
    try {
      const result = await adminAPI.settings.testSmtpConnection({
        smtp_host: form.smtp_host,
        smtp_port: form.smtp_port,
        smtp_username: form.smtp_username,
        smtp_password: ui.smtpPasswordManuallyEdited ? form.smtp_password : '',
        smtp_use_tls: form.smtp_use_tls
      })
      // API returns { message: "..." } on success, errors are thrown as exceptions
      useAppStore.getState().showSuccess(result.message || t('admin.settings.smtpConnectionSuccess'))
    } catch (error: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.settings.failedToTestSmtp')))
    } finally {
      setTestingSmtp(false)
    }
  }

  async function sendTestEmail() {
    if (!testEmailAddress) {
      useAppStore.getState().showError(t('admin.settings.testEmail.enterRecipientHint'))
      return
    }
    setSendingTestEmail(true)
    try {
      const result = await adminAPI.settings.sendTestEmail({
        email: testEmailAddress,
        smtp_host: form.smtp_host,
        smtp_port: form.smtp_port,
        smtp_username: form.smtp_username,
        smtp_password: ui.smtpPasswordManuallyEdited ? form.smtp_password : '',
        smtp_from_email: form.smtp_from_email,
        smtp_from_name: form.smtp_from_name,
        smtp_use_tls: form.smtp_use_tls
      })
      useAppStore.getState().showSuccess(result.message || t('admin.settings.testEmailSent'))
    } catch (error: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.settings.failedToSendTestEmail')))
    } finally {
      setSendingTestEmail(false)
    }
  }

  const markEdited = () => {
    if (!ui.smtpPasswordManuallyEdited) updateUi({ smtpPasswordManuallyEdited: true })
  }

  return (
    <>
      <SettingsRegion
        title={t('admin.settings.smtp.title')}
        description={t('admin.settings.smtp.description')}
        actions={
          <Button type="button" variant="secondary" size="sm" disabled={testingSmtp || loadFailed} onClick={() => void testSmtpConnection()}>
            {testingSmtp ? t('admin.settings.smtp.testing') : t('admin.settings.smtp.testConnection')}
          </Button>
        }
      >
        <div className={s.grid2}>
          <Field label={t('admin.settings.smtp.host')}>
            <input
              type="text"
              className={s.input}
              value={form.smtp_host}
              placeholder={t('admin.settings.smtp.hostPlaceholder')}
              onChange={(e) => updateForm({ smtp_host: e.target.value })}
            />
          </Field>
          <Field label={t('admin.settings.smtp.port')}>
            <input
              type="number"
              min="1"
              max="65535"
              className={s.input}
              value={form.smtp_port}
              placeholder={t('admin.settings.smtp.portPlaceholder')}
              onChange={(e) => updateForm({ smtp_port: numberInputValue(e.target.value) as number })}
            />
          </Field>
          <Field label={t('admin.settings.smtp.username')}>
            <input
              type="text"
              className={s.input}
              value={form.smtp_username}
              placeholder={t('admin.settings.smtp.usernamePlaceholder')}
              onChange={(e) => updateForm({ smtp_username: e.target.value })}
            />
          </Field>
          <Field
            label={t('admin.settings.smtp.password')}
            hint={form.smtp_password_configured ? t('admin.settings.smtp.passwordConfiguredHint') : t('admin.settings.smtp.passwordHint')}
          >
            <input
              type="password"
              autoComplete="new-password"
              autoCapitalize="off"
              spellCheck={false}
              className={s.input}
              value={form.smtp_password}
              placeholder={
                form.smtp_password_configured
                  ? t('admin.settings.smtp.passwordConfiguredPlaceholder')
                  : t('admin.settings.smtp.passwordPlaceholder')
              }
              onKeyDown={markEdited}
              onPaste={markEdited}
              onChange={(e) => updateForm({ smtp_password: e.target.value })}
            />
          </Field>
          <Field label={t('admin.settings.smtp.fromEmail')}>
            <input
              type="email"
              className={s.input}
              value={form.smtp_from_email}
              placeholder={t('admin.settings.smtp.fromEmailPlaceholder')}
              onChange={(e) => updateForm({ smtp_from_email: e.target.value })}
            />
          </Field>
          <Field label={t('admin.settings.smtp.fromName')}>
            <input
              type="text"
              className={s.input}
              value={form.smtp_from_name}
              placeholder={t('admin.settings.smtp.fromNamePlaceholder')}
              onChange={(e) => updateForm({ smtp_from_name: e.target.value })}
            />
          </Field>
        </div>
        <ToggleRow
          label={t('admin.settings.smtp.useTls')}
          description={t('admin.settings.smtp.useTlsHint')}
          checked={form.smtp_use_tls}
          onChange={(value) => updateForm({ smtp_use_tls: value })}
        />
      </SettingsRegion>

      <SettingsRegion title={t('admin.settings.testEmail.title')} description={t('admin.settings.testEmail.description')}>
        <Field label={t('admin.settings.testEmail.recipientEmail')}>
          <div className={s.inline}>
            <input
              type="email"
              className={cx(s.input, s.grow)}
              style={{ flex: '1 1 16rem', width: 'auto' }}
              value={testEmailAddress}
              placeholder={t('admin.settings.testEmail.recipientEmailPlaceholder')}
              onChange={(e) => setTestEmailAddress(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              disabled={sendingTestEmail || !testEmailAddress || loadFailed}
              onClick={() => void sendTestEmail()}
            >
              {sendingTestEmail ? t('admin.settings.testEmail.sending') : t('admin.settings.testEmail.sendTestEmail')}
            </Button>
          </div>
        </Field>
      </SettingsRegion>
    </>
  )
}

function NotificationsSections() {
  const { t } = useI18n()
  const { form, updateForm } = useSettings()
  const emails: NotifyEmailEntry[] = form.account_quota_notify_emails || []
  const updateEmail = (index: number, patch: Partial<NotifyEmailEntry>) =>
    updateForm({ account_quota_notify_emails: emails.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)) })

  return (
    <>
      <SettingsRegion title={t('admin.settings.balanceNotify.title')} description={t('admin.settings.balanceNotify.description')}>
        <ToggleRow
          label={t('admin.settings.balanceNotify.enabled')}
          checked={form.balance_low_notify_enabled}
          onChange={(value) => updateForm({ balance_low_notify_enabled: value })}
        >
          {form.balance_low_notify_enabled ? (
            <div className={s.grid2}>
              <Field label={t('admin.settings.balanceNotify.threshold')} hint={t('admin.settings.balanceNotify.thresholdHint')}>
                <div className={s.inline} style={{ flexWrap: 'nowrap' }}>
                  <span className={s.hint}>$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={s.input}
                    value={form.balance_low_notify_threshold}
                    onChange={(e) => updateForm({ balance_low_notify_threshold: numberInputValue(e.target.value) as number })}
                  />
                </div>
              </Field>
              <Field label={t('admin.settings.balanceNotify.rechargeUrl')} hint={t('admin.settings.balanceNotify.rechargeUrlHint')}>
                <input
                  type="url"
                  className={s.input}
                  value={form.balance_low_notify_recharge_url}
                  placeholder={currentOrigin}
                  onChange={(e) => updateForm({ balance_low_notify_recharge_url: e.target.value })}
                />
              </Field>
            </div>
          ) : null}
        </ToggleRow>
      </SettingsRegion>

      <SettingsRegion title={t('admin.settings.quotaNotify.title')} description={t('admin.settings.quotaNotify.description')}>
        <ToggleRow
          label={t('admin.settings.quotaNotify.enabled')}
          checked={form.account_quota_notify_enabled}
          onChange={(value) => updateForm({ account_quota_notify_enabled: value })}
        >
          {form.account_quota_notify_enabled ? (
            <Field label={t('admin.settings.quotaNotify.emails')} hint={t('admin.settings.quotaNotify.emailsHint')}>
              <div className={s.columnTight}>
                {emails.map((entry, index) => (
                  <div key={index} className={s.inline} style={{ flexWrap: 'nowrap' }}>
                    <SettingSwitch
                      checked={!entry.disabled}
                      aria-label={entry.email || t('admin.settings.quotaNotify.emailPlaceholder')}
                      onChange={(value) => updateEmail(index, { disabled: !value })}
                    />
                    <input
                      type="email"
                      className={s.input}
                      value={entry.email}
                      placeholder={t('admin.settings.quotaNotify.emailPlaceholder')}
                      onChange={(e) => updateEmail(index, { email: e.target.value })}
                    />
                    <button
                      type="button"
                      className={cx(s.iconButton, s.iconButtonDanger)}
                      aria-label={t('common.delete')}
                      onClick={() => updateForm({ account_quota_notify_emails: emails.filter((_, i) => i !== index) })}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => updateForm({ account_quota_notify_emails: [...emails, { email: '', disabled: false, verified: true }] })}
                  >
                    <Plus size={14} aria-hidden="true" />
                    {t('admin.settings.quotaNotify.addEmail')}
                  </Button>
                </div>
              </div>
            </Field>
          ) : null}
        </ToggleRow>
      </SettingsRegion>
    </>
  )
}

export default function EmailTab() {
  const { t } = useI18n()
  const { form, updateForm } = useSettings()
  return (
    <>
      {/* SMTP 与测试邮件仅在开启邮箱验证时显示 */}
      {form.email_verify_enabled ? (
        <SmtpSection />
      ) : (
        <EmptyState
          icon={<Mail size={20} aria-hidden="true" />}
          title={t('admin.settings.emailTabDisabledTitle')}
          description={t('admin.settings.emailTabDisabledHint')}
        />
      )}
      <SettingsRegion
        title={t('admin.settings.subscriptionExpiryNotify.title')}
        description={t('admin.settings.subscriptionExpiryNotify.description')}
      >
        <ToggleRow
          label={t('admin.settings.subscriptionExpiryNotify.enabled')}
          description={t('admin.settings.subscriptionExpiryNotify.enabledHint')}
          checked={form.subscription_expiry_notify_enabled}
          onChange={(value) => updateForm({ subscription_expiry_notify_enabled: value })}
        />
      </SettingsRegion>
      <EmailTemplateEditor />
      <NotificationsSections />
    </>
  )
}
