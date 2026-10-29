import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { adminAPI } from '@/api/admin'
import BulkEditAccountModal, { type BulkEditAccountModalProps } from '../BulkEditAccountModal'

const { showError, showSuccess, showInfo, translate } = vi.hoisted(() => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showInfo: vi.fn(),
  translate: vi.fn((key: string) => key)
}))

vi.mock('@/stores/app', () => {
  const state = { showError, showSuccess, showInfo }
  return {
    useAppStore: Object.assign((selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state), {
      getState: () => state
    })
  }
})

vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      bulkUpdate: vi.fn(),
      checkMixedChannelRisk: vi.fn()
    }
  }
}))

vi.mock('@/api/admin/accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/admin/accounts')>()),
  getAntigravityDefaultModelMapping: vi.fn()
}))

// t 需保持稳定引用（与真实 useI18n 一致）
const i18n = vi.hoisted(() => ({ te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ ...i18n, t: translate }) }))

// Vue 版把 BaseDialog 桩成始终渲染插槽；这里同样让抽屉始终渲染内容与底部，便于在 show=false 后检查重置结果
vi.mock('@/components/account/AccountFormLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/account/AccountFormLayout')>()),
  AccountFormDrawer: ({ children, footer }: { children: ReactNode; footer?: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  )
}))

