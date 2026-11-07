/**
 * MCP 授权页要求登录：各登录入口都必须把完整的授权查询串原样带回授权页。
 * 对应 Vue 版 views/auth/__tests__/MCPLoginRedirect.spec.ts。
 */
import { fireEvent, screen } from '@testing-library/react'
import type { ComponentType, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildOAuthLoginStartURL, type OAuthLoginStart } from '@/api/auth'
import DingTalkOAuthSection from '@/components/auth/DingTalkOAuthSection'
import EmailOAuthButtons from '@/components/auth/EmailOAuthButtons'
import LinuxDoOAuthSection from '@/components/auth/LinuxDoOAuthSection'
import OidcOAuthSection from '@/components/auth/OidcOAuthSection'
import WechatOAuthSection from '@/components/auth/WechatOAuthSection'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import LoginView from '@/views/auth/LoginView'
import OAuthCallbackView from '@/views/auth/OAuthCallbackView'
import { flushPromises, query, renderAt, setValue } from './authTestUtils'

const { navigateMock, exchangeCompletionMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  exchangeCompletionMock: vi.fn()
}))

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigateMock
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: 'en', setLocale: vi.fn() })
}))

vi.mock('@/layouts/AuthLayout', () => ({
  AuthFooter: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/api/client', () => ({ apiClient: { post: vi.fn() } }))

vi.mock('@/api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/auth')>()),
  getPublicSettings: vi.fn().mockResolvedValue({ registration_enabled: false }),
  isTotp2FARequired: () => false,
  resolveWeChatOAuthStart: () => ({ mode: 'open', unavailableReason: null }),
  exchangePendingOAuthCompletion: (...args: unknown[]) => exchangeCompletionMock(...args),
  persistOAuthTokenContext: vi.fn()
}))

vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copyToClipboard: vi.fn() }) }))

const authorizationPath = '/oauth/mcp/authorize?' + new URLSearchParams({
  response_type: 'code',
  client_id: 'desktop',
  redirect_uri: 'http://127.0.0.1:54321/callback',
  resource: 'https://api.example.com/api/v1/mcp',
  state: 'opaque+a&b=c',
  code_challenge: 'a'.repeat(43),
  code_challenge_method: 'S256'
}).toString()
const loginEntry = query('/login', { redirect: authorizationPath })
const originalLocation = window.location

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
  useAuthStore.setState({ login: vi.fn().mockResolvedValue({}), loginWithPasskey: vi.fn(), login2FA: vi.fn(), setToken: vi.fn() })
  useAppStore.setState({ showError: vi.fn(), showSuccess: vi.fn(), showWarning: vi.fn(), cachedPublicSettings: null, publicSettingsLoaded: true })
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, href: 'https://platform.example.com/auth/callback', hash: '' }
  })
})
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
})

describe('MCP authorization through existing sign-in flows', () => {
  it('returns to the original OAuth query after password login', async () => {
    renderAt(<LoginView />, loginEntry)
    await flushPromises()
    setValue(document.querySelector('#email')!, 'user@example.com')
    setValue(document.querySelector('#password')!, 'local-test-password')
    fireEvent.submit(document.querySelector('form')!)
    await flushPromises()
    expect(useAuthStore.getState().login).toHaveBeenCalledTimes(1)
    expect(navigateMock).toHaveBeenCalledWith(authorizationPath)
  })

  type StartProps = { onStart: (request: OAuthLoginStart) => void; githubEnabled?: boolean; googleEnabled?: boolean }
  it.each([
    ['github', EmailOAuthButtons, { githubEnabled: true }],
    ['google', EmailOAuthButtons, { googleEnabled: true }],
    ['linuxdo', LinuxDoOAuthSection, {}],
    ['oidc', OidcOAuthSection, {}],
    ['dingtalk', DingTalkOAuthSection, {}],
    ['wechat', WechatOAuthSection, {}]
  ] as [string, ComponentType<StartProps>, Partial<StartProps>][])(
    'preserves the entire return path when starting %s sign-in',
    (provider, Component, props) => {
      const onStart = vi.fn()
      renderAt(<Component {...props} onStart={onStart} />, loginEntry)
      fireEvent.click(screen.getByRole('button'))
      const request = onStart.mock.calls[0]?.[0] as OAuthLoginStart
      expect(request.provider).toBe(provider)
      expect(request.params.redirect).toBe(authorizationPath)
      const start = new URL(buildOAuthLoginStartURL(request), 'https://platform.example.com')
      expect(start.searchParams.get('redirect')).toBe(authorizationPath)
    }
  )

  it('returns from successful social sign-in to the intact OAuth consent request', async () => {
    exchangeCompletionMock.mockResolvedValue({ access_token: 'test-session', redirect: authorizationPath })
    renderAt(<OAuthCallbackView />, '/auth/oauth/callback')
    await flushPromises()
    expect(navigateMock).toHaveBeenCalledWith(authorizationPath, { replace: true })
  })
})
