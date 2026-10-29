import { t } from '@/i18n'
import { useAppStore } from '@/stores/app'
import { createObservableState, useObservableInstance } from './useObservableState'
import { adminAPI } from '@/api/admin'
import { extractApiErrorMessage } from '@/utils/apiError'
import type { GeminiOAuthCapabilities } from '@/api/admin/gemini'

export interface GeminiTokenInfo {
  access_token?: string
  refresh_token?: string
  token_type?: string
  scope?: string
  expires_at?: number | string
  project_id?: string
  oauth_type?: string
  tier_id?: string
  extra?: Record<string, unknown>
  [key: string]: unknown
}

interface FlowState {
  authUrl: string
  sessionId: string
  state: string
  loading: boolean
  error: string
}

const initialState = (): FlowState => ({ authUrl: '', sessionId: '', state: '', loading: false, error: '' })

export function createGeminiOAuth() {
  const observable = createObservableState<FlowState>(initialState())
  const s = () => observable.get()
  const set = observable.set

  const resetState = () => {
    set(initialState())
  }

  const generateAuthUrl = async (
    proxyId: number | null | undefined,
    projectId?: string | null,
    oauthType?: string,
    tierId?: string
  ): Promise<boolean> => {
    set({ loading: true, authUrl: '', sessionId: '', state: '', error: '' })

    try {
      const payload: Record<string, unknown> = {}
      if (proxyId) payload.proxy_id = proxyId
      const trimmedProjectID = projectId?.trim()
      if (trimmedProjectID) payload.project_id = trimmedProjectID
      if (oauthType) payload.oauth_type = oauthType
      const trimmedTierID = tierId?.trim()
      if (trimmedTierID) payload.tier_id = trimmedTierID

      const response = await adminAPI.gemini.generateAuthUrl(payload as any)
      set({ authUrl: response.auth_url, sessionId: response.session_id, state: response.state })
      return true
    } catch (err: unknown) {
      set({ error: extractApiErrorMessage(err, t('admin.accounts.oauth.gemini.failedToGenerateUrl')) })
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
    oauthType?: string
    tierId?: string
  }): Promise<GeminiTokenInfo | null> => {
    const code = params.code?.trim()
    if (!code || !params.sessionId || !params.state) {
      set({ error: t('admin.accounts.oauth.gemini.missingExchangeParams') })
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
      if (params.oauthType) payload.oauth_type = params.oauthType
      const trimmedTierID = params.tierId?.trim()
      if (trimmedTierID) payload.tier_id = trimmedTierID

      const tokenInfo = await adminAPI.gemini.exchangeCode(payload as any)
      return tokenInfo as GeminiTokenInfo
    } catch (err: any) {
      // Check for specific missing project_id error
      const errorMessage = err.message || err.response?.data?.message || ''
      if (errorMessage.includes('missing project_id')) {
        set({ error: t('admin.accounts.oauth.gemini.missingProjectId') })
      } else {
        set({ error: errorMessage || t('admin.accounts.oauth.gemini.failedToExchangeCode') })
      }
      useAppStore.getState().showError(s().error)
      return null
    } finally {
      set({ loading: false })
    }
  }

  const buildCredentials = (tokenInfo: GeminiTokenInfo): Record<string, unknown> => {
    let expiresAt: string | undefined
    if (typeof tokenInfo.expires_at === 'number' && Number.isFinite(tokenInfo.expires_at)) {
      expiresAt = Math.floor(tokenInfo.expires_at).toString()
    } else if (typeof tokenInfo.expires_at === 'string' && tokenInfo.expires_at.trim()) {
      expiresAt = tokenInfo.expires_at.trim()
    }

    return {
      access_token: tokenInfo.access_token,
      refresh_token: tokenInfo.refresh_token,
      token_type: tokenInfo.token_type,
      expires_at: expiresAt,
      scope: tokenInfo.scope,
      project_id: tokenInfo.project_id,
      oauth_type: tokenInfo.oauth_type,
      tier_id: tokenInfo.tier_id
    }
  }

  const buildExtraInfo = (tokenInfo: GeminiTokenInfo): Record<string, unknown> | undefined => {
    if (!tokenInfo.extra || typeof tokenInfo.extra !== 'object') return undefined
    return tokenInfo.extra
  }

  const getCapabilities = async (): Promise<GeminiOAuthCapabilities | null> => {
    try {
      return await adminAPI.gemini.getCapabilities()
    } catch {
      // Capabilities are optional for older servers; don't block the UI.
      return null
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
    buildCredentials,
    buildExtraInfo,
    getCapabilities
  }
}

export type GeminiOAuth = ReturnType<typeof createGeminiOAuth>

export function useGeminiOAuth(): GeminiOAuth {
  return useObservableInstance(createGeminiOAuth)
}
