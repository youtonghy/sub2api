/**
 * LinuxDo、OIDC、钉钉回调页共用的页面。三个 Vue 页面的模板与脚本只在文案、提供方和少数分支上不同，
 * 这里用 config 表达差异，状态流转与 Vue 版逐行对应。
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { createStore, useStore } from 'zustand'

import { Button } from '@/components/arc/button/button'
import { apiClient } from '@/api/client'
import {
  exchangePendingOAuthCompletion,
  getOAuthCompletionKind,
  isOAuthLoginCompletion,
  login2FA,
  persistOAuthTokenContext,
  type OAuthAdoptionDecision,
  type PendingOAuthExchangeResponse
} from '@/api/auth'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n, type UseI18nResult } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import {
  clearAllAffiliateReferralCodes,
  loadOAuthAffiliateCode,
  oauthAffiliatePayload
} from '@/utils/oauthAffiliate'
import AuthHeading from './AuthHeading'
import {
  OAuthBindLoginForm,
  OAuthFlowCard,
  OAuthFlowHint,
  OAuthInvitationForm,
  OAuthProfileAdoption,
  OAuthTotpChallengeForm
} from './OAuthFlowParts'
import PendingOAuthCreateAccountForm, { type PendingOAuthCreateAccountPayload } from './PendingOAuthCreateAccountForm'
import {
  getRequestErrorMessage,
  hasSuggestedProfile,
  isCreateAccountRecoveryError,
  normalizedPendingState,
  parseFragmentParams,
  readLegacyFragmentLogin,
  sanitizeRedirectPath,
  serializeAdoptionDecision,
  type PendingAccountAction
} from './oauthCallback'
import styles from './oauthFlow.module.css'

export type PendingActionResponse = PendingOAuthExchangeResponse & {
  step?: string
  intent?: string
  email?: string
  resolved_email?: string
  pending_email?: string
  existing_account_email?: string
  suggested_email?: string
  compat_email?: string
  provider_fallback?: string
  requires_2fa?: boolean
  temp_token?: string
  user_email_masked?: string
}

export interface PendingOAuthCallbackLabels {
  title: string
  processing: string
  hint: string
  invitationRequired: string
  completing: string
  completeRegistration: string
}

export interface PendingOAuthCallbackConfig {
  provider: 'linuxdo' | 'oidc' | 'dingtalk'
  /** 页面初始的提供方显示名 */
  initialProviderName: (t: UseI18nResult['t']) => string
  /** OIDC 从公开设置读取自定义名称 */
  loadProviderName?: () => Promise<string | undefined>
  labels: (t: UseI18nResult['t'], providerName: string) => PendingOAuthCallbackLabels
  missingTokenKey: string
  completeRegistrationFailedKey: string
  /** 视为“绑定已有账户”的后端状态，各提供方略有不同 */
  bindLoginStates: readonly string[]
  extractPendingAccountEmail: (completion: PendingActionResponse) => string
  completeRegistration: (request: {
    invitationCode: string
    decision: OAuthAdoptionDecision
    affCode: string
    legacyPendingOAuthToken: string
  }) => Promise<PendingActionResponse>
  /** 片段里的 error 转成提示文案，钉钉会先查专用翻译 */
  fragmentErrorMessage?: (error: string, errorDescription: string, i18n: UseI18nResult) => string
  /** 钉钉：无邮箱用户需要先补邮箱 */
  emailCompletion?: boolean
}

interface FlowState {
  isProcessing: boolean
  errorMessage: string
  needsInvitation: boolean
  invitationCode: string
  isSubmitting: boolean
  invitationError: string
  redirectTo: string
  adoptionRequired: boolean
  suggestedDisplayName: string
  suggestedAvatarUrl: string
  adoptDisplayName: boolean
  adoptAvatar: boolean
  needsAdoptionConfirmation: boolean
  pendingAccountAction: PendingAccountAction
  pendingAccountEmail: string
  bindLoginEmail: string
  bindLoginPassword: string
  legacyPendingOAuthToken: string
  accountActionError: string
  canReturnToCreateAccount: boolean
  needsTotpChallenge: boolean
  totpTempToken: string
  totpCode: string
  totpError: string
  totpUserEmailMasked: string
  providerName: string
}

