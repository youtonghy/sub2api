import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { Check, CircleHelp, Copy, Info, KeyRound, Link2, RefreshCw, Sparkles, TriangleAlert, User } from 'lucide-react'

import { adminAPI } from '@/api/admin'
import { Button } from '@/components/arc/button/button'
import { RadioGroup } from '@/components/arc/radio-group/radio-group'
import type { AddMethod, AuthInputMethod } from '@/composables/useAccountOAuth'
import { useClipboard } from '@/composables/useClipboard'
import { useI18n } from '@/i18n/useI18n'
import type { AccountPlatform } from '@/types'
import { FormNotice } from './AccountFormLayout'
import formStyles from './AccountForm.module.css'
import styles from './OAuthAuthorizationFlow.module.css'

/** 流程内部输入值（Vue 版 defineExpose 暴露的字段） */
export interface OAuthFlowState {
  authCode: string
  oauthState: string
  projectId: string
  sessionKey: string
  refreshToken: string
  sessionToken: string
  codexSession: string
  codexPAT: string
  ssoCookie: string
  emailPassword: string
  inputMethod: AuthInputMethod
}

/** ref 句柄：字段为只读 getter，总是返回最新值 */
export interface OAuthFlowHandle extends Readonly<OAuthFlowState> {
  reset: () => void
}

export interface OAuthAuthorizationFlowProps {
  addMethod: AddMethod
  authUrl?: string
  sessionId?: string
  loading?: boolean
  error?: string
  showHelp?: boolean
  showProxyWarning?: boolean
  allowMultiple?: boolean
  methodLabel?: string
  showCookieOption?: boolean
  showRefreshTokenOption?: boolean
  showMobileRefreshTokenOption?: boolean
  showSessionTokenOption?: boolean
  showAccessTokenOption?: boolean
  showCodexSessionImportOption?: boolean
  showAgentIdentityOption?: boolean
  showCodexPatOption?: boolean
  showSsoOption?: boolean
  /** Grok email----password login (admin; password never persisted). */
  showEmailPasswordOption?: boolean
  showManualOption?: boolean
  initialInputMethod?: AuthInputMethod
  /** Prefill for Grok email----password reauth（只传邮箱或 "email----"） */
  initialEmailPassword?: string
  platform?: AccountPlatform
  showProjectId?: boolean
  onGenerateUrl?: () => void
  onExchangeCode?: (code: string) => void
  onCookieAuth?: (sessionKey: string) => void
  onValidateRefreshToken?: (refreshToken: string) => void
  onValidateMobileRefreshToken?: (refreshToken: string) => void
  onValidateSessionToken?: (sessionToken: string) => void
  onImportAccessToken?: (accessToken: string) => void
  onImportCodexSession?: (content: string) => void
  onImportCodexPat?: (accessToken: string) => void
  onImportSso?: (content: string) => void
  onAuthorizePassword?: (emailPasswordInput: string) => void
  /** Vue 版 update:inputMethod */
  onInputMethodChange?: (method: AuthInputMethod) => void
  /** 任一内部输入值变化时回调（含挂载时的初始值），供父组件在渲染中派生按钮状态 */
  onStateChange?: (state: OAuthFlowState) => void
  ref?: Ref<OAuthFlowHandle | null>
}

const CODE_EXTRACT_PLATFORMS: ReadonlyArray<string> = ['openai', 'gemini', 'antigravity', 'grok']

const countLines = (value: string) =>
  value
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item).length

/**
 * 从回调 URL 中提取授权码与 state（OpenAI/Gemini/Antigravity/Grok）
 * 例：http://localhost:8085/callback?code=xxx...&state=...
 * 与 Vue 版 watch(authCodeInput) 相同：替换后的值会再次检查，直到不再变化。
 */
