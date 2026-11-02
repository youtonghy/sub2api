import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BUILTIN_PLATFORM_CATALOG, resetPlatformCatalog, setPlatformCatalog } from '@/constants/platformCatalog'

const { copyToClipboard, showError, showSuccess, showInfo, showWarning, syncUpstreamModels, syncUpstreamModelsPreview } =
  vi.hoisted(() => ({
    copyToClipboard: vi.fn().mockResolvedValue(true),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showInfo: vi.fn(),
    showWarning: vi.fn(),
    syncUpstreamModels: vi.fn(),
    syncUpstreamModelsPreview: vi.fn()
  }))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      key === 'common.copy'
        ? '复制'
        : key === 'admin.accounts.modelMappingConflict'
          ? `Model mapping conflict: ${params?.from} → ${params?.to}`
          : key === 'admin.accounts.syncUpstreamModelsError'
            ? `${key}: ${params?.message}`
            : key,
    te: () => true,
    locale: 'en'
  })
}))

vi.mock('@/stores/app', () => ({
  useAppStore: {
    getState: () => ({
      showError,
      showSuccess,
      showInfo,
      showWarning
    })
  }
}))

vi.mock('@/api/admin/accounts', () => ({
  accountsAPI: {
    syncUpstreamModels,
    syncUpstreamModelsPreview
  }
}))

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({
    copyToClipboard
  })
}))

vi.mock('@/components/common/ModelIcon', () => ({ default: () => null }))

import ModelWhitelistSelector, { type ModelWhitelistSelectorProps } from '../ModelWhitelistSelector'

const flushPromises = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

/** 对应 Vue 版 mount：记录 update:modelValue / upstream-synced 事件 */
function mountSelector(props: Partial<ModelWhitelistSelectorProps> & { modelValue?: string[] } = {}) {
  const emitted = { update: [] as string[][][], upstreamSynced: [] as unknown[][] }
  const { modelValue = [], ...rest } = props
  const view = render(
    <ModelWhitelistSelector
      value={modelValue}
      platform="openai"
      {...rest}
      onChange={(value) => emitted.update.push([value])}
      onUpstreamSynced={() => emitted.upstreamSynced.push([])}
    />
  )
  const buttons = () => within(view.container).queryAllByRole('button')
  const findButton = (text: string) => buttons().find((button) => button.textContent === text)
  return { ...view, emitted, findButton }
}

function findModelRow(container: HTMLElement, modelId: string) {
  const row = within(container)
    .getAllByTestId('model-option')
    .find((candidate) => candidate.textContent?.includes(modelId))

  if (!row) {
    throw new Error(`Model row not found: ${modelId}`)
  }

  return row
}

