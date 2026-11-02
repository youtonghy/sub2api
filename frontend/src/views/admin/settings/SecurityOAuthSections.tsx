/** 安全 Tab 的第三方登录：LinuxDo、GitHub/Google 邮箱登录、微信、钉钉、通用 OIDC（随整表保存） */
import type { ReactNode } from 'react'

import { Button } from '@/components/arc/button/button'
import { Field, Notice, SettingsRegion, ToggleRow } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { cx, numberInputValue } from '@/components/admin/settings/settingsUtils'
import { useClipboard } from '@/composables/useClipboard'
import { useI18n } from '@/i18n/useI18n'
import { useSettings } from './settingsContext'
import type { SettingsForm } from './settingsForm'
import { dingtalkPolicyPatch, syncWeChatConnectMode } from './settingsPersistence'

type StringKey = Exclude<
  {
    [K in keyof SettingsForm]-?: SettingsForm[K] extends string | undefined ? K : never
  }[keyof SettingsForm],
  undefined
>

const currentOrigin = typeof window !== 'undefined' ? window.location.origin : ''

function useCallbackUrl() {
  const { form } = useSettings()
  return (path: string) => {
    const base = (form.api_base_url || currentOrigin).replace(/\/+$/, '')
    const apiRoot = base.endsWith('/api/v1') ? base : `${base}/api/v1`
    return `${apiRoot}${path.startsWith('/') ? path : `/${path}`}`
  }
}

function TextInput({
  field,
  type = 'text',
  placeholder,
  testId,
  mono,
  autoComplete
}: {
  field: StringKey
  type?: string
  placeholder?: string
  testId?: string
  mono?: boolean
  autoComplete?: string
}) {
  const { form, updateForm } = useSettings()
  return (
    <input
      type={type}
      className={cx(s.input, mono && s.mono)}
      value={form[field] ?? ''}
      placeholder={placeholder}
      data-testid={testId}
      autoComplete={autoComplete}
      onChange={(e) => updateForm({ [field]: e.target.value } as Partial<SettingsForm>)}
    />
  )
}

function SuggestedUrl({ onSet, label, suggestion }: { onSet: () => void; label: string; suggestion: string }) {
  return (
    <div className={s.inline}>
      <Button type="button" variant="secondary" size="sm" onClick={onSet}>
        {label}
      </Button>
      {suggestion ? <code className={s.code}>{suggestion}</code> : null}
    </div>
  )
}

function LinuxDoSection() {
  const { t } = useI18n()
  const { form, updateForm } = useSettings()
  const { copyToClipboard } = useClipboard()
  const suggestion = useCallbackUrl()('/auth/oauth/linuxdo/callback')
  return (
    <SettingsRegion title={t('admin.settings.linuxdo.title')} description={t('admin.settings.linuxdo.description')}>
      <ToggleRow
        label={t('admin.settings.linuxdo.enable')}
        description={t('admin.settings.linuxdo.enableHint')}
        checked={form.linuxdo_connect_enabled}
        onChange={(value) => updateForm({ linuxdo_connect_enabled: value })}
      >
        {form.linuxdo_connect_enabled ? (
          <>
            <div className={s.grid2}>
              <Field label={t('admin.settings.linuxdo.clientId')} hint={t('admin.settings.linuxdo.clientIdHint')}>
                <TextInput field="linuxdo_connect_client_id" placeholder={t('admin.settings.linuxdo.clientIdPlaceholder')} />
              </Field>
              <Field
                label={t('admin.settings.linuxdo.clientSecret')}
                hint={
                  form.linuxdo_connect_client_secret_configured
                    ? t('admin.settings.linuxdo.clientSecretConfiguredHint')
                    : t('admin.settings.linuxdo.clientSecretHint')
                }
              >
                <TextInput
                  field="linuxdo_connect_client_secret"
                  type="password"
                  placeholder={
                    form.linuxdo_connect_client_secret_configured
                      ? t('admin.settings.linuxdo.clientSecretConfiguredPlaceholder')
                      : t('admin.settings.linuxdo.clientSecretPlaceholder')
                  }
                />
              </Field>
            </div>
            <Field label={t('admin.settings.linuxdo.redirectUrl')} hint={t('admin.settings.linuxdo.redirectUrlHint')}>
              <TextInput field="linuxdo_connect_redirect_url" type="url" placeholder={t('admin.settings.linuxdo.redirectUrlPlaceholder')} />
              <SuggestedUrl
                label={t('admin.settings.linuxdo.quickSetCopy')}
                suggestion={suggestion}
                onSet={() => {
                  if (!suggestion) return
                  updateForm({ linuxdo_connect_redirect_url: suggestion })
                  void copyToClipboard(suggestion, t('admin.settings.linuxdo.redirectUrlSetAndCopied'))
                }}
              />
            </Field>
          </>
        ) : null}
      </ToggleRow>
    </SettingsRegion>
  )
}

