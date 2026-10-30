/**
 * 安全 Tab：受限访问密钥、旧版全权密钥、注册与登录安全、API Key IP ACL、面板接口限流、人机验证，
 * 以及第三方登录（见 SecurityOAuthSections）。
 */
import type { ClipboardEvent, KeyboardEvent } from 'react'
import { Info } from 'lucide-react'

import { adminAPI } from '@/api'
import type { PanelRateLimitSettings } from '@/api/admin/settings'
import AdminAccessKeysSettings from '@/components/admin/settings/AdminAccessKeysSettings'
import { Field, Notice, SettingsRegion, ToggleRow } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { cx, numberInputValue } from '@/components/admin/settings/settingsUtils'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores'
import {
  isRegistrationEmailSuffixDomainValid,
  normalizeRegistrationEmailSuffixDomain,
  parseRegistrationEmailSuffixWhitelistInput
} from '@/utils/registrationEmailPolicy'
import IndependentSettingsRegion from './IndependentSettingsRegion'
import LegacyAdminApiKeySection from './LegacyAdminApiKeySection'
import SecurityOAuthSections from './SecurityOAuthSections'
import { useSettings } from './settingsContext'
import { captchaPatch, type CaptchaProviderSelection } from './settingsForm'
import {
  addForwardedClientIpHeader,
  maxForwardedClientIpHeaders,
  separatorKeys,
  type ForwardedClientIpHeaderResult
} from './settingsHelpers'
import TagInput from './TagInput'
import { useIndependentSettings } from './useIndependentSettings'