describe('ModelWhitelistSelector', () => {
  beforeEach(() => {
    copyToClipboard.mockClear()
    showError.mockReset()
    showSuccess.mockReset()
    showInfo.mockReset()
    showWarning.mockReset()
    syncUpstreamModels.mockReset()
    syncUpstreamModelsPreview.mockReset()
  })

  afterEach(() => {
    cleanup()
    resetPlatformCatalog()
  })

  it.each(['anthropic', 'openai', 'gemini', 'antigravity', 'grok', 'kimi', 'zhipu', 'deepseek', 'minimax', 'opencode_go', 'command_code', 'cline'])(
    'supports upstream sync for %s saved accounts and creation previews',
    (platform) => {
      const wrappers = [
        () => mountSelector({ platform, accountId: 46 }),
        () => mountSelector({ platform, syncCredentials: { platform, type: 'apikey', api_key: 'test-key' } })
      ]
      for (const mountOne of wrappers) {
        const wrapper = mountOne()
        expect(wrapper.findButton('admin.accounts.syncUpstreamModels')).toBeDefined()
        wrapper.unmount()
      }
    }
  )

  it.each(['typesafe', 'unregistered'])('hides upstream sync for unsupported %s saved accounts and creation previews', (platform) => {
    const wrappers = [
      () => mountSelector({ platform, accountId: 46 }),
      () => mountSelector({ platform, syncCredentials: { platform, type: 'apikey', api_key: 'test-key' } })
    ]
    for (const mountOne of wrappers) {
      const wrapper = mountOne()
      expect(wrapper.findButton('admin.accounts.syncUpstreamModels')).toBeUndefined()
      wrapper.unmount()
    }
    expect(syncUpstreamModels).not.toHaveBeenCalled()
    expect(syncUpstreamModelsPreview).not.toHaveBeenCalled()
  })

  it('requires a supported request builder for newly registered platforms', async () => {
    const wrapper = mountSelector({ platform: 'acme_router', accountId: 46 })
    const platforms = [
      ...BUILTIN_PLATFORM_CATALOG.platforms,
      { id: 'acme_router', display_name: 'Acme Router', gateway: 'openai' as const, cn_provider: false }
    ]
    act(() => setPlatformCatalog({ ...BUILTIN_PLATFORM_CATALOG, platforms }))
    await flushPromises()
    expect(wrapper.findButton('admin.accounts.syncUpstreamModels')).toBeUndefined()

    act(() =>
      setPlatformCatalog({
        ...BUILTIN_PLATFORM_CATALOG,
        platforms: platforms.map((spec) =>
          spec.id === 'acme_router'
            ? { ...spec, multi_protocol: { default_mode: 'default', routing: 'by_inbound' as const, modes: [] } }
            : spec
        )
      })
    )
    await flushPromises()
    expect(wrapper.findButton('admin.accounts.syncUpstreamModels')).toBeDefined()
    wrapper.unmount()
  })

  it('rejects a custom whitelist model that is already mapped to a different target', () => {
    const wrapper = mountSelector({ modelMappings: [{ from: 'gpt-latest', to: 'deepseek-chat' }] })
    fireEvent.change(screen.getByPlaceholderText('admin.accounts.enterCustomModelName'), { target: { value: ' gpt-latest ' } })
    fireEvent.click(wrapper.findButton('admin.accounts.addModel')!)

    expect(wrapper.emitted.update).toHaveLength(0)
    expect(showInfo).toHaveBeenCalledWith(expect.stringContaining('gpt-latest → deepseek-chat'))
  })

  it('keeps the existing duplicate identity warning before checking mappings', () => {
    const wrapper = mountSelector({ modelValue: ['gpt-latest'], modelMappings: [{ from: 'gpt-latest', to: 'deepseek-chat' }] })
    fireEvent.change(screen.getByPlaceholderText('admin.accounts.enterCustomModelName'), { target: { value: 'gpt-latest' } })
    fireEvent.click(wrapper.findButton('admin.accounts.addModel')!)
    expect(showInfo).toHaveBeenCalledWith('admin.accounts.modelExists')
    expect(wrapper.emitted.update).toHaveLength(0)
  })

  it('allows matching identity mapping as a whitelist model', () => {
    const wrapper = mountSelector({ modelMappings: [{ from: 'gpt-latest', to: 'gpt-latest' }] })
    fireEvent.change(screen.getByPlaceholderText('admin.accounts.enterCustomModelName'), { target: { value: 'gpt-latest' } })
    fireEvent.click(wrapper.findButton('admin.accounts.addModel')!)
    expect(wrapper.emitted.update).toEqual([[['gpt-latest']]])
  })

  it('still allows custom models without a mapping prop', () => {
    const wrapper = mountSelector()
    fireEvent.change(screen.getByPlaceholderText('admin.accounts.enterCustomModelName'), { target: { value: 'custom-model' } })
    fireEvent.click(wrapper.findButton('admin.accounts.addModel')!)
    expect(wrapper.emitted.update).toEqual([[['custom-model']]])
  })

  it('copies a model ID without selecting the model', async () => {
    const wrapper = mountSelector()
    fireEvent.click(screen.getByTestId('model-whitelist-trigger'))

    const row = findModelRow(wrapper.container, 'gpt-5.6-sol')

    const copyButton = within(row).getByTestId('copy-model-id')
    expect(copyButton.getAttribute('aria-label')).toBe('复制 gpt-5.6-sol')

    fireEvent.click(copyButton)
    await flushPromises()

    expect(copyToClipboard).toHaveBeenCalledWith('gpt-5.6-sol')
    expect(wrapper.emitted.update).toHaveLength(0)
  })

  it('keeps the existing model selection behavior', () => {
    const wrapper = mountSelector()
    fireEvent.click(screen.getByTestId('model-whitelist-trigger'))

    const row = findModelRow(wrapper.container, 'gpt-5.6-sol')
    fireEvent.click(within(row).getByTestId('select-model'))

    expect(wrapper.emitted.update).toEqual([[['gpt-5.6-sol']]])
    expect(copyToClipboard).not.toHaveBeenCalled()
  })

  it('warns when model IDs sync but capability metadata is incomplete', async () => {
    syncUpstreamModels.mockResolvedValue({
      models: ['x-preview-f-free'],
      warnings: [
        {
          code: 'upstream_model_metadata_incomplete',
          message: 'Model IDs were synced, but capability metadata could not be updated.'
        }
      ]
    })
    const wrapper = mountSelector({ modelValue: [], platform: 'openai', accountId: 46 })

    const syncButton = wrapper.findButton('admin.accounts.syncUpstreamModels')
    expect(syncButton).toBeDefined()
    fireEvent.click(syncButton!)
    await flushPromises()

    expect(wrapper.emitted.update).toEqual([[['x-preview-f-free']]])
    expect(showWarning).toHaveBeenCalledWith('admin.accounts.syncUpstreamModelsMetadataIncomplete')
    expect(showSuccess).not.toHaveBeenCalled()
  })

  it('shows the backend message when upstream sync is rejected', async () => {
    syncUpstreamModels.mockRejectedValue({
      status: 400,
      code: 'BAD_REQUEST',
      message: 'Vertex API key accounts do not support upstream model listing'
    })
    const wrapper = mountSelector({ platform: 'gemini', accountId: 174 })

    const syncButton = wrapper.findButton('admin.accounts.syncUpstreamModels')
    expect(syncButton).toBeDefined()
    fireEvent.click(syncButton!)
    await flushPromises()

    expect(showError).toHaveBeenCalledWith(
      'admin.accounts.syncUpstreamModelsError: Vertex API key accounts do not support upstream model listing'
    )
  })

  it('shows success and a partial warning when some capabilities were saved', async () => {
    syncUpstreamModels.mockResolvedValue({
      models: ['gpt-6-astra', 'gpt-image-2'],
      warnings: [
        {
          code: 'upstream_model_metadata_partial',
          message: 'Some model capabilities were saved; remaining models are still incomplete.'
        }
      ]
    })
    const wrapper = mountSelector({ modelValue: [], platform: 'openai', accountId: 46 })

    const syncButton = wrapper.findButton('admin.accounts.syncUpstreamModels')
    expect(syncButton).toBeDefined()
    fireEvent.click(syncButton!)
    await flushPromises()

    expect(wrapper.emitted.update).toEqual([[['gpt-6-astra', 'gpt-image-2']]])
    expect(showSuccess).toHaveBeenCalledWith('admin.accounts.syncUpstreamModelsSuccess')
    expect(showWarning).toHaveBeenCalledWith('admin.accounts.syncUpstreamModelsMetadataPartial')
  })

  it('reports a successful preview so account creation can persist metadata', async () => {
    syncUpstreamModelsPreview.mockResolvedValue({
      models: ['x-preview-f-free'],
      metadata: {
        'x-preview-f-free': {
          id: 'x-preview-f-free',
          reasoning: true,
          supported_reasoning_levels: ['low', 'high', 'max']
        }
      }
    })
    const wrapper = mountSelector({
      syncCredentials: {
        platform: 'openai',
        type: 'apikey',
        base_url: 'https://opencode.ai/zen/v1',
        api_key: 'test-key'
      }
    })
    const syncButton = wrapper.findButton('admin.accounts.syncUpstreamModels')

    expect(syncButton).toBeDefined()
    fireEvent.click(syncButton!)
    await flushPromises()

    expect(syncUpstreamModelsPreview).toHaveBeenCalledOnce()
    expect(wrapper.emitted.upstreamSynced).toEqual([[]])
    expect(wrapper.emitted.update).toEqual([[['x-preview-f-free']]])
  })

  it('shows the upstream sync button for OpenCode Go create-account credentials', () => {
    const wrapper = mountSelector({
      platform: 'opencode_go',
      syncCredentials: {
        platform: 'opencode_go',
        type: 'apikey',
        base_url: 'https://opencode.ai/zen/go/v1',
        api_key: 'sk-test'
      }
    })
    const syncButton = wrapper.findButton('admin.accounts.syncUpstreamModels')

    expect(syncButton).toBeDefined()
    expect(syncButton).toBeInTheDocument()
  })
})