function extractAuthCode(platform: string, input: string): { code: string; state: string | null } {
  let current = input
  let state: string | null = null
  if (!CODE_EXTRACT_PLATFORMS.includes(platform)) return { code: current, state }
  for (let guard = 0; guard < 5; guard++) {
    const trimmed = current.trim()
    // Check if it looks like a URL with code parameter
    if (!trimmed.includes('code=')) break
    let next: string | null = null
    try {
      // Try to parse as URL
      const url = trimmed.includes('?')
        ? new URL(trimmed)
        : new URL(`http://localhost/callback?${trimmed.replace(/^\?/, '')}`)
      const code = url.searchParams.get('code')
      const stateParam = url.searchParams.get('state')
      if (stateParam) state = stateParam
      if (code && code !== trimmed) next = code
    } catch {
      // If URL parsing fails, try regex extraction
      const match = trimmed.match(/[?&]code=([^&]+)/)
      const stateMatch = trimmed.match(/[?&]state=([^&]+)/)
      if (stateMatch && stateMatch[1]) state = stateMatch[1]
      if (match && match[1] && match[1] !== trimmed) next = match[1]
    }
    if (next === null || next === current) break
    // Replace the input with just the code
    current = next
  }
  return { code: current, state }
}

function Spinnerless({ loading, icon }: { loading: boolean; icon: ReactNode }) {
  return loading ? null : icon
}

