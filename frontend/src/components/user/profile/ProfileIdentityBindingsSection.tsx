import { Mail } from 'lucide-react'
import { useState } from 'react'
import { useLocation } from 'react-router'

import {
  hasExplicitWeChatOAuthCapabilities,
  resolveWeChatOAuthStartStrict,
  type WeChatOAuthPublicSettings
} from '@/api/auth'
import { bindEmailIdentity, sendEmailBindingCode, startOAuthBinding, unbindAuthIdentity } from '@/api/user'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { User, UserAuthBindingStatus, UserAuthProvider } from '@/types'
import styles from './ProfileIdentityBindingsSection.module.css'
import shared from './Profile.module.css'

type BindableProvider = Exclude<UserAuthProvider, 'email'>

export interface ProfileIdentityBindingsSectionProps {
  user: User | null
  linuxdoEnabled?: boolean
  dingtalkEnabled?: boolean
  oidcEnabled?: boolean
  oidcProviderName?: string
  wechatEnabled?: boolean
  wechatOpenEnabled?: boolean
  wechatMpEnabled?: boolean
  embedded?: boolean
  compact?: boolean
}

interface EmailForm {
  email: string
  verifyCode: string
  password: string
}

const legacyBindingNoteKeys: Record<string, string> = {
  'Primary account email is managed from the profile form.': 'profile.authBindings.notes.emailManagedFromProfile',
  'You can unbind this sign-in method.': 'profile.authBindings.notes.canUnbind',
  'Bind another sign-in method before unbinding.': 'profile.authBindings.notes.bindAnotherBeforeUnbind'
}

function emailFormFor(user: User | null): EmailForm {
  return {
    email: typeof user?.email === 'string' && !user.email.endsWith('.invalid') ? user.email : '',
    verifyCode: '',
    password: ''
  }
}

function resolveLegacyCompatibleWeChatSettings(
  settings: WeChatOAuthPublicSettings | null | undefined
): WeChatOAuthPublicSettings | null {
  if (!settings) {
    return null
  }
  if (hasExplicitWeChatOAuthCapabilities(settings)) {
    return settings
  }
  if (typeof settings.wechat_oauth_enabled !== 'boolean') {
    return null
  }
  return {
    ...settings,
    wechat_oauth_open_enabled: settings.wechat_oauth_enabled,
    wechat_oauth_mp_enabled: settings.wechat_oauth_enabled
  }
}

function normalizeBindingStatus(binding: boolean | UserAuthBindingStatus | undefined): boolean | null {
  if (typeof binding === 'boolean') {
    return binding
  }
  if (!binding) {
    return null
  }
  if (typeof binding.bound === 'boolean') {
    return binding.bound
  }
  return Boolean(binding.provider_subject || binding.issuer || binding.provider_key)
}

function getBindingStatusForUser(user: User | null | undefined, provider: UserAuthProvider): boolean {
  if (provider === 'email') {
    if (typeof user?.email_bound === 'boolean') {
      return user.email_bound
    }
    const nested = user?.auth_bindings?.email ?? user?.identity_bindings?.email
    return normalizeBindingStatus(nested) ?? false
  }

  const directFlag = user?.[`${provider}_bound` as keyof User]
  if (typeof directFlag === 'boolean') {
    return directFlag
  }

  const nested = user?.auth_bindings?.[provider] ?? user?.identity_bindings?.[provider]
  return normalizeBindingStatus(nested) ?? false
}

function getDisplayableEmail(user: User | null | undefined): string {
  const email = user?.email?.trim() || ''
  if (!email) {
    return ''
  }
  if (email.endsWith('.invalid') && !getBindingStatusForUser(user, 'email')) {
    return ''
  }
  return email
}

const providerInitials: Record<UserAuthProvider, string> = {
  email: 'E',
  linuxdo: 'L',
  dingtalk: 'D',
  wechat: 'W',
  oidc: 'O',
  github: 'G',
  google: 'G'
}