function RegistrationSection() {
  const { t } = useI18n()
  const { form, updateForm, draft, updateDraft, ui, updateUi } = useSettings()
  const tags = draft.registrationEmailSuffixWhitelistTags
  const toggle = (key: 'registration_enabled' | 'email_verify_enabled' | 'promo_code_enabled' | 'invitation_code_enabled', label: string) => (
    <ToggleRow
      label={t(`admin.settings.registration.${label}`)}
      description={t(`admin.settings.registration.${label}Hint`)}
      checked={form[key]}
      onChange={(value) => updateForm({ [key]: value })}
    />
  )

  function addTag(list: string[], raw: string): string[] {
    const suffix = normalizeRegistrationEmailSuffixDomain(raw)
    if (!isRegistrationEmailSuffixDomainValid(suffix) || list.includes(suffix)) return list
    return [...list, suffix]
  }
  function commitDraft() {
    const value = ui.registrationEmailSuffixWhitelistDraft
    if (!value) return
    updateDraft((d) => ({ registrationEmailSuffixWhitelistTags: addTag(d.registrationEmailSuffixWhitelistTags, value) }))
    updateUi({ registrationEmailSuffixWhitelistDraft: '' })
  }
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (separatorKeys.has(event.key)) {
      event.preventDefault()
      commitDraft()
      return
    }
    if (event.key === 'Backspace' && !ui.registrationEmailSuffixWhitelistDraft && tags.length > 0) {
      updateDraft((d) => ({ registrationEmailSuffixWhitelistTags: d.registrationEmailSuffixWhitelistTags.slice(0, -1) }))
    }
  }
  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData?.getData('text') || ''
    if (!text.trim()) return
    event.preventDefault()
    const tokens = parseRegistrationEmailSuffixWhitelistInput(text)
    updateDraft((d) => ({
      registrationEmailSuffixWhitelistTags: tokens.reduce(addTag, d.registrationEmailSuffixWhitelistTags)
    }))
  }

  return (
    <SettingsRegion title={t('admin.settings.registration.title')} description={t('admin.settings.registration.description')}>
      {toggle('registration_enabled', 'enableRegistration')}
      {toggle('email_verify_enabled', 'emailVerification')}
      <Field label={t('admin.settings.registration.emailSuffixWhitelist')} hint={t('admin.settings.registration.emailSuffixWhitelistInputHint')}>
        <p className={s.hint}>{t('admin.settings.registration.emailSuffixWhitelistHint')}</p>
        <TagInput
          tags={tags}
          draft={ui.registrationEmailSuffixWhitelistDraft}
          onDraftChange={(value) => updateUi({ registrationEmailSuffixWhitelistDraft: normalizeRegistrationEmailSuffixDomain(value) })}
          onRemove={(suffix) =>
            updateDraft((d) => ({
              registrationEmailSuffixWhitelistTags: d.registrationEmailSuffixWhitelistTags.filter((item) => item !== suffix)
            }))
          }
          onKeyDown={handleKeyDown}
          onBlur={commitDraft}
          onPaste={handlePaste}
          placeholder={t('admin.settings.registration.emailSuffixWhitelistPlaceholder')}
          removeLabel={(tag) => tag}
        />
      </Field>
      <ToggleRow
        label={t('admin.settings.registration.emailDomainQuota')}
        description={t('admin.settings.registration.emailDomainQuotaHint')}
        checked={form.registration_email_domain_quota_enabled}
        onChange={(value) => updateForm({ registration_email_domain_quota_enabled: value })}
      />
      {toggle('promo_code_enabled', 'promoCode')}
      {toggle('invitation_code_enabled', 'invitationCode')}
      {form.email_verify_enabled ? (
        <ToggleRow
          label={t('admin.settings.registration.passwordReset')}
          description={t('admin.settings.registration.passwordResetHint')}
          checked={form.password_reset_enabled}
          onChange={(value) => updateForm({ password_reset_enabled: value })}
        />
      ) : null}
      {form.email_verify_enabled && form.password_reset_enabled ? (
        <Field label={t('admin.settings.registration.frontendUrl')} hint={t('admin.settings.registration.frontendUrlHint')}>
          <input
            type="url"
            className={s.input}
            value={form.frontend_url}
            placeholder={t('admin.settings.registration.frontendUrlPlaceholder')}
            onChange={(e) => updateForm({ frontend_url: e.target.value })}
          />
        </Field>
      ) : null}
      <ToggleRow
        label={t('admin.settings.registration.totp')}
        description={
          <>
            {t('admin.settings.registration.totpHint')}
            {!form.totp_encryption_key_configured ? (
              <span className={s.warningText} style={{ display: 'block' }}>
                {t('admin.settings.registration.totpKeyNotConfigured')}
              </span>
            ) : null}
          </>
        }
        checked={form.totp_enabled}
        disabled={!form.totp_encryption_key_configured}
        onChange={(value) => updateForm({ totp_enabled: value })}
      />
      <ToggleRow
        data-testid="passkey-settings"
        label={t('admin.settings.security.passkey')}
        description={t('admin.settings.security.passkeyHint')}
        checked={form.passkey_enabled}
        disabled={!form.passkey_configured}
        switchTestId="passkey-toggle"
        onChange={(value) => updateForm({ passkey_enabled: value })}
      >
        <Notice tone={form.passkey_configured ? 'success' : 'warning'} data-testid="passkey-config-status">
          <p>{form.passkey_configured ? t('admin.settings.security.passkeyConfigured') : t('admin.settings.security.passkeyNotConfigured')}</p>
          <p>
            {t('admin.settings.security.passkeyRPID')}: {form.passkey_rp_id || t('admin.settings.security.passkeyValueNotConfigured')}
          </p>
          <p>
            {t('admin.settings.security.passkeyOrigins')}:{' '}
            {form.passkey_rp_origins.length > 0
              ? form.passkey_rp_origins.join(', ')
              : t('admin.settings.security.passkeyValueNotConfigured')}
          </p>
          {!form.passkey_configured ? <p>{t('admin.settings.security.passkeyDeploymentHint')}</p> : null}
        </Notice>
      </ToggleRow>
      {/* 敏感操作 step-up 2FA */}
      <ToggleRow
        label={t('admin.settings.security.stepUp')}
        description={t('admin.settings.security.stepUpHint')}
        checked={form.step_up_enabled}
        onChange={(value) => updateForm({ step_up_enabled: value })}
      />
      {/* 会话 IP/UA 绑定 */}
      <ToggleRow
        label={t('admin.settings.security.sessionBinding')}
        description={t('admin.settings.security.sessionBindingHint')}
        checked={form.session_binding_enabled}
        onChange={(value) => updateForm({ session_binding_enabled: value })}
      />
      {/* 审计日志保留天数 */}
      <div className={s.row}>
        <div className={s.rowHead}>
          <div className={s.rowText}>
            <label className={s.rowLabel} htmlFor="audit-log-retention-days">
              {t('admin.settings.security.auditRetention')}
            </label>
            <p className={s.rowDescription}>{t('admin.settings.security.auditRetentionHint')}</p>
          </div>
          <input
            id="audit-log-retention-days"
            type="number"
            min="0"
            className={cx(s.input, s.inputNarrow)}
            value={form.audit_log_retention_days}
            onChange={(e) => updateForm({ audit_log_retention_days: numberInputValue(e.target.value) as number })}
          />
        </div>
      </div>
    </SettingsRegion>
  )
}

