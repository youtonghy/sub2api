import { t } from '@/i18n'
import { useAppStore } from '@/stores/app'
import { createObservableState, useObservableInstance } from './useObservableState'
import { adminAPI } from '@/api/admin'
import type { AntigravityTokenInfo } from '@/api/admin/antigravity'

interface FlowState {
  authUrl: string
  sessionId: string
  state: string
  loading: boolean
  error: string
}

const initialState = (): FlowState => ({ authUrl: '', sessionId: '', state: '', loading: false, error: '' })

export function createAntigravityOAuth() {
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

      const response = await adminAPI.antigravity.generateAuthUrl(payload as any)
      set({ authUrl: response.auth_url, sessionId: response.session_id, state: response.state })
      return true
    } catch (err: any) {
      set({ error: err.response?.data?.detail || t('admin.accounts.oauth.antigravity.failedToGenerateUrl') })
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
  }): Promise<AntigravityTokenInfo | null> => {
    const code = params.code?.trim()
    if (!code || !params.sessionId || !params.state) {
      set({ error: t('admin.accounts.oauth.antigravity.missingExchangeParams') })
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

      const tokenInfo = await adminAPI.antigravity.exchangeCode(payload as any)
      return tokenInfo as AntigravityTokenInfo
    } catch (err: any) {
      set({ error: err.response?.data?.detail || t('admin.accounts.oauth.antigravity.failedToExchangeCode') })
      useAppStore.getState().showError(s().error)
      return null
    } finally {
      set({ loading: false })
    }
  }

  const validateRefreshToken = async (
    refreshToken: string,
    proxyId?: number | null
  ): Promise<AntigravityTokenInfo | null> => {
    if (!refreshToken.trim()) {
      set({ error: t('admin.accounts.oauth.antigravity.pleaseEnterRefreshToken') })
      return null
    }

    set({ loading: true, error: '' })

    try {
      const tokenInfo = await adminAPI.antigravity.refreshAntigravityToken(
        refreshToken.trim(),
        proxyId
      )
      return tokenInfo as AntigravityTokenInfo
    } catch (err: any) {
      set({ error: err.response?.data?.detail || t('admin.accounts.oauth.antigravity.failedToValidateRT') })
      // Don't show global error toast for batch validation to avoid spamming
      // appStore.showError(error.value)
      return null
    } finally {
      set({ loading: false })
    }
  }

  const buildCredentials = (
    tokenInfo: AntigravityTokenInfo,
    fallbackRefreshToken?: string
  ): Record<string, unknown> => {
    let expiresAt: string | undefined
    if (typeof tokenInfo.expires_at === 'number' && Number.isFinite(tokenInfo.expires_at)) {
      expiresAt = Math.floor(tokenInfo.expires_at).toString()
    } else if (typeof tokenInfo.expires_at === 'string' && tokenInfo.expires_at.trim()) {
      expiresAt = tokenInfo.expires_at.trim()
    }
    const refreshToken = tokenInfo.refresh_token?.trim()
      ? tokenInfo.refresh_token
      : fallbackRefreshToken

    return {
      access_token: tokenInfo.access_token,
      refresh_token: refreshToken,
      token_type: tokenInfo.token_type,
      expires_at: expiresAt,
      project_id: tokenInfo.project_id,
      email: tokenInfo.email,
      ...(tokenInfo.plan_type ? { plan_type: tokenInfo.plan_type } : {})
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
    buildCredentials
  }
}

export type AntigravityOAuth = ReturnType<typeof createAntigravityOAuth>

export function useAntigravityOAuth(): AntigravityOAuth {
  return useObservableInstance(createAntigravityOAuth)
}
