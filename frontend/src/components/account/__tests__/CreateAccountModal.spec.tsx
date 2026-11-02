import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useImperativeHandle, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BUILTIN_PLATFORM_CATALOG, resetPlatformCatalog, setPlatformCatalog } from '@/constants/platformCatalog'

const {
  createAccountMock,
  probeUpstreamBillingMock,
  syncUpstreamModelsMock,
  showWarningMock,
  importCodexSessionMock,
  createOpenAICodexPATMock,
  authIsSimpleMode,
  flowStub,
  whitelistStub
} = vi.hoisted(() => ({
  createAccountMock: vi.fn(),
  probeUpstreamBillingMock: vi.fn(),
  syncUpstreamModelsMock: vi.fn(),
  showWarningMock: vi.fn(),
  importCodexSessionMock: vi.fn(),
  createOpenAICodexPATMock: vi.fn(),
  authIsSimpleMode: { value: true },
  flowStub: { inputMethod: 'manual', props: null as Record<string, any> | null },
  whitelistStub: { props: null as Record<string, any> | null }
}))

vi.mock('@/stores/app', () => {
  const state = {
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showInfo: vi.fn(),
    showWarning: showWarningMock
  }
  return { useAppStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), { getState: () => state }) }
})

vi.mock('@/stores/auth', () => {
  const state = {
    get isSimpleMode() {
      return authIsSimpleMode.value
    }
  }
  return { useAuthStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), { getState: () => state }) }
})

vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      create: createAccountMock,
      probeUpstreamBilling: probeUpstreamBillingMock,
      syncUpstreamModels: syncUpstreamModelsMock,
      checkMixedChannelRisk: vi.fn().mockResolvedValue({ has_risk: false }),
      importCodexSession: importCodexSessionMock,
      createOpenAICodexPAT: createOpenAICodexPATMock
    },
    settings: {
      getWebSearchEmulationConfig: vi.fn().mockResolvedValue({ enabled: false, providers: [] }),
      getSettings: vi.fn().mockResolvedValue({})
    },
    tlsFingerprintProfiles: {
      list: vi.fn().mockResolvedValue([])
    },
    gemini: {
      getCapabilities: vi.fn().mockResolvedValue({})
    }
  }
}))

vi.mock('@/api/admin/accounts', () => ({
  getAntigravityDefaultModelMapping: vi.fn().mockResolvedValue([])
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' })
}))

// Vue 版用 BaseDialog 桩直接渲染插槽；这里把抽屉换成内联渲染（正文 + 底部操作区）
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

vi.mock('@/components/common/BaseDialog', () => ({
  default: ({ show, children }: { show: boolean; children?: ReactNode }) => (show ? <div>{children}</div> : null)
}))
vi.mock('@/components/common/ConfirmDialog', () => ({ default: () => null }))
vi.mock('@/components/common/Select', () => ({ default: () => null }))
vi.mock('@/components/common/ProxySelector', () => ({ default: () => null }))
vi.mock('@/components/common/ProxyAdBanner', () => ({ default: () => null }))
vi.mock('../QuotaLimitCard', () => ({ default: () => null }))

vi.mock('../OAuthAuthorizationFlow', () => ({
  default: (props: Record<string, any>) => {
    flowStub.props = props
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useImperativeHandle(props.ref, () => ({
      get inputMethod() {
        return flowStub.inputMethod
      },
      authCode: '',
      oauthState: '',
      projectId: '',
      reset: () => {}
    }))
    return (
      <div>
        <button type="button" data-testid="import-codex-session" onClick={() => props.onImportCodexSession('session-json')}>
          session
        </button>
        <button type="button" data-testid="import-codex-pat" onClick={() => props.onImportCodexPat('pat-token')}>
          pat
        </button>
      </div>
    )
  }
}))

vi.mock('@/components/common/GroupSelector', () => ({
  default: ({ onChange }: { onChange: (value: number[]) => void }) => (
    <button type="button" data-testid="select-pricing-groups" onClick={() => onChange([1, 2])}>
      groups
    </button>
  )
}))

vi.mock('../ModelWhitelistSelector', () => ({
  default: (props: Record<string, any>) => {
    whitelistStub.props = props
    return (
      <button
        type="button"
        data-testid="model-whitelist-selector"
        onClick={() => {
          props.onChange(['public-glm'])
          props.onUpstreamSynced?.()
        }}
      >
        models
      </button>
    )
  }
}))

import CreateAccountModal from '../CreateAccountModal'

const flushPromises = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

let onCreated = vi.fn()
let onClose = vi.fn()

function mountModal(groups: any[] = []) {
  onCreated = vi.fn()
  onClose = vi.fn()
  return render(<CreateAccountModal show proxies={[]} groups={groups} onClose={onClose} onCreated={onCreated} />)
}

type Wrapper = ReturnType<typeof mountModal>

const formEl = (wrapper: Wrapper) => wrapper.container.querySelector<HTMLFormElement>('form#create-account-form')!
const textInput = (wrapper: Wrapper) =>
  wrapper.container.querySelector<HTMLInputElement>('form#create-account-form input[type="text"]')!
const passwordInput = (wrapper: Wrapper) =>
  wrapper.container.querySelector<HTMLInputElement>('form#create-account-form input[type="password"]')!

async function setValue(element: Element, value: string) {
  await act(async () => {
    fireEvent.change(element, { target: { value } })
  })
}

async function click(element: Element) {
  await act(async () => {
    fireEvent.click(element)
  })
}