const TOASTED_ERRORS = ['invitationError', 'accountActionError', 'totpError', 'errorMessage'] as const

export default function PendingOAuthCallbackPage({ config }: { config: PendingOAuthCallbackConfig }) {
  const i18n = useI18n()
  const { t } = i18n
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [store] = useState(() =>
    createStore<FlowState>(() => ({
      isProcessing: true,
      errorMessage: '',
      needsInvitation: false,
      invitationCode: '',
      isSubmitting: false,
      invitationError: '',
      redirectTo: '/dashboard',
      adoptionRequired: false,
      suggestedDisplayName: '',
      suggestedAvatarUrl: '',
      adoptDisplayName: true,
      adoptAvatar: true,
      needsAdoptionConfirmation: false,
      pendingAccountAction: 'none',
      pendingAccountEmail: '',
      bindLoginEmail: '',
      bindLoginPassword: '',
      legacyPendingOAuthToken: '',
      accountActionError: '',
      canReturnToCreateAccount: false,
      needsTotpChallenge: false,
      totpTempToken: '',
      totpCode: '',
      totpError: '',
      totpUserEmailMasked: '',
      providerName: config.initialProviderName(t)
    }))
  )
  const state = useStore(store)
  const get = store.getState
  const set = store.setState
  const [bindSuccessMessage] = useState(() => t('profile.authBindings.bindSuccess'))

  // 错误文案变为新的非空值时弹出提示（对应 Vue 版的四个 watch）
  useEffect(() => store.subscribe((next, prev) => {
    for (const key of TOASTED_ERRORS) {
      if (next[key] && next[key] !== prev[key]) {
        useAppStore.getState().showError(next[key])
      }
    }
  }), [store])

  const replace = (path: string) => navigate(path, { replace: true })

  function persistPendingAuthSession(redirect?: string) {
    useAuthStore.getState().setPendingAuthSession({
      token: '',
      token_field: 'pending_oauth_token',
      provider: config.provider,
      redirect: sanitizeRedirectPath(redirect || get().redirectTo)
    })
  }

  function clearPendingAuthSession() {
    useAuthStore.getState().clearPendingAuthSession()
  }

  function currentAdoptionDecision(): OAuthAdoptionDecision {
    return {
      adoptDisplayName: get().adoptDisplayName,
      adoptAvatar: get().adoptAvatar
    }
  }

  function applyAdoptionSuggestionState(completion: {
    adoption_required?: boolean
    suggested_display_name?: string
    suggested_avatar_url?: string
  }) {
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

  function resolvePendingAccountAction(completion: PendingActionResponse): PendingAccountAction {
    const raw = normalizedPendingState(completion.step || completion.error || completion.intent)
    if (
      raw === 'choice' ||
      raw === 'choose_account_action_required' ||
      raw === 'choose_account_action' ||
      raw === 'choose_account' ||
      raw === 'choose'
    ) {
      return 'choose_account_action'
    }
    if (raw === 'email_required' || raw === 'create_account_required' || raw === 'create_account') {
      return 'create_account'
    }
    if (config.bindLoginStates.includes(raw)) {
      return 'bind_login'
    }
    return 'none'
  }

  function applyPendingAccountAction(completion: PendingActionResponse) {
    const action = resolvePendingAccountAction(completion)
    set({
      pendingAccountAction: action,
      accountActionError: '',
      needsTotpChallenge: false,
      totpTempToken: '',
      totpCode: '',
      totpError: '',
      totpUserEmailMasked: ''
    })

    const email = config.extractPendingAccountEmail(completion)
    if (action === 'choose_account_action') {
      set({
        pendingAccountEmail: email,
        bindLoginEmail: email,
        bindLoginPassword: '',
        canReturnToCreateAccount: false
      })
      return
    }

    if (action === 'create_account') {
      set({ pendingAccountEmail: email, canReturnToCreateAccount: true })
      return
    }

    if (action === 'bind_login') {
      set({ bindLoginEmail: email, bindLoginPassword: '', canReturnToCreateAccount: false })
      return
    }

    set({ canReturnToCreateAccount: false })
  }

  function applyTotpChallenge(completion: PendingActionResponse): boolean {
    if (completion.requires_2fa !== true || !completion.temp_token) {
      return false
    }

    set({
      pendingAccountAction: 'none',
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
      bindLoginEmail: current.bindLoginEmail.trim() || nextEmail?.trim() || current.pendingAccountEmail.trim(),
      bindLoginPassword: '',
      accountActionError: '',
      canReturnToCreateAccount: true
    })
  }

  function switchToCreateAccountMode() {
    const current = get()
    set({
      pendingAccountAction: 'create_account',
      pendingAccountEmail: current.pendingAccountEmail.trim() || current.bindLoginEmail.trim(),
      accountActionError: ''
    })
  }

  function emailCompletionPath(redirect: string): string {
    return '/auth/dingtalk/email-completion?redirect=' + encodeURIComponent(redirect)
  }

  function requiresEmailCompletion(completion: PendingActionResponse): boolean {
    return completion.step === 'email_completion' ||
      (completion as Record<string, unknown>)['requires_email_completion'] === true
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
      throw new Error(t(config.missingTokenKey))
    }

    persistOAuthTokenContext(completion)
    await useAuthStore.getState().setToken(completion.access_token)
    clearAllAffiliateReferralCodes()
    useAppStore.getState().showSuccess(t('auth.loginSuccess'))
    await replace(redirect)
  }

  async function finalizePendingAccountResponse(completion: PendingActionResponse) {
    applyAdoptionSuggestionState(completion)
    const redirect = sanitizeRedirectPath(completion.redirect || get().redirectTo)

    // step=email_completion: 用户无邮箱，需要跳到补邮箱页面
    if (config.emailCompletion && requiresEmailCompletion(completion)) {
      await replace(emailCompletionPath(redirect))
      return
    }

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
      const completion = await config.completeRegistration({
        invitationCode: get().invitationCode.trim(),
        decision: currentAdoptionDecision(),
        affCode: loadOAuthAffiliateCode(),
        legacyPendingOAuthToken: get().legacyPendingOAuthToken
      })
      await finalizePendingAccountResponse(completion)
    } catch (e: unknown) {
      const err = e as { message?: string; response?: { data?: { message?: string } } }
      set({
        invitationError: err.response?.data?.message || err.message || t(config.completeRegistrationFailedKey)
      })
    } finally {
      set({ isSubmitting: false })
    }
  }

  async function handleContinueLogin() {
    set({ isSubmitting: true })
    try {
      const completion = await exchangePendingOAuthCompletion(currentAdoptionDecision()) as PendingActionResponse
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
      const { data } = await apiClient.post<PendingActionResponse>('/auth/oauth/pending/create-account', {
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
      const { data } = await apiClient.post<PendingActionResponse>('/auth/oauth/pending/bind-login', {
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
    if (config.loadProviderName) {
      void config.loadProviderName()
        .then((name) => {
          if (name) set({ providerName: name })
        })
        .catch(() => {
          // Ignore; fallback remains OIDC
        })
    }

    const params = parseFragmentParams()
    const legacyLogin = readLegacyFragmentLogin(params)
    const legacyPendingToken = params.get('pending_oauth_token')?.trim() || ''
    const error = params.get('error')
    const errorDesc = params.get('error_description') || params.get('error_message') || ''
    const redirect = sanitizeRedirectPath(
      params.get('redirect') || searchParams.get('redirect') || '/dashboard'
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
        set({
          errorMessage: config.fragmentErrorMessage
            ? config.fragmentErrorMessage(error, errorDesc, i18n)
            : errorDesc || error,
          isProcessing: false
        })
        return
      }

      const completion = await exchangePendingOAuthCompletion() as PendingActionResponse
      const completionRedirect = sanitizeRedirectPath(
        completion.redirect || searchParams.get('redirect') || '/dashboard'
      )
      applyAdoptionSuggestionState(completion)
      set({ redirectTo: completionRedirect })

      if (config.emailCompletion && requiresEmailCompletion(completion)) {
        // 用户从补邮箱页"我已有账户"按钮跳回时携带 bind=1，跳过 email_completion 自动 redirect，
        // 直接进入 bind_login 输入密码绑定已有账户。
        const wantsBindExisting = searchParams.get('bind') === '1'
        const presetEmail = (searchParams.get('email') || '').trim()
        if (wantsBindExisting) {
          set({
            pendingAccountAction: 'bind_login',
            bindLoginEmail: presetEmail,
            bindLoginPassword: '',
            canReturnToCreateAccount: true,
            isProcessing: false
          })
          persistPendingAuthSession(completionRedirect)
          return
        }
        await replace(emailCompletionPath(completionRedirect))
        return
      }

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

  const labels = config.labels(t, state.providerName)
  const providerName = state.providerName
  const needsChooser = state.pendingAccountAction === 'choose_account_action'
  const needsCreateAccount = state.pendingAccountAction === 'create_account'
  const needsBindLogin = state.pendingAccountAction === 'bind_login'
  const showFlow =
    state.needsInvitation ||
    state.needsAdoptionConfirmation ||
    needsChooser ||
    needsCreateAccount ||
    needsBindLogin ||
    state.needsTotpChallenge

  return (
    <>
      <AuthHeading title={labels.title}>{state.isProcessing ? labels.processing : labels.hint}</AuthHeading>

      {showFlow && (
        <div className={styles.flow}>
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
            <OAuthInvitationForm
              hint={labels.invitationRequired}
              code={state.invitationCode}
              onCodeChange={(value) => set({ invitationCode: value })}
              isSubmitting={state.isSubmitting}
              submitLabel={labels.completeRegistration}
              submittingLabel={labels.completing}
              onSubmit={() => void handleSubmitInvitation()}
            />
          ) : state.needsAdoptionConfirmation ? (
            <>
              <OAuthFlowHint>{t('auth.oauthFlow.reviewProfileBeforeContinue', { providerName })}</OAuthFlowHint>
              <Button
                type="button"
                className={styles.fullWidth}
                loading={state.isSubmitting}
                onClick={() => void handleContinueLogin()}
              >
                {state.isSubmitting ? t('common.processing') : t('auth.continue')}
              </Button>
            </>
          ) : needsChooser ? (
            <OAuthFlowCard
              title={t('auth.oauthFlow.chooseHowToContinue')}
              description={
                state.pendingAccountEmail
                  ? t('auth.oauthFlow.suggestedEmail', { email: state.pendingAccountEmail })
                  : t('auth.oauthFlow.chooseAccountActionHint')
              }
            >
              <div className={styles.choiceGrid} data-columns="2">
                <Button
                  type="button"
                  variant="secondary"
                  className={styles.fullWidth}
                  disabled={state.isSubmitting}
                  onClick={() => switchToBindLoginMode()}
                >
                  {t('auth.oauthFlow.bindExistingAccount')}
                </Button>
                <Button
                  type="button"
                  className={styles.fullWidth}
                  disabled={state.isSubmitting}
                  onClick={switchToCreateAccountMode}
                >
                  {t('auth.oauthFlow.createNewAccount')}
                </Button>
              </div>
            </OAuthFlowCard>
          ) : needsCreateAccount ? (
            <>
              <OAuthFlowHint>{t('auth.oauthFlow.createAccountHint')}</OAuthFlowHint>
              <PendingOAuthCreateAccountForm
                testIdPrefix={config.provider}
                initialEmail={state.pendingAccountEmail}
                isSubmitting={state.isSubmitting}
                errorMessage={state.accountActionError}
                onSubmit={(payload) => void handleCreateAccount(payload)}
                onSwitchToBind={switchToBindLoginMode}
              />
            </>
          ) : needsBindLogin ? (
            <>
              <OAuthFlowHint>{t('auth.oauthFlow.bindLoginHint', { providerName })}</OAuthFlowHint>
              <OAuthBindLoginForm
                testIdPrefix={config.provider}
                email={state.bindLoginEmail}
                password={state.bindLoginPassword}
                onEmailChange={(value) => set({ bindLoginEmail: value })}
                onPasswordChange={(value) => set({ bindLoginPassword: value })}
                isSubmitting={state.isSubmitting}
                onSubmit={() => void handleBindLogin()}
              />
              {state.canReturnToCreateAccount && (
                <Button
                  type="button"
                  variant="secondary"
                  className={styles.fullWidth}
                  disabled={state.isSubmitting}
                  onClick={switchToCreateAccountMode}
                >
                  {t('auth.oauthFlow.useDifferentEmail')}
                </Button>
              )}
            </>
          ) : state.needsTotpChallenge ? (
            <OAuthTotpChallengeForm
              testIdPrefix={config.provider}
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
