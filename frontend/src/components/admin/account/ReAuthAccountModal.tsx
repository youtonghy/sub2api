import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Cloud, Sparkles, User } from 'lucide-react'

import { adminAPI } from '@/api/admin'
import OAuthAuthorizationFlow, {
  type OAuthFlowHandle,
  type OAuthFlowState
} from '@/components/account/OAuthAuthorizationFlow'
import { Button } from '@/components/arc/button/button'
import { RadioGroup } from '@/components/arc/radio-group/radio-group'
import BaseDialog from '@/components/common/BaseDialog'
import PlatformIcon from '@/components/common/PlatformIcon'
import { useAccountOAuth, type AddMethod, type AuthInputMethod } from '@/composables/useAccountOAuth'
import { useAntigravityOAuth } from '@/composables/useAntigravityOAuth'
import { useGeminiOAuth } from '@/composables/useGeminiOAuth'
import { useGrokOAuth } from '@/composables/useGrokOAuth'
import { useOpenAIOAuth } from '@/composables/useOpenAIOAuth'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { Account } from '@/types'
import styles from './ReAuthAccountModal.module.css'

export interface ReAuthAccountModalProps {
  show: boolean
  account: Account | null
  onClose: () => void
  onReauthorized: (account: Account) => void
}

type GeminiOAuthType = 'code_assist' | 'google_one' | 'ai_studio'