function EmailOAuthSection() {
  const { form, updateForm, localText } = useSettings()
  const { copyToClipboard } = useClipboard()
  const callbackUrl = useCallbackUrl()
  const secretConfiguredPlaceholder = localText('密钥已配置，留空以保留当前值。', 'Secret configured. Leave empty to keep the current value.')

  function provider(name: 'github' | 'google', title: string, hint: string, guide: ReactNode) {
    const enabled = form[`${name}_oauth_enabled`]
    const suggestion = callbackUrl(`/auth/oauth/${name}/callback`)
    return (
      <ToggleRow label={title} description={hint} checked={enabled} onChange={(value) => updateForm({ [`${name}_oauth_enabled`]: value })}>
        {enabled ? (
          <>
            <Notice tone="info">
              <p>{guide}</p>
            </Notice>
            <div className={s.grid2}>
              <Field label="Client ID">
                <TextInput field={`${name}_oauth_client_id`} placeholder={`${title} OAuth Client ID`} />
              </Field>
              <Field label="Client Secret">
                <TextInput
                  field={`${name}_oauth_client_secret`}
                  type="password"
                  placeholder={form[`${name}_oauth_client_secret_configured`] ? secretConfiguredPlaceholder : `${title} OAuth Client Secret`}
                />
              </Field>
            </div>
            <Field label={localText('后端回调地址', 'Backend Callback URL')}>
              <TextInput
                field={`${name}_oauth_redirect_url`}
                type="url"
                placeholder={`https://your-domain.com/api/v1/auth/oauth/${name}/callback`}
              />
              <SuggestedUrl
                label={localText('生成并复制', 'Generate and copy')}
                suggestion={suggestion}
                onSet={() => {
                  if (!suggestion) return
                  updateForm({ [`${name}_oauth_redirect_url`]: suggestion })
                  void copyToClipboard(suggestion, localText('回调地址已写入并复制。', 'Callback URL set and copied.'))
                }}
              />
            </Field>
            <Field label={localText('前端回跳地址', 'Frontend Callback URL')}>
              <TextInput field={`${name}_oauth_frontend_redirect_url`} placeholder="/auth/oauth/callback" />
            </Field>
          </>
        ) : null}
      </ToggleRow>
    )
  }

  const githubLink = (
    <a
      data-testid="github-oauth-apps-guide-link"
      href="https://github.com/settings/developers"
      target="_blank"
      rel="noopener noreferrer"
      className={s.link}
    >
      OAuth Apps
    </a>
  )

  return (
    <SettingsRegion
      title={localText('邮箱快捷登录', 'Email OAuth Sign-in')}
      description={localText(
        '开启 GitHub 或 Google 邮箱授权登录后，系统会读取已验证邮箱，存在则直接登录，不存在则自动注册。',
        'After GitHub or Google email OAuth is enabled, the system reads a verified email, signs in matching users, and auto-registers missing users.'
      )}
    >
      {provider(
        'github',
        'GitHub',
        localText(
          'GitHub OAuth App 需要 read:user user:email 权限，回调地址填写下方后端地址。',
          'GitHub OAuth App needs read:user user:email scopes. Use the backend callback URL below.'
        ),
        localText('zh', 'en') === 'zh' ? (
          <>
            开通引导：GitHub Settings → Developer settings → {githubLink} → New OAuth App；Homepage URL 填站点域名，Authorization callback
            URL 填下面的后端回调地址。
          </>
        ) : (
          <>
            Setup guide: GitHub Settings → Developer settings → {githubLink} → New OAuth App. Use your site origin as Homepage URL and the
            backend callback URL below as Authorization callback URL.
          </>
        )
      )}
      {provider(
        'google',
        'Google',
        localText(
          'Google OAuth 客户端需要 openid email profile 范围，并在凭据里登记后端回调地址。',
          'Google OAuth client needs openid email profile scopes and the backend callback URL registered in credentials.'
        ),
        localText(
          '开通引导：Google Cloud Console → APIs & Services → OAuth consent screen 完成同意屏幕；Credentials → Create Credentials → OAuth client ID，类型选择 Web application，并把下面地址加入 Authorized redirect URIs。',
          'Setup guide: Google Cloud Console → APIs & Services → OAuth consent screen, then Credentials → Create Credentials → OAuth client ID, choose Web application, and add the URL below to Authorized redirect URIs.'
        )
      )}
    </SettingsRegion>
  )
}