/** Vue 版在所有 button 中按文本查找；这里同时包含 Arc radio-cards 的选项卡片（role="radio"） */
async function selectButtonByText(wrapper: Wrapper, text: string) {
  const button = Array.from(wrapper.container.querySelectorAll('button, [role="radio"]')).find((candidate) =>
    candidate.textContent?.includes(text)
  )
  expect(button).toBeDefined()
  await click(button!)
}

/** Vue 版直接点击开关按钮；这里 data-testid 在开关行上，点击行内的 Arc switch */
async function clickToggle(testId: string) {
  await click(within(screen.getByTestId(testId)).getAllByRole('switch')[0])
}

async function submit(wrapper: Wrapper) {
  await act(async () => {
    fireEvent.submit(formEl(wrapper))
  })
}

async function submitApiKeyAccount(
  platform: 'openai' | 'anthropic',
  enableLongContextBilling = false,
  disableUpstreamBillingProbe = false
) {
  const wrapper = mountModal()
  await selectButtonByText(wrapper, platform === 'openai' ? 'OpenAI' : 'admin.accounts.claudeConsole')
  if (platform === 'openai') {
    await selectButtonByText(wrapper, 'API Key')
  }
  await setValue(textInput(wrapper), `${platform} account`)
  await setValue(passwordInput(wrapper), 'test-api-key')
  if (enableLongContextBilling) {
    await clickToggle('openai-long-context-billing-toggle')
  }
  if (disableUpstreamBillingProbe) {
    await clickToggle('upstream-billing-auto-probe')
  }
  await submit(wrapper)
  await flushPromises()
  return wrapper
}

async function openCodexImportStep(toggleClicks = 0) {
  const wrapper = mountModal()
  await selectButtonByText(wrapper, 'OpenAI')
  for (let index = 0; index < toggleClicks; index += 1) {
    await clickToggle('openai-long-context-billing-toggle')
  }
  await setValue(textInput(wrapper), 'Codex import')
  await submit(wrapper)
  await flushPromises()
  return wrapper
}

afterEach(() => {
  cleanup()
  flowStub.inputMethod = 'manual'
  flowStub.props = null
  whitelistStub.props = null
})