function ApiKeyAclSection() {
  const { t } = useI18n()
  const { form, updateForm, ui, updateUi } = useSettings()
  const headers = form.forwarded_client_ip_headers

  function showError(result: ForwardedClientIpHeaderResult) {
    if (result === 'invalid') {
      useAppStore.getState().showError(t('admin.settings.apiKeyAcl.forwardedClientIpHeaderInvalid'))
    } else if (result === 'full') {
      useAppStore.getState().showError(t('admin.settings.apiKeyAcl.forwardedClientIpHeadersLimit', { max: maxForwardedClientIpHeaders }))
    }
  }
  function commitDraft() {
    const value = ui.forwardedClientIpHeaderDraft
    if (!value) return
    const { result, headers: next } = addForwardedClientIpHeader(headers, value)
    updateForm({ forwarded_client_ip_headers: next })
    showError(result)
    updateUi({ forwardedClientIpHeaderDraft: '' })
  }
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (separatorKeys.has(event.key)) {
      event.preventDefault()
      commitDraft()
      return
    }
    if (event.key === 'Backspace' && !ui.forwardedClientIpHeaderDraft && headers.length > 0) {
      updateForm({ forwarded_client_ip_headers: headers.slice(0, -1) })
    }
  }
  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData?.getData('text') || ''
    if (!text.trim()) return
    event.preventDefault()
    let error: ForwardedClientIpHeaderResult | undefined
    let next = headers
    for (const token of text.split(/[,，;\r\n]+/)) {
      if (!token.trim()) continue
      const added = addForwardedClientIpHeader(next, token)
      next = added.headers
      if (added.result === 'invalid' || added.result === 'full') error = added.result
    }
    updateForm({ forwarded_client_ip_headers: next })
    if (error) showError(error)
  }

  return (
    <SettingsRegion
      data-testid="api-key-acl-settings"
      title={t('admin.settings.apiKeyAcl.title')}
      description={t('admin.settings.apiKeyAcl.description')}
    >
      <ToggleRow
        label={t('admin.settings.apiKeyAcl.trustForwardedIp')}
        description={t('admin.settings.apiKeyAcl.trustForwardedIpHint')}
        checked={form.api_key_acl_trust_forwarded_ip}
        onChange={(value) => updateForm({ api_key_acl_trust_forwarded_ip: value })}
      >
        {form.api_key_acl_trust_forwarded_ip ? (
          <Field
            label={t('admin.settings.apiKeyAcl.forwardedClientIpHeaders')}
            htmlFor="forwarded-client-ip-headers"
            hint={t('admin.settings.apiKeyAcl.forwardedClientIpHeadersRiskHint')}
          >
            <p className={s.hint}>{t('admin.settings.apiKeyAcl.forwardedClientIpHeadersHint')}</p>
            <TagInput
              id="forwarded-client-ip-headers"
              tags={headers}
              draft={ui.forwardedClientIpHeaderDraft}
              onDraftChange={(value) => updateUi({ forwardedClientIpHeaderDraft: value })}
              onRemove={(header) => updateForm({ forwarded_client_ip_headers: headers.filter((item) => item !== header) })}
              onKeyDown={handleKeyDown}
              onBlur={commitDraft}
              onPaste={handlePaste}
              placeholder={t('admin.settings.apiKeyAcl.forwardedClientIpHeadersPlaceholder')}
              removeLabel={(header) => t('admin.settings.apiKeyAcl.removeForwardedClientIpHeader', { header })}
              inputTestId="forwarded-client-ip-headers-input"
              tagTestId="forwarded-client-ip-header-tag"
            />
          </Field>
        ) : null}
      </ToggleRow>
    </SettingsRegion>
  )
}

