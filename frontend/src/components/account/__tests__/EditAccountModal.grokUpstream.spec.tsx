import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { updateAccountMock, checkMixedChannelRiskMock, authIsSimpleMode } = vi.hoisted(() => ({
  updateAccountMock: vi.fn(),
  checkMixedChannelRiskMock: vi.fn(),
  authIsSimpleMode: { value: true }
}))

vi.mock('@/stores/app', () => {
  const store = { showError: vi.fn(), showSuccess: vi.fn(), showInfo: vi.fn(), showWarning: vi.fn() }
  return { useAppStore: Object.assign((selector: (s: typeof store) => unknown) => selector(store), { getState: () => store }) }
})

vi.mock('@/stores/auth', () => {
  const state = () => ({ isSimpleMode: authIsSimpleMode.value })
  return { useAuthStore: Object.assign((selector: (s: ReturnType<typeof state>) => unknown) => selector(state()), { getState: state }) }
})

vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      update: updateAccountMock,
      checkMixedChannelRisk: checkMixedChannelRiskMock
    },
    settings: {
      getWebSearchEmulationConfig: vi.fn().mockResolvedValue({ enabled: false, providers: [] }),
      getSettings: vi.fn().mockResolvedValue({})
    },
    tlsFingerprintProfiles: {
      list: vi.fn().mockResolvedValue([])
    }
  }
}))

vi.mock('@/api/admin/accounts', () => ({
  getAntigravityDefaultModelMapping: vi.fn()
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: 'en', setLocale: vi.fn() })
}))

// Vue 版 BaseDialog 桩：show 时直接渲染内容与 footer
vi.mock('../AccountFormLayout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../AccountFormLayout')>()
  return {
    ...actual,
    AccountFormDrawer: ({ show, children, footer }: { show: boolean; children: ReactNode; footer?: ReactNode }) =>
      show ? (
        <div>
          {children}
          {footer}
        </div>
      ) : null
  }
})

// Vue 版 stubs: Select / ProxySelector / GroupSelector / ModelWhitelistSelector
vi.mock('@/components/common/Select', () => ({ default: () => null }))
vi.mock('@/components/common/ProxySelector', () => ({ default: () => null }))
vi.mock('@/components/common/GroupSelector', () => ({ default: () => null }))
vi.mock('../ModelWhitelistSelector', () => ({ default: () => null }))

import EditAccountModal from '../EditAccountModal'

function buildGrokOAuthAccount(credentials: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    id: 5,
    name: 'Grok OAuth',
    notes: '',
    platform: 'grok',
    type: 'oauth',
    credentials: {
      expires_at: '2027-01-01T00:00:00Z',
      token_type: 'Bearer',
      ...credentials
    },
    credentials_status: { has_access_token: true, has_refresh_token: true },
    extra,
    proxy_id: null,
    concurrency: 1,
    priority: 1,
    rate_multiplier: 1,
    status: 'active',
    group_ids: [],
    expires_at: null,
    auto_pause_on_expired: false
  } as any
}

function mountModal(account: any) {
  const view = render(
    <EditAccountModal show account={account} proxies={[]} groups={[]} onClose={() => {}} onUpdated={() => {}} />
  )
  const q = (selector: string) => view.container.querySelector<HTMLElement>(selector)
  const get = (selector: string) => {
    const found = q(selector)
    if (!found) throw new Error(`Element not found: ${selector}`)
    return found
  }
  return {
    q,
    get,
    findAll: (selector: string) => Array.from(view.container.querySelectorAll<HTMLElement>(selector)),
    async click(target: string | HTMLElement) {
      const element = typeof target === 'string' ? get(target) : target
      await act(async () => {
        fireEvent.click(element)
      })
    },
    async setValue(selector: string, value: string) {
      await act(async () => {
        fireEvent.change(get(selector), { target: { value } })
      })
    },
    async submit() {
      await act(async () => {
        fireEvent.submit(get('form#edit-account-form'))
      })
    }
  }
}

afterEach(() => {
  cleanup()
})