describe('CreateAccountModal OpenAI long-context billing', () => {
  beforeEach(() => {
    authIsSimpleMode.value = true
    createAccountMock.mockReset().mockResolvedValue({ id: 42, platform: 'openai', type: 'apikey' })
    probeUpstreamBillingMock.mockReset().mockResolvedValue({})
    syncUpstreamModelsMock.mockReset().mockResolvedValue({ models: [], metadata: {} })
    showWarningMock.mockReset()
    importCodexSessionMock.mockReset().mockResolvedValue({
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      warnings: []
    })
    createOpenAICodexPATMock.mockReset().mockResolvedValue({})
  })

  afterEach(() => vi.useRealTimers())

  it('sets month and year expiry presets without submitting the account form', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-31T12:34:00'))
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'OpenAI')
    await selectButtonByText(wrapper, 'API Key')
    await setValue(textInput(wrapper), 'expiry account')
    await setValue(passwordInput(wrapper), 'test-api-key')
    const input = wrapper.container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!

    for (const [label, expected] of [
      ['payment.oneMonth', '2026-02-28T12:34'],
      ['payment.oneYear', '2027-01-31T12:34']
    ]) {
      const button = Array.from(wrapper.container.querySelectorAll('button')).find(
        (candidate) => candidate.textContent?.trim() === label
      )!
      expect(button.getAttribute('type')).toBe('button')
      await click(button)
      expect(input.value).toBe(expected)
      expect(createAccountMock).not.toHaveBeenCalled()
    }

    await submit(wrapper)
    await flushPromises()
    expect(createAccountMock.mock.calls[0]?.[0]?.expires_at).toBe(new Date('2027-01-31T12:34:00').getTime() / 1000)
  })

  it('allows a manually entered expiry to override a preset before account creation', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'OpenAI')
    await selectButtonByText(wrapper, 'API Key')
    await setValue(textInput(wrapper), 'custom expiry account')
    await setValue(passwordInput(wrapper), 'test-api-key')
    await selectButtonByText(wrapper, 'payment.oneMonth')
    await setValue(wrapper.container.querySelector('input[type="datetime-local"]')!, '2030-04-15T09:20')

    await submit(wrapper)
    await flushPromises()
    expect(createAccountMock.mock.calls[0]?.[0]?.expires_at).toBe(new Date('2030-04-15T09:20:00').getTime() / 1000)
  })

  it('hides only the redundant account toggle when every selected group enables tier pricing', async () => {
    authIsSimpleMode.value = false
    const wrapper = mountModal([
      { id: 1, long_context_pricing_enabled: true },
      { id: 2, long_context_pricing_enabled: true }
    ])

    await selectButtonByText(wrapper, 'OpenAI')
    await click(screen.getByTestId('select-pricing-groups'))

    expect(screen.queryByTestId('openai-long-context-billing-toggle')).toBeNull()
    expect(screen.queryByTestId('create-openai-ws-mode')).not.toBeNull()
  })

  it('keeps the account toggle when any selected group disables tier pricing', async () => {
    authIsSimpleMode.value = false
    const wrapper = mountModal([
      { id: 1, long_context_pricing_enabled: true },
      { id: 2, long_context_pricing_enabled: false }
    ])

    await selectButtonByText(wrapper, 'OpenAI')
    await click(screen.getByTestId('select-pricing-groups'))

    expect(screen.queryByTestId('openai-long-context-billing-toggle')).not.toBeNull()
    expect(screen.queryByTestId('create-openai-ws-mode')).not.toBeNull()
  })

  it('sends false explicitly for normal OpenAI account creation by default', async () => {
    await submitApiKeyAccount('openai')

    expect(createAccountMock).toHaveBeenCalledTimes(1)
    expect(createAccountMock.mock.calls[0]?.[0]?.extra?.openai_long_context_billing_enabled).toBe(false)
  })

  it('omits the upstream request id header from extra when left empty', async () => {
    await submitApiKeyAccount('openai')

    expect(createAccountMock).toHaveBeenCalledTimes(1)
    expect(createAccountMock.mock.calls[0]?.[0]?.extra).not.toHaveProperty('upstream_request_id_header')
  })

  it('sends the trimmed upstream request id header in extra when filled', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'OpenAI')
    await selectButtonByText(wrapper, 'API Key')
    await setValue(textInput(wrapper), 'openai account')
    await setValue(passwordInput(wrapper), 'test-api-key')
    await setValue(screen.getByTestId('upstream-request-id-header'), '  X-Oneapi-Request-Id  ')
    await submit(wrapper)
    await flushPromises()

    expect(createAccountMock).toHaveBeenCalledTimes(1)
    expect(createAccountMock.mock.calls[0]?.[0]?.extra?.upstream_request_id_header).toBe('X-Oneapi-Request-Id')
  })

  it('omits images_url_to_b64_json from extra by default', async () => {
    await submitApiKeyAccount('openai')

    expect(createAccountMock).toHaveBeenCalledTimes(1)
    expect(createAccountMock.mock.calls[0]?.[0]?.extra).not.toHaveProperty('images_url_to_b64_json')
  })

  it('sends images_url_to_b64_json in extra when the toggle is enabled', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'OpenAI')
    await selectButtonByText(wrapper, 'API Key')
    await setValue(textInput(wrapper), 'openai account')
    await setValue(passwordInput(wrapper), 'test-api-key')
    await clickToggle('openai-images-url-to-b64-json-toggle')
    await submit(wrapper)
    await flushPromises()

    expect(createAccountMock).toHaveBeenCalledTimes(1)
    expect(createAccountMock.mock.calls[0]?.[0]?.extra?.images_url_to_b64_json).toBe(true)
  })

  it('persists upstream model metadata after creating an account from preview', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'OpenAI')
    await selectButtonByText(wrapper, 'API Key')
    await setValue(textInput(wrapper), 'OpenCode account')
    await setValue(passwordInput(wrapper), 'test-api-key')
    await click(screen.getByTestId('model-whitelist-selector'))
    await submit(wrapper)
    await flushPromises()

    expect(createAccountMock).toHaveBeenCalledOnce()
    expect(syncUpstreamModelsMock).toHaveBeenCalledWith(42)
  })

  it('includes the current concrete model mapping in preview credentials', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'OpenAI')
    await selectButtonByText(wrapper, 'API Key')
    await setValue(passwordInput(wrapper), 'test-api-key')
    await click(screen.getByTestId('model-whitelist-selector'))
    await flushPromises()

    expect(whitelistStub.props?.syncCredentials).toMatchObject({
      model_mapping: { 'public-glm': 'public-glm' }
    })
  })

  it('runs formal capability sync after creating an account with explicit mappings', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'OpenAI')
    await selectButtonByText(wrapper, 'API Key')
    await setValue(textInput(wrapper), 'Mapped account')
    await setValue(passwordInput(wrapper), 'test-api-key')
    await selectButtonByText(wrapper, 'admin.accounts.modelMapping')
    await selectButtonByText(wrapper, 'admin.accounts.addMapping')
    await setValue(wrapper.container.querySelector('input[placeholder="admin.accounts.requestModel"]')!, 'public-glm')
    await setValue(wrapper.container.querySelector('input[placeholder="admin.accounts.actualModel"]')!, 'glm-5.3')
    await submit(wrapper)
    await flushPromises()

    expect(createAccountMock.mock.calls[0]?.[0]?.credentials?.model_mapping).toEqual({
      'public-glm': 'glm-5.3'
    })
    expect(syncUpstreamModelsMock).toHaveBeenCalledWith(42)
  })

  it('warns when post-create capability metadata remains incomplete', async () => {
    syncUpstreamModelsMock.mockResolvedValue({
      models: ['x-preview-f-free'],
      warnings: [{ code: 'upstream_model_metadata_incomplete', message: 'metadata incomplete' }]
    })
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'OpenAI')
    await selectButtonByText(wrapper, 'API Key')
    await setValue(textInput(wrapper), 'OpenCode account')
    await setValue(passwordInput(wrapper), 'test-api-key')
    await click(screen.getByTestId('model-whitelist-selector'))
    await submit(wrapper)
    await flushPromises()

    expect(showWarningMock).toHaveBeenCalledWith('admin.accounts.syncUpstreamModelsMetadataIncomplete')
  })

  // namespace 摊平是仅 OAuth 的兼容开关：API Key 走 chat completions 回退桥时由桥自行摊平
  it('shows the Codex namespace flatten toggle only for OpenAI OAuth accounts', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'OpenAI')

    expect(screen.queryByTestId('create-openai-flatten-namespaces-toggle')).not.toBeNull()

    await selectButtonByText(wrapper, 'API Key')
    expect(screen.queryByTestId('create-openai-flatten-namespaces-toggle')).toBeNull()
  })

  it('enables upstream billing probes by default for new OpenAI API key accounts', async () => {
    await submitApiKeyAccount('openai')

    expect(createAccountMock.mock.calls[0]?.[0]?.upstream_billing_probe_enabled).toBe(true)
  })

  it('waits for the initial upstream billing probe before refreshing the account list', async () => {
    let resolveProbe: (() => void) | undefined
    probeUpstreamBillingMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveProbe = resolve
        })
    )

    await submitApiKeyAccount('openai')

    expect(probeUpstreamBillingMock).toHaveBeenCalledWith(42)
    expect(onCreated).not.toHaveBeenCalled()

    resolveProbe?.()
    await flushPromises()

    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('sends an explicit disabled state when the create toggle is turned off', async () => {
    await submitApiKeyAccount('openai', false, true)

    expect(createAccountMock.mock.calls[0]?.[0]?.upstream_billing_probe_enabled).toBe(false)
    expect(probeUpstreamBillingMock).not.toHaveBeenCalled()
  })

  it('submits OpenCode Zen default protocol rules with adaptive endpoints', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'OpenCode')
    await setValue(textInput(wrapper), 'oc')
    await setValue(passwordInput(wrapper), 'sk-opencode-zen')

    await submit(wrapper)
    await flushPromises()

    expect(createAccountMock).toHaveBeenCalledTimes(1)
    expect(createAccountMock.mock.calls[0]?.[0]?.credentials).toMatchObject({
      account_mode: 'zen',
      api_protocol: 'adaptive',
      base_url: 'https://opencode.ai/zen/v1',
      api_base_urls: {
        chat_completions: 'https://opencode.ai/zen/v1',
        anthropic: 'https://opencode.ai/zen',
        responses: 'https://opencode.ai/zen/v1'
      },
      protocol_rules: [
        { pattern: 'grok-*', protocol: 'responses' },
        { pattern: 'gpt-*', protocol: 'responses' },
        { pattern: 'muse-spark-*', protocol: 'responses' },
        { pattern: 'claude-*', protocol: 'anthropic' },
        { pattern: 'qwen3.8-max', protocol: 'chat_completions' },
        { pattern: 'qwen*', protocol: 'anthropic' }
      ]
    })
  })

  it('submits OpenCode GO endpoints after switching account type', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'OpenCode')
    await selectButtonByText(wrapper, 'admin.accounts.opencodeGo.accountMode.go')
    await setValue(textInput(wrapper), 'oc-go')
    await setValue(passwordInput(wrapper), 'sk-opencode-go')

    await submit(wrapper)
    await flushPromises()

    expect(createAccountMock).toHaveBeenCalledTimes(1)
    expect(createAccountMock.mock.calls[0]?.[0]?.credentials).toMatchObject({
      account_mode: 'go',
      api_protocol: 'adaptive',
      base_url: 'https://opencode.ai/zen/go/v1',
      api_base_urls: {
        chat_completions: 'https://opencode.ai/zen/go/v1',
        anthropic: 'https://opencode.ai/zen/go',
        responses: 'https://opencode.ai/zen/go/v1'
      },
      protocol_rules: [
        { pattern: 'grok-*', protocol: 'responses' },
        { pattern: 'gpt-*', protocol: 'responses' },
        { pattern: 'muse-spark-*', protocol: 'responses' },
        { pattern: 'minimax-*', protocol: 'anthropic' },
        { pattern: 'qwen*', protocol: 'anthropic' }
      ]
    })
  })

  describe('providers using the generic form', () => {
    const serverOnlyProviders = {
      platforms: [
        ...BUILTIN_PLATFORM_CATALOG.platforms,
        {
          id: 'acme_router',
          display_name: 'Acme Router',
          gateway: 'openai' as const,
          cn_provider: false,
          multi_protocol: {
            default_mode: 'standard',
            routing: 'by_model' as const,
            modes: [
              {
                mode: 'standard',
                base_urls: {
                  chat_completions: 'https://api.acme-router.example/provider/v1',
                  anthropic: 'https://api.acme-router.example/provider'
                },
                protocol_rules: [{ pattern: 'claude-*', protocol: 'anthropic' as const }]
              },
              {
                mode: 'team',
                base_urls: {
                  chat_completions: 'https://team.acme-router.example/provider/v1',
                  anthropic: 'https://team.acme-router.example/provider'
                },
                protocol_rules: [{ pattern: 'sonnet-*', protocol: 'anthropic' as const }]
              }
            ]
          }
        },
        {
          id: 'acme_chat',
          display_name: 'Acme Chat',
          gateway: 'openai' as const,
          cn_provider: false,
          multi_protocol: {
            default_mode: 'pass',
            routing: 'by_inbound' as const,
            modes: [{ mode: 'pass', base_urls: { chat_completions: 'https://api.acme-chat.example/v1' } }]
          }
        }
      ],
      composite_precedence: [...BUILTIN_PLATFORM_CATALOG.composite_precedence, 'acme_router', 'acme_chat']
    }

    beforeEach(() => {
      setPlatformCatalog(serverOnlyProviders as never)
    })

    afterEach(() => {
      resetPlatformCatalog()
    })

    it('creates a by-model provider account from its profile defaults', async () => {
      const wrapper = mountModal()
      await click(screen.getByTestId('platform-button-acme_router'))
      await setValue(textInput(wrapper), 'cc')
      await setValue(passwordInput(wrapper), 'sk-cc')

      await submit(wrapper)
      await flushPromises()

      expect(createAccountMock).toHaveBeenCalledTimes(1)
      const payload = createAccountMock.mock.calls[0]?.[0]
      expect(payload?.platform).toBe('acme_router')
      expect(payload?.type).toBe('apikey')
      expect(payload?.credentials).toMatchObject({
        api_key: 'sk-cc',
        account_mode: 'standard',
        api_protocol: 'adaptive',
        base_url: 'https://api.acme-router.example/provider/v1',
        api_base_urls: {
          chat_completions: 'https://api.acme-router.example/provider/v1',
          anthropic: 'https://api.acme-router.example/provider'
        },
        protocol_rules: [{ pattern: 'claude-*', protocol: 'anthropic' }]
      })
      // 该供应商没有原生 Responses 端点，不下发 responses 基址。
      expect(payload?.credentials?.api_base_urls).not.toHaveProperty('responses')
      // 没有内置模型列表时不预填白名单，新账号不限制模型。
      expect(payload?.credentials).not.toHaveProperty('model_mapping')
    })

    it('switches endpoints and default rules with the provider mode', async () => {
      const wrapper = mountModal()
      await click(screen.getByTestId('platform-button-acme_router'))
      await click(within(screen.getByTestId('generic-account-mode')).getAllByRole('radio')[1])
      await setValue(textInput(wrapper), 'cc-team')
      await setValue(passwordInput(wrapper), 'sk-cc')

      await submit(wrapper)
      await flushPromises()

      expect(createAccountMock.mock.calls[0]?.[0]?.credentials).toMatchObject({
        account_mode: 'team',
        base_url: 'https://team.acme-router.example/provider/v1',
        api_base_urls: {
          chat_completions: 'https://team.acme-router.example/provider/v1',
          anthropic: 'https://team.acme-router.example/provider'
        },
        protocol_rules: [{ pattern: 'sonnet-*', protocol: 'anthropic' }]
      })
    })

    it('creates a by-inbound provider account without protocol rules', async () => {
      const wrapper = mountModal()
      await click(screen.getByTestId('platform-button-acme_chat'))
      // 单一接入模式时不显示模式选择。
      expect(screen.queryByTestId('generic-account-mode')).toBeNull()
      await setValue(textInput(wrapper), 'acme-chat')
      await setValue(passwordInput(wrapper), 'sk-acme-chat')

      await submit(wrapper)
      await flushPromises()

      const credentials = createAccountMock.mock.calls[0]?.[0]?.credentials
      expect(credentials).toMatchObject({
        account_mode: 'pass',
        api_protocol: 'adaptive',
        base_url: 'https://api.acme-chat.example/v1',
        api_base_urls: { chat_completions: 'https://api.acme-chat.example/v1' }
      })
      expect(credentials).not.toHaveProperty('protocol_rules')
    })

    it('falls back to the Kimi default mode after a server-only provider', async () => {
      const wrapper = mountModal()
      await click(screen.getByTestId('platform-button-acme_router'))
      await selectButtonByText(wrapper, 'Kimi')
      await setValue(textInput(wrapper), 'kimi')
      await setValue(passwordInput(wrapper), 'sk-kimi')

      await submit(wrapper)
      await flushPromises()

      expect(createAccountMock.mock.calls[0]?.[0]?.credentials).toMatchObject({
        account_mode: 'payg',
        base_url: 'https://api.moonshot.cn/v1'
      })
      expect(createAccountMock.mock.calls[0]?.[0]?.credentials).not.toHaveProperty('protocol_rules')
    })
  })

  it('groups the aggregators on their own row below the CN providers', () => {
    mountModal()
    const labels = (testid: string) =>
      within(screen.getByTestId(testid))
        .getAllByRole('radio')
        .map((radio) => radio.textContent?.trim())
    expect(labels('platform-row-cn')).toEqual(['Kimi', 'Zhipu GLM', 'DeepSeek', 'MiniMax'])
    expect(labels('platform-row-aggregators')).toEqual(['OpenCode', 'Command Code', 'Cline'])
  })

  it('creates a Cline account without an account type and with only the Chat Completions endpoint', async () => {
    const wrapper = mountModal()
    await click(screen.getByTestId('platform-button-cline'))
    // 积分与 ClinePass 共用同一个 Key，按模型计费，不需要选择账号类型。
    expect(screen.queryByTestId('generic-account-mode')).toBeNull()
    await setValue(textInput(wrapper), 'cline')
    await setValue(passwordInput(wrapper), 'sk-cline')

    await submit(wrapper)
    await flushPromises()

    const payload = createAccountMock.mock.calls[0]?.[0]
    expect(payload?.platform).toBe('cline')
    expect(payload?.credentials).toMatchObject({
      account_mode: 'payg',
      api_protocol: 'adaptive',
      base_url: 'https://api.cline.bot/api/v1',
      api_base_urls: { chat_completions: 'https://api.cline.bot/api/v1' }
    })
    expect(payload?.credentials).not.toHaveProperty('protocol_rules')
    expect(payload?.credentials?.api_base_urls).not.toHaveProperty('responses')
    expect(payload?.credentials?.api_base_urls).not.toHaveProperty('anthropic')
  })

  it('submits adaptive Kimi protocol endpoints', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'Kimi')
    await setValue(textInput(wrapper), 'Kimi adaptive')
    await setValue(passwordInput(wrapper), 'sk-kimi')

    await submit(wrapper)
    await flushPromises()

    expect(createAccountMock).toHaveBeenCalledTimes(1)
    expect(createAccountMock.mock.calls[0]?.[0]?.credentials).toMatchObject({
      account_mode: 'payg',
      api_protocol: 'adaptive',
      base_url: 'https://api.moonshot.cn/v1',
      api_base_urls: {
        chat_completions: 'https://api.moonshot.cn/v1',
        anthropic: 'https://api.moonshot.cn/anthropic',
        responses: 'https://api.moonshot.cn/v1'
      }
    })
  })

  it('submits adaptive Kimi Coding Plan Responses endpoint', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'Kimi')
    await selectButtonByText(wrapper, 'admin.accounts.cnProviders.accountMode.coding')
    await setValue(textInput(wrapper), 'Kimi coding')
    await setValue(passwordInput(wrapper), 'sk-kimi-coding')

    await submit(wrapper)
    await flushPromises()

    expect(createAccountMock).toHaveBeenCalledTimes(1)
    expect(createAccountMock.mock.calls[0]?.[0]?.credentials).toMatchObject({
      account_mode: 'coding',
      api_protocol: 'adaptive',
      base_url: 'https://api.kimi.com/coding/v1',
      api_base_urls: {
        chat_completions: 'https://api.kimi.com/coding/v1',
        anthropic: 'https://api.kimi.com/coding',
        responses: 'https://api.kimi.com/coding/v1'
      }
    })
  })

  it('submits adaptive MiniMax protocol endpoints', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'MiniMax')
    await setValue(textInput(wrapper), 'MiniMax adaptive')
    await setValue(passwordInput(wrapper), 'sk-minimax')

    await submit(wrapper)
    await flushPromises()

    expect(createAccountMock).toHaveBeenCalledTimes(1)
    expect(createAccountMock.mock.calls[0]?.[0]?.credentials).toMatchObject({
      account_mode: 'payg',
      api_protocol: 'adaptive',
      base_url: 'https://api.minimaxi.com/v1',
      api_base_urls: {
        chat_completions: 'https://api.minimaxi.com/v1',
        anthropic: 'https://api.minimaxi.com/anthropic',
        responses: 'https://api.minimaxi.com/v1'
      }
    })
  })

  it('uses the edited adaptive Chat endpoint when previewing upstream models', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'Kimi')
    await setValue(screen.getByTestId('cn-adaptive-base-url-chat_completions'), 'https://relay.example.com/v1')
    await setValue(passwordInput(wrapper), 'sk-relay')

    expect(whitelistStub.props?.syncCredentials).toMatchObject({
      platform: 'kimi',
      type: 'apikey',
      base_url: 'https://relay.example.com/v1',
      api_key: 'sk-relay'
    })
  })

  it('exposes Agent Identity in the OpenAI authorization methods', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'OpenAI')
    await setValue(textInput(wrapper), 'OpenAI account')
    await submit(wrapper)
    await flushPromises()

    expect(flowStub.props?.showManualOption).toBe(true)
    expect(flowStub.props?.showCodexSessionImportOption).toBe(true)
    expect(flowStub.props?.showAgentIdentityOption).toBe(true)
    expect(flowStub.props?.showCodexPatOption).toBe(true)
    expect(flowStub.props?.initialInputMethod).toBe('manual')
  })

  it.each([
    ['camelCase', { authMode: 'agentIdentity', agentIdentity: { agentRuntimeId: 'runtime' } }],
    ['nested identity without auth_mode', { agent_identity: { agent_runtime_id: 'runtime' } }]
  ])('accepts backend-compatible %s Agent Identity imports', async (_name, content) => {
    await openCodexImportStep()
    flowStub.inputMethod = 'agent_identity'

    await act(async () => {
      flowStub.props?.onImportCodexSession(JSON.stringify(content))
    })
    await flushPromises()

    expect(importCodexSessionMock).toHaveBeenCalledTimes(1)
  })

  it('sends true explicitly when OpenAI long-context billing is enabled', async () => {
    await submitApiKeyAccount('openai', true)

    expect(createAccountMock).toHaveBeenCalledTimes(1)
    expect(createAccountMock.mock.calls[0]?.[0]?.extra?.openai_long_context_billing_enabled).toBe(true)
  })

  it('omits the OpenAI setting for non-OpenAI account creation', async () => {
    await submitApiKeyAccount('anthropic')

    expect(createAccountMock).toHaveBeenCalledTimes(1)
    expect(createAccountMock.mock.calls[0]?.[0]?.extra?.openai_long_context_billing_enabled).toBeUndefined()
    // 上游倍率探测已放宽到全部 API-key 平台：非 OpenAI 平台与 OpenAI 一致，默认开启。
    expect(createAccountMock.mock.calls[0]?.[0]?.upstream_billing_probe_enabled).toBe(true)
  })

  it('sends an explicit disabled state when the non-OpenAI create toggle is turned off', async () => {
    await submitApiKeyAccount('anthropic', false, true)

    expect(createAccountMock.mock.calls[0]?.[0]?.upstream_billing_probe_enabled).toBe(false)
  })

  it('antigravity upstream 创建默认携带上游倍率探测开关', async () => {
    // antigravity upstream 走独立创建 helper，
    // 也必须与其余 API-key 平台一样默认开启探测并传递开关。
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'Antigravity')
    await selectButtonByText(wrapper, 'admin.accounts.types.antigravityApikey')
    await setValue(textInput(wrapper), 'antigravity relay')
    const baseInput = Array.from(wrapper.container.querySelectorAll('input')).find(
      (candidate) => candidate.getAttribute('placeholder') === 'https://cloudcode-pa.googleapis.com'
    )
    expect(baseInput).toBeDefined()
    await setValue(baseInput!, 'https://relay.example')
    await setValue(passwordInput(wrapper), 'sk-upstream')
    await submit(wrapper)
    await flushPromises()

    expect(createAccountMock).toHaveBeenCalledTimes(1)
    const payload = createAccountMock.mock.calls[0]?.[0]
    expect(payload?.platform).toBe('antigravity')
    expect(payload?.type).toBe('apikey')
    expect(payload?.upstream_billing_probe_enabled).toBe(true)
    // 创建成功后前端立即发起一次首探（与其他 apikey 平台一致）。
    expect(probeUpstreamBillingMock).toHaveBeenCalledWith(42)
  })

  it('leaves Codex session import billing ownership to the backend', async () => {
    await openCodexImportStep()
    await click(screen.getByTestId('import-codex-session'))
    await flushPromises()

    expect(importCodexSessionMock).toHaveBeenCalledTimes(1)
    expect(importCodexSessionMock.mock.calls[0]?.[0]?.extra?.openai_long_context_billing_enabled).toBeUndefined()
  })

  it('leaves Codex PAT import billing ownership to the backend', async () => {
    await openCodexImportStep()
    await click(screen.getByTestId('import-codex-pat'))
    await flushPromises()

    expect(createOpenAICodexPATMock).toHaveBeenCalledTimes(1)
    expect(createOpenAICodexPATMock.mock.calls[0]?.[0]?.extra?.openai_long_context_billing_enabled).toBeUndefined()
  })

  it('sends explicit true for Codex session import after the toggle is enabled', async () => {
    await openCodexImportStep(1)
    await click(screen.getByTestId('import-codex-session'))
    await flushPromises()

    expect(importCodexSessionMock.mock.calls[0]?.[0]?.extra?.openai_long_context_billing_enabled).toBe(true)
  })

  it('sends explicit false for Codex session import after the toggle is changed back', async () => {
    await openCodexImportStep(2)
    await click(screen.getByTestId('import-codex-session'))
    await flushPromises()

    expect(importCodexSessionMock.mock.calls[0]?.[0]?.extra?.openai_long_context_billing_enabled).toBe(false)
  })

  it('sends explicit true for Codex PAT import after the toggle is enabled', async () => {
    await openCodexImportStep(1)
    await click(screen.getByTestId('import-codex-pat'))
    await flushPromises()

    expect(createOpenAICodexPATMock.mock.calls[0]?.[0]?.extra?.openai_long_context_billing_enabled).toBe(true)
  })

  it('sends explicit false for Codex PAT import after the toggle is changed back', async () => {
    await openCodexImportStep(2)
    await click(screen.getByTestId('import-codex-pat'))
    await flushPromises()

    expect(createOpenAICodexPATMock.mock.calls[0]?.[0]?.extra?.openai_long_context_billing_enabled).toBe(false)
  })
})

