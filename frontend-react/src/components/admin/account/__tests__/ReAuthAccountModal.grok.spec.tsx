/**
 * Vue 版 ReAuthAccountModal.grok.spec.ts 通过读取 .vue 源码文本断言绑定关系；源码文本断言在 React 版无意义，
 * 这里把每条断言改写为等价的行为断言：捕获传给 OAuthAuthorizationFlow 的 props 并驱动其回调。
 */
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OAuthAuthorizationFlowProps, OAuthFlowState } from '@/components/account/OAuthAuthorizationFlow'
import type { Account } from '@/types'
import ReAuthAccountModal from '../ReAuthAccountModal'

const mocks = vi.hoisted(() => ({
  flowProps: null as OAuthAuthorizationFlowProps | null,
  validateSSOToken: vi.fn(),
  refreshGrokToken: vi.fn(),
  createFromSSO: vi.fn(),
  authorizePassword: vi.fn(),
  applyOAuthCredentials: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    grok: {
      validateSSOToken: mocks.validateSSOToken,
      refreshGrokToken: mocks.refreshGrokToken,
      createFromSSO: mocks.createFromSSO,
      authorizePassword: mocks.authorizePassword
    },
    accounts: { applyOAuthCredentials: mocks.applyOAuthCredentials }
  }
}))
vi.mock('@/stores/app', () => {
  const state = { showError: mocks.showError, showSuccess: mocks.showSuccess }
  return {
    useAppStore: Object.assign((selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state), {
      getState: () => state
    })
  }
})
const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))
vi.mock('@/components/account/OAuthAuthorizationFlow', () => ({
  default: (props: OAuthAuthorizationFlowProps) => {
    mocks.flowProps = props
    return null
  }
}))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

const grokAccount = (credentials: Record<string, unknown> = {}) =>
  ({ id: 7, name: 'grok-1', platform: 'grok', type: 'oauth', proxy_id: 3, credentials }) as unknown as Account

const flowState = (inputMethod: OAuthFlowState['inputMethod']): OAuthFlowState => ({
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
  inputMethod
})

function renderModal(account: Account) {
  const onClose = vi.fn()
  const onReauthorized = vi.fn()
  render(<ReAuthAccountModal show account={account} onClose={onClose} onReauthorized={onReauthorized} />)
  return { onClose, onReauthorized }
}

const flow = () => {
  if (!mocks.flowProps) throw new Error('OAuthAuthorizationFlow not rendered')
  return mocks.flowProps
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.flowProps = null
})

describe('ReAuthAccountModal Grok re-auth paths', () => {
  it('exposes SSO cookie and refresh-token options; password auth stays hidden', () => {
    renderModal(grokAccount())

    expect(flow().showSsoOption).toBe(true)
    expect(flow().showEmailPasswordOption).toBe(false)
    expect(flow().showRefreshTokenOption).toBe(true)
    expect(flow().onAuthorizePassword).toBeUndefined()
  })

  it('shows the refresh-token option for OpenAI / Antigravity / Grok only', () => {
    for (const [platform, expected] of [
      ['openai', true],
      ['antigravity', true],
      ['grok', true],
      ['gemini', false],
      ['anthropic', false]
    ] as const) {
      const view = render(
        <ReAuthAccountModal
          show
          account={{ ...grokAccount(), platform } as Account}
          onClose={vi.fn()}
          onReauthorized={vi.fn()}
        />
      )
      expect(flow().showRefreshTokenOption).toBe(expected)
      expect(flow().showSsoOption).toBe(platform === 'grok')
      view.unmount()
    }
  })

  it('wires SSO and RT reauth without batch account create', async () => {
    const updated = { id: 7, name: 'grok-1' } as Account
    mocks.validateSSOToken.mockResolvedValue({ access_token: 'at-sso', refresh_token: 'rt-new', email: 'a@x.ai' })
    mocks.applyOAuthCredentials.mockResolvedValue(updated)
    const sso = renderModal(grokAccount())

    // 多行输入只取第一条非空 SSO
    await act(async () => flow().onImportSso?.('\n  sso-cookie-1  \nsso-cookie-2'))
    await flushPromises()

    expect(mocks.validateSSOToken).toHaveBeenCalledWith('sso-cookie-1', 3)
    // Re-auth updates the existing account; must not call createFromSSO batch create
    expect(mocks.createFromSSO).not.toHaveBeenCalled()
    expect(mocks.applyOAuthCredentials).toHaveBeenCalledWith(7, {
      type: 'oauth',
      credentials: { access_token: 'at-sso', refresh_token: 'rt-new', email: 'a@x.ai' },
      extra: { email: 'a@x.ai' }
    })
    expect(mocks.showSuccess).toHaveBeenCalledWith('admin.accounts.reAuthorizedSuccess')
    expect(sso.onReauthorized).toHaveBeenCalledWith(updated)
    expect(sso.onClose).toHaveBeenCalled()

    vi.clearAllMocks()
    mocks.refreshGrokToken.mockResolvedValue({ access_token: 'at-rt', refresh_token: 'rt-2' })
    mocks.applyOAuthCredentials.mockResolvedValue(updated)
    await act(async () => flow().onValidateRefreshToken?.('rt-1\nrt-ignored'))
    await flushPromises()

    expect(mocks.refreshGrokToken).toHaveBeenCalledWith('rt-1', 3)
    expect(mocks.createFromSSO).not.toHaveBeenCalled()
    expect(mocks.applyOAuthCredentials).toHaveBeenCalledWith(7, {
      type: 'oauth',
      credentials: { access_token: 'at-rt', refresh_token: 'rt-2' },
      extra: {}
    })
  })

  it('reports an empty refresh token for Grok without calling the API', async () => {
    renderModal(grokAccount())

    await act(async () => flow().onValidateRefreshToken?.('  \n '))

    expect(mocks.refreshGrokToken).not.toHaveBeenCalled()
    expect(flow().error).toBe('admin.accounts.oauth.grok.pleaseEnterRefreshToken')
  })

  it('hides footer code-exchange button for SSO/RT input methods', () => {
    renderModal(grokAccount())
    const completeButton = () => screen.queryByRole('button', { name: 'admin.accounts.oauth.completeAuth' })

    act(() => flow().onStateChange?.(flowState('manual')))
    expect(completeButton()).not.toBeNull()

    act(() => flow().onStateChange?.(flowState('sso_cookie')))
    expect(completeButton()).toBeNull()

    act(() => flow().onStateChange?.(flowState('refresh_token')))
    expect(completeButton()).toBeNull()
  })

  it('defaults reauth to refresh_token or sso_cookie (not password)', () => {
    const cases: Array<[Account, string]> = [
      [grokAccount({ refresh_token: 'rt' }), 'refresh_token'],
      [grokAccount({ has_refresh_token: true }), 'refresh_token'],
      [grokAccount({ refresh_token: '   ' }), 'sso_cookie'],
      [grokAccount(), 'sso_cookie'],
      [{ ...grokAccount({ refresh_token: 'rt' }), platform: 'openai' } as Account, 'manual']
    ]
    for (const [account, expected] of cases) {
      const view = render(<ReAuthAccountModal show account={account} onClose={vi.fn()} onReauthorized={vi.fn()} />)
      expect(flow().initialInputMethod).toBe(expected)
      expect(flow().initialEmailPassword).toBeUndefined()
      view.unmount()
    }
  })
})