// Vue 版 Select 桩：原生 select，透传 data-testid / disabled
vi.mock('@/components/common/Select', () => ({
  default: (props: {
    value: string
    options: Array<{ value: string; label: string }>
    onChange?: (value: string) => void
    disabled?: boolean
    'data-testid'?: string
  }) => (
    <select
      data-testid={props['data-testid']}
      disabled={props.disabled}
      value={props.value}
      onChange={(event) => props.onChange?.(event.target.value)}
    >
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}))
vi.mock('@/components/common/ProxySelector', () => ({ default: () => null }))
vi.mock('@/components/common/GroupSelector', () => ({ default: () => null }))
vi.mock('@/components/common/ModelIcon', () => ({ default: () => null }))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

const baseProps: BulkEditAccountModalProps = {
  show: true,
  accountIds: [1, 2],
  selectedPlatforms: ['antigravity'],
  selectedTypes: ['apikey'],
  proxies: [],
  groups: [],
  onClose: vi.fn(),
  onUpdated: vi.fn()
}

function mountModal(extraProps: Partial<BulkEditAccountModalProps> = {}) {
  const onClose = vi.fn()
  const props = { ...baseProps, onClose, ...extraProps }
  const view = render(<BulkEditAccountModal {...props} />)
  return {
    ...view,
    onClose,
    setProps: (next: Partial<BulkEditAccountModalProps>) => {
      Object.assign(props, next)
      view.rerender(<BulkEditAccountModal {...props} />)
    }
  }
}

const byId = (id: string) => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} not found`)
  return el
}
const exists = (id: string) => document.getElementById(id) !== null

/** Vue 版 setValue(true/false) 作用于勾选框：只在状态不同时点击 */
const setChecked = (el: HTMLElement, value: boolean) => {
  if ((el.getAttribute('aria-checked') === 'true') !== value) fireEvent.click(el)
}
const enable = (id: string) => setChecked(byId(id), true)
const submit = async () => {
  fireEvent.submit(byId('bulk-edit-account-form'))
  await flushPromises()
}
const selectValue = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } })

describe('BulkEditAccountModal', () => {
  beforeEach(() => {
    vi.mocked(adminAPI.accounts.bulkUpdate).mockReset()
    vi.mocked(adminAPI.accounts.checkMixedChannelRisk).mockReset()
    showError.mockReset()
    showSuccess.mockReset()
    translate.mockClear()

    vi.mocked(adminAPI.accounts.bulkUpdate).mockResolvedValue({
      success: 2,
      failed: 0,
      results: []
    } as any)
    vi.mocked(adminAPI.accounts.checkMixedChannelRisk).mockResolvedValue({
      has_risk: false
    } as any)
  })

  it('批量修改倍率时提示自动同步账号需要先关闭同步', () => {
    mountModal()

    expect(screen.queryByTestId('bulk-rate-sync-warning')).toBeNull()
    enable('bulk-edit-rate-multiplier-enabled')

    expect(screen.getByTestId('bulk-rate-sync-warning').textContent).toContain('admin.accounts.bulkEdit.rateSyncWarning')
  })

  it('后端拒绝修改同步账号倍率时展示专用错误', async () => {
    vi.mocked(adminAPI.accounts.bulkUpdate).mockRejectedValueOnce({
      status: 409,
      reason: 'UPSTREAM_BILLING_RATE_SYNC_BULK_CONFLICT',
      metadata: { count: '2' },
      message: 'conflict'
    })
    mountModal()

    enable('bulk-edit-rate-multiplier-enabled')
    await submit()

    expect(showError).toHaveBeenCalledWith('admin.accounts.bulkEdit.rateSyncConflict')
  })

  it('antigravity 白名单包含 Gemini 图片模型且过滤掉普通 GPT 模型', () => {
    mountModal()
    const trigger = screen.getByTestId('model-whitelist-trigger')
    expect(trigger).toBeInTheDocument()

    fireEvent.click(trigger)

    expect(document.body.textContent).toContain('gemini-3.1-flash-image')
    expect(document.body.textContent).toContain('gemini-2.5-flash-image')
    expect(document.body.textContent).not.toContain('gpt-5.3-codex')
  })

  it('antigravity 映射预设包含图片映射并过滤 OpenAI 预设', () => {
    mountModal()

    const mappingTab = screen.getAllByRole('button').find((btn) => btn.textContent?.includes('admin.accounts.modelMapping'))
    expect(mappingTab).toBeTruthy()
    fireEvent.click(mappingTab!)

    expect(document.body.textContent).toContain('3.1-Flash-Image透传')
    expect(document.body.textContent).toContain('3-Pro-Image→3.1')
    expect(document.body.textContent).not.toContain('GPT-5.3 Codex Spark')
  })

  it('仅勾选模型限制且白名单留空时，应提交空 model_mapping 以支持所有模型', async () => {
    mountModal({
      selectedPlatforms: ['anthropic'],
      selectedTypes: ['apikey']
    })

    enable('bulk-edit-model-restriction-enabled')
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      credentials: {
        model_mapping: {}
      }
    })
  })

  it('全部目标为 Grok OAuth 时，官方主机 base_url 作为手动端点切换正常提交', async () => {
    mountModal({
      selectedPlatforms: ['grok'],
      selectedTypes: ['oauth']
    })

    enable('bulk-edit-base-url-enabled')
    fireEvent.change(byId('bulk-edit-base-url'), { target: { value: 'https://api.x.ai/v1' } })
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      credentials: {
        base_url: 'https://api.x.ai/v1'
      }
    })
  })

  it('所选全为 grok 时展示快捷端点，点击后填入并自动勾选 base_url', async () => {
    mountModal({
      selectedPlatforms: ['grok'],
      selectedTypes: ['oauth']
    })

    const presets = screen.getAllByTestId('grok-base-url-preset')
    expect(presets.length).toBe(5)

    // 第三个预设为区域 API (us-east-1.api.x.ai/v1)
    fireEvent.click(presets[2])
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      credentials: {
        base_url: 'https://us-east-1.api.x.ai/v1'
      }
    })
  })

  it('所选含非 grok 平台时不展示快捷端点', () => {
    mountModal({
      selectedPlatforms: ['grok', 'anthropic'],
      selectedTypes: ['apikey']
    })

    expect(screen.queryAllByTestId('grok-base-url-preset').length).toBe(0)
  })

  it.each(['kimi', 'zhipu', 'deepseek', 'minimax'] as const)('全部目标为 %s API Key 时展示请求头覆写', (platform) => {
    mountModal({
      selectedPlatforms: [platform],
      selectedTypes: ['apikey']
    })

    expect(exists('bulk-edit-header-override-enabled')).toBe(true)
  })

  it.each(['kimi', 'zhipu', 'deepseek', 'minimax'] as const)('目标为 %s OAuth 时不展示请求头覆写', (platform) => {
    mountModal({
      selectedPlatforms: [platform],
      selectedTypes: ['oauth']
    })

    expect(exists('bulk-edit-header-override-enabled')).toBe(false)
  })

  it('全部目标为 Grok OAuth 时，第三方 base_url 正常提交', async () => {
    mountModal({
      selectedPlatforms: ['grok'],
      selectedTypes: ['oauth']
    })

    enable('bulk-edit-base-url-enabled')
    fireEvent.change(byId('bulk-edit-base-url'), { target: { value: 'https://relay.example.com/v1' } })
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      credentials: {
        base_url: 'https://relay.example.com/v1'
      }
    })
  })

  it('混合类型选择（含 apikey）时官方主机 base_url 不拦截', async () => {
    mountModal({
      selectedPlatforms: ['grok'],
      selectedTypes: ['apikey', 'oauth']
    })

    enable('bulk-edit-base-url-enabled')
    fireEvent.change(byId('bulk-edit-base-url'), { target: { value: 'https://api.x.ai/v1' } })
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      credentials: {
        base_url: 'https://api.x.ai/v1'
      }
    })
  })

  it('OpenAI 账号批量编辑可开启自动透传', async () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['oauth']
    })

    enable('bulk-edit-openai-passthrough-enabled')
    fireEvent.click(byId('bulk-edit-openai-passthrough-toggle'))
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      extra: {
        openai_passthrough: true
      }
    })
  })

  it('OpenAI OAuth 批量编辑可开启 namespace 摊平兼容开关', async () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['oauth']
    })

    enable('bulk-edit-openai-flatten-namespaces-enabled')
    fireEvent.click(byId('bulk-edit-openai-flatten-namespaces-toggle'))
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      extra: {
        openai_responses_flatten_namespaces: true
      }
    })
  })

  it('namespace 摊平开关不对 setup-token 等非 OAuth 选择展示', () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['oauth', 'setup-token']
    })

    expect(exists('bulk-edit-openai-flatten-namespaces-enabled')).toBe(false)
  })

  it('OpenAI OAuth 批量编辑应提交 OAuth 专属 WS mode 字段（含 http_bridge）', async () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['oauth']
    })

    enable('bulk-edit-openai-ws-mode-enabled')
    selectValue('bulk-edit-openai-ws-mode-select', 'http_bridge')
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      extra: {
        openai_oauth_responses_websockets_v2_mode: 'http_bridge',
        openai_oauth_responses_websockets_v2_enabled: true
      }
    })
  })

  it('OpenAI API Key 批量编辑不显示 WS mode 入口', () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['apikey']
    })

    expect(exists('bulk-edit-openai-ws-mode-enabled')).toBe(false)
  })

  it('OpenAI OAuth 批量编辑应提交 codex_cli_only 字段', async () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['oauth']
    })

    enable('bulk-edit-openai-codex-cli-only-enabled')
    fireEvent.click(byId('bulk-edit-openai-codex-cli-only-toggle'))
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      extra: {
        codex_cli_only: true
      }
    })
  })

  it('OpenAI OAuth 批量编辑应提交 codex_cli_only_allow_app_server 字段（需同时开启父开关）', async () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['oauth']
    })

    // 子开关从属于 codex_cli_only：必须同时批量开启父开关才写入
    enable('bulk-edit-openai-codex-cli-only-enabled')
    fireEvent.click(byId('bulk-edit-openai-codex-cli-only-toggle'))
    enable('bulk-edit-openai-codex-app-server-enabled')
    fireEvent.click(byId('bulk-edit-openai-codex-app-server-toggle'))
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      extra: {
        codex_cli_only: true,
        codex_cli_only_allow_app_server: true
      }
    })
  })

  it('未同时开启父开关时不应写入 codex_cli_only_allow_app_server', async () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['oauth']
    })

    // 仅开启子开关、不批量设置父开关 codex_cli_only：不应写入孤立字段，也不应调用接口
    enable('bulk-edit-openai-codex-app-server-enabled')
    fireEvent.click(byId('bulk-edit-openai-codex-app-server-toggle'))
    await submit()

    expect(adminAPI.accounts.bulkUpdate).not.toHaveBeenCalled()
  })

  it('OpenAI API Key 批量编辑应提交 API Key 专属 WS mode 字段', async () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['apikey']
    })

    enable('bulk-edit-openai-apikey-ws-mode-enabled')
    selectValue('bulk-edit-openai-apikey-ws-mode-select', 'ctx_pool')
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      extra: {
        openai_apikey_responses_websockets_v2_mode: 'ctx_pool',
        openai_apikey_responses_websockets_v2_enabled: true
      }
    })
  })

  it('OpenAI 支持类型展示长上下文设置，混合平台隐藏全部新增设置', () => {
    for (const selectedTypes of [['oauth'], ['setup-token'], ['apikey'], ['oauth', 'setup-token', 'apikey']] as const) {
      const view = mountModal({
        selectedPlatforms: ['openai'],
        selectedTypes: [...selectedTypes]
      })
      expect(exists('bulk-edit-openai-long-context-billing-enabled')).toBe(true)
      view.unmount()
    }

    mountModal({
      selectedPlatforms: ['openai', 'anthropic'],
      selectedTypes: ['apikey']
    })
    expect(exists('bulk-edit-openai-long-context-billing-enabled')).toBe(false)
    expect(exists('bulk-edit-openai-endpoint-capabilities-enabled')).toBe(false)
    expect(exists('bulk-edit-openai-responses-mode-enabled')).toBe(false)
  })

  it('端点能力与 Responses 路由仅对全部 OpenAI API Key 目标展示', () => {
    const apiKey = mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['apikey']
    })
    expect(exists('bulk-edit-openai-endpoint-capabilities-enabled')).toBe(true)
    expect(exists('bulk-edit-openai-responses-mode-enabled')).toBe(true)
    apiKey.unmount()

    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['oauth']
    })
    expect(exists('bulk-edit-openai-endpoint-capabilities-enabled')).toBe(false)
    expect(exists('bulk-edit-openai-responses-mode-enabled')).toBe(false)
  })

  it('长上下文设置独立启用并提交布尔值', async () => {
    const enabledView = mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['oauth']
    })

    enable('bulk-edit-openai-long-context-billing-enabled')
    fireEvent.click(screen.getByTestId('bulk-edit-openai-long-context-billing-toggle'))
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenLastCalledWith([1, 2], {
      extra: { openai_long_context_billing_enabled: true }
    })
    enabledView.unmount()

    vi.mocked(adminAPI.accounts.bulkUpdate).mockClear()
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['setup-token']
    })
    enable('bulk-edit-openai-long-context-billing-enabled')
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      extra: { openai_long_context_billing_enabled: false }
    })
  })

  it('端点能力默认值提交 null，表示恢复两个默认端点', async () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['apikey']
    })

    enable('bulk-edit-openai-endpoint-capabilities-enabled')
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      credentials: { openai_capabilities: null }
    })
  })

  it('Responses 路由独立启用，auto 提交 null，强制模式提交明确值', async () => {
    const autoView = mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['apikey']
    })
    enable('bulk-edit-openai-responses-mode-enabled')
    await submit()
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenLastCalledWith([1, 2], {
      extra: { openai_responses_mode: null }
    })
    autoView.unmount()

    vi.mocked(adminAPI.accounts.bulkUpdate).mockClear()
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['apikey']
    })
    enable('bulk-edit-openai-responses-mode-enabled')
    selectValue('bulk-edit-openai-responses-mode-select', 'force_responses')
    await submit()
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      extra: { openai_responses_mode: 'force_responses' }
    })
  })

  it('仅启用 Embeddings 时恢复 Responses 自动模式并精确提交联动字段', async () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['apikey']
    })

    enable('bulk-edit-openai-endpoint-capabilities-enabled')
    enable('bulk-edit-openai-responses-mode-enabled')
    selectValue('bulk-edit-openai-responses-mode-select', 'force_chat_completions')
    setChecked(screen.getByTestId('bulk-edit-openai-endpoint-capability-chat_completions'), false)

    expect((screen.getByTestId('bulk-edit-openai-responses-mode-select') as HTMLSelectElement).value).toBe('auto')
    expect(screen.queryByTestId('bulk-edit-openai-responses-mode-not-applicable')).not.toBeNull()

    await submit()
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      credentials: { openai_capabilities: ['embeddings'] },
      extra: { openai_responses_mode: null }
    })
  })

  it('persists Seedance in a two-capability bulk update', async () => {
    mountModal({ selectedPlatforms: ['openai'], selectedTypes: ['apikey'] })
    enable('bulk-edit-openai-endpoint-capabilities-enabled')
    setChecked(screen.getByTestId('bulk-edit-openai-endpoint-capability-embeddings'), false)
    setChecked(screen.getByTestId('bulk-edit-openai-endpoint-capability-seedance'), true)
    await submit()
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      credentials: { openai_capabilities: ['chat_completions', 'seedance'] }
    })
  })

  it('关闭端点能力修改后 Responses 路由恢复独立可编辑', async () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['apikey']
    })

    enable('bulk-edit-openai-endpoint-capabilities-enabled')
    setChecked(screen.getByTestId('bulk-edit-openai-endpoint-capability-chat_completions'), false)
    setChecked(byId('bulk-edit-openai-endpoint-capabilities-enabled'), false)
    enable('bulk-edit-openai-responses-mode-enabled')

    const select = screen.getByTestId('bulk-edit-openai-responses-mode-select')
    expect(select).not.toBeDisabled()
    fireEvent.change(select, { target: { value: 'force_responses' } })
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      extra: { openai_responses_mode: 'force_responses' }
    })
  })

  it('目标变化后不提交已经隐藏的 OpenAI 设置', async () => {
    const view = mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['apikey']
    })

    enable('bulk-edit-openai-long-context-billing-enabled')
    enable('bulk-edit-openai-endpoint-capabilities-enabled')
    enable('bulk-edit-openai-responses-mode-enabled')
    view.setProps({ selectedPlatforms: ['anthropic'], selectedTypes: ['apikey'] })
    enable('bulk-edit-status-enabled')
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      status: 'active'
    })
  })

  it('至少保留一个端点能力', () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['apikey']
    })
    enable('bulk-edit-openai-endpoint-capabilities-enabled')
    setChecked(screen.getByTestId('bulk-edit-openai-endpoint-capability-chat_completions'), false)
    setChecked(screen.getByTestId('bulk-edit-openai-endpoint-capability-embeddings'), false)

    expect(screen.getByTestId('bulk-edit-openai-endpoint-capability-embeddings')).toHaveAttribute('aria-checked', 'true')
  })

  it('关闭弹窗后重置新增设置的启用状态和值', () => {
    const view = mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['apikey']
    })
    enable('bulk-edit-openai-long-context-billing-enabled')
    fireEvent.click(screen.getByTestId('bulk-edit-openai-long-context-billing-toggle'))
    enable('bulk-edit-openai-endpoint-capabilities-enabled')
    setChecked(screen.getByTestId('bulk-edit-openai-endpoint-capability-chat_completions'), false)
    enable('bulk-edit-openai-responses-mode-enabled')

    view.setProps({ show: false })

    expect(byId('bulk-edit-openai-long-context-billing-enabled')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('bulk-edit-openai-long-context-billing-toggle')).toHaveAttribute('aria-checked', 'false')
    expect(byId('bulk-edit-openai-endpoint-capabilities-enabled')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('bulk-edit-openai-endpoint-capability-chat_completions')).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect((screen.getByTestId('bulk-edit-openai-responses-mode-select') as HTMLSelectElement).value).toBe('auto')
  })

  it('筛选全量模式固定展示影子继承说明并按 filters 提交', async () => {
    mountModal({
      accountIds: [],
      selectedPlatforms: [],
      selectedTypes: [],
      target: {
        mode: 'filtered',
        filters: { platform: 'openai', type: 'oauth', status: 'active' },
        previewCount: 20,
        selectedPlatforms: ['openai'],
        selectedTypes: ['oauth']
      }
    })

    expect(screen.getByTestId('bulk-edit-openai-long-context-shadow-hint').textContent).toContain(
      'admin.accounts.bulkEdit.longContextShadowHint'
    )
    enable('bulk-edit-openai-long-context-billing-enabled')
    fireEvent.click(screen.getByTestId('bulk-edit-openai-long-context-billing-toggle'))
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith({
      filters: { platform: 'openai', type: 'oauth', status: 'active' },
      extra: { openai_long_context_billing_enabled: true }
    })
  })

  it('成功响应包含影子继承数量时展示专用提示', async () => {
    vi.mocked(adminAPI.accounts.bulkUpdate).mockResolvedValueOnce({
      success: 2,
      failed: 0,
      long_context_inherited_count: 1,
      results: []
    } as any)
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['oauth']
    })
    enable('bulk-edit-openai-long-context-billing-enabled')
    await submit()

    expect(showSuccess).toHaveBeenCalledWith('admin.accounts.bulkEdit.successWithInherited')
    expect(translate).toHaveBeenCalledWith('admin.accounts.bulkEdit.successWithInherited', {
      count: 2,
      inherited: 1
    })
  })

  it('部分成功且包含影子继承数量时展示组合提示', async () => {
    vi.mocked(adminAPI.accounts.bulkUpdate).mockResolvedValueOnce({
      success: 1,
      failed: 1,
      long_context_inherited_count: 1,
      results: []
    } as any)
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['oauth']
    })
    enable('bulk-edit-openai-long-context-billing-enabled')
    await submit()

    expect(showError).toHaveBeenCalledWith('admin.accounts.bulkEdit.partialSuccessWithInherited')
    expect(translate).toHaveBeenCalledWith('admin.accounts.bulkEdit.partialSuccessWithInherited', {
      success: 1,
      failed: 1,
      inherited: 1
    })
  })

  it('全影子长上下文错误使用专用提示并保持弹窗打开', async () => {
    vi.mocked(adminAPI.accounts.bulkUpdate).mockRejectedValueOnce({
      status: 400,
      reason: 'OPENAI_LONG_CONTEXT_PARENT_REQUIRED',
      message: 'select parent'
    })
    const view = mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['oauth']
    })
    enable('bulk-edit-openai-long-context-billing-enabled')
    await submit()

    expect(showError).toHaveBeenCalledWith('admin.accounts.bulkEdit.longContextParentRequired')
    expect(view.onClose).not.toHaveBeenCalled()
  })

  it('OpenAI API Key 批量编辑可统一开启上游倍率自动探测', async () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['apikey']
    })

    enable('bulk-edit-upstream-billing-auto-probe-enabled')
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      upstream_billing_probe_enabled: true
    })
  })

  it('非 OpenAI 平台的 API Key 批量编辑同样可开启上游倍率自动探测', async () => {
    // 探测已放宽到全部 API-key 平台，混合平台选择只要求类型全为 apikey。
    mountModal({
      selectedPlatforms: ['grok', 'anthropic'],
      selectedTypes: ['apikey']
    })

    enable('bulk-edit-upstream-billing-auto-probe-enabled')
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      upstream_billing_probe_enabled: true
    })
  })

  it('OpenAI API Key 批量编辑可统一关闭上游倍率自动探测', async () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['apikey']
    })

    enable('bulk-edit-upstream-billing-auto-probe-enabled')
    selectValue('bulk-edit-upstream-billing-auto-probe-select', 'disabled')
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      upstream_billing_probe_enabled: false
    })
  })

  it('非 OpenAI API Key 目标不显示上游倍率自动探测批量开关', () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['oauth']
    })

    expect(exists('bulk-edit-upstream-billing-auto-probe-enabled')).toBe(false)
  })

  it('筛选结果批量编辑可统一开启上游倍率自动探测', async () => {
    mountModal({
      accountIds: [],
      selectedPlatforms: [],
      selectedTypes: [],
      target: {
        mode: 'filtered',
        filters: { platform: 'openai', type: 'apikey', status: 'active' },
        previewCount: 20,
        selectedPlatforms: ['openai'],
        selectedTypes: ['apikey']
      }
    })

    enable('bulk-edit-upstream-billing-auto-probe-enabled')
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith({
      filters: { platform: 'openai', type: 'apikey', status: 'active' },
      upstream_billing_probe_enabled: true
    })
  })

  it('筛选 OpenAI 账号批量编辑应提交 Compact 模式和专属模型映射', async () => {
    mountModal({
      accountIds: [],
      selectedPlatforms: [],
      selectedTypes: [],
      target: {
        mode: 'filtered',
        filters: { platform: 'openai' },
        previewCount: 12,
        selectedPlatforms: ['openai'],
        selectedTypes: ['oauth', 'apikey']
      }
    })

    enable('bulk-edit-openai-compact-mode-enabled')
    selectValue('bulk-edit-openai-compact-mode-select', 'force_on')
    enable('bulk-edit-openai-compact-model-mapping-enabled')
    fireEvent.click(screen.getByTestId('bulk-edit-openai-compact-model-mapping-add'))
    const inputs = screen.getAllByTestId('bulk-edit-openai-compact-model-mapping-input')
    fireEvent.change(inputs[0], { target: { value: 'gpt-5.4' } })
    fireEvent.change(inputs[1], { target: { value: 'gpt-5.4-openai-compact' } })
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith({
      filters: { platform: 'openai' },
      extra: {
        openai_compact_mode: 'force_on'
      },
      credentials: {
        compact_model_mapping: {
          'gpt-5.4': 'gpt-5.4-openai-compact'
        }
      }
    })
  })

  it('OpenAI 账号批量编辑可关闭自动透传', async () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['apikey']
    })

    enable('bulk-edit-openai-passthrough-enabled')
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      extra: {
        openai_passthrough: false,
        openai_oauth_passthrough: false
      }
    })
  })

  it('开启 OpenAI 自动透传时不再同时提交模型限制', async () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['oauth']
    })

    enable('bulk-edit-openai-passthrough-enabled')
    fireEvent.click(byId('bulk-edit-openai-passthrough-toggle'))
    enable('bulk-edit-model-restriction-enabled')
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      extra: {
        openai_passthrough: true
      }
    })
    expect(document.body.textContent).toContain('admin.accounts.openai.modelRestrictionDisabledByPassthrough')
  })

  it('filtered-results 模式下应提交 filters 而不是 account_ids', async () => {
    mountModal({
      accountIds: [],
      target: {
        mode: 'filtered',
        filters: {
          platform: 'openai',
          type: 'oauth',
          status: 'active',
          group: '12',
          search: 'bulk-target',
          privacy_mode: 'training_set_cf_blocked'
        },
        previewCount: 5,
        selectedPlatforms: ['openai'],
        selectedTypes: ['oauth']
      }
    })

    enable('bulk-edit-status-enabled')
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith({
      filters: {
        platform: 'openai',
        type: 'oauth',
        status: 'active',
        group: '12',
        search: 'bulk-target',
        privacy_mode: 'training_set_cf_blocked'
      },
      status: 'active'
    })
  })
  // issue #6327：批量编辑无法把 Codex 指纹收敛关掉。
  //
  // 批量更新走 JSONB 顶层合并（extra = COALESCE(extra,'{}') || payload），删掉 payload
  // 里的键只表示「本次不更新该键」，清不掉账号已有的 device/session/full；而且只删不写会让
  // payload 退化成 {extra:{}}，被后端 len(req.Extra) > 0 判为空更新直接 400
  // "No updates provided"。Create/Edit 那两个表单能删键，是因为它们提交完整 extra 对象、
  // 后端整体 SetExtra 覆盖——两种持久化语义不能共用同一套写法。
  it('OpenAI OAuth 批量编辑选择「关闭」时应显式提交 codex_fingerprint_mode=off（issue #6327）', async () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['oauth']
    })

    // 下拉框默认就是 off，用户只勾选「编辑该项」即提交——正是 issue 描述的操作路径。
    enable('bulk-edit-openai-codex-fingerprint-mode-enabled')
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      extra: {
        codex_fingerprint_mode: 'off'
      }
    })

    // 缺陷时期的形状：extra 为空对象，后端必然回 400。显式钉死不得回退。
    const payload = vi.mocked(adminAPI.accounts.bulkUpdate).mock.calls[0][1] as {
      extra: Record<string, unknown>
    }
    expect(Object.keys(payload.extra).length).toBeGreaterThan(0)
  })

  // 与兄弟字段 codex_cli_only 的写法对齐：关闭态同样落显式值，不靠省略表达。
  it('OpenAI OAuth 批量编辑显式 opt-in 模式仍原样提交', async () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['oauth']
    })

    enable('bulk-edit-openai-codex-fingerprint-mode-enabled')
    selectValue('bulk-codex-fingerprint-mode-select', 'session')
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      extra: {
        codex_fingerprint_mode: 'session'
      }
    })
  })

  // 未勾选「编辑该项」时不得写入该键，否则批量编辑别的字段会顺手清掉账号的收敛设置。
  it('未勾选编辑该项时不写入 codex_fingerprint_mode', async () => {
    mountModal({
      selectedPlatforms: ['openai'],
      selectedTypes: ['oauth']
    })

    enable('bulk-edit-openai-codex-cli-only-enabled')
    fireEvent.click(byId('bulk-edit-openai-codex-cli-only-toggle'))
    await submit()

    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      extra: {
        codex_cli_only: true
      }
    })
  })
})

// 以下为 React 版补充：Vue 版用原生 window.confirm()，React 版改用 ConfirmDialog，确认后才加入 429
describe('BulkEditAccountModal 429/529 confirmation', () => {
  beforeEach(() => {
    vi.mocked(adminAPI.accounts.bulkUpdate).mockReset()
    vi.mocked(adminAPI.accounts.bulkUpdate).mockResolvedValue({ success: 2, failed: 0, results: [] } as any)
  })

  it('选择 429 需要确认，取消则不加入，确认后加入并提交', async () => {
    mountModal({ selectedPlatforms: ['anthropic'], selectedTypes: ['apikey'] })
    enable('bulk-edit-custom-error-codes-enabled')

    // 对话框打开期间 Radix 会给其余内容加 aria-hidden，这里直接按文本查找按钮
    const codeButton = () =>
      Array.from(document.querySelectorAll('button')).find((btn) => btn.textContent === '429 Rate Limit')!
    fireEvent.click(codeButton())
    let dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('admin.accounts.customErrorCodes429Warning')
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.cancel' }))
    await flushPromises()
    expect(codeButton()).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(codeButton())
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.confirm' }))
    await flushPromises()
    expect(codeButton()).toHaveAttribute('aria-pressed', 'true')

    await submit()
    expect(adminAPI.accounts.bulkUpdate).toHaveBeenCalledWith([1, 2], {
      credentials: { custom_error_codes_enabled: true, custom_error_codes: [429] }
    })
  })
})
