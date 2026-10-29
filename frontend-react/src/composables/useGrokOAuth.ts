import { t } from '@/i18n'
import { useAppStore } from '@/stores/app'
import { createObservableState, useObservableInstance } from './useObservableState'
import { adminAPI } from '@/api/admin'
import type { GrokTokenInfo } from '@/api/admin/grok'
import { extractApiErrorMessage, extractI18nErrorMessage } from '@/utils/apiError'

interface FlowState {
  authUrl: string
  sessionId: string
  state: string
  loading: boolean
  error: string
}

const initialState = (): FlowState => ({ authUrl: '', sessionId: '', state: '', loading: false, error: '' })

export function createGrokOAuth() {
  const observable = createObservableState<FlowState>(initialState())
  const s = () => observable.get()
  const set = observable.set

  const resetState = () => {
    set(initialState())
  }

  const generateAuthUrl = async (proxyId: number | null | undefined): Promise<boolean> => {
    set({ loading: true, authUrl: '', sessionId: '', state: '', error: '' })

    try {
      const payload: Record<string, unknown> = {}
      if (proxyId) payload.proxy_id = proxyId

      const response = await adminAPI.grok.generateAuthUrl(payload)
      set({ authUrl: response.auth_url, sessionId: response.session_id, state: response.state })
      return true
    } catch (err: any) {
      set({ error: extractApiErrorMessage(err, t('admin.accounts.oauth.grok.failedToGenerateUrl')) })
      useAppStore.getState().showError(s().error)
      return false
    } finally {
      set({ loading: false })
    }
  }

  const exchangeAuthCode = async (params: {
    code: string
    sessionId: string
    state: string
    proxyId?: number | null
  }): Promise<GrokTokenInfo | null> => {
    const code = params.code?.trim()
    if (!code || !params.sessionId || !params.state) {
      set({ error: t('admin.accounts.oauth.grok.missingExchangeParams') })
      return null
    }

    set({ loading: true, error: '' })

    try {
      const payload: Record<string, unknown> = {
        session_id: params.sessionId,
        state: params.state,
        code
      }
      if (params.proxyId) payload.proxy_id = params.proxyId

      return await adminAPI.grok.exchangeCode(payload as any)
    } catch (err: any) {
      set({
        error: extractI18nErrorMessage(err, t, 'admin.accounts.oauth.grok.errors', t('admin.accounts.oauth.grok.failedToExchangeCode'))
      })
      useAppStore.getState().showError(s().error)
      return null
    } finally {
      set({ loading: false })
    }
  }

  const validateRefreshToken = async (
    refreshToken: string,
    proxyId?: number | null
  ): Promise<GrokTokenInfo | null> => {
    if (!refreshToken.trim()) {
      set({ error: t('admin.accounts.oauth.grok.pleaseEnterRefreshToken') })
      return null
    }

    set({ loading: true, error: '' })

    try {
      return await adminAPI.grok.refreshGrokToken(refreshToken.trim(), proxyId)
    } catch (err: any) {
      set({
        error: extractI18nErrorMessage(err, t, 'admin.accounts.oauth.grok.errors', t('admin.accounts.oauth.grok.failedToValidateRT'))
      })
      return null
    } finally {
      set({ loading: false })
    }
  }

  // Build account credentials for create/re-auth. Never persist raw SSO cookies
  // or passwords: those exist only for the one-shot authorize API call.
  const buildCredentials = (tokenInfo: GrokTokenInfo): Record<string, unknown> => {
    const credentials: Record<string, unknown> = {
      access_token: tokenInfo.access_token,
      token_type: tokenInfo.token_type,
      expires_at: tokenInfo.expires_at,
      client_id: tokenInfo.client_id,
      scope: tokenInfo.scope,
      email: tokenInfo.email,
      sub: tokenInfo.sub,
      team_id: tokenInfo.team_id,
      subscription_tier: tokenInfo.subscription_tier,
      entitlement_status: tokenInfo.entitlement_status,
      // Leave base_url unset so system/CLI mode can choose the correct host.
    }
    if (tokenInfo.refresh_token) credentials.refresh_token = tokenInfo.refresh_token
    if (tokenInfo.id_token) credentials.id_token = tokenInfo.id_token
    const blocked = new Set(['sso_token', 'password', 'sso', 'sso-rw'])
    return Object.fromEntries(
      Object.entries(credentials).filter(
        ([key, value]) => !blocked.has(key) && value !== undefined && value !== ''
      )
    )
  }

  const buildExtraInfo = (tokenInfo: GrokTokenInfo): Record<string, unknown> => {
    const extra: Record<string, unknown> = {}
    if (tokenInfo.email) extra.email = tokenInfo.email
    if (tokenInfo.subscription_tier) extra.subscription_tier = tokenInfo.subscription_tier
    if (tokenInfo.entitlement_status) extra.entitlement_status = tokenInfo.entitlement_status
    return extra
  }

  const validateSSOToken = async (
    ssoToken: string,
    proxyId?: number | null
  ): Promise<GrokTokenInfo | null> => {
    if (!ssoToken.trim()) {
      set({ error: t('admin.accounts.oauth.grok.pleaseEnterSSOToken', 'Please enter an SSO token') })
      return null
    }
    set({ loading: true, error: '' })
    try {
      return await adminAPI.grok.validateSSOToken(ssoToken.trim(), proxyId)
    } catch (err: any) {
      set({
        error: extractI18nErrorMessage(err, t, 'admin.accounts.oauth.grok.errors', t('admin.accounts.oauth.grok.failedToValidateSSO', 'Failed to validate SSO token'))
      })
      useAppStore.getState().showError(s().error)
      return null
    } finally {
      set({ loading: false })
    }
  }

  const authorizePassword = async (
    emailAndPassword: string,
    proxyId?: number | null
  ): Promise<GrokTokenInfo | null> => {
    if (!emailAndPassword.trim()) {
      set({ error: t('admin.accounts.oauth.grok.pleaseEnterPassword', 'Please enter email----password') })
      return null
    }
    set({ loading: true, error: '' })
    try {
      return await adminAPI.grok.authorizePassword(emailAndPassword, proxyId)
    } catch (err: any) {
      set({
        error: extractI18nErrorMessage(err, t, 'admin.accounts.oauth.grok.errors', t('admin.accounts.oauth.grok.failedToAuthorizePassword', 'Password authorization failed'))
      })
      useAppStore.getState().showError(s().error)
      return null
    } finally {
      set({ loading: false })
    }
  }

  return {
    observable,
    get authUrl() {
      return s().authUrl
    },
    get sessionId() {
      return s().sessionId
    },
    get state() {
      return s().state
    },
    get loading() {
      return s().loading
    },
    get error() {
      return s().error
    },
    resetState,
    generateAuthUrl,
    exchangeAuthCode,
    validateRefreshToken,
    validateSSOToken,
    authorizePassword,
    buildCredentials,
    buildExtraInfo
  }
}

export type GrokOAuth = ReturnType<typeof createGrokOAuth>

export function useGrokOAuth(): GrokOAuth {
  return useObservableInstance(createGrokOAuth)
}