function WeChatSection() {
  const { t } = useI18n()
  const { form, updateForm, localText } = useSettings()
  const { copyToClipboard } = useClipboard()
  const suggestion = useCallbackUrl()('/auth/oauth/wechat/callback')
  const configured = localText('密钥已配置，留空以保留当前值。', 'Secret configured. Leave empty to keep the current value.')

  function setOpen(value: boolean) {
    updateForm((f) => {
      const next = { ...f, wechat_connect_open_enabled: value }
      return { wechat_connect_open_enabled: value, ...syncWeChatConnectMode(next, value ? 'open' : undefined) }
    })
  }
  function setMp(value: boolean) {
    updateForm((f) => {
      const next = { ...f, wechat_connect_mp_enabled: value, ...(value ? { wechat_connect_mobile_enabled: false } : {}) }
      return { ...next, ...syncWeChatConnectMode(next, value ? 'mp' : undefined) }
    })
  }
  function setMobile(value: boolean) {
    updateForm((f) => {
      const next = { ...f, wechat_connect_mobile_enabled: value, ...(value ? { wechat_connect_mp_enabled: false } : {}) }
      return { ...next, ...syncWeChatConnectMode(next, value ? 'mobile' : undefined) }
    })
  }

  const app = (
    key: 'open' | 'mp' | 'mobile',
    title: string,
    hint: string,
    onChange: (value: boolean) => void,
    idLabel: string,
    idPlaceholder: string,
    secretLabel: string,
    secretPlaceholder: string
  ) => {
    const enabled = form[`wechat_connect_${key}_enabled`]
    return (
      <ToggleRow label={title} description={hint} checked={enabled} onChange={onChange} switchTestId={`wechat-connect-${key}-enabled`}>
        {enabled ? (
          <div className={s.grid2}>
            <Field label={idLabel}>
              <TextInput field={`wechat_connect_${key}_app_id`} placeholder={idPlaceholder} testId={`wechat-connect-${key}-app-id`} />
            </Field>
            <Field label={secretLabel}>
              <TextInput
                field={`wechat_connect_${key}_app_secret`}
                type="password"
                placeholder={form[`wechat_connect_${key}_app_secret_configured`] ? configured : secretPlaceholder}
                testId={`wechat-connect-${key}-app-secret`}
              />
            </Field>
          </div>
        ) : null}
      </ToggleRow>
    )
  }

  return (
    <SettingsRegion title={t('admin.settings.wechatConnect.title')} description={t('admin.settings.wechatConnect.description')}>
      <ToggleRow
        label={t('admin.settings.wechatConnect.enabledLabel')}
        description={t('admin.settings.wechatConnect.enabledHint')}
        checked={form.wechat_connect_enabled}
        onChange={(value) => updateForm({ wechat_connect_enabled: value })}
        switchTestId="wechat-connect-enabled"
      />
      {form.wechat_connect_enabled ? (
        <div className={s.column}>
          {app(
            'open',
            localText('PC 应用', 'PC App'),
            localText(
              '桌面浏览器通过微信开放平台扫码登录。可与公众号或移动应用同时存在。',
              'Desktop browsers sign in through WeChat Open Platform QR login. This can coexist with Official Account or Mobile App.'
            ),
            setOpen,
            localText('PC AppID', 'PC App ID'),
            localText('微信开放平台 PC 应用 AppID', 'WeChat Open Platform PC App ID'),
            localText('PC AppSecret', 'PC App Secret'),
            localText('微信开放平台 PC 应用 AppSecret', 'WeChat Open Platform PC App Secret')
          )}
          {app(
            'mp',
            localText('公众号', 'Official Account'),
            localText(
              '仅在微信内浏览器可用；非微信环境下会显示不可用。',
              'Only available inside the WeChat browser. It is shown as unavailable outside WeChat.'
            ),
            setMp,
            localText('公众号 AppID', 'Official Account App ID'),
            localText('公众号 AppID', 'Official Account App ID'),
            localText('公众号 AppSecret', 'Official Account App Secret'),
            localText('公众号 AppSecret', 'Official Account App Secret')
          )}
          {app(
            'mobile',
            localText('移动应用', 'Mobile App'),
            localText(
              '原生移动端通过微信 SDK 唤起授权，网页端不会直接发起该流程。',
              'Native mobile clients start authorization through the WeChat SDK. The web UI does not launch this flow directly.'
            ),
            setMobile,
            localText('移动应用 AppID', 'Mobile App ID'),
            localText('移动应用 AppID', 'Mobile App ID'),
            localText('移动应用 AppSecret', 'Mobile App Secret'),
            localText('移动应用 AppSecret', 'Mobile App Secret')
          )}
          {form.wechat_connect_open_enabled && (form.wechat_connect_mp_enabled || form.wechat_connect_mobile_enabled) ? (
            <Notice tone="warning">
              <p>
                {localText(
                  '如果同时启用 PC 应用和公众号/移动应用，这些应用需要挂在同一个微信开放平台主体下，否则 UnionID 无法稳定归并账号。',
                  'When PC App is enabled together with Official Account or Mobile App, they should belong to the same WeChat Open Platform account so UnionID can merge identities reliably.'
                )}
              </p>
            </Notice>
          ) : null}
          <Field
            label={localText('浏览器回调地址', 'Browser Redirect URL')}
            hint={localText(
              '用于 PC 应用和公众号的网页回调。移动应用走原生 SDK 时不直接使用这个浏览器回调。',
              'Used by PC App and Official Account browser callbacks. Native mobile SDK flows do not start from this browser callback directly.'
            )}
          >
            <TextInput
              field="wechat_connect_redirect_url"
              type="url"
              testId="wechat-connect-redirect-url"
              placeholder={t('admin.settings.wechatConnect.redirectUrlPlaceholder')}
            />
            <SuggestedUrl
              label={t('admin.settings.wechatConnect.generateAndCopy')}
              suggestion={suggestion}
              onSet={() => {
                if (!suggestion) return
                updateForm({ wechat_connect_redirect_url: suggestion })
                void copyToClipboard(suggestion, t('admin.settings.wechatConnect.redirectUrlSetAndCopied'))
              }}
            />
          </Field>
          <Field
            label={t('admin.settings.wechatConnect.frontendRedirectUrlLabel')}
            hint={t('admin.settings.wechatConnect.frontendRedirectUrlHint')}
          >
            <TextInput
              field="wechat_connect_frontend_redirect_url"
              testId="wechat-connect-frontend-redirect-url"
              placeholder={t('admin.settings.wechatConnect.frontendRedirectUrlPlaceholder')}
            />
          </Field>
        </div>
      ) : null}
    </SettingsRegion>
  )
}

