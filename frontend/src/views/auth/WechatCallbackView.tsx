import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { createStore, useStore } from 'zustand'

import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import AuthHeading from '@/components/auth/AuthHeading'
import {
  OAuthBindLoginForm,
  OAuthFlowCard,
  OAuthFlowHint,
  OAuthInvitationForm,
  OAuthProfileAdoption,
  OAuthTotpChallengeForm
} from '@/components/auth/OAuthFlowParts'
import PendingOAuthCreateAccountForm, {
  type PendingOAuthCreateAccountPayload
} from '@/components/auth/PendingOAuthCreateAccountForm'
import {
  getRequestErrorMessage,
  hasSuggestedProfile,
  isCreateAccountRecoveryError,
  normalizedPendingState,
  parseFragmentParams,
  readLegacyFragmentLogin,
  sanitizeRedirectPath,
  serializeAdoptionDecision
} from '@/components/auth/oauthCallback'
import flowStyles from '@/components/auth/oauthFlow.module.css'
import { apiClient } from '@/api/client'
import {
  completeWeChatOAuthRegistration,
  exchangePendingOAuthCompletion,
  getAuthToken,
  hasExplicitWeChatOAuthCapabilities,
  getOAuthCompletionKind,
  isOAuthLoginCompletion,
  login2FA,
  prepareOAuthBindAccessTokenCookie,
  persistOAuthTokenContext,
  resolveWeChatOAuthStartStrict,
  type OAuthAdoptionDecision,
  type PendingOAuthExchangeResponse
} from '@/api/auth'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import {
  clearAllAffiliateReferralCodes,
  loadOAuthAffiliateCode,
  oauthAffiliatePayload
} from '@/utils/oauthAffiliate'

type PendingWeChatCompletion = PendingOAuthExchangeResponse & {
  step?: string
  status?: string
  state?: string
  pending_email?: string
  resolved_email?: string
  existing_account_email?: string
  email?: string
  intent?: string
  requires_2fa?: boolean
  temp_token?: string
  user_email_masked?: string
}

type WeChatPendingAccountAction = 'none' | 'choice' | 'create_account' | 'bind_login'

interface WechatFlowState {
  isProcessing: boolean
  errorMessage: string
  needsInvitation: boolean
  needsChooser: boolean
  invitationCode: string
  isSubmitting: boolean
  invitationError: string
  redirectTo: string
  adoptionRequired: boolean
  suggestedDisplayName: string
  suggestedAvatarUrl: string
  existingAccountEmail: string
  adoptDisplayName: boolean
  adoptAvatar: boolean
  needsAdoptionConfirmation: boolean
  pendingAccountAction: WeChatPendingAccountAction
  pendingAccountEmail: string
  bindLoginEmail: string
  bindLoginPassword: string
  legacyPendingOAuthToken: string
  accountActionError: string
  needsTotpChallenge: boolean
  totpTempToken: string
  totpCode: string
  totpError: string
  totpUserEmailMasked: string
}

const TOASTED_ERRORS = ['invitationError', 'accountActionError', 'totpError', 'errorMessage'] as const