describe('CreateAccountModal gemini explicit cache upstream switch', () => {
  beforeEach(() => {
    authIsSimpleMode.value = true
    createAccountMock.mockReset().mockResolvedValue({ id: 43, platform: 'gemini', type: 'apikey' })
    probeUpstreamBillingMock.mockReset().mockResolvedValue({})
    syncUpstreamModelsMock.mockReset().mockResolvedValue({ models: [], metadata: {} })
  })

  const geminiBaseUrlInput = (wrapper: Wrapper) =>
    Array.from(wrapper.container.querySelectorAll<HTMLInputElement>('form#create-account-form input[type="text"]')).find(
      (input) => input.value === 'https://generativelanguage.googleapis.com'
    )

  it('only offers the switch for a custom base url and sends it on create', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'Gemini')
    await selectButtonByText(wrapper, 'admin.accounts.gemini.accountType.apiKeyTitle')
    expect(screen.queryByTestId('explicit-cache-upstream-section')).toBeNull()

    const baseUrlInput = geminiBaseUrlInput(wrapper)
    expect(baseUrlInput).toBeDefined()
    await setValue(baseUrlInput!, 'https://upstream.example.com')
    expect(screen.queryByTestId('explicit-cache-upstream-section')).not.toBeNull()

    await clickToggle('explicit-cache-upstream-toggle')
    await setValue(screen.getByTestId('explicit-cache-upstream-max-ttl'), '1800')
    await setValue(textInput(wrapper), 'gemini upstream gateway')
    await setValue(passwordInput(wrapper), 'sk-upstream')
    await submit(wrapper)
    await flushPromises()

    expect(createAccountMock).toHaveBeenCalledTimes(1)
    expect(createAccountMock.mock.calls[0]?.[0]?.credentials).toMatchObject({
      base_url: 'https://upstream.example.com',
      explicit_cache_upstream: true,
      explicit_cache_upstream_max_ttl_seconds: 1800
    })
  })

  it('only offers the AI Studio tier for the official base url', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'Gemini')
    await selectButtonByText(wrapper, 'admin.accounts.gemini.accountType.apiKeyTitle')
    expect(screen.queryByTestId('gemini-oauth-tier')).toBeNull()
    expect(screen.queryByTestId('gemini-apikey-note')).not.toBeNull()
    await setValue(screen.getByTestId('gemini-apikey-tier'), 'aistudio_paid')

    const baseUrlInput = geminiBaseUrlInput(wrapper)
    expect(baseUrlInput).toBeDefined()
    await setValue(baseUrlInput!, 'https://upstream.example.com')
    expect(screen.queryByTestId('gemini-apikey-tier')).toBeNull()
    expect(screen.queryByTestId('gemini-apikey-note')).toBeNull()

    await setValue(textInput(wrapper), 'gemini relay')
    await setValue(passwordInput(wrapper), 'sk-upstream')
    await submit(wrapper)
    await flushPromises()

    expect(createAccountMock).toHaveBeenCalledTimes(1)
    const credentials = createAccountMock.mock.calls[0]?.[0]?.credentials
    expect(credentials).toMatchObject({ base_url: 'https://upstream.example.com' })
    expect(credentials).not.toHaveProperty('tier_id')
  })

  it('shows the OAuth tier fallback only on the OAuth form', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'Gemini')
    await selectButtonByText(wrapper, 'admin.accounts.gemini.accountType.oauthTitle')
    expect(screen.queryByTestId('gemini-oauth-tier')).not.toBeNull()
    expect(screen.queryByTestId('gemini-apikey-note')).toBeNull()
  })

  it('keeps the selected AI Studio tier for the official base url', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'Gemini')
    await selectButtonByText(wrapper, 'admin.accounts.gemini.accountType.apiKeyTitle')
    await setValue(screen.getByTestId('gemini-apikey-tier'), 'aistudio_paid')
    await setValue(textInput(wrapper), 'gemini official')
    await setValue(passwordInput(wrapper), 'AIza-official')
    await submit(wrapper)
    await flushPromises()

    expect(createAccountMock).toHaveBeenCalledTimes(1)
    expect(createAccountMock.mock.calls[0]?.[0]?.credentials).toMatchObject({
      base_url: 'https://generativelanguage.googleapis.com',
      tier_id: 'aistudio_paid'
    })
  })
})