function DingTalkSection() {
  const { t } = useI18n()
  const { form, updateForm, localText } = useSettings()
  const internal = form.dingtalk_connect_corp_restriction_policy === 'internal_only'

  const syncToggle = (
    key: 'dingtalk_connect_sync_display_name' | 'dingtalk_connect_sync_corp_email' | 'dingtalk_connect_sync_dept',
    label: string,
    extraHint: string | null,
    keyField: StringKey,
    keyPlaceholder: string,
    nameField: StringKey,
    namePlaceholder: string
  ) => (
    <ToggleRow
      label={t(`admin.settings.dingtalk.${label}`)}
      description={
        <>
          {t(`admin.settings.dingtalk.${label}Hint`)}
          {extraHint ? (
            <span className={s.warningText} style={{ display: 'block' }}>
              {t(`admin.settings.dingtalk.${extraHint}`)}
            </span>
          ) : null}
        </>
      }
      checked={form[key]}
      onChange={(value) => updateForm({ [key]: value })}
    >
      {form[key] ? (
        <>
          <div className={s.grid2}>
            <Field label={t(`admin.settings.dingtalk.${label}Target`)}>
              <TextInput field={keyField} placeholder={keyPlaceholder} mono />
            </Field>
            <Field label={t('admin.settings.dingtalk.syncAttrDisplayName')}>
              <TextInput field={nameField} placeholder={namePlaceholder} />
            </Field>
          </div>
          <p className={s.hint}>{t(`admin.settings.dingtalk.${label}TargetHint`)}</p>
        </>
      ) : null}
    </ToggleRow>
  )

  return (
    <SettingsRegion title={t('admin.settings.dingtalk.title')} description={t('admin.settings.dingtalk.description')}>
      <ToggleRow
        label={t('admin.settings.dingtalk.enable')}
        description={t('admin.settings.dingtalk.enableHint')}
        checked={form.dingtalk_connect_enabled}
        onChange={(value) => updateForm({ dingtalk_connect_enabled: value })}
      >
        {form.dingtalk_connect_enabled ? (
          <>
            <div className={s.grid2}>
              <Field label={t('admin.settings.dingtalk.clientId')} hint={t('admin.settings.dingtalk.clientIdHint')}>
                <TextInput field="dingtalk_connect_client_id" placeholder={t('admin.settings.dingtalk.clientIdPlaceholder')} />
              </Field>
              <Field
                label={t('admin.settings.dingtalk.clientSecret')}
                hint={
                  form.dingtalk_connect_client_secret_configured
                    ? t('admin.settings.dingtalk.clientSecretConfiguredHint')
                    : t('admin.settings.dingtalk.clientSecretHint')
                }
              >
                <TextInput
                  field="dingtalk_connect_client_secret"
                  type="password"
                  placeholder={
                    form.dingtalk_connect_client_secret_configured
                      ? t('admin.settings.dingtalk.clientSecretConfiguredPlaceholder')
                      : t('admin.settings.dingtalk.clientSecretPlaceholder')
                  }
                />
              </Field>
            </div>
            <Field label={t('admin.settings.dingtalk.redirectUrl')} hint={t('admin.settings.dingtalk.redirectUrlHint')}>
              <TextInput field="dingtalk_connect_redirect_url" type="url" placeholder={t('admin.settings.dingtalk.redirectUrlPlaceholder')} />
            </Field>
            {/* Corp Restriction Policy */}
            <Field label={t('admin.settings.dingtalk.corpPolicy.label')} hint={t('admin.settings.dingtalk.corpPolicy.hint')}>
              <div className={s.choiceGroup} role="radiogroup" aria-label={t('admin.settings.dingtalk.corpPolicy.label')}>
                {(['none', 'internal_only'] as const).map((policy) => (
                  <label key={policy} className={s.checkboxLabel}>
                    <input
                      type="radio"
                      name="dingtalk-corp-policy"
                      value={policy}
                      checked={form.dingtalk_connect_corp_restriction_policy === policy}
                      onChange={() =>
                        updateForm({ dingtalk_connect_corp_restriction_policy: policy, ...dingtalkPolicyPatch(policy) })
                      }
                    />
                    {t(`admin.settings.dingtalk.corpPolicy.${policy === 'none' ? 'none' : 'internalOnly'}`)}
                  </label>
                ))}
              </div>
            </Field>
            {/* bypass_registration 与身份同步开关（仅 internal_only 模式下可见可用） */}
            {internal ? (
              <>
                <ToggleRow
                  label={t('admin.settings.dingtalk.bypassRegistration')}
                  description={t('admin.settings.dingtalk.bypassRegistrationHint')}
                  checked={form.dingtalk_connect_bypass_registration}
                  onChange={(value) => updateForm({ dingtalk_connect_bypass_registration: value })}
                />
                {syncToggle(
                  'dingtalk_connect_sync_display_name',
                  'syncDisplayName',
                  null,
                  'dingtalk_connect_sync_display_name_attr_key',
                  'dingtalk_name',
                  'dingtalk_connect_sync_display_name_attr_name',
                  localText('钉钉姓名', 'DingTalk Name')
                )}
                {syncToggle(
                  'dingtalk_connect_sync_corp_email',
                  'syncCorpEmail',
                  'syncCorpEmailPermissionHint',
                  'dingtalk_connect_sync_corp_email_attr_key',
                  'dingtalk_email',
                  'dingtalk_connect_sync_corp_email_attr_name',
                  localText('钉钉企业邮箱', 'DingTalk Corporate Email')
                )}
                {syncToggle(
                  'dingtalk_connect_sync_dept',
                  'syncDept',
                  'syncDeptPermissionHint',
                  'dingtalk_connect_sync_dept_attr_key',
                  'dingtalk_department',
                  'dingtalk_connect_sync_dept_attr_name',
                  localText('钉钉部门', 'DingTalk Department')
                )}
              </>
            ) : null}
          </>
        ) : null}
      </ToggleRow>
    </SettingsRegion>
  )
}