/** 登录方式绑定（邮箱绑定/更换与第三方绑定、解绑），对应 Vue 版 ProfileIdentityBindingsSection.vue */
export default function ProfileIdentityBindingsSection({
  user,
  linuxdoEnabled = false,
  dingtalkEnabled = false,
  oidcEnabled = false,
  oidcProviderName = 'OIDC',
  wechatEnabled = false,
  wechatOpenEnabled,
  wechatMpEnabled,
  embedded = false,
  compact = false
}: ProfileIdentityBindingsSectionProps) {
  const { t } = useI18n()
  const location = useLocation()
  const cachedPublicSettings = useAppStore((s) => s.cachedPublicSettings)

  const [localUser, setLocalUser] = useState<User | null>(null)
  const [isSendingEmailCode, setIsSendingEmailCode] = useState(false)
  const [isBindingEmail, setIsBindingEmail] = useState(false)
  const [isEmailBindingFormDirty, setIsEmailBindingFormDirty] = useState(false)
  const [isEmailFormExpanded, setIsEmailFormExpanded] = useState(!compact)
  const [unbindingProvider, setUnbindingProvider] = useState<BindableProvider | null>(null)
  const [emailBindingForm, setEmailBindingForm] = useState<EmailForm>(() => emailFormFor(user))
  const [prevUser, setPrevUser] = useState(user)
  const [prevCompact, setPrevCompact] = useState(compact)

  function resetEmailBindingForm(next: User | null) {
    setEmailBindingForm(emailFormFor(next))
    setIsEmailBindingFormDirty(false)
  }

  // 对应 Vue 版 watch(user)
  if (user !== prevUser) {
    setPrevUser(user)
    setLocalUser(null)
    // Profile polling must not overwrite an in-progress email verification flow.
    if (user?.id !== prevUser?.id || !isEmailBindingFormDirty) {
      resetEmailBindingForm(user)
    }
  }
  // 对应 Vue 版 watch(compact)
  if (compact !== prevCompact) {
    setPrevCompact(compact)
    if (!compact) setIsEmailFormExpanded(true)
  }

  const currentUser = localUser ?? user
  const getBindingStatus = (provider: UserAuthProvider) => getBindingStatusForUser(currentUser, provider)
  const getBindingDetails = (provider: UserAuthProvider): UserAuthBindingStatus | null => {
    const binding = currentUser?.auth_bindings?.[provider] ?? currentUser?.identity_bindings?.[provider]
    if (!binding || typeof binding === 'boolean') {
      return null
    }
    return binding
  }

  const emailBound = getBindingStatus('email')
  const showEmailForm = !compact || isEmailFormExpanded
  const emailPasswordPlaceholder = emailBound
    ? t('profile.authBindings.replaceEmailPasswordPlaceholder')
    : t('profile.authBindings.passwordPlaceholder')
  const emailSubmitActionLabel = emailBound
    ? t('profile.authBindings.confirmEmailReplaceAction')
    : t('profile.authBindings.confirmEmailBindAction')

  const wechatOAuthSettings =
    resolveLegacyCompatibleWeChatSettings(cachedPublicSettings) ??
    resolveLegacyCompatibleWeChatSettings({
      wechat_oauth_enabled: wechatEnabled,
      wechat_oauth_open_enabled: wechatOpenEnabled,
      wechat_oauth_mp_enabled: wechatMpEnabled
    })
  const resolvedWeChatBinding = resolveWeChatOAuthStartStrict(wechatOAuthSettings)

  function isProviderEnabledForBinding(provider: BindableProvider): boolean {
    if (provider === 'linuxdo') return linuxdoEnabled
    if (provider === 'dingtalk') return dingtalkEnabled
    if (provider === 'oidc') return oidcEnabled
    return resolvedWeChatBinding.mode !== null
  }

  function bindableItem(provider: BindableProvider, label: string) {
    const bound = getBindingStatus(provider)
    const details = getBindingDetails(provider)
    return {
      provider,
      label,
      bound,
      canBind: !bound && isProviderEnabledForBinding(provider) && (details?.can_bind ?? true),
      canUnbind: Boolean(bound && details?.can_unbind),
      details
    }
  }

  const providerItems = [
    {
      provider: 'email' as UserAuthProvider,
      label: t('profile.authBindings.providers.email'),
      bound: emailBound,
      canBind: false,
      canUnbind: false,
      details: getBindingDetails('email')
    },
    bindableItem('linuxdo', t('profile.authBindings.providers.linuxdo')),
    bindableItem('dingtalk', t('profile.authBindings.providers.dingtalk')),
    bindableItem('oidc', t('profile.authBindings.providers.oidc', { providerName: oidcProviderName })),
    bindableItem('wechat', t('profile.authBindings.providers.wechat'))
  ]

  function bindingCountLabel(details: UserAuthBindingStatus | null): string {
    if (!details || typeof details.bound_count !== 'number' || details.bound_count <= 1) {
      return ''
    }
    return t('profile.authBindings.boundCount', { count: details.bound_count })
  }

  function bindingNote(details: UserAuthBindingStatus | null): string {
    if (!details) {
      return ''
    }
    const noteKey = details.note_key?.trim() || legacyBindingNoteKeys[details.note?.trim() || ''] || ''
    if (noteKey) {
      const translated = t(noteKey)
      if (translated !== noteKey) {
        return translated
      }
    }
    return details.note?.trim() || ''
  }

  function hasBindingDetails(provider: UserAuthProvider, details: UserAuthBindingStatus | null): boolean {
    if (!details) {
      return false
    }
    const showsProviderIdentityDetails = provider !== 'email' && Boolean(details.display_name || details.subject_hint)
    return Boolean(showsProviderIdentityDetails || bindingCountLabel(details) || bindingNote(details))
  }

  function startBinding(provider: UserAuthProvider) {
    if (provider === 'email') {
      return
    }
    const fullPath = `${location.pathname}${location.search}${location.hash}`
    void startOAuthBinding(provider, {
      redirectTo: fullPath || '/profile',
      wechatOAuthSettings: provider === 'wechat' ? wechatOAuthSettings : null
    })
  }

  function applyUpdatedUser(next: User) {
    setLocalUser(next)
    useAuthStore.setState({ user: next })
  }

  async function handleUnbind(provider: BindableProvider, providerLabel: string) {
    setUnbindingProvider(provider)
    try {
      const next = await unbindAuthIdentity(provider)
      applyUpdatedUser(next)
      useAppStore.getState().showSuccess(t('profile.authBindings.unbindSuccess', { providerName: providerLabel }))
    } catch (error) {
      useAppStore.getState().showError((error as { message?: string }).message || t('common.tryAgain'))
    } finally {
      setUnbindingProvider(null)
    }
  }

  // v-model.trim：提交与校验使用去除首尾空白后的值
  const trimmedEmail = emailBindingForm.email.trim()
  const trimmedCode = emailBindingForm.verifyCode.trim()

  function validateEmailBindingForm(requireCode: boolean): boolean {
    const appStore = useAppStore.getState()
    if (!trimmedEmail) {
      appStore.showError(t('auth.emailRequired'))
      return false
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      appStore.showError(t('auth.invalidEmail'))
      return false
    }
    if (requireCode && !trimmedCode) {
      appStore.showError(t('auth.codeRequired'))
      return false
    }
    if (requireCode && !emailBindingForm.password) {
      appStore.showError(t('auth.passwordRequired'))
      return false
    }
    if (requireCode && !emailBound && emailBindingForm.password.length < 6) {
      appStore.showError(t('auth.passwordMinLength'))
      return false
    }
    return true
  }

  async function sendEmailCode() {
    if (!validateEmailBindingForm(false)) {
      return
    }
    const email = trimmedEmail
    setIsEmailBindingFormDirty(true)
    setIsSendingEmailCode(true)
    try {
      await sendEmailBindingCode(email)
      useAppStore.getState().showSuccess(t('profile.authBindings.codeSentTo', { email }))
    } catch (error) {
      useAppStore.getState().showError((error as { message?: string }).message || t('auth.sendCodeFailed'))
    } finally {
      setIsSendingEmailCode(false)
    }
  }

  async function bindEmail() {
    if (!validateEmailBindingForm(true)) {
      return
    }
    setIsEmailBindingFormDirty(true)
    setIsBindingEmail(true)
    try {
      const next = await bindEmailIdentity({
        email: trimmedEmail,
        verify_code: trimmedCode,
        password: emailBindingForm.password
      })
      const replacingBoundEmail = emailBound
      applyUpdatedUser(next)
      resetEmailBindingForm(next)
      if (compact) {
        setIsEmailFormExpanded(false)
      }
      useAppStore
        .getState()
        .showSuccess(
          replacingBoundEmail ? t('profile.authBindings.replaceSuccess') : t('profile.authBindings.bindSuccess')
        )
    } catch (error) {
      useAppStore.getState().showError((error as { message?: string }).message || t('common.tryAgain'))
    } finally {
      setIsBindingEmail(false)
    }
  }

  function updateEmailField(field: keyof EmailForm, value: string) {
    setEmailBindingForm((prev) => ({ ...prev, [field]: value }))
    setIsEmailBindingFormDirty(true)
  }

  const header = (
    <div>
      {embedded ? (
        <p className={shared.embeddedTitle}>{t('profile.authBindings.title')}</p>
      ) : (
        <h2 className={shared.panelTitle}>{t('profile.authBindings.title')}</h2>
      )}
      <p className={shared.panelDescription}>{t('profile.authBindings.description')}</p>
    </div>
  )

  const rows = providerItems.map((item) => {
    const details = item.details
    const summary = item.provider === 'email' ? getDisplayableEmail(currentUser) : ''
    const countLabel = bindingCountLabel(details)
    const note = bindingNote(details)
    return (
      <div key={item.provider} className={styles.row} data-embedded={embedded ? '' : undefined}>
        <div className={styles.rowMain}>
          <div className={styles.providerIcon} data-provider={item.provider}>
            {item.provider === 'email' ? (
              <Mail size={16} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <span>{providerInitials[item.provider]}</span>
            )}
          </div>

          <div className={styles.rowBody}>
            <div className={styles.rowTitle}>
              <h3 className={styles.providerLabel}>{item.label}</h3>
              <Badge
                size="sm"
                tone={item.bound ? 'success' : 'neutral'}
                data-testid={`profile-binding-${item.provider}-status`}
              >
                {item.bound ? t('profile.authBindings.status.bound') : t('profile.authBindings.status.notBound')}
              </Badge>
            </div>

            {summary && <p className={styles.summary}>{summary}</p>}

            {hasBindingDetails(item.provider, details) && (
              <div className={styles.details}>
                {item.provider !== 'email' && details?.display_name && (
                  <p className={styles.detailName}>{details.display_name}</p>
                )}
                {item.provider !== 'email' && details?.subject_hint && <p>{details.subject_hint}</p>}
                {countLabel && <p>{countLabel}</p>}
                {note && <p>{note}</p>}
              </div>
            )}

            {item.provider === 'email' && showEmailForm && (
              <div data-testid="profile-binding-email-form" className={styles.emailForm}>
                <input
                  data-testid="profile-binding-email-input"
                  type="email"
                  className={styles.input}
                  aria-label={t('profile.authBindings.emailPlaceholder')}
                  placeholder={t('profile.authBindings.emailPlaceholder')}
                  disabled={isSendingEmailCode || isBindingEmail}
                  value={emailBindingForm.email}
                  onChange={(event) => updateEmailField('email', event.target.value)}
                />
                <Button
                  data-testid="profile-binding-email-send-code"
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={isSendingEmailCode || isBindingEmail}
                  onClick={() => void sendEmailCode()}
                >
                  {isSendingEmailCode ? t('common.loading') : t('profile.authBindings.sendCodeAction')}
                </Button>
                <input
                  data-testid="profile-binding-email-code-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  className={styles.input}
                  aria-label={t('profile.authBindings.codePlaceholder')}
                  placeholder={t('profile.authBindings.codePlaceholder')}
                  disabled={isBindingEmail}
                  value={emailBindingForm.verifyCode}
                  onChange={(event) => updateEmailField('verifyCode', event.target.value)}
                />
                <input
                  data-testid="profile-binding-email-password-input"
                  type="password"
                  className={styles.input}
                  aria-label={emailPasswordPlaceholder}
                  placeholder={emailPasswordPlaceholder}
                  disabled={isBindingEmail}
                  value={emailBindingForm.password}
                  onChange={(event) => updateEmailField('password', event.target.value)}
                />
                <Button
                  data-testid="profile-binding-email-submit"
                  type="button"
                  size="sm"
                  className={styles.submit}
                  disabled={isBindingEmail}
                  onClick={() => void bindEmail()}
                >
                  {isBindingEmail ? t('common.loading') : emailSubmitActionLabel}
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className={styles.rowActions}>
          {item.provider === 'email' && compact && (
            <Button
              data-testid="profile-binding-email-toggle"
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsEmailFormExpanded((value) => !value)}
            >
              {showEmailForm
                ? t('profile.authBindings.hideEmailFormAction')
                : t('profile.authBindings.manageEmailAction')}
            </Button>
          )}
          {item.canBind && (
            <Button
              data-testid={`profile-binding-${item.provider}-action`}
              type="button"
              size="sm"
              onClick={() => startBinding(item.provider)}
            >
              {t('profile.authBindings.bindAction', { providerName: item.label })}
            </Button>
          )}
          {item.canUnbind && item.provider !== 'email' && (
            <Button
              data-testid={`profile-binding-${item.provider}-unbind`}
              type="button"
              variant="secondary"
              size="sm"
              disabled={unbindingProvider === item.provider}
              onClick={() => void handleUnbind(item.provider as BindableProvider, item.label)}
            >
              {unbindingProvider === item.provider ? t('common.loading') : t('profile.authBindings.unbindAction')}
            </Button>
          )}
        </div>
      </div>
    )
  })

  if (embedded) {
    return (
      <div className={shared.stack}>
        {header}
        {rows}
      </div>
    )
  }

  return (
    <section className={shared.panel}>
      <div className={shared.panelHeader}>{header}</div>
      <div className={styles.list}>{rows}</div>
    </section>
  )
}