describe('CreateAccountModal Vertex API key auth', () => {
  beforeEach(() => {
    authIsSimpleMode.value = true
    createAccountMock.mockReset().mockResolvedValue({ id: 44, platform: 'gemini', type: 'service_account' })
    probeUpstreamBillingMock.mockReset().mockResolvedValue({})
    syncUpstreamModelsMock.mockReset().mockResolvedValue({ models: [], metadata: {} })
  })

  async function openGeminiVertexApiKeyForm() {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'Gemini')
    await selectButtonByText(wrapper, 'admin.accounts.vertexLabel')
    // Vue 版 data-testid="vertex-auth-mode-apikey" 的原生单选框，这里是 Arc radio-group 的同名选项
    await click(screen.getByRole('radio', { name: 'admin.accounts.vertexAuthModeApiKey' }))
    await setValue(textInput(wrapper), 'vertex api key account')
    await setValue(screen.getByTestId('vertex-api-key-input'), ' vertex-key ')
    return wrapper
  }

  it('creates a Gemini Vertex account with API key auth and no project for the express endpoint', async () => {
    const wrapper = await openGeminiVertexApiKeyForm()
    await submit(wrapper)
    await flushPromises()

    expect(createAccountMock).toHaveBeenCalledTimes(1)
    const payload = createAccountMock.mock.calls[0]?.[0]
    expect(payload?.platform).toBe('gemini')
    expect(payload?.type).toBe('service_account')
    expect(payload?.credentials).toEqual({
      auth_mode: 'apikey',
      api_key: 'vertex-key',
      location: 'global',
      tier_id: 'vertex'
    })
  })

  it('sends the project id when an API key account targets a project endpoint', async () => {
    const wrapper = await openGeminiVertexApiKeyForm()
    await setValue(screen.getByTestId('vertex-api-key-project-id-input'), ' my-project ')
    await submit(wrapper)
    await flushPromises()

    expect(createAccountMock.mock.calls[0]?.[0]?.credentials).toMatchObject({
      auth_mode: 'apikey',
      api_key: 'vertex-key',
      project_id: 'my-project',
      location: 'global'
    })
  })

  it('keeps Anthropic Vertex accounts on Service Account JSON only', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'admin.accounts.vertexLabel')
    expect(screen.queryByRole('radio', { name: 'admin.accounts.vertexAuthModeApiKey' })).toBeNull()
    expect(screen.queryByTestId('vertex-api-key-input')).toBeNull()
  })
})