export default function WechatCallbackView() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [store] = useState(() =>
    createStore<WechatFlowState>(() => ({
      isProcessing: true,
      errorMessage: '',
      needsInvitation: false,
      needsChooser: false,
      invitationCode: '',
      isSubmitting: false,
      invitationError: '',
      redirectTo: '/dashboard',
      adoptionRequired: false,
      suggestedDisplayName: '',
      suggestedAvatarUrl: '',
      existingAccountEmail: '',
      adoptDisplayName: true,
      adoptAvatar: true,
      needsAdoptionConfirmation: false,
      pendingAccountAction: 'none',
      pendingAccountEmail: '',
      bindLoginEmail: '',
      bindLoginPassword: '',
      legacyPendingOAuthToken: '',
      accountActionError: '',
      needsTotpChallenge: false,
      totpTempToken: '',
      totpCode: '',
      totpError: '',
      totpUserEmailMasked: ''
    }))
  )
  const state = useStore(store)
  const get = store.getState
  const set = store.setState
  const [bindSuccessMessage] = useState(() => t('profile.authBindings.bindSuccess'))
  const [providerName] = useState(() => t('auth.wechatProviderName'))
  // Vue 版 computed 没有响应式依赖，只在首次读取时求值
  const [hasCurrentAuthToken] = useState(() => Boolean(getAuthToken()))

  // 错误文案变为新的非空值时弹出提示（对应 Vue 版的四个 watch）
  useEffect(() => store.subscribe((next, prev) => {
    for (const key of TOASTED_ERRORS) {
      if (next[key] && next[key] !== prev[key]) {
        useAppStore.getState().showError(next[key])
      }
    }
  }), [store])

  const replace = (path: string) => navigate(path, { replace: true })
  const queryString = (key: string): string | undefined => searchParams.get(key) ?? undefined

  function persistPendingAuthSession(redirect?: string) {
    useAuthStore.getState().setPendingAuthSession({
      token: '',
      token_field: 'pending_oauth_token',
      provider: 'wechat',
      redirect: sanitizeRedirectPath(redirect || get().redirectTo)
    })
  }

  function clearPendingAuthSession() {
    useAuthStore.getState().clearPendingAuthSession()
  }

  async function ensurePublicSettingsLoaded(): Promise<void> {
    const appStore = useAppStore.getState()
    if (hasExplicitWeChatOAuthCapabilities(appStore.cachedPublicSettings)) {
      return
    }

    if (appStore.publicSettingsLoaded) {
      return
    }

    await appStore.fetchPublicSettings()
  }

  function resolveConfiguredWeChatOAuthMode(): 'open' | 'mp' | null {
    const settings = useAppStore.getState().cachedPublicSettings
    if (!hasExplicitWeChatOAuthCapabilities(settings)) {
      return null
    }

    return resolveWeChatOAuthStartStrict(settings).mode
  }

  function resolveWeChatOAuthUnavailableMessage(): string {
    const resolved = resolveWeChatOAuthStartStrict(useAppStore.getState().cachedPublicSettings)

    switch (resolved.unavailableReason) {
      case 'capability_unknown':
        return t('auth.oauthFlow.wechatAvailabilityUnknown')
      case 'external_browser_required':
        return t('auth.oauthFlow.wechatSystemBrowserOnly')
      case 'wechat_browser_required':
        return t('auth.oauthFlow.wechatBrowserOnly')
      case 'native_app_required':
        return 'This WeChat sign-in flow is only available from the native mobile app.'
      case 'not_configured':
        return t('auth.oauthFlow.wechatNotConfigured')
      default:
        return t('auth.loginFailed')
    }
  }

  function resolveRuntimeWeChatOAuthMode(): 'open' | 'mp' {
    if (typeof navigator === 'undefined') {
      return 'open'
    }
    return /MicroMessenger/i.test(navigator.userAgent) ? 'mp' : 'open'
  }

  function normalizeWeChatOAuthMode(value: unknown): 'open' | 'mp' | null {
    return value === 'open' || value === 'mp' ? value : null
  }

  function resolveRequestedWeChatOAuthMode(): 'open' | 'mp' | null {
    const configuredMode = resolveConfiguredWeChatOAuthMode()
    if (configuredMode) {
      return configuredMode
    }

    const queryMode = normalizeWeChatOAuthMode(queryString('mode'))
    if (queryMode) {
      return queryMode
    }

    return resolveRuntimeWeChatOAuthMode()
  }

  function resolveRedirectTarget(): string {
    return sanitizeRedirectPath(queryString('redirect') || get().redirectTo || '/dashboard')
  }

  function resolveWeChatStartURL(intent: 'bind_current_user' | 'adopt_existing_user_by_email'): string | null {
    const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api/v1'
    const normalized = apiBase.replace(/\/$/, '')
    const mode = resolveRequestedWeChatOAuthMode()
    if (!mode) {
      return null
    }
    const params = new URLSearchParams({
      mode,
      redirect: resolveRedirectTarget(),
      intent,
    })

    return `${normalized}/auth/oauth/wechat/bind/start?${params.toString()}`
  }

  function buildExistingAccountResumePath(): string | null {
    const mode = resolveRequestedWeChatOAuthMode()
    if (!mode) {
      return null
    }

    const params = new URLSearchParams({
      wechat_bind_existing: '1',
      redirect: resolveRedirectTarget(),
      mode,
    })

    const email = get().existingAccountEmail.trim()
    if (email) {
      params.set('email', email)
    }

    return `/auth/wechat/callback?${params.toString()}`
  }

  function currentAdoptionDecision(): OAuthAdoptionDecision {
    return {
      adoptDisplayName: get().adoptDisplayName,
      adoptAvatar: get().adoptAvatar
    }
  }

  function resolveResumeEmail(): string {
    return (queryString('email') ?? '').trim()
  }

  async function handleBindCurrentAccount() {
    const unavailableMessage = resolveConfiguredWeChatOAuthMode() === null
      ? resolveWeChatOAuthUnavailableMessage()
      : ''

    const startURL = resolveWeChatStartURL('bind_current_user')
    if (!startURL) {
      set({ errorMessage: unavailableMessage || resolveWeChatOAuthUnavailableMessage() })
      return
    }

    try {
      await prepareOAuthBindAccessTokenCookie()
      window.location.href = startURL
    } catch (e: unknown) {
      set({ errorMessage: getRequestErrorMessage(e, t('auth.loginFailed')) })
    }
  }

  async function redirectToLoginForExistingAccount(): Promise<boolean> {
    const resumePath = buildExistingAccountResumePath()
    if (!resumePath) {
      return false
    }

    const params = new URLSearchParams({
      redirect: resumePath,
    })
    const email = get().existingAccountEmail.trim()
    if (email) {
      params.set('email', email)
    }
    await replace(`/login?${params.toString()}`)
    return true
  }

  async function handleExistingAccountBinding() {
    if (getAuthToken()) {
      await handleBindCurrentAccount()
      return
    }

    if (!(await redirectToLoginForExistingAccount())) {
      set({ errorMessage: resolveWeChatOAuthUnavailableMessage() })
    }
  }

  function applyAdoptionSuggestionState(completion: PendingOAuthExchangeResponse) {
    const suggestedDisplayName = completion.suggested_display_name || ''
    const suggestedAvatarUrl = completion.suggested_avatar_url || ''
    set({
      adoptionRequired: completion.adoption_required === true,
      suggestedDisplayName,
      suggestedAvatarUrl,
      ...(!suggestedDisplayName ? { adoptDisplayName: false } : {}),
      ...(!suggestedAvatarUrl ? { adoptAvatar: false } : {})
    })
  }

  function extractPendingAccountEmail(completion: PendingWeChatCompletion): string {
    return (
      completion.pending_email ||
      completion.existing_account_email ||
      completion.resolved_email ||
      completion.email ||
      resolveResumeEmail() ||
      ''
    ).trim()
  }

  function resolvePendingAccountAction(completion: PendingWeChatCompletion): WeChatPendingAccountAction {
    const raw = normalizedPendingState(
      completion.step || completion.status || completion.state || completion.error || completion.intent
    )
    if (
      raw === 'choice' ||
      raw === 'choose_account_action_required' ||
      raw === 'choose_account_action' ||
      raw === 'choose_account' ||
      raw === 'choose'
    ) {
      return 'choice'
    }
    if (raw === 'email_required' || raw === 'create_account_required' || raw === 'create_account') {
      return 'create_account'
    }
    if (
      raw === 'existing_account' ||
      raw === 'existing_account_required' ||
      raw === 'existing_account_binding_required' ||
      raw === 'adopt_existing_user_by_email' ||
      raw === 'bind_login_required' ||
      raw === 'bind_login'
    ) {
      return 'bind_login'
    }
    return 'none'
  }

  function applyPendingAccountAction(completion: PendingWeChatCompletion) {
    const action = resolvePendingAccountAction(completion)
    const email = extractPendingAccountEmail(completion)
    set({
      pendingAccountAction: action,
      accountActionError: '',
      needsChooser: false,
      needsTotpChallenge: false,
      totpTempToken: '',
      totpCode: '',
      totpError: '',
      totpUserEmailMasked: '',
      pendingAccountEmail: email
    })

    if (action === 'create_account') {
      return
    }

    if (action === 'bind_login') {
      set({ bindLoginEmail: email, bindLoginPassword: '' })
      return
    }

    if (action === 'choice') {
      set({ needsChooser: true, bindLoginPassword: '' })
    }
  }

  function applyTotpChallenge(completion: PendingWeChatCompletion): boolean {
    if (completion.requires_2fa !== true || !completion.temp_token) {
      return false
    }

    set({
      pendingAccountAction: 'none',
      needsChooser: false,
      needsInvitation: false,
      needsAdoptionConfirmation: false,
      needsTotpChallenge: true,
      totpTempToken: completion.temp_token,
      totpCode: '',
      totpError: '',
      totpUserEmailMasked: completion.user_email_masked || '',
      isProcessing: false
    })
    return true
  }

  function switchToBindLoginMode(nextEmail?: string) {
    const current = get()
    set({
      pendingAccountAction: 'bind_login',
      needsChooser: false,
      bindLoginEmail: current.bindLoginEmail.trim() || nextEmail?.trim() || current.pendingAccountEmail.trim(),
      bindLoginPassword: '',
      accountActionError: ''
    })
  }

  function switchToCreateAccountMode() {
    const current = get()
    set({
      pendingAccountAction: 'create_account',
      needsChooser: false,
      pendingAccountEmail: current.pendingAccountEmail.trim() || current.bindLoginEmail.trim(),
      accountActionError: ''
    })
  }

  async function finalizeCompletion(completion: PendingOAuthExchangeResponse, redirect: string) {
    if (getOAuthCompletionKind(completion) === 'bind') {
      const bindRedirect = sanitizeRedirectPath(completion.redirect || '/profile')
      clearPendingAuthSession()
      clearAllAffiliateReferralCodes()
      useAppStore.getState().showSuccess(bindSuccessMessage)
      await replace(bindRedirect)
      return
    }

    if (!isOAuthLoginCompletion(completion)) {
      throw new Error(t('auth.oidc.callbackMissingToken'))
    }

    persistOAuthTokenContext(completion)
    await useAuthStore.getState().setToken(completion.access_token)
    clearAllAffiliateReferralCodes()
    useAppStore.getState().showSuccess(t('auth.loginSuccess'))
    await replace(redirect)
  }

  async function finalizePendingAccountResponse(completion: PendingWeChatCompletion) {
    applyAdoptionSuggestionState(completion)
    const redirect = sanitizeRedirectPath(completion.redirect || get().redirectTo)

    if (completion.error === 'invitation_required') {
      set({
        pendingAccountAction: 'none',
        needsInvitation: true,
        needsAdoptionConfirmation: false,
        isProcessing: false
      })
      persistPendingAuthSession(redirect)
      return
    }

    if (applyTotpChallenge(completion)) {
      persistPendingAuthSession(redirect)
      return
    }

    applyPendingAccountAction(completion)
    if (get().pendingAccountAction !== 'none') {
      set({ needsInvitation: false, needsAdoptionConfirmation: false, isProcessing: false })
      persistPendingAuthSession(redirect)
      return
    }

    if (completion.auth_result === 'pending_session') {
      set({ needsInvitation: false, needsAdoptionConfirmation: false, isProcessing: false })
      persistPendingAuthSession(redirect)
      return
    }

    await finalizeCompletion(completion, redirect)
  }

  async function handleSubmitInvitation() {
    set({ invitationError: '' })
    if (!get().invitationCode.trim()) return

    set({ isSubmitting: true })
    try {
      const affCode = loadOAuthAffiliateCode()
      const decision = currentAdoptionDecision()
      const invitationCode = get().invitationCode.trim()
      const legacyPendingOAuthToken = get().legacyPendingOAuthToken
      const completion: PendingWeChatCompletion = legacyPendingOAuthToken
        ? (
            await apiClient.post<PendingWeChatCompletion>('/auth/oauth/wechat/complete-registration', {
              pending_oauth_token: legacyPendingOAuthToken,
              invitation_code: invitationCode,
              ...oauthAffiliatePayload(affCode),
              ...serializeAdoptionDecision(decision)
            })
          ).data
        : affCode
          ? await completeWeChatOAuthRegistration(invitationCode, decision, affCode)
          : await completeWeChatOAuthRegistration(invitationCode, decision)
      await finalizePendingAccountResponse(completion)
    } catch (e: unknown) {
      const err = e as { message?: string; response?: { data?: { message?: string } } }
      set({
        invitationError: err.response?.data?.message || err.message || t('auth.oidc.completeRegistrationFailed')
      })
    } finally {
      set({ isSubmitting: false })
    }
  }

  async function handleContinueLogin() {
    set({ isSubmitting: true })
    try {
      const completion = await exchangePendingOAuthCompletion(currentAdoptionDecision()) as PendingWeChatCompletion
      await finalizePendingAccountResponse(completion)
    } catch (e: unknown) {
      set({ errorMessage: getRequestErrorMessage(e, t('auth.loginFailed')), needsAdoptionConfirmation: false })
    } finally {
      set({ isSubmitting: false })
    }
  }

  async function handleCreateAccount(payload: PendingOAuthCreateAccountPayload) {
    set({ accountActionError: '' })
    if (!payload.email || !payload.password) return

    set({ isSubmitting: true })
    try {
      const { data } = await apiClient.post<PendingWeChatCompletion>('/auth/oauth/pending/create-account', {
        email: payload.email,
        password: payload.password,
        verify_code: payload.verifyCode || undefined,
        ...(payload.turnstileToken ? { turnstile_token: payload.turnstileToken } : {}),
        ...(payload.tencentCaptchaTicket
          ? {
              tencent_captcha_ticket: payload.tencentCaptchaTicket,
              tencent_captcha_randstr: payload.tencentCaptchaRandstr
            }
          : {}),
        invitation_code: payload.invitationCode || undefined,
        ...oauthAffiliatePayload(loadOAuthAffiliateCode()),
        ...serializeAdoptionDecision(currentAdoptionDecision())
      })
      await finalizePendingAccountResponse(data)
    } catch (e: unknown) {
      if (isCreateAccountRecoveryError(e)) {
        switchToBindLoginMode(payload.email.trim())
        return
      }
      set({ accountActionError: getRequestErrorMessage(e, t('auth.loginFailed')) })
    } finally {
      set({ isSubmitting: false })
    }
  }

  async function handleBindLogin() {
    set({ accountActionError: '' })
    const email = get().bindLoginEmail.trim()
    const password = get().bindLoginPassword
    if (!email || !password) return

    set({ isSubmitting: true })
    try {
      const { data } = await apiClient.post<PendingWeChatCompletion>('/auth/oauth/pending/bind-login', {
        email,
        password,
        ...serializeAdoptionDecision(currentAdoptionDecision())
      })
      await finalizePendingAccountResponse(data)
    } catch (e: unknown) {
      set({ accountActionError: getRequestErrorMessage(e, t('auth.loginFailed')) })
    } finally {
      set({ isSubmitting: false })
    }
  }

  async function handleSubmitTotpChallenge() {
    set({ totpError: '' })
    const code = get().totpCode.trim()
    if (!get().totpTempToken || code.length !== 6) return

    set({ isSubmitting: true })
    try {
      const completion = await login2FA({
        temp_token: get().totpTempToken,
        totp_code: code
      })
      persistOAuthTokenContext(completion)
      await useAuthStore.getState().setToken(completion.access_token)
      clearAllAffiliateReferralCodes()
      useAppStore.getState().showSuccess(t('auth.loginSuccess'))
      await replace(get().redirectTo)
    } catch (e: unknown) {
      set({ totpError: getRequestErrorMessage(e, t('auth.loginFailed')) })
    } finally {
      set({ isSubmitting: false })
    }
  }

  useMountOnce(async () => {
    try {
      await ensurePublicSettingsLoaded()
    } catch {
      // Binding recovery requires confirmed capability flags. Use the strict guard below.
    }

    const queryEmail = searchParams.get('email')
    if (typeof queryEmail === 'string') {
      const email = queryEmail.trim()
      set({ existingAccountEmail: email, bindLoginEmail: email, pendingAccountEmail: email })
    }

    if (searchParams.get('wechat_bind_existing') === '1') {
      if (getAuthToken()) {
        await handleBindCurrentAccount()
        return
      }

      if (!(await redirectToLoginForExistingAccount())) {
        set({ errorMessage: resolveWeChatOAuthUnavailableMessage(), isProcessing: false })
      }
      return
    }

    const params = parseFragmentParams()
    const legacyLogin = readLegacyFragmentLogin(params)
    const legacyPendingToken = params.get('pending_oauth_token')?.trim() || ''
    const error = params.get('error')
    const errorDesc = params.get('error_description') || params.get('error_message') || ''
    const redirect = sanitizeRedirectPath(
      params.get('redirect') || queryString('redirect') || '/dashboard'
    )

    try {
      if (legacyLogin) {
        persistOAuthTokenContext(legacyLogin)
        await useAuthStore.getState().setToken(legacyLogin.access_token)
        clearAllAffiliateReferralCodes()
        useAppStore.getState().showSuccess(t('auth.loginSuccess'))
        await replace(redirect)
        return
      }

      if (error === 'invitation_required' && legacyPendingToken) {
        set({
          legacyPendingOAuthToken: legacyPendingToken,
          redirectTo: redirect,
          needsInvitation: true,
          isProcessing: false
        })
        return
      }

      if (error) {
        set({ errorMessage: errorDesc || error, isProcessing: false })
        return
      }

      const completion = await exchangePendingOAuthCompletion() as PendingWeChatCompletion
      const completionRedirect = sanitizeRedirectPath(
        completion.redirect || queryString('redirect') || '/dashboard'
      )
      applyAdoptionSuggestionState(completion)
      set({ redirectTo: completionRedirect })

      if (completion.error === 'invitation_required') {
        set({ needsInvitation: true, isProcessing: false })
        persistPendingAuthSession(completionRedirect)
        return
      }

      if (applyTotpChallenge(completion)) {
        persistPendingAuthSession(completionRedirect)
        return
      }

      applyPendingAccountAction(completion)
      if (get().pendingAccountAction !== 'none') {
        set({ isProcessing: false })
        persistPendingAuthSession(completionRedirect)
        return
      }

      if (get().adoptionRequired && hasSuggestedProfile(completion)) {
        set({ needsAdoptionConfirmation: true, isProcessing: false })
        persistPendingAuthSession(completionRedirect)
        return
      }

      await finalizeCompletion(completion, completionRedirect)
    } catch (e: unknown) {
      clearPendingAuthSession()
      set({ errorMessage: getRequestErrorMessage(e, t('auth.loginFailed')), isProcessing: false })
    }
  })

  const showBackToChooser = state.pendingAccountAction === 'create_account' || state.pendingAccountAction === 'bind_login'
  const needsCreateAccount = state.pendingAccountAction === 'create_account'
  const needsBindLogin = state.pendingAccountAction === 'bind_login'
  const showFlow =
    state.needsInvitation ||
    state.needsChooser ||
    state.needsAdoptionConfirmation ||
    needsCreateAccount ||
    needsBindLogin ||
    state.needsTotpChallenge

  const backToChooserButton = showBackToChooser && (
    <Button
      type="button"
      variant="secondary"
      className={flowStyles.fullWidth}
      disabled={state.isSubmitting}
      onClick={switchToCreateAccountMode}
    >
      {t('auth.oauthFlow.createNewAccount')}
    </Button>
  )

  return (
    <>
      <AuthHeading title={t('auth.oidc.callbackTitle', { providerName })}>
        {state.isProcessing ? t('auth.oidc.callbackProcessing', { providerName }) : t('auth.oidc.callbackHint')}
      </AuthHeading>

      {showFlow && (
        <div className={flowStyles.flow}>
          {state.adoptionRequired && (state.suggestedDisplayName || state.suggestedAvatarUrl) && (
            <OAuthProfileAdoption
              providerName={providerName}
              suggestedDisplayName={state.suggestedDisplayName}
              suggestedAvatarUrl={state.suggestedAvatarUrl}
              adoptDisplayName={state.adoptDisplayName}
              adoptAvatar={state.adoptAvatar}
              onAdoptDisplayNameChange={(value) => set({ adoptDisplayName: value })}
              onAdoptAvatarChange={(value) => set({ adoptAvatar: value })}
            />
          )}

          {state.needsInvitation ? (
            <>
              <OAuthInvitationForm
                hint={t('auth.oidc.invitationRequired', { providerName })}
                code={state.invitationCode}
                onCodeChange={(value) => set({ invitationCode: value })}
                isSubmitting={state.isSubmitting}
                submitLabel={t('auth.oidc.completeRegistration')}
                submittingLabel={t('auth.oidc.completing')}
                onSubmit={() => void handleSubmitInvitation()}
              />

              <OAuthFlowCard
                title={t('auth.alreadyHaveAccount')}
                description={
                  hasCurrentAuthToken
                    ? t('auth.oauthFlow.bindCurrentAccountDescription', { providerName })
                    : t('auth.oauthFlow.signInThenBindDescription', { providerName })
                }
              >
                {!hasCurrentAuthToken && (
                  <Input
                    label={t('auth.emailLabel')}
                    value={state.existingAccountEmail}
                    onChange={(event) => set({ existingAccountEmail: event.target.value })}
                    data-testid="existing-account-email"
                    type="email"
                    autoComplete="email"
                    placeholder={t('auth.emailPlaceholder')}
                    disabled={state.isSubmitting}
                  />
                )}
                <Button
                  data-testid="existing-account-submit"
                  type="button"
                  variant="secondary"
                  className={flowStyles.fullWidth}
                  disabled={state.isSubmitting}
                  onClick={() => void handleExistingAccountBinding()}
                >
                  {hasCurrentAuthToken ? t('auth.oauthFlow.bindCurrentAccount') : t('auth.signIn')}
                </Button>
              </OAuthFlowCard>
            </>
          ) : state.needsChooser ? (
            <OAuthFlowCard
              title={t('auth.oauthFlow.chooseHowToContinue')}
              description={t('auth.oauthFlow.chooseAccountActionHint')}
            >
              <Button
                data-testid="wechat-choice-bind-existing"
                type="button"
                className={flowStyles.fullWidth}
                disabled={state.isSubmitting}
                onClick={() => switchToBindLoginMode()}
              >
                {t('auth.oauthFlow.bindExistingAccount')}
              </Button>
              <Button
                data-testid="wechat-choice-create-account"
                type="button"
                variant="secondary"
                className={flowStyles.fullWidth}
                disabled={state.isSubmitting}
                onClick={switchToCreateAccountMode}
              >
                {t('auth.oauthFlow.createNewAccount')}
              </Button>
            </OAuthFlowCard>
          ) : state.needsAdoptionConfirmation ? (
            <>
              <OAuthFlowHint>{t('auth.oauthFlow.reviewProfileBeforeContinue', { providerName })}</OAuthFlowHint>
              <Button
                type="button"
                className={flowStyles.fullWidth}
                loading={state.isSubmitting}
                onClick={() => void handleContinueLogin()}
              >
                {state.isSubmitting ? t('common.processing') : t('auth.continue')}
              </Button>
            </>
          ) : needsCreateAccount ? (
            <>
              <OAuthFlowHint>{t('auth.oauthFlow.createAccountHint')}</OAuthFlowHint>
              <PendingOAuthCreateAccountForm
                testIdPrefix="wechat"
                initialEmail={state.pendingAccountEmail}
                isSubmitting={state.isSubmitting}
                errorMessage={state.accountActionError}
                onSubmit={(payload) => void handleCreateAccount(payload)}
                onSwitchToBind={switchToBindLoginMode}
              />
              {backToChooserButton}
            </>
          ) : needsBindLogin ? (
            <>
              <OAuthFlowHint>{t('auth.oauthFlow.bindSignInToExistingAccount', { providerName })}</OAuthFlowHint>
              {hasCurrentAuthToken ? (
                <OAuthFlowCard
                  title={t('auth.oauthFlow.bindCurrentAccountTitle')}
                  description={t('auth.oauthFlow.bindCurrentAccountDescription', { providerName })}
                >
                  <Button
                    data-testid="existing-account-submit"
                    type="button"
                    className={flowStyles.fullWidth}
                    loading={state.isSubmitting}
                    onClick={() => void handleBindCurrentAccount()}
                  >
                    {state.isSubmitting ? t('common.processing') : t('auth.oauthFlow.bindCurrentAccount')}
                  </Button>
                </OAuthFlowCard>
              ) : (
                <OAuthBindLoginForm
                  testIdPrefix="wechat"
                  email={state.bindLoginEmail}
                  password={state.bindLoginPassword}
                  onEmailChange={(value) => set({ bindLoginEmail: value })}
                  onPasswordChange={(value) => set({ bindLoginPassword: value })}
                  isSubmitting={state.isSubmitting}
                  onSubmit={() => void handleBindLogin()}
                />
              )}
              {backToChooserButton}
            </>
          ) : state.needsTotpChallenge ? (
            <OAuthTotpChallengeForm
              testIdPrefix="wechat"
              hint={t('auth.oauthFlow.totpHint', {
                providerName,
                account: state.totpUserEmailMasked || t('auth.oauthFlow.yourAccount')
              })}
              code={state.totpCode}
              onCodeChange={(value) => set({ totpCode: value })}
              isSubmitting={state.isSubmitting}
              onSubmit={() => void handleSubmitTotpChallenge()}
            />
          ) : null}
        </div>
      )}
    </>
  )
}