/** OAuth / Token 授权流程（对应 Vue 版 OAuthAuthorizationFlow.vue） */
export default function OAuthAuthorizationFlow({
  authUrl = '',
  loading = false,
  error = '',
  showHelp = true,
  showProxyWarning = true,
  allowMultiple = false,
  methodLabel = 'Authorization Method',
  showCookieOption = true,
  showRefreshTokenOption = false,
  showMobileRefreshTokenOption = false,
  showSessionTokenOption = false,
  showAccessTokenOption = false,
  showCodexSessionImportOption = false,
  showAgentIdentityOption = false,
  showCodexPatOption = false,
  showSsoOption = false,
  showEmailPasswordOption = false,
  showManualOption = true,
  initialInputMethod = 'manual',
  initialEmailPassword = '',
  platform = 'anthropic',
  showProjectId = true,
  onGenerateUrl,
  onCookieAuth,
  onValidateRefreshToken,
  onValidateMobileRefreshToken,
  onImportCodexSession,
  onImportCodexPat,
  onImportSso,
  onAuthorizePassword,
  onInputMethodChange,
  onStateChange,
  ref
}: OAuthAuthorizationFlowProps) {
  const { t } = useI18n()
  const { copied, copyToClipboard } = useClipboard()

  // Local state（同步写入 stateRef，句柄 getter 总是读到最新值）
  const initialState = (): OAuthFlowState => ({
    authCode: '',
    oauthState: '',
    projectId: '',
    sessionKey: '',
    refreshToken: '',
    sessionToken: '',
    codexSession: '',
    codexPAT: '',
    ssoCookie: '',
    emailPassword: initialEmailPassword || '',
    inputMethod: initialInputMethod
  })
  const [state, setState] = useState<OAuthFlowState>(initialState)
  const stateRef = useRef<OAuthFlowState>(state)
  const [showHelpDialog, setShowHelpDialog] = useState(false)

  const update = (patch: Partial<OAuthFlowState>) => {
    stateRef.current = { ...stateRef.current, ...patch }
    setState(stateRef.current)
  }

  // 密码授权能力：按 [platform, showEmailPasswordOption] 请求，失败时关闭（后端同样强制）
  const passwordKey = `${platform}|${showEmailPasswordOption}`
  const [passwordAuth, setPasswordAuth] = useState<{ key: string; enabled: boolean }>({ key: '', enabled: false })
  useEffect(() => {
    if (platform !== 'grok' || !showEmailPasswordOption) return
    let cancelled = false
    adminAPI.grok
      .getCapabilities()
      .then((capabilities) => {
        if (!cancelled) setPasswordAuth({ key: passwordKey, enabled: capabilities.password_auth_enabled })
      })
      .catch(() => {
        // Fail closed; the backend enforces the same capability.
      })
    return () => {
      cancelled = true
    }
  }, [platform, showEmailPasswordOption, passwordKey])
  const passwordAuthEnabled = passwordAuth.key === passwordKey && passwordAuth.enabled
  const emailPasswordOptionEnabled = showEmailPasswordOption && platform === 'grok' && passwordAuthEnabled

  const resetToManualIfPasswordHidden = useEffectEvent((enabled: boolean) => {
    if (!enabled && stateRef.current.inputMethod === 'email_password') update({ inputMethod: 'manual' })
  })
  useEffect(() => {
    resetToManualIfPasswordHidden(emailPasswordOptionEnabled)
  }, [emailPasswordOptionEnabled])

  // Watchers：initialInputMethod / initialEmailPassword 变化（不含首次挂载）
  const lastInitialMethod = useRef(initialInputMethod)
  const applyInitialMethod = useEffectEvent((method: AuthInputMethod) => update({ inputMethod: method }))
  useEffect(() => {
    if (lastInitialMethod.current === initialInputMethod) return
    lastInitialMethod.current = initialInputMethod
    applyInitialMethod(initialInputMethod)
  }, [initialInputMethod])

  const lastInitialEmail = useRef(initialEmailPassword)
  const applyInitialEmail = useEffectEvent((value: string) => {
    // Only prefill when the field is empty so we never overwrite operator input.
    if (value && !stateRef.current.emailPassword.trim()) update({ emailPassword: value })
  })
  useEffect(() => {
    if (lastInitialEmail.current === initialEmailPassword) return
    lastInitialEmail.current = initialEmailPassword
    applyInitialEmail(initialEmailPassword)
  }, [initialEmailPassword])

  // inputMethod 变化时通知父组件（Vue 版 emit('update:inputMethod')，不含首次挂载）
  const lastMethod = useRef(state.inputMethod)
  const emitInputMethod = useEffectEvent((method: AuthInputMethod) => onInputMethodChange?.(method))
  useEffect(() => {
    if (lastMethod.current === state.inputMethod) return
    lastMethod.current = state.inputMethod
    emitInputMethod(state.inputMethod)
  }, [state.inputMethod])

  // 内部输入值镜像给父组件（含挂载时的初始值）
  const emitState = useEffectEvent((next: OAuthFlowState) => onStateChange?.(next))
  useEffect(() => {
    emitState(state)
  }, [state])

  useImperativeHandle(
    ref,
    () => ({
      get authCode() {
        return stateRef.current.authCode
      },
      get oauthState() {
        return stateRef.current.oauthState
      },
      get projectId() {
        return stateRef.current.projectId
      },
      get sessionKey() {
        return stateRef.current.sessionKey
      },
      get refreshToken() {
        return stateRef.current.refreshToken
      },
      get sessionToken() {
        return stateRef.current.sessionToken
      },
      get codexSession() {
        return stateRef.current.codexSession
      },
      get codexPAT() {
        return stateRef.current.codexPAT
      },
      get ssoCookie() {
        return stateRef.current.ssoCookie
      },
      get emailPassword() {
        return stateRef.current.emailPassword
      },
      get inputMethod() {
        return stateRef.current.inputMethod
      },
      reset: () => {
        update({
          authCode: '',
          oauthState: '',
          projectId: '',
          sessionKey: '',
          refreshToken: '',
          sessionToken: '',
          codexSession: '',
          codexPAT: '',
          ssoCookie: '',
          emailPassword: '',
          inputMethod: initialInputMethod
        })
        setShowHelpDialog(false)
      }
    }),
    [initialInputMethod]
  )

  const showLocalCallbackNotice = platform === 'openai' || platform === 'grok'

  // Get translation key based on platform
  const getOAuthKey = (key: string) => {
    if (platform === 'openai') return `admin.accounts.oauth.openai.${key}`
    if (platform === 'gemini') return `admin.accounts.oauth.gemini.${key}`
    if (platform === 'antigravity') return `admin.accounts.oauth.antigravity.${key}`
    if (platform === 'grok') return `admin.accounts.oauth.grok.${key}`
    return `admin.accounts.oauth.${key}`
  }

  const oauthImportantNotice = (() => {
    if (platform === 'openai') return t('admin.accounts.oauth.openai.importantNotice')
    if (platform === 'antigravity') return t('admin.accounts.oauth.antigravity.importantNotice')
    if (platform === 'grok') return t('admin.accounts.oauth.grok.importantNotice')
    return ''
  })()

  const { inputMethod } = state
  const isAgentIdentityInput = inputMethod === 'agent_identity'

  // Computed: show method selection only when there is something to choose.
  const methodOptions: { value: AuthInputMethod; label: string; visible: boolean }[] = [
    { value: 'manual', label: t('admin.accounts.oauth.manualAuth'), visible: showManualOption },
    { value: 'cookie', label: t('admin.accounts.oauth.cookieAutoAuth'), visible: showCookieOption },
    { value: 'refresh_token', label: t(getOAuthKey('refreshTokenAuth')), visible: showRefreshTokenOption },
    { value: 'sso_cookie', label: t(getOAuthKey('ssoCookieAuth')), visible: showSsoOption },
    { value: 'email_password', label: t(getOAuthKey('emailPasswordAuth')), visible: emailPasswordOptionEnabled },
    {
      value: 'mobile_refresh_token',
      label: t('admin.accounts.oauth.openai.mobileRefreshTokenAuth'),
      visible: showMobileRefreshTokenOption
    },
    { value: 'session_token', label: t(getOAuthKey('sessionTokenAuth')), visible: showSessionTokenOption },
    { value: 'access_token', label: t('admin.accounts.oauth.openai.accessTokenAuth'), visible: showAccessTokenOption },
    {
      value: 'codex_session',
      label: t('admin.accounts.oauth.openai.codexSessionAuth'),
      visible: showCodexSessionImportOption
    },
    {
      value: 'agent_identity',
      label: t('admin.accounts.oauth.openai.agentIdentityAuth'),
      visible: showAgentIdentityOption
    },
    { value: 'codex_pat', label: t('admin.accounts.oauth.openai.codexPatAuth'), visible: showCodexPatOption }
  ]
  const visibleMethods = methodOptions.filter((option) => option.visible)
  const showMethodSelection = visibleMethods.length > 1

  // Computed
  const parsedKeyCount = countLines(state.sessionKey)
  const parsedRefreshTokenCount = countLines(state.refreshToken)
  const parsedCodexSessionCount = (() => {
    const trimmed = state.codexSession.trim()
    if (!trimmed) return 0
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 1
    return countLines(trimmed)
  })()
  const parsedSSOCount = countLines(state.ssoCookie)
  const parsedEmailPasswordCount = state.emailPassword
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item && item.includes('----')).length

  // Methods
  const handleAuthCodeInput = (value: string) => {
    const { code, state: oauthState } = extractAuthCode(platform, value)
    update(oauthState ? { authCode: code, oauthState } : { authCode: code })
  }

  const handleCopyUrl = () => {
    if (authUrl) {
      void copyToClipboard(authUrl, 'URL copied to clipboard')
    }
  }

  const handleRegenerate = () => {
    update({ authCode: '' })
    onGenerateUrl?.()
  }

  const handleCookieAuth = () => {
    if (state.sessionKey.trim()) onCookieAuth?.(state.sessionKey)
  }

  const handleValidateRefreshToken = () => {
    if (!state.refreshToken.trim()) return
    if (inputMethod === 'mobile_refresh_token') {
      onValidateMobileRefreshToken?.(state.refreshToken.trim())
    } else {
      onValidateRefreshToken?.(state.refreshToken.trim())
    }
  }

  const handleImportCodexSession = () => {
    if (state.codexSession.trim()) onImportCodexSession?.(state.codexSession.trim())
  }

  const handleImportCodexPAT = () => {
    if (state.codexPAT.trim()) onImportCodexPat?.(state.codexPAT.trim())
  }

  const handleImportSSO = () => {
    if (state.ssoCookie.trim()) onImportSso?.(state.ssoCookie.trim())
  }

  const handleAuthorizePassword = () => {
    if (state.emailPassword.trim()) onAuthorizePassword?.(state.emailPassword)
  }

  const errorNotice = error ? (
    <FormNotice tone="danger">
      <p className={styles.error}>{error}</p>
    </FormNotice>
  ) : null

  const countBadge = (count: number) =>
    count > 1 ? <span className={styles.count}>{t('admin.accounts.oauth.keysCount', { count })}</span> : null

  const submitIcon = <Spinnerless loading={loading} icon={<Sparkles size={16} aria-hidden="true" />} />

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.headerIcon} aria-hidden="true">
          <Link2 size={16} />
        </span>
        <h3 className={styles.title}>{t(getOAuthKey('title'))}</h3>
      </div>

      {/* Auth Method Selection */}
      {showMethodSelection ? (
        <RadioGroup
          label={methodLabel}
          name="oauth-input-method"
          value={inputMethod}
          onValueChange={(value) => update({ inputMethod: value as AuthInputMethod })}
          options={visibleMethods.map(({ value, label }) => ({ value, label }))}
        />
      ) : null}

      {/* Refresh Token Input (OpenAI / Antigravity / Mobile RT) */}
      {inputMethod === 'refresh_token' || inputMethod === 'mobile_refresh_token' ? (
        <div className={styles.panel}>
          <p className={styles.description}>{t(getOAuthKey('refreshTokenDesc'))}</p>
          <label className={styles.fieldLabel} htmlFor="oauth-refresh-token">
            <KeyRound size={14} aria-hidden="true" className={styles.fieldIcon} />
            Refresh Token
            {countBadge(parsedRefreshTokenCount)}
          </label>
          <textarea
            id="oauth-refresh-token"
            value={state.refreshToken}
            onChange={(event) => update({ refreshToken: event.target.value })}
            rows={3}
            className={[formStyles.textarea, formStyles.mono].join(' ')}
            placeholder={t(getOAuthKey('refreshTokenPlaceholder'))}
          />
          {parsedRefreshTokenCount > 1 ? (
            <p className={styles.hint}>
              {t('admin.accounts.oauth.batchCreateAccounts', { count: parsedRefreshTokenCount })}
            </p>
          ) : null}
          {errorNotice}
          <Button
            type="button"
            variant="primary"
            loading={loading}
            disabled={loading || !state.refreshToken.trim()}
            onClick={handleValidateRefreshToken}
          >
            {submitIcon}
            {loading ? t(getOAuthKey('validating')) : t(getOAuthKey('validateAndCreate'))}
          </Button>
        </div>
      ) : null}

      {/* SSO Cookie Input (Grok Web -> Grok Build) */}
      {inputMethod === 'sso_cookie' ? (
        <div className={styles.panel}>
          <p className={styles.description}>{t(getOAuthKey('ssoCookieDesc'))}</p>
          <label className={styles.fieldLabel} htmlFor="oauth-sso-cookie">
            <KeyRound size={14} aria-hidden="true" className={styles.fieldIcon} />
            {t(getOAuthKey('ssoCookieLabel'))}
            {countBadge(parsedSSOCount)}
          </label>
          <textarea
            id="oauth-sso-cookie"
            value={state.ssoCookie}
            onChange={(event) => update({ ssoCookie: event.target.value })}
            rows={5}
            className={[formStyles.textarea, formStyles.mono].join(' ')}
            placeholder={t(getOAuthKey('ssoCookiePlaceholder'))}
            spellCheck={false}
          />
          <p className={styles.hint}>{t(getOAuthKey('ssoCookieHint'))}</p>
          {errorNotice}
          <Button
            type="button"
            variant="primary"
            loading={loading}
            disabled={loading || !state.ssoCookie.trim()}
            onClick={handleImportSSO}
          >
            {submitIcon}
            {loading ? t(getOAuthKey('convertingSSO')) : t(getOAuthKey('convertSSOAndCreate'))}
          </Button>
        </div>
      ) : null}

      {/* Grok email + password → ephemeral SSO → Build OAuth (password never stored) */}
      {inputMethod === 'email_password' ? (
        <div className={styles.panel}>
          <p className={styles.description}>{t(getOAuthKey('emailPasswordDesc'))}</p>
          <label className={styles.fieldLabel} htmlFor="oauth-email-password">
            <User size={14} aria-hidden="true" className={styles.fieldIcon} />
            {t(getOAuthKey('emailPasswordInputLabel'))}
            {countBadge(parsedEmailPasswordCount)}
          </label>
          <textarea
            id="oauth-email-password"
            value={state.emailPassword}
            onChange={(event) => update({ emailPassword: event.target.value })}
            rows={4}
            className={[formStyles.textarea, formStyles.mono].join(' ')}
            placeholder={t(getOAuthKey('emailPasswordPlaceholder'))}
            spellCheck={false}
            autoComplete="off"
          />
          <p className={styles.hint}>{t(getOAuthKey('emailPasswordHint'))}</p>
          {errorNotice}
          <Button
            type="button"
            variant="primary"
            loading={loading}
            disabled={loading || !state.emailPassword.trim()}
            onClick={handleAuthorizePassword}
          >
            {submitIcon}
            {loading ? t(getOAuthKey('validating')) : t(getOAuthKey('validateAndCreate'))}
          </Button>
        </div>
      ) : null}

      {/* Codex auth.json / session credential batch import */}
      {inputMethod === 'codex_session' || inputMethod === 'agent_identity' ? (
        <div className={styles.panel}>
          <p className={styles.description}>
            {t(
              isAgentIdentityInput
                ? 'admin.accounts.oauth.openai.agentIdentityDesc'
                : 'admin.accounts.oauth.openai.codexSessionDesc'
            )}
          </p>
          <label className={styles.fieldLabel} htmlFor="oauth-codex-session">
            <KeyRound size={14} aria-hidden="true" className={styles.fieldIcon} />
            {t(
              isAgentIdentityInput
                ? 'admin.accounts.oauth.openai.agentIdentityInputLabel'
                : 'admin.accounts.oauth.openai.codexSessionInputLabel'
            )}
            {countBadge(parsedCodexSessionCount)}
          </label>
          <textarea
            id="oauth-codex-session"
            value={state.codexSession}
            onChange={(event) => update({ codexSession: event.target.value })}
            rows={8}
            className={[formStyles.textarea, formStyles.mono].join(' ')}
            placeholder={t(
              isAgentIdentityInput
                ? 'admin.accounts.oauth.openai.agentIdentityPlaceholder'
                : 'admin.accounts.oauth.openai.codexSessionPlaceholder'
            )}
            spellCheck={false}
          />
          <p className={styles.hint}>
            {t(
              isAgentIdentityInput
                ? 'admin.accounts.oauth.openai.agentIdentityHint'
                : 'admin.accounts.oauth.openai.codexSessionHint'
            )}
          </p>
          {errorNotice}
          <Button
            type="button"
            variant="primary"
            loading={loading}
            disabled={loading || !state.codexSession.trim()}
            onClick={handleImportCodexSession}
          >
            {submitIcon}
            {loading
              ? t('admin.accounts.oauth.openai.validating')
              : t('admin.accounts.oauth.openai.codexSessionImportAndCreate')}
          </Button>
        </div>
      ) : null}

      {/* Codex Personal Access Token */}
      {inputMethod === 'codex_pat' ? (
        <div className={styles.panel}>
          <p className={styles.description}>{t('admin.accounts.oauth.openai.codexPatDesc')}</p>
          <label className={styles.fieldLabel} htmlFor="oauth-codex-pat">
            <KeyRound size={14} aria-hidden="true" className={styles.fieldIcon} />
            {t('admin.accounts.oauth.openai.codexPatInputLabel')}
          </label>
          <textarea
            id="oauth-codex-pat"
            value={state.codexPAT}
            onChange={(event) => update({ codexPAT: event.target.value })}
            rows={3}
            className={[formStyles.textarea, formStyles.mono].join(' ')}
            placeholder={t('admin.accounts.oauth.openai.codexPatPlaceholder')}
            spellCheck={false}
          />
          <p className={styles.hint}>{t('admin.accounts.oauth.openai.codexPatHint')}</p>
          {errorNotice}
          <Button
            type="button"
            variant="primary"
            loading={loading}
            disabled={loading || !state.codexPAT.trim()}
            onClick={handleImportCodexPAT}
          >
            {submitIcon}
            {loading
              ? t('admin.accounts.oauth.openai.validating')
              : t('admin.accounts.oauth.openai.codexPatImportAndCreate')}
          </Button>
        </div>
      ) : null}

      {/* Cookie Auto-Auth Form */}
      {inputMethod === 'cookie' ? (
        <div className={styles.panel}>
          <p className={styles.description}>{t('admin.accounts.oauth.cookieAutoAuthDesc')}</p>
          <label className={styles.fieldLabel} htmlFor="oauth-session-key">
            <KeyRound size={14} aria-hidden="true" className={styles.fieldIcon} />
            {t('admin.accounts.oauth.sessionKey')}
            {allowMultiple ? countBadge(parsedKeyCount) : null}
            {showHelp ? (
              <button
                type="button"
                className={styles.helpButton}
                aria-label={t('admin.accounts.oauth.howToGetSessionKey')}
                aria-expanded={showHelpDialog}
                onClick={() => setShowHelpDialog((value) => !value)}
              >
                <CircleHelp size={16} aria-hidden="true" />
              </button>
            ) : null}
          </label>
          <textarea
            id="oauth-session-key"
            value={state.sessionKey}
            onChange={(event) => update({ sessionKey: event.target.value })}
            rows={3}
            className={[formStyles.textarea, formStyles.mono].join(' ')}
            placeholder={
              allowMultiple
                ? t('admin.accounts.oauth.sessionKeyPlaceholder')
                : t('admin.accounts.oauth.sessionKeyPlaceholderSingle')
            }
          />
          {parsedKeyCount > 1 && allowMultiple ? (
            <p className={styles.hint}>{t('admin.accounts.oauth.batchCreateAccounts', { count: parsedKeyCount })}</p>
          ) : null}

          {/* Help Section */}
          {showHelpDialog && showHelp ? (
            <FormNotice tone="warning" title={t('admin.accounts.oauth.howToGetSessionKey')}>
              <ol className={styles.helpList}>
                <li>{t('admin.accounts.oauth.step1')}</li>
                <li>{t('admin.accounts.oauth.step2')}</li>
                <li>{t('admin.accounts.oauth.step3')}</li>
                <li>{t('admin.accounts.oauth.step4')}</li>
                <li>{t('admin.accounts.oauth.step5')}</li>
                <li>{t('admin.accounts.oauth.step6')}</li>
              </ol>
              <p>{t('admin.accounts.oauth.sessionKeyFormat')}</p>
            </FormNotice>
          ) : null}

          {errorNotice}
          <Button
            type="button"
            variant="primary"
            loading={loading}
            disabled={loading || !state.sessionKey.trim()}
            onClick={handleCookieAuth}
          >
            {submitIcon}
            {loading ? t('admin.accounts.oauth.authorizing') : t('admin.accounts.oauth.startAutoAuth')}
          </Button>
        </div>
      ) : null}

      {/* Manual Authorization Flow */}
      {inputMethod === 'manual' ? (
        <div className={styles.panel}>
          <p className={styles.description}>{t(getOAuthKey('followSteps'))}</p>
          <ol className={styles.steps}>
            {/* Step 1: Generate Auth URL */}
            <li className={styles.step}>
              <span className={styles.stepNumber} aria-hidden="true">
                1
              </span>
              <div className={styles.stepBody}>
                <p className={styles.stepTitle}>{t(getOAuthKey('step1GenerateUrl'))}</p>
                {showProjectId && platform === 'gemini' ? (
                  <div className={formStyles.field}>
                    <label className={styles.fieldLabel} htmlFor="oauth-gemini-project-id">
                      {t('admin.accounts.oauth.gemini.projectIdLabel')}
                      <a
                        href="https://console.cloud.google.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.inlineLink}
                      >
                        <CircleHelp size={12} aria-hidden="true" />
                        {t('admin.accounts.oauth.gemini.howToGetProjectId')}
                      </a>
                    </label>
                    <input
                      id="oauth-gemini-project-id"
                      value={state.projectId}
                      onChange={(event) => update({ projectId: event.target.value })}
                      type="text"
                      className={[formStyles.input, formStyles.mono].join(' ')}
                      placeholder={t('admin.accounts.oauth.gemini.projectIdPlaceholder')}
                    />
                    <p className={styles.hint}>{t('admin.accounts.oauth.gemini.projectIdHint')}</p>
                  </div>
                ) : null}
                {!authUrl ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    loading={loading}
                    disabled={loading}
                    onClick={() => onGenerateUrl?.()}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    <Spinnerless loading={loading} icon={<Link2 size={16} aria-hidden="true" />} />
                    {loading ? t('admin.accounts.oauth.generating') : t(getOAuthKey('generateAuthUrl'))}
                  </Button>
                ) : (
                  <>
                    <div className={styles.urlRow}>
                      <input
                        value={authUrl}
                        readOnly
                        type="text"
                        aria-label={t(getOAuthKey('generateAuthUrl'))}
                        className={[formStyles.input, formStyles.mono].join(' ')}
                      />
                      <button
                        type="button"
                        className={formStyles.iconButton}
                        title="Copy URL"
                        aria-label="Copy URL"
                        onClick={handleCopyUrl}
                      >
                        {copied ? (
                          <Check size={16} aria-hidden="true" className={styles.copied} />
                        ) : (
                          <Copy size={16} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    <button type="button" className={styles.linkButton} onClick={handleRegenerate}>
                      <RefreshCw size={12} aria-hidden="true" />
                      {t('admin.accounts.oauth.regenerate')}
                    </button>
                  </>
                )}
              </div>
            </li>

            {/* Step 2: Open URL and authorize */}
            <li className={styles.step}>
              <span className={styles.stepNumber} aria-hidden="true">
                2
              </span>
              <div className={styles.stepBody}>
                <p className={styles.stepTitle}>{t(getOAuthKey('step2OpenUrl'))}</p>
                <p className={styles.description}>{t(getOAuthKey('openUrlDesc'))}</p>
                {/* Local callback notice */}
                {showLocalCallbackNotice ? (
                  <FormNotice tone="warning">
                    <p>{oauthImportantNotice}</p>
                  </FormNotice>
                ) : showProxyWarning ? (
                  /* Proxy Warning (for non-OpenAI) */
                  <FormNotice tone="warning">
                    <p>{t('admin.accounts.oauth.proxyWarning')}</p>
                  </FormNotice>
                ) : null}
              </div>
            </li>

            {/* Step 3: Enter authorization code */}
            <li className={styles.step}>
              <span className={styles.stepNumber} aria-hidden="true">
                3
              </span>
              <div className={styles.stepBody}>
                <p className={styles.stepTitle}>{t(getOAuthKey('step3EnterCode'))}</p>
                <p className={styles.description}>{t(getOAuthKey('authCodeDesc'))}</p>
                <label className={styles.fieldLabel} htmlFor="oauth-auth-code">
                  <KeyRound size={14} aria-hidden="true" className={styles.fieldIcon} />
                  {t(getOAuthKey('authCode'))}
                </label>
                <textarea
                  id="oauth-auth-code"
                  value={state.authCode}
                  onChange={(event) => handleAuthCodeInput(event.target.value)}
                  rows={3}
                  className={[formStyles.textarea, formStyles.mono].join(' ')}
                  style={{ resize: 'none' }}
                  placeholder={t(getOAuthKey('authCodePlaceholder'))}
                />
                <p className={styles.hint}>
                  <Info size={12} aria-hidden="true" /> {t(getOAuthKey('authCodeHint'))}
                </p>

                {/* Gemini-specific state parameter warning */}
                {platform === 'gemini' ? (
                  <FormNotice tone="warning" title={t('admin.accounts.oauth.gemini.stateWarningTitle')}>
                    <p>
                      <TriangleAlert size={12} aria-hidden="true" /> {t('admin.accounts.oauth.gemini.stateWarningDesc')}
                    </p>
                  </FormNotice>
                ) : null}

                {errorNotice}
              </div>
            </li>
          </ol>
        </div>
      ) : null}
    </div>
  )
}
