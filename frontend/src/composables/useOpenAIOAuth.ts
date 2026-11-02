import { adminAPI } from '@/api/admin'
import { t } from '@/i18n'
import { useAppStore } from '@/stores/app'
import { extractApiErrorMessage, extractI18nErrorMessage } from '@/utils/apiError'
import { createObservableState, useObservableInstance } from './useObservableState'

export interface OpenAITokenInfo {
  access_token?: string
  refresh_token?: string
  client_id?: string
  id_token?: string
  token_type?: string
  expires_in?: number
  expires_at?: number
  scope?: string
  email?: string
  name?: string
  plan_type?: string
  subscription_expires_at?: string
  privacy_mode?: string
  // OpenAI specific IDs (extracted from ID Token)
  chatgpt_account_id?: string
  chatgpt_user_id?: string
  organization_id?: string
  [key: string]: unknown
}

export type OpenAIOAuthPlatform = 'openai'

interface OpenAIOAuthState {
  authUrl: string
  sessionId: string
  oauthState: string
  loading: boolean
  error: string
}

const initialState = (): OpenAIOAuthState => ({
  authUrl: '',
  sessionId: '',
  oauthState: '',
  loading: false,
  error: ''
})

/** OpenAI OAuth 流程（对应 Vue 版 useOpenAIOAuth）；状态字段为只读 getter，总是返回最新值 */
export function createOpenAIOAuth() {
  const endpointPrefix = '/admin/openai'
  const observable = createObservableState<OpenAIOAuthState>(initialState())
  const s = () => observable.get()
  const set = observable.set

  // Reset state
  const resetState = () => {
    set(initialState())
  }

  // Generate auth URL for OpenAI OAuth
  const generateAuthUrl = async (proxyId?: number | null, redirectUri?: string): Promise<boolean> => {
    set({ loading: true, authUrl: '', sessionId: '', oauthState: '', error: '' })

    try {
      const payload: Record<string, unknown> = {}
      if (proxyId) {
        payload.proxy_id = proxyId
      }
      if (redirectUri) {
        payload.redirect_uri = redirectUri
      }

      const response = await adminAPI.accounts.generateAuthUrl(`${endpointPrefix}/generate-auth-url`, payload)
      let oauthState = ''
      try {
        const parsed = new URL(response.auth_url)
        oauthState = parsed.searchParams.get('state') || ''
      } catch {
        oauthState = ''
      }
      set({ authUrl: response.auth_url, sessionId: response.session_id, oauthState })
      return true
    } catch (err: any) {
      set({ error: extractApiErrorMessage(err, t('admin.accounts.oauth.openai.failedToGenerateUrl')) })
      useAppStore.getState().showError(s().error)
      return false
    } finally {
      set({ loading: false })
    }
  }

  // Exchange auth code for tokens
  const exchangeAuthCode = async (
    code: string,
    currentSessionId: string,
    state: string,
    proxyId?: number | null
  ): Promise<OpenAITokenInfo | null> => {
    if (!code.trim() || !currentSessionId || !state.trim()) {
      set({ error: 'Missing auth code, session ID, or state' })
      return null
    }

    set({ loading: true, error: '' })

    try {
      const payload: { session_id: string; code: string; state: string; proxy_id?: number } = {
        session_id: currentSessionId,
        code: code.trim(),
        state: state.trim()
      }
      if (proxyId) {
        payload.proxy_id = proxyId
      }

      const tokenInfo = await adminAPI.accounts.exchangeCode(`${endpointPrefix}/exchange-code`, payload)
      return tokenInfo as OpenAITokenInfo
    } catch (err: any) {
      set({
        error: extractI18nErrorMessage(
          err,
          t,
          'admin.accounts.oauth.openai.errors',
          t('admin.accounts.oauth.openai.failedToExchangeCode')
        )
      })
      useAppStore.getState().showError(s().error)
      return null
    } finally {
      set({ loading: false })
    }
  }

  // Validate refresh token and get full token info
  // clientId: 指定 OAuth client_id（用于第三方渠道获取的 RT，如 app_LlGpXReQgckcGGUo2JrYvtJK）
  const validateRefreshToken = async (
    refreshToken: string,
    proxyId?: number | null,
    clientId?: string
  ): Promise<OpenAITokenInfo | null> => {
    if (!refreshToken.trim()) {
      set({ error: 'Missing refresh token' })
      return null
    }

    set({ loading: true, error: '' })

    try {
      // Use dedicated refresh-token endpoint
      const tokenInfo = await adminAPI.accounts.refreshOpenAIToken(
        refreshToken.trim(),
        proxyId,
        `${endpointPrefix}/refresh-token`,
        clientId
      )
      return tokenInfo as OpenAITokenInfo
    } catch (err: any) {
      set({
        error: extractI18nErrorMessage(
          err,
          t,
          'admin.accounts.oauth.openai.errors',
          t('admin.accounts.oauth.openai.failedToValidateRT')
        )
      })
      useAppStore.getState().showError(s().error)
      return null
    } finally {
      set({ loading: false })
    }
  }

  // Build credentials for OpenAI OAuth account (aligned with backend BuildAccountCredentials)
  const buildCredentials = (tokenInfo: OpenAITokenInfo): Record<string, unknown> => {
    const creds: Record<string, unknown> = {
      access_token: tokenInfo.access_token,
      expires_at: tokenInfo.expires_at
    }

    // 仅在返回了新的 refresh_token 时才写入，防止用空值覆盖已有令牌
    if (tokenInfo.refresh_token) {
      creds.refresh_token = tokenInfo.refresh_token
    }
    if (tokenInfo.id_token) {
      creds.id_token = tokenInfo.id_token
    }
    if (tokenInfo.email) {
      creds.email = tokenInfo.email
    }
    if (tokenInfo.chatgpt_account_id) {
      creds.chatgpt_account_id = tokenInfo.chatgpt_account_id
    }
    if (tokenInfo.chatgpt_user_id) {
      creds.chatgpt_user_id = tokenInfo.chatgpt_user_id
    }
    if (tokenInfo.organization_id) {
      creds.organization_id = tokenInfo.organization_id
    }
    if (tokenInfo.plan_type) {
      creds.plan_type = tokenInfo.plan_type
    }
    if (tokenInfo.subscription_expires_at) {
      creds.subscription_expires_at = tokenInfo.subscription_expires_at
    }
    if (tokenInfo.client_id) {
      creds.client_id = tokenInfo.client_id
    }

    return creds
  }

  // Build extra info from token response
  const buildExtraInfo = (tokenInfo: OpenAITokenInfo): Record<string, string> | undefined => {
    const extra: Record<string, string> = {}
    if (tokenInfo.email) {
      extra.email = tokenInfo.email
    }
    if (tokenInfo.name) {
      extra.name = tokenInfo.name
    }
    if (tokenInfo.privacy_mode) {
      extra.privacy_mode = tokenInfo.privacy_mode
    }
    return Object.keys(extra).length > 0 ? extra : undefined
  }

  return {
    observable,
    // State
    get authUrl() {
      return s().authUrl
    },
    get sessionId() {
      return s().sessionId
    },
    get oauthState() {
      return s().oauthState
    },
    get loading() {
      return s().loading
    },
    get error() {
      return s().error
    },
    // Methods
    resetState,
    generateAuthUrl,
    exchangeAuthCode,
    validateRefreshToken,
    buildCredentials,
    buildExtraInfo
  }
}

export type OpenAIOAuth = ReturnType<typeof createOpenAIOAuth>

export function useOpenAIOAuth(): OpenAIOAuth {
  return useObservableInstance(createOpenAIOAuth)
}
