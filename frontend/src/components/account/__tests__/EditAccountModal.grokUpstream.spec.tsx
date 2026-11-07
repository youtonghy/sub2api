import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  updateAccountMock,
  checkMixedChannelRiskMock,
  getByIdMock,
  syncUpstreamModelsMock,
  selectorSyncMock,
  showWarningMock,
  showSuccessMock,
  showErrorMock,
  authIsSimpleMode
} = vi.hoisted(() => ({
  updateAccountMock: vi.fn(),
  checkMixedChannelRiskMock: vi.fn(),
  getByIdMock: vi.fn(),
  syncUpstreamModelsMock: vi.fn(),
  selectorSyncMock: vi.fn(),
  showWarningMock: vi.fn(),
  showSuccessMock: vi.fn(),
  showErrorMock: vi.fn(),
  authIsSimpleMode: { value: true }
}))

vi.mock('@/stores/app', () => {
  const store = { showError: showErrorMock, showSuccess: showSuccessMock, showInfo: vi.fn(), showWarning: showWarningMock }
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
      getById: getByIdMock,
      syncUpstreamModels: syncUpstreamModelsMock,
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
// 白名单选择器桩：暴露与真实组件相同的 ref 句柄，并可手动触发 upstream-sync-finished
vi.mock('../ModelWhitelistSelector', async () => {
  const { useImperativeHandle } = await import('react')
  function ModelWhitelistSelectorStub(props: any) {
    useImperativeHandle(props.ref, () => ({
      syncUpstreamModels: async () => {
        await selectorSyncMock(props.accountId)
        props.onUpstreamSyncFinished?.()
      },
      isSyncingUpstream: false
    }))
    return (
      <div data-testid="model-whitelist-selector" data-show-sync={String(props.showSyncButton)}>
        <button type="button" data-testid="emit-upstream-sync-finished" onClick={() => props.onUpstreamSyncFinished?.()}>
          finished
        </button>
      </div>
    )
  }
  return { default: ModelWhitelistSelectorStub }
})

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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function diagnostics(model: string, endpoint = 'https://cli-chat-proxy.grok.com/v1/models') {
  return {
    state: 'fresh',
    endpoint,
    fetched_at: '2026-10-25T11:00:00.000Z',
    expires_at: '2099-01-01T00:00:00.000Z',
    models: [model],
    mappings: [{ requested: 'friendly', upstream: model, status: 'listed' }]
  }
}

const flushPromises = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

function mountModal(account: any) {
  let props = { show: true, account }
  const element = () => (
    <EditAccountModal show={props.show} account={props.account} proxies={[]} groups={[]} onClose={() => {}} onUpdated={() => {}} />
  )
  const view = render(element())
  const q = (selector: string) => view.container.querySelector<HTMLElement>(selector)
  const get = (selector: string) => {
    const found = q(selector)
    if (!found) throw new Error(`Element not found: ${selector}`)
    return found
  }
  return {
    q,
    get,
    text: () => view.container.textContent ?? '',
    unmount: () => view.unmount(),
    async setProps(next: Partial<typeof props>) {
      props = { ...props, ...next }
      await act(async () => {
        view.rerender(element())
      })
    },
    buttonByText: (text: string) =>
      Array.from(view.container.querySelectorAll<HTMLElement>('button')).find((button) => button.textContent === text),
    async openDiagnosticsDetails() {
      const button = view.container.querySelector<HTMLElement>('[data-testid="grok-diagnostics-details-toggle"]')
      if (button && button.getAttribute('aria-expanded') === 'false') {
        await act(async () => {
          fireEvent.click(button)
        })
      }
    },
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
    getByIdMock.mockReset()
    getByIdMock.mockResolvedValue({ grok_model_diagnostics: null })
    syncUpstreamModelsMock.mockReset()
    syncUpstreamModelsMock.mockResolvedValue({ models: [], discovery_source: 'upstream' })
    selectorSyncMock.mockReset()
    selectorSyncMock.mockResolvedValue(undefined)
    showWarningMock.mockReset()
    showSuccessMock.mockReset()
    showErrorMock.mockReset()
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
  describe('model catalog diagnostics', () => {
    it('keeps an edited base URL when a saved sync finishes and flags unsaved edits', async () => {
      const account = buildGrokOAuthAccount({ base_url: 'https://my-relay.example.com' })
      getByIdMock.mockResolvedValue({
        ...account,
        grok_model_diagnostics: diagnostics('saved-model', 'https://my-relay.example.com/v1/models')
      })
      const wrapper = mountModal(account)
      await flushPromises()
      expect(wrapper.q('[data-testid="grok-diagnostics-dirty"]')).toBeNull()

      await wrapper.setValue('[data-testid="grok-custom-base-url-input"]', 'https://draft.example.com')
      expect(wrapper.text()).toContain('admin.accounts.grokModelDiagnostics.savedConfigHint')
      await wrapper.click('[data-testid="emit-upstream-sync-finished"]')
      await flushPromises()

      expect((wrapper.get('[data-testid="grok-custom-base-url-input"]') as HTMLInputElement).value).toBe('https://draft.example.com')
      expect(account.credentials.base_url).toBe('https://my-relay.example.com')
      expect(account.grok_model_diagnostics).toBeUndefined()
      await wrapper.openDiagnosticsDetails()
      expect(wrapper.text()).toContain('saved-model')
      expect(getByIdMock).toHaveBeenCalledTimes(2)
      expect(getByIdMock).toHaveBeenCalledWith(account.id)
    })

    it('submits the draft mapping and does not append catalog ids after a saved-config sync', async () => {
      const account = buildGrokOAuthAccount({
        base_url: 'https://my-relay.example.com',
        model_mapping: { friendly: 'grok-4.7' }
      })
      getByIdMock.mockResolvedValue({ ...account, grok_model_diagnostics: diagnostics('catalog-only-model') })
      syncUpstreamModelsMock.mockResolvedValue({
        models: ['grok-composer-2.5-fast', 'extra-catalog-id'],
        discovery_source: 'upstream',
        warnings: [{ code: 'upstream_model_metadata_incomplete', message: 'incomplete' }]
      })
      updateAccountMock.mockResolvedValue(account)
      const wrapper = mountModal(account)
      await flushPromises()

      await wrapper.setValue('input[placeholder="admin.accounts.actualModel"]', 'grok-4.5')
      await wrapper.click('[data-testid="grok-diagnostics-sync"]')
      await flushPromises()

      expect(syncUpstreamModelsMock).toHaveBeenCalledWith(account.id)
      expect(selectorSyncMock).not.toHaveBeenCalled()
      expect((wrapper.get('input[placeholder="admin.accounts.actualModel"]') as HTMLInputElement).value).toBe('grok-4.5')
      expect(showSuccessMock).not.toHaveBeenCalled()
      expect(showWarningMock).toHaveBeenCalledWith('admin.accounts.syncUpstreamModelsMetadataIncomplete')
      await wrapper.submit()
      await vi.waitFor(() => expect(updateAccountMock).toHaveBeenCalledTimes(1))
      const payload = updateAccountMock.mock.calls[0]?.[1]
      expect(payload?.credentials?.model_mapping).toEqual({ friendly: 'grok-4.5' })
      expect(JSON.stringify(payload)).not.toContain('extra-catalog-id')
      expect(JSON.stringify(payload)).not.toContain('catalog-only-model')
    })

    it('keeps the panel and one shared sync button in both modes and routes whitelist syncs to the selector', async () => {
      const wrapper = mountModal(buildGrokOAuthAccount())
      await flushPromises()
      expect(wrapper.q('[data-testid="grok-model-diagnostics"]')).not.toBeNull()
      expect(wrapper.findAll('[data-testid="grok-diagnostics-sync"]')).toHaveLength(1)
      // 已保存账号隐藏选择器内置的同步按钮，只保留诊断面板上的按钮
      expect(wrapper.get('[data-testid="model-whitelist-selector"]').dataset.showSync).toBe('false')

      await wrapper.click('[data-testid="grok-diagnostics-sync"]')
      await flushPromises()
      expect(selectorSyncMock).toHaveBeenCalledWith(5)
      expect(syncUpstreamModelsMock).not.toHaveBeenCalled()
      expect(getByIdMock).toHaveBeenCalledTimes(2)

      await wrapper.click(wrapper.buttonByText('admin.accounts.modelMapping')!)
      expect(wrapper.q('[data-testid="grok-model-diagnostics"]')).not.toBeNull()
      expect(wrapper.q('[data-testid="grok-diagnostics-sync"]')).not.toBeNull()
      expect(wrapper.q('[data-testid="grok-model-mapping-editor"]')).not.toBeNull()
      // 白名单选择器在映射模式下保持挂载（隐藏），进行中的同步仍可回调
      expect(wrapper.q('[data-testid="model-whitelist-selector"]')?.closest('[hidden]')).not.toBeNull()

      await wrapper.click(wrapper.buttonByText('admin.accounts.modelWhitelist')!)
      expect(wrapper.q('[data-testid="grok-model-diagnostics"]')).not.toBeNull()
    })

    it('does not let a late account response overwrite the current diagnostics', async () => {
      const accountA = buildGrokOAuthAccount({ base_url: 'https://a.example.com' })
      const accountB = { ...buildGrokOAuthAccount({ base_url: 'https://b.example.com' }), id: 9, name: 'Grok B' }
      const first = deferred<any>()
      const second = deferred<any>()
      getByIdMock.mockImplementation((id: number) => (id === accountA.id ? first.promise : second.promise))
      const wrapper = mountModal(accountA)
      await flushPromises()
      await wrapper.setProps({ account: accountB })
      first.resolve({ ...accountA, grok_model_diagnostics: diagnostics('late-a-model') })
      await flushPromises()
      await wrapper.openDiagnosticsDetails()
      expect(wrapper.text()).not.toContain('late-a-model')

      second.resolve({ ...accountB, grok_model_diagnostics: diagnostics('current-b-model') })
      await flushPromises()
      expect(wrapper.text()).toContain('current-b-model')
      expect(wrapper.text()).not.toContain('late-a-model')
    })

    it('drops a response that arrives after the same account is closed and reopened', async () => {
      const account = buildGrokOAuthAccount()
      const first = deferred<any>()
      getByIdMock.mockImplementation(() => first.promise)
      const wrapper = mountModal(account)
      await flushPromises()
      await wrapper.setProps({ show: false })

      const reopened = deferred<any>()
      getByIdMock.mockImplementation(() => reopened.promise)
      await wrapper.setProps({ show: true })
      first.resolve({ ...account, grok_model_diagnostics: diagnostics('closed-model') })
      await flushPromises()
      await wrapper.openDiagnosticsDetails()
      expect(wrapper.text()).not.toContain('closed-model')

      reopened.resolve({ ...account, grok_model_diagnostics: diagnostics('reopened-model') })
      await flushPromises()
      expect(wrapper.text()).toContain('reopened-model')
      expect(wrapper.text()).not.toContain('closed-model')
    })

    it('does not apply a response after the modal unmounts', async () => {
      const account = buildGrokOAuthAccount()
      const pending = deferred<any>()
      getByIdMock.mockImplementation(() => pending.promise)
      const wrapper = mountModal(account)
      await flushPromises()
      wrapper.unmount()
      pending.resolve({ ...account, grok_model_diagnostics: diagnostics('unmounted-model') })
      await flushPromises()

      getByIdMock.mockResolvedValue({ ...account, grok_model_diagnostics: diagnostics('mounted-model') })
      const again = mountModal(account)
      await flushPromises()
      await again.openDiagnosticsDetails()
      expect(again.text()).toContain('mounted-model')
      expect(again.text()).not.toContain('unmounted-model')
    })

    it('keeps the previous diagnostics and shows a refresh failure', async () => {
      const account = buildGrokOAuthAccount()
      getByIdMock
        .mockResolvedValueOnce({ ...account, grok_model_diagnostics: diagnostics('kept-model') })
        .mockRejectedValueOnce(new Error('offline'))
      const wrapper = mountModal(account)
      await flushPromises()
      await wrapper.openDiagnosticsDetails()
      expect(wrapper.text()).toContain('kept-model')

      await wrapper.click('[data-testid="emit-upstream-sync-finished"]')
      await flushPromises()
      expect(wrapper.text()).toContain('kept-model')
      expect(wrapper.text()).toContain('admin.accounts.grokModelDiagnostics.refreshFailed')
    })

    it('shows diagnostics for a Grok API key and skips non-Grok accounts', async () => {
      const apiKey = {
        ...buildGrokOAuthAccount(),
        type: 'apikey',
        credentials: { api_key: 'xai-test', base_url: 'https://api.x.ai/v1' },
        credentials_status: { has_api_key: true }
      }
      getByIdMock.mockResolvedValue({ ...apiKey, grok_model_diagnostics: diagnostics('apikey-model', 'https://api.x.ai/v1/models') })
      const wrapper = mountModal(apiKey)
      await flushPromises()
      expect(wrapper.q('[data-testid="grok-model-diagnostics"]')).not.toBeNull()
      await wrapper.openDiagnosticsDetails()
      expect(wrapper.text()).toContain('apikey-model')
      expect(wrapper.text()).not.toContain('admin.accounts.grokModelDiagnostics.savedConfigHint')

      await wrapper.setValue('input[placeholder="https://api.x.ai/v1"]', 'https://draft-api.example.com')
      expect(wrapper.text()).toContain('admin.accounts.grokModelDiagnostics.savedConfigHint')
      wrapper.unmount()

      getByIdMock.mockClear()
      const openai = mountModal({ ...buildGrokOAuthAccount(), platform: 'openai' })
      await flushPromises()
      expect(openai.q('[data-testid="grok-model-diagnostics"]')).toBeNull()
      expect(openai.get('[data-testid="model-whitelist-selector"]').dataset.showSync).not.toBe('false')
      expect(getByIdMock).not.toHaveBeenCalled()
    })

    it('sends one saved-config sync from mapping mode and does not toast a live success for fallback', async () => {
      const account = buildGrokOAuthAccount({ model_mapping: { friendly: 'grok-4.7' } })
      const pending = deferred<any>()
      syncUpstreamModelsMock.mockImplementation(() => pending.promise)
      const wrapper = mountModal(account)
      await flushPromises()

      await wrapper.click('[data-testid="grok-diagnostics-sync"]')
      await wrapper.click('[data-testid="grok-diagnostics-sync"]')
      expect(syncUpstreamModelsMock).toHaveBeenCalledTimes(1)
      expect(syncUpstreamModelsMock).toHaveBeenCalledWith(account.id)

      pending.resolve({
        models: ['composer-2.5'],
        discovery_source: 'configured_fallback',
        warnings: [{ code: 'grok_model_catalog_configured_fallback', message: 'fallback' }]
      })
      await flushPromises()
      expect(showWarningMock).toHaveBeenCalledWith('admin.accounts.grokModelDiagnostics.configuredFallback')
      expect(showSuccessMock).not.toHaveBeenCalled()
      expect((wrapper.get('input[placeholder="admin.accounts.actualModel"]') as HTMLInputElement).value).toBe('grok-4.7')
      expect(getByIdMock.mock.calls.length).toBeGreaterThan(1)
      expect((wrapper.get('[data-testid="grok-diagnostics-sync"]') as HTMLButtonElement).disabled).toBe(false)
    })

    it('does not toast or replace diagnostics when a saved-config sync resolves for a previous account', async () => {
      const accountA = buildGrokOAuthAccount({ model_mapping: { friendly: 'grok-4.7' } })
      const accountB = { ...buildGrokOAuthAccount({ model_mapping: { friendly: 'grok-4.5' } }), id: 9, name: 'Grok B' }
      const pending = deferred<any>()
      getByIdMock.mockImplementation(async (id: number) => ({
        grok_model_diagnostics: diagnostics(id === 9 ? 'account-b-model' : 'account-a-model')
      }))
      syncUpstreamModelsMock.mockImplementation(() => pending.promise)
      const wrapper = mountModal(accountA)
      await flushPromises()
      await wrapper.click('[data-testid="grok-diagnostics-sync"]')
      await wrapper.setProps({ account: accountB })
      await flushPromises()
      const callsBefore = getByIdMock.mock.calls.length

      pending.resolve({ models: ['x'], discovery_source: 'configured_fallback' })
      await flushPromises()
      expect(showWarningMock).not.toHaveBeenCalled()
      expect(getByIdMock.mock.calls.length).toBe(callsBefore)
      await wrapper.openDiagnosticsDetails()
      expect(wrapper.text()).toContain('account-b-model')
      expect(wrapper.text()).not.toContain('account-a-model')
    })

    it('reports a sync failure without dropping the previous diagnostics', async () => {
      const account = buildGrokOAuthAccount({ model_mapping: { friendly: 'grok-4.7' } })
      getByIdMock.mockResolvedValue({ ...account, grok_model_diagnostics: diagnostics('kept-model') })
      syncUpstreamModelsMock.mockRejectedValue({ status: 502, message: 'upstream unavailable' })
      const wrapper = mountModal(account)
      await flushPromises()
      await wrapper.click('[data-testid="grok-diagnostics-sync"]')
      await flushPromises()
      expect(showErrorMock).toHaveBeenCalledWith('admin.accounts.syncUpstreamModelsError')
      await wrapper.openDiagnosticsDetails()
      expect(wrapper.text()).toContain('kept-model')
    })

    it('collapses diagnostics details when switching accounts', async () => {
      const accountA = buildGrokOAuthAccount()
      const accountB = { ...buildGrokOAuthAccount(), id: 9, name: 'Grok B' }
      getByIdMock.mockResolvedValue({ grok_model_diagnostics: diagnostics('any-model') })
      const wrapper = mountModal(accountA)
      await flushPromises()
      await wrapper.openDiagnosticsDetails()
      expect(wrapper.get('[data-testid="grok-diagnostics-details-toggle"]').getAttribute('aria-expanded')).toBe('true')
      await wrapper.setProps({ account: accountB })
      await flushPromises()
      expect(wrapper.get('[data-testid="grok-diagnostics-details-toggle"]').getAttribute('aria-expanded')).toBe('false')
    })

    it('renders compact Grok mapping rows with column headers and indexed labels', async () => {
      const account = buildGrokOAuthAccount({ model_mapping: { friendly: 'grok-4.7', other: 'grok-4.5' } })
      updateAccountMock.mockResolvedValue(account)
      const wrapper = mountModal(account)
      await flushPromises()
      expect(wrapper.text()).toContain('admin.accounts.grokModelDiagnostics.requestColumn')
      expect(wrapper.text()).toContain('admin.accounts.grokModelDiagnostics.targetColumn')
      const rows = wrapper.findAll('[data-testid="grok-model-mapping-row"]')
      expect(rows).toHaveLength(2)
      expect(rows[0].querySelector('input')?.getAttribute('aria-label')).toBe('admin.accounts.grokModelDiagnostics.mappingFromAria')
      expect(rows[0].querySelector('button')?.getAttribute('aria-label')).toBe('admin.accounts.grokModelDiagnostics.removeMappingAria')

      await wrapper.click(rows[0].querySelector('button')!)
      expect(wrapper.findAll('[data-testid="grok-model-mapping-row"]')).toHaveLength(1)
      await wrapper.click('[data-testid="grok-model-mapping-add"]')
      expect(wrapper.findAll('[data-testid="grok-model-mapping-row"]')).toHaveLength(2)
      await wrapper.submit()
      await vi.waitFor(() => expect(updateAccountMock).toHaveBeenCalledTimes(1))
      expect(updateAccountMock.mock.calls[0]?.[1]?.credentials?.model_mapping).toEqual({ other: 'grok-4.5' })
    })
  })
})