/** 重新授权账号（对应 Vue 版 components/admin/account/ReAuthAccountModal.vue） */
export default function ReAuthAccountModal({ show, account, onClose, onReauthorized }: ReAuthAccountModalProps) {
  const { t } = useI18n()

  // OAuth composables
  const claudeOAuth = useAccountOAuth()
  const openaiOAuth = useOpenAIOAuth()
  const geminiOAuth = useGeminiOAuth()
  const antigravityOAuth = useAntigravityOAuth()
  const grokOAuth = useGrokOAuth()

  // Refs
  const oauthFlowRef = useRef<OAuthFlowHandle | null>(null)
  // 授权流程内部输入值的镜像，用于渲染时派生按钮状态
  const [flowState, setFlowState] = useState<OAuthFlowState | null>(null)

  // State
  const [addMethod, setAddMethod] = useState<AddMethod>('oauth')
  const [geminiOAuthType, setGeminiOAuthType] = useState<GeminiOAuthType>('code_assist')

  // Computed - check platform
  const isOpenAI = account?.platform === 'openai'
  const isOpenAILike = isOpenAI
  const isGemini = account?.platform === 'gemini'
  const isAnthropic = account?.platform === 'anthropic'
  const isAntigravity = account?.platform === 'antigravity'
  const isGrok = account?.platform === 'grok'

  /**
   * Grok reauth default tab (password auth is hidden):
   * - refresh_token when RT may still work
   * - SSO cookie otherwise
   */
  const grokInitialInputMethod = ((): AuthInputMethod => {
    if (!isGrok) return 'manual'
    const creds = (account?.credentials || {}) as Record<string, unknown>
    const hasRT =
      (typeof creds.refresh_token === 'string' && creds.refresh_token.trim() !== '') ||
      (typeof creds.has_refresh_token === 'boolean' && creds.has_refresh_token)
    if (hasRT) return 'refresh_token'
    return 'sso_cookie'
  })()

  // Computed - current OAuth client based on platform
  const currentClient = isOpenAILike
    ? openaiOAuth
    : isGemini
      ? geminiOAuth
      : isAntigravity
        ? antigravityOAuth
        : isGrok
          ? grokOAuth
          : claudeOAuth
  const currentAuthUrl = currentClient.authUrl
  const currentSessionId = currentClient.sessionId
  const currentLoading = currentClient.loading
  const currentError = currentClient.error

  // Computed — footer "complete auth" only for code-exchange flows, not SSO/password/RT.
  const isManualInputMethod = (() => {
    const method = flowState?.inputMethod
    if (method === 'sso_cookie' || method === 'email_password' || method === 'refresh_token') {
      return false
    }
    // OpenAI/Gemini/Antigravity/Grok use manual code paste by default (no cookie auth)
    return isOpenAILike || isGemini || isAntigravity || isGrok || method === 'manual'
  })()

  const canExchangeCode = Boolean((flowState?.authCode || '').trim() && currentSessionId && !currentLoading)

  // Methods
  const resetState = () => {
    setAddMethod('oauth')
    setGeminiOAuthType('code_assist')
    claudeOAuth.resetState()
    openaiOAuth.resetState()
    geminiOAuth.resetState()
    antigravityOAuth.resetState()
    grokOAuth.resetState()
    oauthFlowRef.current?.reset()
  }

  // Watchers：只跟随 show 变化（Vue 版 watch(() => props.show)）
  const onShowChange = useEffectEvent((visible: boolean) => {
    if (visible && account) {
      // Initialize addMethod based on current account type (Claude only)
      if (isAnthropic && (account.type === 'oauth' || account.type === 'setup-token')) {
        setAddMethod(account.type as AddMethod)
      }
      if (isGemini) {
        const creds = (account.credentials || {}) as Record<string, unknown>
        setGeminiOAuthType(
          creds.oauth_type === 'google_one' ? 'google_one' : creds.oauth_type === 'ai_studio' ? 'ai_studio' : 'code_assist'
        )
      }
    } else {
      resetState()
    }
  })
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 对应 Vue 版 watch(show)：打开时初始化、关闭时重置
    onShowChange(show)
  }, [show])

  const handleClose = () => {
    onClose()
  }

  const showError = (message: string) => useAppStore.getState().showError(message)
  const showSuccess = (message: string) => useAppStore.getState().showSuccess(message)

  const finishReauth = (updatedAccount: Account) => {
    showSuccess(t('admin.accounts.reAuthorizedSuccess'))
    onReauthorized(updatedAccount)
    handleClose()
  }

  const handleGenerateUrl = async () => {
    if (!account) return

    if (isOpenAILike) {
      await openaiOAuth.generateAuthUrl(account.proxy_id)
    } else if (isGemini) {
      const creds = (account.credentials || {}) as Record<string, unknown>
      const tierId = typeof creds.tier_id === 'string' ? creds.tier_id : undefined
      const projectId = geminiOAuthType === 'code_assist' ? oauthFlowRef.current?.projectId : undefined
      await geminiOAuth.generateAuthUrl(account.proxy_id, projectId, geminiOAuthType, tierId)
    } else if (isAntigravity) {
      await antigravityOAuth.generateAuthUrl(account.proxy_id)
    } else if (isGrok) {
      await grokOAuth.generateAuthUrl(account.proxy_id)
    } else {
      await claudeOAuth.generateAuthUrl(addMethod, account.proxy_id)
    }
  }

  const handleExchangeCode = async () => {
    if (!account) return

    const authCode = oauthFlowRef.current?.authCode || ''
    if (!authCode.trim()) return

    if (isOpenAILike) {
      // OpenAI OAuth flow
      const oauthClient = openaiOAuth
      const sessionId = oauthClient.sessionId
      if (!sessionId) return
      const stateToUse = (oauthFlowRef.current?.oauthState || oauthClient.oauthState || '').trim()
      if (!stateToUse) {
        oauthClient.observable.set({ error: t('admin.accounts.oauth.authFailed') })
        showError(oauthClient.error)
        return
      }

      const tokenInfo = await oauthClient.exchangeAuthCode(authCode.trim(), sessionId, stateToUse, account.proxy_id)
      if (!tokenInfo) return

      // Build credentials and extra info
      const credentials = oauthClient.buildCredentials(tokenInfo)
      const extra = oauthClient.buildExtraInfo(tokenInfo)

      try {
        const updatedAccount = await adminAPI.accounts.applyOAuthCredentials(account.id, {
          type: 'oauth',
          credentials,
          extra
        })
        finishReauth(updatedAccount)
      } catch (error: any) {
        oauthClient.observable.set({ error: error.response?.data?.detail || t('admin.accounts.oauth.authFailed') })
        showError(oauthClient.error)
      }
    } else if (isGemini) {
      const sessionId = geminiOAuth.sessionId
      if (!sessionId) return

      const stateFromInput = oauthFlowRef.current?.oauthState || ''
      const stateToUse = stateFromInput || geminiOAuth.state
      if (!stateToUse) return

      const tokenInfo = await geminiOAuth.exchangeAuthCode({
        code: authCode.trim(),
        sessionId,
        state: stateToUse,
        proxyId: account.proxy_id,
        oauthType: geminiOAuthType,
        tierId:
          typeof (account.credentials as any)?.tier_id === 'string'
            ? ((account.credentials as any).tier_id as string)
            : undefined
      })
      if (!tokenInfo) return

      const credentials = geminiOAuth.buildCredentials(tokenInfo)

      try {
        await adminAPI.accounts.update(account.id, {
          type: 'oauth',
          credentials
        })
        const updatedAccount = await adminAPI.accounts.clearError(account.id)
        finishReauth(updatedAccount)
      } catch (error: any) {
        geminiOAuth.observable.set({ error: error.response?.data?.detail || t('admin.accounts.oauth.authFailed') })
        showError(geminiOAuth.error)
      }
    } else if (isAntigravity) {
      // Antigravity OAuth flow
      const sessionId = antigravityOAuth.sessionId
      if (!sessionId) return

      const stateFromInput = oauthFlowRef.current?.oauthState || ''
      const stateToUse = stateFromInput || antigravityOAuth.state
      if (!stateToUse) return

      const tokenInfo = await antigravityOAuth.exchangeAuthCode({
        code: authCode.trim(),
        sessionId,
        state: stateToUse,
        proxyId: account.proxy_id
      })
      if (!tokenInfo) return

      const credentials = antigravityOAuth.buildCredentials(tokenInfo)

      try {
        await adminAPI.accounts.update(account.id, {
          type: 'oauth',
          credentials
        })
        const updatedAccount = await adminAPI.accounts.clearError(account.id)
        finishReauth(updatedAccount)
      } catch (error: any) {
        antigravityOAuth.observable.set({
          error: error.response?.data?.detail || t('admin.accounts.oauth.authFailed')
        })
        showError(antigravityOAuth.error)
      }
    } else if (isGrok) {
      const sessionId = grokOAuth.sessionId
      if (!sessionId) return

      const stateFromInput = oauthFlowRef.current?.oauthState || ''
      const stateToUse = stateFromInput || grokOAuth.state
      if (!stateToUse) return

      const tokenInfo = await grokOAuth.exchangeAuthCode({
        code: authCode.trim(),
        sessionId,
        state: stateToUse,
        proxyId: account.proxy_id
      })
      if (!tokenInfo) return

      const credentials = grokOAuth.buildCredentials(tokenInfo)
      const extra = grokOAuth.buildExtraInfo(tokenInfo)

      try {
        const updatedAccount = await adminAPI.accounts.applyOAuthCredentials(account.id, {
          type: 'oauth',
          credentials,
          extra
        })
        finishReauth(updatedAccount)
      } catch (error: any) {
        grokOAuth.observable.set({ error: error.response?.data?.detail || t('admin.accounts.oauth.authFailed') })
        showError(grokOAuth.error)
      }
    } else {
      // Claude OAuth flow
      const sessionId = claudeOAuth.sessionId
      if (!sessionId) return

      claudeOAuth.observable.set({ loading: true, error: '' })

      try {
        const proxyConfig = account.proxy_id ? { proxy_id: account.proxy_id } : {}
        const endpoint =
          addMethod === 'oauth' ? '/admin/accounts/exchange-code' : '/admin/accounts/exchange-setup-token-code'

        const tokenInfo = await adminAPI.accounts.exchangeCode(endpoint, {
          session_id: sessionId,
          code: authCode.trim(),
          ...proxyConfig
        })

        const extra = claudeOAuth.buildExtraInfo(tokenInfo)

        const updatedAccount = await adminAPI.accounts.applyOAuthCredentials(account.id, {
          type: addMethod as 'oauth' | 'setup-token',
          credentials: tokenInfo as unknown as Record<string, unknown>,
          extra
        })
        finishReauth(updatedAccount)
      } catch (error: any) {
        claudeOAuth.observable.set({ error: error.response?.data?.detail || t('admin.accounts.oauth.authFailed') })
        showError(claudeOAuth.error)
      } finally {
        claudeOAuth.observable.set({ loading: false })
      }
    }
  }

  const handleCookieAuth = async (sessionKey: string) => {
    if (!account || isOpenAILike) return

    claudeOAuth.observable.set({ loading: true, error: '' })

    try {
      const proxyConfig = account.proxy_id ? { proxy_id: account.proxy_id } : {}
      const endpoint =
        addMethod === 'oauth' ? '/admin/accounts/cookie-auth' : '/admin/accounts/setup-token-cookie-auth'

      const tokenInfo = await adminAPI.accounts.exchangeCode(endpoint, {
        session_id: '',
        code: sessionKey.trim(),
        ...proxyConfig
      })

      const extra = claudeOAuth.buildExtraInfo(tokenInfo)

      const updatedAccount = await adminAPI.accounts.applyOAuthCredentials(account.id, {
        type: addMethod as 'oauth' | 'setup-token',
        credentials: tokenInfo as unknown as Record<string, unknown>,
        extra
      })
      finishReauth(updatedAccount)
    } catch (error: any) {
      claudeOAuth.observable.set({ error: error.response?.data?.detail || t('admin.accounts.oauth.cookieAuthFailed') })
    } finally {
      claudeOAuth.observable.set({ loading: false })
    }
  }

  /** Apply Grok Build OAuth tokens onto the existing account (never store password/SSO). */
  const applyGrokReauthTokenInfo = async (tokenInfo: {
    access_token?: string
    refresh_token?: string
    email?: string
    [key: string]: unknown
  }) => {
    if (!account) return
    const credentials = grokOAuth.buildCredentials(tokenInfo as any)
    const extra = grokOAuth.buildExtraInfo(tokenInfo as any)
    const updatedAccount = await adminAPI.accounts.applyOAuthCredentials(account.id, {
      type: 'oauth',
      credentials,
      extra
    })
    finishReauth(updatedAccount)
  }

  /** Re-auth with a single refresh token. */
  const handleGrokValidateRefreshToken = async (refreshTokenInput: string) => {
    if (!account || !isGrok) return
    const refreshToken = refreshTokenInput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)[0]
    if (!refreshToken) {
      grokOAuth.observable.set({ error: t('admin.accounts.oauth.grok.pleaseEnterRefreshToken') })
      return
    }

    grokOAuth.observable.set({ loading: true, error: '' })
    try {
      const tokenInfo = await grokOAuth.validateRefreshToken(refreshToken, account.proxy_id)
      if (!tokenInfo) return
      await applyGrokReauthTokenInfo(tokenInfo)
    } catch (error: any) {
      grokOAuth.observable.set({
        error: error.response?.data?.detail || error.message || t('admin.accounts.oauth.grok.failedToValidateRT')
      })
      showError(grokOAuth.error)
    } finally {
      grokOAuth.observable.set({ loading: false })
    }
  }

  /** Re-auth the existing account with one refresh token. */
  const handleValidateRefreshToken = async (refreshTokenInput: string) => {
    if (!account) return
    if (isGrok) {
      await handleGrokValidateRefreshToken(refreshTokenInput)
      return
    }

    const refreshToken = refreshTokenInput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)[0]
    if (!refreshToken) return

    if (isOpenAILike) {
      openaiOAuth.observable.set({ loading: true, error: '' })
      try {
        const tokenInfo = await openaiOAuth.validateRefreshToken(refreshToken, account.proxy_id)
        if (!tokenInfo) return

        const updatedAccount = await adminAPI.accounts.applyOAuthCredentials(account.id, {
          type: 'oauth',
          credentials: openaiOAuth.buildCredentials(tokenInfo),
          extra: openaiOAuth.buildExtraInfo(tokenInfo)
        })
        finishReauth(updatedAccount)
      } catch (error: any) {
        openaiOAuth.observable.set({
          error:
            error.response?.data?.detail ||
            error.response?.data?.message ||
            error.message ||
            t('admin.accounts.oauth.authFailed')
        })
        showError(openaiOAuth.error)
      } finally {
        openaiOAuth.observable.set({ loading: false })
      }
      return
    }

    if (!isAntigravity) return
    antigravityOAuth.observable.set({ loading: true, error: '' })
    try {
      const tokenInfo = await antigravityOAuth.validateRefreshToken(refreshToken, account.proxy_id)
      if (!tokenInfo) return

      const updatedAccount = await adminAPI.accounts.applyOAuthCredentials(account.id, {
        type: 'oauth',
        credentials: antigravityOAuth.buildCredentials(tokenInfo, refreshToken)
      })
      finishReauth(updatedAccount)
    } catch (error: any) {
      antigravityOAuth.observable.set({
        error:
          error.response?.data?.detail ||
          error.response?.data?.message ||
          error.message ||
          t('admin.accounts.oauth.authFailed')
      })
      showError(antigravityOAuth.error)
    } finally {
      antigravityOAuth.observable.set({ loading: false })
    }
  }

  /** Re-auth with a single SSO cookie → Build OAuth (not batch create). */
  const handleGrokImportSSO = async (ssoInput: string) => {
    if (!account || !isGrok) return
    const ssoToken = ssoInput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)[0]
    if (!ssoToken) return

    grokOAuth.observable.set({ loading: true, error: '' })
    try {
      const tokenInfo = await grokOAuth.validateSSOToken(ssoToken, account.proxy_id)
      if (!tokenInfo) return
      await applyGrokReauthTokenInfo(tokenInfo)
    } catch (error: any) {
      grokOAuth.observable.set({
        error:
          error.response?.data?.detail ||
          error.message ||
          t('admin.accounts.oauth.grok.failedToValidateSSO', 'Failed to validate Grok SSO')
      })
      showError(grokOAuth.error)
    } finally {
      grokOAuth.observable.set({ loading: false })
    }
  }

  const platformLabel = isOpenAI
    ? t('admin.accounts.openaiAccount')
    : isGemini
      ? t('admin.accounts.geminiAccount')
      : isAntigravity
        ? t('admin.accounts.antigravityAccount')
        : isGrok
          ? t('admin.accounts.grokAccount')
          : t('admin.accounts.claudeCodeAccount')

  const flowPlatform = isOpenAI
    ? 'openai'
    : isGemini
      ? 'gemini'
      : isAntigravity
        ? 'antigravity'
        : isGrok
          ? 'grok'
          : 'anthropic'

  return (
    <BaseDialog
      show={show}
      title={t('admin.accounts.reAuthorizeAccount')}
      width="normal"
      onClose={handleClose}
      footer={
        account ? (
          <div className={styles.footer}>
            <Button type="button" variant="secondary" onClick={handleClose}>
              {t('common.cancel')}
            </Button>
            {isManualInputMethod ? (
              <Button
                type="button"
                variant="primary"
                disabled={!canExchangeCode}
                loading={currentLoading}
                onClick={() => void handleExchangeCode()}
              >
                {currentLoading ? t('admin.accounts.oauth.verifying') : t('admin.accounts.oauth.completeAuth')}
              </Button>
            ) : null}
          </div>
        ) : null
      }
    >
      {account ? (
        <div className={styles.content}>
          {/* Account Info */}
          <div className={styles.infoRow}>
            <div className={styles.iconTile} data-platform={flowPlatform}>
              <PlatformIcon platform={flowPlatform} size="md" />
            </div>
            <div className={styles.infoText}>
              <span className={styles.accountName}>{account.name}</span>
              <span className={styles.muted}>{platformLabel}</span>
            </div>
          </div>

          {/* Add Method Selection (Claude only) */}
          {isAnthropic ? (
            <RadioGroup
              label={t('admin.accounts.oauth.authMethod')}
              name="reauth-add-method"
              value={addMethod}
              onValueChange={(value) => setAddMethod(value as AddMethod)}
              options={[
                { value: 'oauth', label: t('admin.accounts.types.oauth') },
                { value: 'setup-token', label: t('admin.accounts.setupTokenLongLived') }
              ]}
            />
          ) : null}

          {/* Gemini OAuth Type Display (read-only) */}
          {isGemini ? (
            <div className={styles.geminiType}>
              <div className={styles.geminiLabel}>{t('admin.accounts.oauth.gemini.oauthTypeLabel')}</div>
              <div className={styles.infoRow}>
                <div className={styles.typeTile} data-type={geminiOAuthType}>
                  {geminiOAuthType === 'google_one' ? (
                    <User size={16} aria-hidden="true" />
                  ) : geminiOAuthType === 'code_assist' ? (
                    <Cloud size={16} aria-hidden="true" />
                  ) : (
                    <Sparkles size={16} aria-hidden="true" />
                  )}
                </div>
                <div className={styles.infoText}>
                  <span className={styles.typeTitle}>
                    {geminiOAuthType === 'google_one'
                      ? 'Google One'
                      : geminiOAuthType === 'code_assist'
                        ? t('admin.accounts.gemini.oauthType.builtInTitle')
                        : t('admin.accounts.gemini.oauthType.customTitle')}
                  </span>
                  <span className={styles.typeDesc}>
                    {geminiOAuthType === 'google_one'
                      ? t('admin.accounts.gemini.oauthType.googleOneDesc')
                      : geminiOAuthType === 'code_assist'
                        ? t('admin.accounts.gemini.oauthType.builtInDesc')
                        : t('admin.accounts.gemini.oauthType.customDesc')}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          <OAuthAuthorizationFlow
            ref={oauthFlowRef}
            addMethod={addMethod}
            authUrl={currentAuthUrl}
            sessionId={currentSessionId}
            loading={currentLoading}
            error={currentError}
            showHelp={isAnthropic}
            showProxyWarning={isAnthropic}
            showCookieOption={isAnthropic}
            showRefreshTokenOption={isOpenAI || isAntigravity || isGrok}
            showSsoOption={isGrok}
            showEmailPasswordOption={false}
            allowMultiple={false}
            methodLabel={t('admin.accounts.inputMethod')}
            platform={flowPlatform}
            showProjectId={isGemini && geminiOAuthType === 'code_assist'}
            initialInputMethod={grokInitialInputMethod}
            onGenerateUrl={() => void handleGenerateUrl()}
            onCookieAuth={(sessionKey) => void handleCookieAuth(sessionKey)}
            onValidateRefreshToken={(refreshToken) => void handleValidateRefreshToken(refreshToken)}
            onImportSso={(content) => void handleGrokImportSSO(content)}
            onStateChange={setFlowState}
          />
        </div>
      ) : null}
    </BaseDialog>
  )
}