// Vue 版 CreateAccountModal.grok.spec.ts 只检查源码文本；这里改为对同样约束的行为断言。
describe('CreateAccountModal Grok account types', () => {
  beforeEach(() => {
    createAccountMock.mockReset().mockResolvedValue({ id: 45, platform: 'grok', type: 'apikey' })
    probeUpstreamBillingMock.mockReset().mockResolvedValue({})
    syncUpstreamModelsMock.mockReset().mockResolvedValue({ models: [], metadata: {} })
  })

  it('offers API-key setup alongside OAuth with the official xAI default', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'Grok')
    await click(screen.getByTestId('grok-account-type-api-key'))

    expect(passwordInput(wrapper).getAttribute('placeholder')).toBe('xai-...')
    const baseUrl = Array.from(wrapper.container.querySelectorAll<HTMLInputElement>('input[type="text"]')).find(
      (input) => input.value === 'https://api.x.ai/v1'
    )
    expect(baseUrl).toBeDefined()

    await setValue(textInput(wrapper), 'grok key')
    await setValue(passwordInput(wrapper), 'xai-test')
    await submit(wrapper)
    await flushPromises()

    expect(createAccountMock.mock.calls[0]?.[0]).toMatchObject({
      platform: 'grok',
      type: 'apikey',
      credentials: { base_url: 'https://api.x.ai/v1', api_key: 'xai-test' }
    })
  })

  it('exposes custom upstream URL and header override for the OAuth create flow', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'Grok')
    expect(screen.queryByTestId('grok-custom-base-url-input')).toBeNull()
    await clickToggle('grok-custom-base-url-toggle')
    expect(screen.getByTestId('grok-custom-base-url-input')).toBeInTheDocument()
    expect(wrapper.container.textContent).toContain('admin.accounts.headerOverride.title')

    await click(screen.getByTestId('grok-account-type-api-key'))
    expect(screen.queryByTestId('grok-custom-base-url-toggle')).toBeNull()
  })

  it('hides Grok password authorize option in the create flow', async () => {
    const wrapper = mountModal()
    await selectButtonByText(wrapper, 'Grok')
    await setValue(textInput(wrapper), 'grok oauth')
    await submit(wrapper)
    await flushPromises()

    expect(flowStub.props?.showEmailPasswordOption).toBe(false)
    expect(flowStub.props?.showSsoOption).toBe(true)
  })
})
