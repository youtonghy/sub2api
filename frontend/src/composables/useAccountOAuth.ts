import { adminAPI } from '@/api/admin'
import { useAppStore } from '@/stores/app'
import { createObservableState, useObservableInstance } from './useObservableState'

export type AddMethod = 'oauth' | 'setup-token'
export type AuthInputMethod =
  | 'manual'
  | 'cookie'
  | 'refresh_token'
  | 'mobile_refresh_token'
  | 'session_token'
  | 'access_token'
  | 'codex_session'
  | 'agent_identity'
  | 'codex_pat'
  | 'sso_cookie'
  | 'email_password'

export interface OAuthState {
  authUrl: string
  authCode: string
  sessionId: string
  sessionKey: string
  loading: boolean
  error: string
}

export interface TokenInfo {
  org_uuid?: string
  account_uuid?: string
  email_address?: string
  [key: string]: unknown
}

const initialState = (): OAuthState => ({
  authUrl: '',
  authCode: '',
  sessionId: '',
  sessionKey: '',
  loading: false,
  error: ''
})

/**
 * Anthropic OAuth / Setup Token 流程状态（对应 Vue 版 useAccountOAuth）。
 * 状态字段为只读 getter，总是返回最新值；用 setAuthCode/setSessionKey 写入输入值。
 */
export function createAccountOAuth() {
  const observable = createObservableState<OAuthState>(initialState())
  const s = () => observable.get()
  const set = observable.set

  // Reset state
  const resetState = () => {
    set(initialState())
  }

  // Generate auth URL
  const generateAuthUrl = async (addMethod: AddMethod, proxyId?: number | null): Promise<boolean> => {
    set({ loading: true, authUrl: '', sessionId: '', error: '' })

    try {
      const proxyConfig = proxyId ? { proxy_id: proxyId } : {}
      const endpoint =
        addMethod === 'oauth' ? '/admin/accounts/generate-auth-url' : '/admin/accounts/generate-setup-token-url'

      const response = await adminAPI.accounts.generateAuthUrl(endpoint, proxyConfig)
      set({ authUrl: response.auth_url, sessionId: response.session_id })
      return true
    } catch (err: any) {
      set({ error: err.response?.data?.detail || 'Failed to generate auth URL' })
      useAppStore.getState().showError(s().error)
      return false
    } finally {
      set({ loading: false })
    }
  }

  // Exchange auth code for tokens
  const exchangeAuthCode = async (addMethod: AddMethod, proxyId?: number | null): Promise<TokenInfo | null> => {
    if (!s().authCode.trim() || !s().sessionId) {
      set({ error: 'Missing auth code or session ID' })
      return null
    }

    set({ loading: true, error: '' })

    try {
      const proxyConfig = proxyId ? { proxy_id: proxyId } : {}
      const endpoint =
        addMethod === 'oauth' ? '/admin/accounts/exchange-code' : '/admin/accounts/exchange-setup-token-code'

      const tokenInfo = await adminAPI.accounts.exchangeCode(endpoint, {
        session_id: s().sessionId,
        code: s().authCode.trim(),
        ...proxyConfig
      })

      return tokenInfo as TokenInfo
    } catch (err: any) {
      set({ error: err.response?.data?.detail || 'Failed to exchange auth code' })
      useAppStore.getState().showError(s().error)
      return null
    } finally {
      set({ loading: false })
    }
  }

  // Cookie-based authentication
  const cookieAuth = async (
    addMethod: AddMethod,
    sessionKeyValue: string,
    proxyId?: number | null
  ): Promise<TokenInfo | null> => {
    if (!sessionKeyValue.trim()) {
      set({ error: 'Please enter sessionKey' })
      return null
    }

    set({ loading: true, error: '' })

    try {
      const proxyConfig = proxyId ? { proxy_id: proxyId } : {}
      const endpoint =
        addMethod === 'oauth' ? '/admin/accounts/cookie-auth' : '/admin/accounts/setup-token-cookie-auth'

      const tokenInfo = await adminAPI.accounts.exchangeCode(endpoint, {
        session_id: '',
        code: sessionKeyValue.trim(),
        ...proxyConfig
      })

      return tokenInfo as TokenInfo
    } catch (err: any) {
      set({ error: err.response?.data?.detail || 'Cookie authorization failed' })
      return null
    } finally {
      set({ loading: false })
    }
  }

  // Parse multiple session keys
  const parseSessionKeys = (input: string): string[] => {
    return input
      .split('\n')
      .map((k) => k.trim())
      .filter((k) => k)
  }

  // Build extra info from token response
  const buildExtraInfo = (tokenInfo: TokenInfo): Record<string, string> | undefined => {
    const extra: Record<string, string> = {}
    if (tokenInfo.org_uuid) {
      extra.org_uuid = tokenInfo.org_uuid
    }
    if (tokenInfo.account_uuid) {
      extra.account_uuid = tokenInfo.account_uuid
    }
    if (tokenInfo.email_address) {
      extra.email_address = tokenInfo.email_address
    }
    return Object.keys(extra).length > 0 ? extra : undefined
  }

  return {
    observable,
    // State
    get authUrl() {
      return s().authUrl
    },
    get authCode() {
      return s().authCode
    },
    get sessionId() {
      return s().sessionId
    },
    get sessionKey() {
      return s().sessionKey
    },
    get loading() {
      return s().loading
    },
    get error() {
      return s().error
    },
    setAuthCode: (value: string) => set({ authCode: value }),
    setSessionKey: (value: string) => set({ sessionKey: value }),
    // Methods
    resetState,
    generateAuthUrl,
    exchangeAuthCode,
    cookieAuth,
    parseSessionKeys,
    buildExtraInfo
  }
}

export type AccountOAuth = ReturnType<typeof createAccountOAuth>

export function useAccountOAuth(): AccountOAuth {
  return useObservableInstance(createAccountOAuth)
}