describe('EditAccountModal Grok OAuth upstream config', () => {
  beforeEach(() => {
    authIsSimpleMode.value = true
    updateAccountMock.mockReset()
    checkMixedChannelRiskMock.mockReset()
    checkMixedChannelRiskMock.mockResolvedValue({ has_risk: false })
  })

  it('enabling the custom base URL toggle and saving persists base_url', async () => {
    const account = buildGrokOAuthAccount({ base_url: 'https://cli-chat-proxy.grok.com/v1' })
    updateAccountMock.mockResolvedValue(account)

    const wrapper = mountModal(account)

    // 官方地址 → 开关初始为关（视同未定制）
    await wrapper.click('[data-testid="grok-custom-base-url-toggle"]')

    await wrapper.setValue('[data-testid="grok-custom-base-url-input"]', 'https://my-relay.example.com')

    await wrapper.submit()
    await vi.waitFor(() => expect(updateAccountMock).toHaveBeenCalledTimes(1))

    const payload = updateAccountMock.mock.calls[0]?.[1]
    expect(payload?.credentials?.base_url).toBe('https://my-relay.example.com')
  })

  it('accepts the official API host as a manual endpoint switch and persists it', async () => {
    const account = buildGrokOAuthAccount({ base_url: 'https://cli-chat-proxy.grok.com/v1' })
    updateAccountMock.mockResolvedValue(account)

    const wrapper = mountModal(account)

    await wrapper.click('[data-testid="grok-custom-base-url-toggle"]')
    await wrapper.setValue('[data-testid="grok-custom-base-url-input"]', 'https://api.x.ai/v1')

    await wrapper.submit()
    await vi.waitFor(() => expect(updateAccountMock).toHaveBeenCalledTimes(1))

    const payload = updateAccountMock.mock.calls[0]?.[1]
    expect(payload?.credentials?.base_url).toBe('https://api.x.ai/v1')
  })

  it('echoes a stored official API endpoint with the toggle on', async () => {
    const account = buildGrokOAuthAccount({ base_url: 'https://us-west-2.api.x.ai/v1' })
    updateAccountMock.mockResolvedValue(account)

    const wrapper = mountModal(account)

    const input = wrapper.get('[data-testid="grok-custom-base-url-input"]') as HTMLInputElement
    expect(input.value).toBe('https://us-west-2.api.x.ai/v1')
  })

  it('fills the input from an endpoint preset chip', async () => {
    const account = buildGrokOAuthAccount({ base_url: 'https://cli-chat-proxy.grok.com/v1' })
    updateAccountMock.mockResolvedValue(account)

    const wrapper = mountModal(account)

    await wrapper.click('[data-testid="grok-custom-base-url-toggle"]')
    const presets = wrapper.findAll('[data-testid="grok-base-url-preset"]')
    expect(presets.length).toBe(5)

    // 第二个预设为官方 API (api.x.ai/v1)
    await wrapper.click(presets[1])
    const input = wrapper.get('[data-testid="grok-custom-base-url-input"]') as HTMLInputElement
    expect(input.value).toBe('https://api.x.ai/v1')
  })

  it('loads an existing custom base_url with the toggle on and keeps it on save', async () => {
    const account = buildGrokOAuthAccount({ base_url: 'https://my-relay.example.com' })
    updateAccountMock.mockResolvedValue(account)

    const wrapper = mountModal(account)

    const input = wrapper.get('[data-testid="grok-custom-base-url-input"]') as HTMLInputElement
    expect(input.value).toBe('https://my-relay.example.com')

    await wrapper.submit()
    await vi.waitFor(() => expect(updateAccountMock).toHaveBeenCalledTimes(1))

    const payload = updateAccountMock.mock.calls[0]?.[1]
    expect(payload?.credentials?.base_url).toBe('https://my-relay.example.com')
  })

  it('keeps stored header overrides intact on an untouched save', async () => {
    const account = buildGrokOAuthAccount({
      header_override_enabled: true,
      header_overrides: {
        'user-agent': 'grok-pager/0.2.93',
        'x-grok-client-identifier': 'grok-pager',
        'x-grok-client-version': '0.2.93',
        'x-xai-token-auth': 'xai-grok-cli'
      }
    })
    updateAccountMock.mockResolvedValue(account)

    const wrapper = mountModal(account)

    await wrapper.submit()
    await vi.waitFor(() => expect(updateAccountMock).toHaveBeenCalledTimes(1))

    const payload = updateAccountMock.mock.calls[0]?.[1]
    expect(payload?.credentials?.header_override_enabled).toBe(true)
    expect(payload?.credentials?.header_overrides).toEqual({
      'user-agent': 'grok-pager/0.2.93',
      'x-grok-client-identifier': 'grok-pager',
      'x-grok-client-version': '0.2.93',
      'x-xai-token-auth': 'xai-grok-cli'
    })
  })

  it('shows the client-tool cache switch only for Grok OAuth accounts', () => {
    const grokOAuthWrapper = mountModal(buildGrokOAuthAccount())
    expect(grokOAuthWrapper.q('[data-testid="grok-client-tool-cache-toggle"]')).not.toBeNull()

    const grokAPIKeyWrapper = mountModal({
      ...buildGrokOAuthAccount(),
      type: 'apikey',
      credentials: { api_key: 'xai-test', base_url: 'https://api.x.ai/v1' }
    })
    expect(grokAPIKeyWrapper.q('[data-testid="grok-client-tool-cache-toggle"]')).toBeNull()

    const openAIOAuthWrapper = mountModal({
      ...buildGrokOAuthAccount(),
      platform: 'openai'
    })
    expect(openAIOAuthWrapper.q('[data-testid="grok-client-tool-cache-toggle"]')).toBeNull()
  })

  it('loads and disables client-tool caching while preserving unrelated extra fields', async () => {
    const account = buildGrokOAuthAccount(
      {},
      {
        grok_client_tool_cache_enabled: true,
        custom_setting: 'keep-me'
      }
    )
    updateAccountMock.mockResolvedValue(account)

    const wrapper = mountModal(account)
    const toggle = wrapper.get('[data-testid="grok-client-tool-cache-toggle"]')
    expect(toggle.getAttribute('aria-checked')).toBe('true')

    await wrapper.click(toggle)
    await wrapper.submit()
    await vi.waitFor(() => expect(updateAccountMock).toHaveBeenCalledTimes(1))

    const payload = updateAccountMock.mock.calls[0]?.[1]
    expect(payload?.extra?.custom_setting).toBe('keep-me')
    expect(payload?.extra?.grok_client_tool_cache_enabled).toBe(false)
  })

  it('defaults client-tool caching on when the setting is missing and persists explicit true', async () => {
    const account = buildGrokOAuthAccount({}, { custom_setting: 'keep-me' })
    updateAccountMock.mockResolvedValue(account)

    const wrapper = mountModal(account)
    const toggle = wrapper.get('[data-testid="grok-client-tool-cache-toggle"]')
    expect(toggle.getAttribute('aria-checked')).toBe('true')

    await wrapper.submit()
    await vi.waitFor(() => expect(updateAccountMock).toHaveBeenCalledTimes(1))

    const payload = updateAccountMock.mock.calls[0]?.[1]
    expect(payload?.extra).toMatchObject({
      grok_client_tool_cache_enabled: true,
      custom_setting: 'keep-me'
    })
  })

  it('keeps an explicit false opt-out when saving an untouched account', async () => {
    const account = buildGrokOAuthAccount(
      {},
      {
        grok_client_tool_cache_enabled: false,
        custom_setting: 'keep-me'
      }
    )
    updateAccountMock.mockResolvedValue(account)

    const wrapper = mountModal(account)
    const toggle = wrapper.get('[data-testid="grok-client-tool-cache-toggle"]')
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    await wrapper.submit()
    await vi.waitFor(() => expect(updateAccountMock).toHaveBeenCalledTimes(1))

    const payload = updateAccountMock.mock.calls[0]?.[1]
    expect(payload?.extra).toMatchObject({
      grok_client_tool_cache_enabled: false,
      custom_setting: 'keep-me'
    })
  })

  it('shows malformed cache settings as disabled so the UI matches the fail-closed backend', () => {
    const account = buildGrokOAuthAccount(
      {},
      {
        grok_client_tool_cache_enabled: 'true',
        custom_setting: 'keep-me'
      }
    )

    const wrapper = mountModal(account)
    expect(wrapper.get('[data-testid="grok-client-tool-cache-toggle"]').getAttribute('aria-checked')).toBe('false')
  })
})