function PanelRateLimitSection() {
  const { t } = useI18n()
  const { form, patch, loading, saving, save } = useIndependentSettings<PanelRateLimitSettings>({
    defaults: { enabled: true, user_rpm: 240, heavy_rpm: 60, exempt_admin: true, public_ip_rpm: 300 },
    load: () => adminAPI.settings.getPanelRateLimitSettings(),
    save: (f) =>
      adminAPI.settings.updatePanelRateLimitSettings({
        enabled: f.enabled,
        user_rpm: f.user_rpm,
        heavy_rpm: f.heavy_rpm,
        exempt_admin: f.exempt_admin,
        public_ip_rpm: f.public_ip_rpm
      }),
    savedKey: 'admin.settings.panelRateLimit.saved',
    saveFailedKey: 'admin.settings.panelRateLimit.saveFailed'
  })
  const rpmField = (key: 'user_rpm' | 'heavy_rpm' | 'public_ip_rpm', label: string, testId?: string) => (
    <Field label={t(`admin.settings.panelRateLimit.${label}`)} hint={t(`admin.settings.panelRateLimit.${label}Hint`)}>
      <div className={s.inline}>
        <input
          type="number"
          min="0"
          max="100000"
          className={cx(s.input, s.inputNarrow)}
          value={form[key]}
          data-testid={testId}
          aria-label={t(`admin.settings.panelRateLimit.${label}`)}
          onChange={(e) => patch({ [key]: numberInputValue(e.target.value) as number })}
        />
        <span className={s.hint}>{t('admin.settings.panelRateLimit.perMinute')}</span>
      </div>
    </Field>
  )
  return (
    <IndependentSettingsRegion
      title={t('admin.settings.panelRateLimit.title')}
      description={t('admin.settings.panelRateLimit.description')}
      loading={loading}
      saving={saving}
      saveTestId="panel-rate-limit-save"
      onSave={() => void save()}
    >
      {/* 计数维度说明：按账号计数，反代部署无误伤 */}
      <Notice tone="info">
        <p className={s.inline}>
          <Info size={16} aria-hidden="true" />
          {t('admin.settings.panelRateLimit.proxySafeNote')}
        </p>
      </Notice>
      <ToggleRow
        label={t('admin.settings.panelRateLimit.enabled')}
        description={t('admin.settings.panelRateLimit.enabledHint')}
        checked={form.enabled}
        onChange={(enabled) => patch({ enabled })}
      >
        {form.enabled ? (
          <>
            <div className={s.grid3}>
              {rpmField('user_rpm', 'userRpm', 'panel-rate-limit-user-rpm')}
              {rpmField('heavy_rpm', 'heavyRpm')}
              {rpmField('public_ip_rpm', 'publicIpRpm')}
            </div>
            <ToggleRow
              label={t('admin.settings.panelRateLimit.exemptAdmin')}
              description={t('admin.settings.panelRateLimit.exemptAdminHint')}
              checked={form.exempt_admin}
              onChange={(exempt_admin) => patch({ exempt_admin })}
            />
          </>
        ) : null}
      </ToggleRow>
    </IndependentSettingsRegion>
  )
}

