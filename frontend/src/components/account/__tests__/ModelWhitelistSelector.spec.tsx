import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
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

import ModelWhitelistSelector, { type ModelWhitelistSelectorHandle, type ModelWhitelistSelectorProps } from '../ModelWhitelistSelector'

const flushPromises = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

/** 对应 Vue 版 mount：记录 update:modelValue / upstream-synced / upstream-sync-finished 事件，handle 对应 wrapper.vm */
function mountSelector(props: Partial<ModelWhitelistSelectorProps> & { modelValue?: string[] } = {}) {
  const emitted = { update: [] as string[][][], upstreamSynced: [] as unknown[][], syncFinished: [] as unknown[][] }
  const handle = createRef<ModelWhitelistSelectorHandle>()
  const element = (next: Partial<ModelWhitelistSelectorProps> & { modelValue?: string[] }) => {
    const { modelValue = [], ...rest } = next
    return (
      <ModelWhitelistSelector
        value={modelValue}
        platform="openai"
        {...rest}
        ref={handle}
        onChange={(value) => emitted.update.push([value])}
        onUpstreamSynced={() => emitted.upstreamSynced.push([])}
        onUpstreamSyncFinished={() => emitted.syncFinished.push([])}
      />
    )
  }
  let current = props
  const view = render(element(current))
  const buttons = () => within(view.container).queryAllByRole('button')
  const findButton = (text: string) => buttons().find((button) => button.textContent === text)
  const setProps = (next: Partial<ModelWhitelistSelectorProps> & { modelValue?: string[] }) => {
    current = { ...current, ...next }
    view.rerender(element(current))
  }
  return { ...view, emitted, findButton, handle, setProps }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
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
  it('does not append configured fallback IDs', async () => {
    syncUpstreamModels.mockResolvedValue({
      models: ['composer-2.5'],
      discovery_source: 'configured_fallback',
      warnings: [{ code: 'grok_model_catalog_configured_fallback', message: 'fallback' }]
    })
    const wrapper = mountSelector({ platform: 'grok', accountId: 46, modelValue: ['grok-4.7'] })
    fireEvent.click(wrapper.findButton('admin.accounts.syncUpstreamModels')!)
    await flushPromises()
    expect(wrapper.emitted.update).toEqual([])
    expect(showWarning).toHaveBeenCalledWith('admin.accounts.grokModelDiagnostics.configuredFallback')
    expect(showSuccess).not.toHaveBeenCalled()
    expect(wrapper.emitted.syncFinished).toHaveLength(1)
  })

  it('still appends a real catalog when capability metadata is incomplete', async () => {
    syncUpstreamModels.mockResolvedValue({
      models: ['grok-4.7'],
      discovery_source: 'upstream',
      warnings: [{ code: 'upstream_model_metadata_incomplete', message: 'incomplete' }]
    })
    const wrapper = mountSelector({ platform: 'grok', accountId: 46, modelValue: ['grok-4'] })
    fireEvent.click(wrapper.findButton('admin.accounts.syncUpstreamModels')!)
    await flushPromises()
    expect(wrapper.emitted.update).toEqual([[['grok-4', 'grok-4.7']]])
    expect(showWarning).toHaveBeenCalledWith('admin.accounts.syncUpstreamModelsMetadataIncomplete')
    expect(showSuccess).not.toHaveBeenCalled()
    expect(wrapper.emitted.syncFinished).toHaveLength(1)
    expect(wrapper.emitted.upstreamSynced).toEqual([])
  })

  it('keeps creation preview on the original upstream-synced event only', async () => {
    syncUpstreamModelsPreview.mockResolvedValue({ models: ['grok-4.7'], discovery_source: 'upstream' })
    const wrapper = mountSelector({
      syncCredentials: { platform: 'grok', type: 'apikey', base_url: 'https://api.x.ai/v1', api_key: 'xai-test' }
    })
    fireEvent.click(wrapper.findButton('admin.accounts.syncUpstreamModels')!)
    await flushPromises()
    expect(syncUpstreamModels).not.toHaveBeenCalled()
    expect(wrapper.emitted.upstreamSynced).toEqual([[]])
    expect(wrapper.emitted.syncFinished).toEqual([])
    expect(wrapper.emitted.update).toEqual([[['grok-4.7']]])
  })

  it('does not mark a creation preview synced when the catalog is only a configured fallback', async () => {
    syncUpstreamModelsPreview.mockResolvedValue({ models: ['composer-2.5'], discovery_source: 'configured_fallback' })
    const wrapper = mountSelector({ syncCredentials: { platform: 'grok', type: 'apikey', api_key: 'xai-test' } })
    fireEvent.click(wrapper.findButton('admin.accounts.syncUpstreamModels')!)
    await flushPromises()
    expect(wrapper.emitted.update).toEqual([])
    expect(wrapper.emitted.upstreamSynced).toEqual([])
    expect(wrapper.emitted.syncFinished).toEqual([])
    expect(showWarning).toHaveBeenCalledWith('admin.accounts.grokModelDiagnostics.configuredFallback')
  })

  it('emits completion when a saved account sync fails so the last attempt can refresh', async () => {
    syncUpstreamModels.mockRejectedValue({ status: 502, message: 'upstream unavailable' })
    const wrapper = mountSelector({ platform: 'grok', accountId: 46, modelValue: ['grok-4.7'] })
    fireEvent.click(wrapper.findButton('admin.accounts.syncUpstreamModels')!)
    await flushPromises()
    expect(wrapper.emitted.update).toEqual([])
    expect(showError).toHaveBeenCalled()
    expect(wrapper.emitted.syncFinished).toHaveLength(1)
  })

  it('can hide only the built-in trigger while retaining its public sync action', async () => {
    syncUpstreamModels.mockResolvedValue({ models: ['grok-4.7'], discovery_source: 'upstream' })
    const wrapper = mountSelector({ platform: 'grok', accountId: 46, showSyncButton: false })
    expect(wrapper.container.querySelector('[data-testid="sync-upstream-models"]')).toBeNull()
    await act(async () => {
      await wrapper.handle.current!.syncUpstreamModels()
    })
    expect(syncUpstreamModels).toHaveBeenCalledWith(46)
    expect(wrapper.emitted.update).toEqual([[['grok-4.7']]])
    expect(wrapper.emitted.syncFinished).toEqual([[]])
  })

  it('does not apply an older account sync to the current draft or clear the newer busy state', async () => {
    const first = deferred<any>()
    const second = deferred<any>()
    syncUpstreamModels.mockImplementation((id: number) => (id === 1 ? first.promise : second.promise))
    const wrapper = mountSelector({ platform: 'grok', accountId: 1, modelValue: ['a-local'] })
    const syncButton = () => wrapper.container.querySelector('[data-testid="sync-upstream-models"]') as HTMLButtonElement

    fireEvent.click(syncButton())
    expect(syncButton().disabled).toBe(true)
    expect(wrapper.handle.current!.isSyncingUpstream).toBe(true)

    wrapper.setProps({ accountId: 2, modelValue: ['b-local'] })
    expect(syncButton().disabled).toBe(false)
    expect(wrapper.handle.current!.isSyncingUpstream).toBe(false)
    fireEvent.click(syncButton())
    expect(syncUpstreamModels).toHaveBeenNthCalledWith(1, 1)
    expect(syncUpstreamModels).toHaveBeenNthCalledWith(2, 2)

    first.resolve({ models: ['a-private-catalog'], discovery_source: 'upstream' })
    await flushPromises()
    expect(wrapper.emitted.update).toEqual([])
    expect(showSuccess).not.toHaveBeenCalled()
    expect(wrapper.emitted.syncFinished).toEqual([])
    expect(syncButton().disabled).toBe(true)
    expect(wrapper.handle.current!.isSyncingUpstream).toBe(true)

    second.resolve({ models: ['b-catalog'], discovery_source: 'upstream' })
    await flushPromises()
    expect(wrapper.emitted.update).toEqual([[['b-local', 'b-catalog']]])
    expect(wrapper.emitted.syncFinished).toEqual([[]])
    expect(showSuccess).toHaveBeenCalledTimes(1)
    expect(syncButton().disabled).toBe(false)
  })

  it('drops a sync result that settles after unmount', async () => {
    const pending = deferred<any>()
    syncUpstreamModels.mockReturnValue(pending.promise)
    const wrapper = mountSelector({ platform: 'grok', accountId: 46 })
    fireEvent.click(wrapper.findButton('admin.accounts.syncUpstreamModels')!)
    wrapper.unmount()
    pending.resolve({ models: ['grok-4.7'], discovery_source: 'upstream' })
    await flushPromises()
    expect(wrapper.emitted.update).toEqual([])
    expect(wrapper.emitted.syncFinished).toEqual([])
    expect(showSuccess).not.toHaveBeenCalled()
  })
})
