import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BUILTIN_PLATFORM_CATALOG, resetPlatformCatalog, setPlatformCatalog } from '@/constants/platformCatalog'
import ChannelsView from '@/views/admin/ChannelsView'

const { listChannels, getGroups, syncPricingModels, showSuccess, showError } = vi.hoisted(() => ({
  listChannels: vi.fn(),
  getGroups: vi.fn(),
  syncPricingModels: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    channels: { list: listChannels, syncPricingModels },
    groups: { getAll: getGroups },
    settings: { getWebSearchEmulationConfig: vi.fn().mockResolvedValue({ enabled: false }) }
  }
}))

vi.mock('@/stores/app', () => {
  const state = { showSuccess, showError }
  const useAppStore = Object.assign((selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state), {
    getState: () => state
  })
  return { useAppStore }
})

const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

// Vue 版把 PricingEntryCard 换成只显示模型的桩
vi.mock('@/components/admin/channel/PricingEntryCard', () => ({
  default: ({ entry }: { entry: { models: string[] } }) => <div className="pricing-entry">{entry.models.join(', ')}</div>
}))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

async function openDialog() {
  await flushPromises()
  fireEvent.click(screen.getAllByRole('button', { name: 'admin.channels.createChannel' })[0])
  await flushPromises()
}

async function enablePlatform(platform: string) {
  const label = `admin.groups.platforms.${platform}`
  const chip = screen.getByRole('checkbox', { name: label, hidden: true })
  if (chip.getAttribute('aria-checked') !== 'true') fireEvent.click(chip)
  await userEvent.click(screen.getByRole('tab', { name: label }))
}

// Vue 版用 isVisible() 过滤 v-show 隐藏的平台页；这里按 hidden 祖先过滤
function visibleSyncButtons() {
  return screen
    .queryAllByRole('button', { hidden: true })
    .filter(
      (button) =>
        !button.closest('[hidden]') &&
        ['admin.channels.form.syncLatestModels', 'admin.channels.form.syncingModels'].includes(button.textContent ?? '')
    )
}

describe('ChannelsView pricing model sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    listChannels.mockResolvedValue({ items: [], total: 0 })
    getGroups.mockResolvedValue([])
    syncPricingModels.mockReset()
  })

  afterEach(() => {
    act(() => resetPlatformCatalog())
  })

  it.each([
    ['openai', true],
    ['opencode_go', true],
    ['typesafe', true],
    ['command_code', false],
    ['cline', false]
  ] as const)('offers pricing model sync for %s only when its pricing catalog exists', async (platform, expected) => {
    const view = render(<ChannelsView />)
    await openDialog()
    await enablePlatform(platform)

    expect(visibleSyncButtons()).toHaveLength(expected ? 1 : 0)
    expect(syncPricingModels).not.toHaveBeenCalled()
    view.unmount()
  })

  it('reacts to a new platform gaining a pricing catalog', async () => {
    const platform = { id: 'acme_router', display_name: 'Acme Router', gateway: 'openai' as const, cn_provider: false }
    setPlatformCatalog({
      ...BUILTIN_PLATFORM_CATALOG,
      platforms: [...BUILTIN_PLATFORM_CATALOG.platforms, platform]
    })
    const view = render(<ChannelsView />)
    await openDialog()
    await enablePlatform(platform.id)
    expect(visibleSyncButtons()).toHaveLength(0)

    act(() =>
      setPlatformCatalog({
        ...BUILTIN_PLATFORM_CATALOG,
        platforms: [...BUILTIN_PLATFORM_CATALOG.platforms, { ...platform, litellm_provider: 'acme' }]
      })
    )
    await flushPromises()
    expect(visibleSyncButtons()).toHaveLength(1)
    view.unmount()
  })

  it('blocks additional syncs while one request is in flight and adds its models once', async () => {
    let resolveSync!: (value: { models: string[] }) => void
    syncPricingModels.mockReturnValue(new Promise((resolve) => { resolveSync = resolve }))
    const view = render(<ChannelsView />)
    await openDialog()
    await enablePlatform('openai')
    fireEvent.click(visibleSyncButtons()[0])
    fireEvent.click(visibleSyncButtons()[0])
    await enablePlatform('opencode_go')

    expect(visibleSyncButtons()[0]).toBeDisabled()
    fireEvent.click(visibleSyncButtons()[0])
    expect(syncPricingModels).toHaveBeenCalledOnce()
    expect(syncPricingModels).toHaveBeenCalledWith('openai')

    await act(async () => resolveSync({ models: ['gpt-latest'] }))
    await flushPromises()
    const entries = document.querySelectorAll('.pricing-entry')
    expect(entries).toHaveLength(1)
    expect(entries[0].textContent).toBe('gpt-latest')
    expect(visibleSyncButtons()[0]).not.toBeDisabled()
    expect(showError).not.toHaveBeenCalled()
    view.unmount()
  })
})

// Vue 版 channelPlatformOptions.spec 读取源码断言 platformOrder 的写法，React 版只保留平台清单断言
describe('Composite channel platform options', () => {
  it('includes the CN concrete providers for pricing and model mapping', async () => {
    const { listPlatformIds } = await import('@/constants/platformCatalog')
    expect(listPlatformIds()).toEqual(expect.arrayContaining(['kimi', 'zhipu', 'deepseek', 'minimax', 'opencode_go']))
  })
})