function CaptchaSection() {
  const { t } = useI18n()
  const { form, updateForm, ui, updateUi } = useSettings()
  const masterEnabled = form.turnstile_enabled || form.tencent_captcha_enabled || form.aliyun_captcha_enabled
  const provider = ui.captchaProvider
  // 天御中国站与国际站是两套独立账号体系，控制台与文档入口不通用，
  // 按当前选择的站点给出对应链接，避免管理员在错误的控制台里找不到 CaptchaAppId。
  const tencentLinks =
    form.tencent_captcha_region === 'intl'
      ? {
          console: 'https://console.tencentcloud.com/captcha/graphical',
          cloudKeys: 'https://console.tencentcloud.com/cam/capi',
          webDocs: 'https://www.tencentcloud.com/document/product/1159/49680'
        }
      : {
          console: 'https://console.cloud.tencent.com/captcha',
          cloudKeys: 'https://console.cloud.tencent.com/cam/capi',
          webDocs: 'https://cloud.tencent.com/document/product/1110/36841'
        }

  function selectProvider(next: CaptchaProviderSelection) {
    updateUi({ captchaProvider: next })
    updateForm(captchaPatch(next))
  }
  const choice = (active: boolean, onClick: () => void, label: string, testId?: string) => (
    <button type="button" className={s.choice} aria-pressed={active} data-testid={testId} onClick={onClick}>
      {label}
    </button>
  )
  const secretInput = (key: 'tencent_captcha_app_secret_key' | 'tencent_captcha_cloud_secret_id' | 'tencent_captcha_cloud_secret_key', label: string, configured: boolean) => (
    <Field
      label={t(`admin.settings.tencentCaptcha.${label}`)}
      hint={configured ? t('admin.settings.tencentCaptcha.configured') : t('admin.settings.tencentCaptcha.required')}
    >
      <input
        type="password"
        autoComplete="new-password"
        className={s.input}
        value={form[key]}
        placeholder={t('admin.settings.tencentCaptcha.keepExisting')}
        onChange={(e) => updateForm({ [key]: e.target.value })}
      />
    </Field>
  )

  return (
    <SettingsRegion data-testid="captcha-settings" title={t('admin.settings.captcha.title')} description={t('admin.settings.captcha.description')}>
      <ToggleRow
        label={t('admin.settings.captcha.enable')}
        description={t('admin.settings.captcha.enableHint')}
        checked={masterEnabled}
        switchTestId="captcha-enabled-toggle"
        onChange={(enabled) => updateForm(captchaPatch(enabled ? provider : null))}
      />
      {masterEnabled ? (
        <div className={s.column}>
          <Field label={t('admin.settings.captcha.provider')}>
            <div className={s.choiceGroup}>
              {choice(provider === 'turnstile', () => selectProvider('turnstile'), t('admin.settings.captcha.providerTurnstile'), 'captcha-provider-turnstile')}
              {choice(provider === 'tencent', () => selectProvider('tencent'), t('admin.settings.captcha.providerTencent'), 'captcha-provider-tencent')}
              {choice(provider === 'aliyun', () => selectProvider('aliyun'), t('admin.settings.captcha.providerAliyun'), 'captcha-provider-aliyun')}
            </div>
          </Field>
          {provider === 'turnstile' ? (
            <div className={s.grid2}>
              <Field
                label={t('admin.settings.turnstile.siteKey')}
                hint={
                  <>
                    {t('admin.settings.turnstile.siteKeyHint')}{' '}
                    <a href="https://dash.cloudflare.com/" target="_blank" rel="noreferrer" className={s.link}>
                      {t('admin.settings.turnstile.cloudflareDashboard')}
                    </a>
                  </>
                }
              >
                <input
                  type="text"
                  className={cx(s.input, s.mono)}
                  placeholder="0x4AAAAAAA..."
                  value={form.turnstile_site_key}
                  onChange={(e) => updateForm({ turnstile_site_key: e.target.value })}
                />
              </Field>
              <Field
                label={t('admin.settings.turnstile.secretKey')}
                hint={
                  form.turnstile_secret_key_configured
                    ? t('admin.settings.turnstile.secretKeyConfiguredHint')
                    : t('admin.settings.turnstile.secretKeyHint')
                }
              >
                <input
                  type="password"
                  className={cx(s.input, s.mono)}
                  placeholder="0x4AAAAAAA..."
                  value={form.turnstile_secret_key}
                  onChange={(e) => updateForm({ turnstile_secret_key: e.target.value })}
                />
              </Field>
            </div>
          ) : provider === 'tencent' ? (
            <div className={s.column}>
              <Field label={t('admin.settings.tencentCaptcha.region')} hint={t('admin.settings.tencentCaptcha.regionHint')}>
                <div className={s.choiceGroup}>
                  {choice(
                    form.tencent_captcha_region !== 'intl',
                    () => updateForm({ tencent_captcha_region: 'cn' }),
                    t('admin.settings.tencentCaptcha.regionCn'),
                    'tencent-captcha-region-cn'
                  )}
                  {choice(
                    form.tencent_captcha_region === 'intl',
                    () => updateForm({ tencent_captcha_region: 'intl' }),
                    t('admin.settings.tencentCaptcha.regionIntl'),
                    'tencent-captcha-region-intl'
                  )}
                </div>
              </Field>
              <div className={s.columnTight}>
                <h3 className={s.itemTitle}>{t('admin.settings.tencentCaptcha.appCredentialsTitle')}</h3>
                <p className={s.hint}>{t('admin.settings.tencentCaptcha.appCredentialsHint')}</p>
              </div>
              <div className={s.grid2}>
                <Field label={t('admin.settings.tencentCaptcha.appId')}>
                  <input
                    type="text"
                    inputMode="numeric"
                    className={s.input}
                    placeholder="123456789"
                    value={form.tencent_captcha_app_id}
                    onChange={(e) => updateForm({ tencent_captcha_app_id: e.target.value })}
                  />
                </Field>
                {secretInput('tencent_captcha_app_secret_key', 'appSecretKey', form.tencent_captcha_app_secret_key_configured)}
              </div>
              <div className={s.columnTight}>
                <h3 className={s.itemTitle}>{t('admin.settings.tencentCaptcha.cloudCredentialsTitle')}</h3>
                <p className={s.hint}>{t('admin.settings.tencentCaptcha.cloudCredentialsHint')}</p>
              </div>
              <div className={s.grid2}>
                {secretInput('tencent_captcha_cloud_secret_id', 'cloudSecretId', form.tencent_captcha_cloud_secret_id_configured)}
                {secretInput('tencent_captcha_cloud_secret_key', 'cloudSecretKey', form.tencent_captcha_cloud_secret_key_configured)}
              </div>
              <p className={s.hint}>{t('admin.settings.tencentCaptcha.camPermissionHint')}</p>
              <p className={s.hint}>{t('admin.settings.tencentCaptcha.aidEncryptedHint')}</p>
              <div className={s.inline}>
                <a href={tencentLinks.console} target="_blank" rel="noopener noreferrer" className={s.link}>
                  {t('admin.settings.tencentCaptcha.openCaptchaConsole')}
                </a>
                <a href={tencentLinks.cloudKeys} target="_blank" rel="noopener noreferrer" className={s.link}>
                  {t('admin.settings.tencentCaptcha.createCloudKeys')}
                </a>
                <a href={tencentLinks.webDocs} target="_blank" rel="noopener noreferrer" className={s.link}>
                  {t('admin.settings.tencentCaptcha.openWebDocs')}
                </a>
              </div>
            </div>
          ) : (
            <div className={s.column}>
              <Field label={t('admin.settings.aliyunCaptcha.region')} hint={t('admin.settings.aliyunCaptcha.regionHint')}>
                <div className={s.choiceGroup}>
                  {choice(form.aliyun_captcha_region !== 'sgp', () => updateForm({ aliyun_captcha_region: 'cn' }), t('admin.settings.aliyunCaptcha.regionCn'))}
                  {choice(form.aliyun_captcha_region === 'sgp', () => updateForm({ aliyun_captcha_region: 'sgp' }), t('admin.settings.aliyunCaptcha.regionSgp'))}
                </div>
              </Field>
              <div className={s.grid2}>
                <Field label={t('admin.settings.aliyunCaptcha.prefix')} hint={t('admin.settings.aliyunCaptcha.prefixHint')}>
                  <input
                    type="text"
                    className={s.input}
                    placeholder="14xxxxx"
                    value={form.aliyun_captcha_prefix}
                    onChange={(e) => updateForm({ aliyun_captcha_prefix: e.target.value })}
                  />
                </Field>
                <Field label={t('admin.settings.aliyunCaptcha.sceneId')} hint={t('admin.settings.aliyunCaptcha.sceneIdHint')}>
                  <input
                    type="text"
                    className={s.input}
                    placeholder="1cxxxxxx"
                    value={form.aliyun_captcha_scene_id}
                    onChange={(e) => updateForm({ aliyun_captcha_scene_id: e.target.value })}
                  />
                </Field>
                <Field label={t('admin.settings.aliyunCaptcha.accessKeyId')} hint={t('admin.settings.aliyunCaptcha.accessKeyIdHint')}>
                  <input
                    type="text"
                    className={s.input}
                    placeholder="LTAI..."
                    value={form.aliyun_captcha_access_key_id}
                    onChange={(e) => updateForm({ aliyun_captcha_access_key_id: e.target.value })}
                  />
                </Field>
                <Field
                  label={t('admin.settings.aliyunCaptcha.accessKeySecret')}
                  hint={
                    form.aliyun_captcha_access_key_secret_configured
                      ? t('admin.settings.aliyunCaptcha.accessKeySecretConfiguredHint')
                      : t('admin.settings.aliyunCaptcha.accessKeySecretHint')
                  }
                >
                  <input
                    type="password"
                    autoComplete="new-password"
                    className={s.input}
                    placeholder="••••••••"
                    value={form.aliyun_captcha_access_key_secret}
                    onChange={(e) => updateForm({ aliyun_captcha_access_key_secret: e.target.value })}
                  />
                </Field>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </SettingsRegion>
  )
}

export default function SecurityTab() {
  return (
    <>
      <AdminAccessKeysSettings />
      {/* 已有全权密钥只提供轮换和删除入口。 */}
      <LegacyAdminApiKeySection />
      <RegistrationSection />
      <ApiKeyAclSection />
      <PanelRateLimitSection />
      <CaptchaSection />
      <SecurityOAuthSections />
    </>
  )
}