function OidcSection() {
  const { t } = useI18n()
  const { form, updateForm } = useSettings()
  const { copyToClipboard } = useClipboard()
  const suggestion = useCallbackUrl()('/auth/oauth/oidc/callback')
  const urlField = (field: StringKey, label: string) => (
    <Field label={t(`admin.settings.oidc.${label}`)}>
      <TextInput field={field} type="url" placeholder={t(`admin.settings.oidc.${label}Placeholder`)} />
    </Field>
  )
  const textField = (field: StringKey, label: string, hint?: boolean) => (
    <Field label={t(`admin.settings.oidc.${label}`)} hint={hint ? t(`admin.settings.oidc.${label}Hint`) : undefined}>
      <TextInput field={field} placeholder={t(`admin.settings.oidc.${label}Placeholder`)} />
    </Field>
  )
  return (
    <SettingsRegion title={t('admin.settings.oidc.title')} description={t('admin.settings.oidc.description')}>
      <ToggleRow
        label={t('admin.settings.oidc.enable')}
        description={t('admin.settings.oidc.enableHint')}
        checked={form.oidc_connect_enabled}
        onChange={(value) => updateForm({ oidc_connect_enabled: value })}
      >
        {form.oidc_connect_enabled ? (
          <>
            <div className={s.grid2}>
              {textField('oidc_connect_provider_name', 'providerName')}
              {textField('oidc_connect_client_id', 'clientId')}
              <Field
                label={t('admin.settings.oidc.clientSecret')}
                hint={
                  form.oidc_connect_client_secret_configured
                    ? t('admin.settings.oidc.clientSecretConfiguredHint')
                    : t('admin.settings.oidc.clientSecretHint')
                }
              >
                <TextInput
                  field="oidc_connect_client_secret"
                  type="password"
                  placeholder={
                    form.oidc_connect_client_secret_configured
                      ? t('admin.settings.oidc.clientSecretConfiguredPlaceholder')
                      : t('admin.settings.oidc.clientSecretPlaceholder')
                  }
                />
              </Field>
              {urlField('oidc_connect_issuer_url', 'issuerUrl')}
              {urlField('oidc_connect_discovery_url', 'discoveryUrl')}
              {urlField('oidc_connect_authorize_url', 'authorizeUrl')}
              {urlField('oidc_connect_token_url', 'tokenUrl')}
              {urlField('oidc_connect_userinfo_url', 'userinfoUrl')}
              {urlField('oidc_connect_jwks_url', 'jwksUrl')}
              {textField('oidc_connect_scopes', 'scopes', true)}
            </div>
            <Field label={t('admin.settings.oidc.redirectUrl')} hint={t('admin.settings.oidc.redirectUrlHint')}>
              <TextInput field="oidc_connect_redirect_url" type="url" placeholder={t('admin.settings.oidc.redirectUrlPlaceholder')} />
              <SuggestedUrl
                label={t('admin.settings.oidc.quickSetCopy')}
                suggestion={suggestion}
                onSet={() => {
                  if (!suggestion) return
                  updateForm({ oidc_connect_redirect_url: suggestion })
                  void copyToClipboard(suggestion, t('admin.settings.oidc.redirectUrlSetAndCopied'))
                }}
              />
            </Field>
            <div className={s.grid2}>
              {textField('oidc_connect_frontend_redirect_url', 'frontendRedirectUrl', true)}
              <Field label={t('admin.settings.oidc.tokenAuthMethod')}>
                <select
                  className={s.select}
                  value={form.oidc_connect_token_auth_method}
                  onChange={(e) => updateForm({ oidc_connect_token_auth_method: e.target.value })}
                >
                  <option value="client_secret_post">client_secret_post</option>
                  <option value="client_secret_basic">client_secret_basic</option>
                  <option value="none">none</option>
                </select>
              </Field>
              <Field label={t('admin.settings.oidc.clockSkewSeconds')}>
                <input
                  type="number"
                  min="0"
                  max="600"
                  className={s.input}
                  value={form.oidc_connect_clock_skew_seconds}
                  onChange={(e) => updateForm({ oidc_connect_clock_skew_seconds: numberInputValue(e.target.value) as number })}
                />
              </Field>
              {textField('oidc_connect_allowed_signing_algs', 'allowedSigningAlgs')}
            </div>
            <ToggleRow
              label={t('admin.settings.oidc.usePkce')}
              checked={form.oidc_connect_use_pkce}
              onChange={(value) => updateForm({ oidc_connect_use_pkce: value })}
              switchTestId="oidc-connect-use-pkce"
            />
            <ToggleRow
              label={t('admin.settings.oidc.validateIdToken')}
              checked={form.oidc_connect_validate_id_token}
              onChange={(value) => updateForm({ oidc_connect_validate_id_token: value })}
              switchTestId="oidc-connect-validate-id-token"
            />
            <ToggleRow
              label={t('admin.settings.oidc.requireEmailVerified')}
              checked={form.oidc_connect_require_email_verified}
              onChange={(value) => updateForm({ oidc_connect_require_email_verified: value })}
            />
            <div className={s.grid3}>
              {textField('oidc_connect_userinfo_email_path', 'userinfoEmailPath')}
              {textField('oidc_connect_userinfo_id_path', 'userinfoIdPath')}
              {textField('oidc_connect_userinfo_username_path', 'userinfoUsernamePath')}
            </div>
          </>
        ) : null}
      </ToggleRow>
    </SettingsRegion>
  )
}

export default function SecurityOAuthSections() {
  return (
    <>
      <LinuxDoSection />
      <EmailOAuthSection />
      <WeChatSection />
      <DingTalkSection />
      <OidcSection />
    </>
  )
}
