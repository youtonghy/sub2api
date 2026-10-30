import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MonitorConfig } from '@/api/channelMonitorV2'
import { CONCRETE_PLATFORM_OPTIONS } from '@/constants/platforms'
import MonitorSettingsPanel from '../MonitorSettingsPanel'

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  groups: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn()
}))
vi.mock('@/api/channelMonitorV2', () => ({
  getConfig: mocks.getConfig,
  updateConfig: mocks.updateConfig,
  MONITOR_ERROR_CATEGORIES: ['authentication', 'network']
}))
vi.mock('@/api/admin', () => ({ adminAPI: { groups: { getAllIncludingInactive: mocks.groups } } }))
vi.mock('@/stores/app', () => {
  const state = {
    cachedPublicSettings: { channel_monitor_enabled: true },
    showError: mocks.showError,
    showSuccess: mocks.showSuccess
  }
  const useAppStore = Object.assign((selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state), {
    getState: () => state
  })
  return { useAppStore }
})
vi.mock('@/utils/featureFlags', () => ({
  getChannelMonitorMode: () => 'v2',
  isChannelMonitorV2Mode: () => true
}))
const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => false, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

// Vue 版用 findComponent(Select) 读取 options 并触发 update:modelValue；这里把 Select 换成原生 select 桩
interface SelectStubProps { value: unknown; options: Array<{ value: string; label: string }>; onChange?: (value: unknown) => void }
const select = vi.hoisted(() => ({ props: null as SelectStubProps | null }))
vi.mock('@/components/common/Select', () => ({
  default: (props: SelectStubProps) => {
    select.props = props
    return (
      <select data-testid="platform-select" value={String(props.value ?? '')} onChange={(e) => props.onChange?.(e.target.value)}>
        <option value="" />
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )
  }
}))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

function config(): MonitorConfig {
  return {
    version: 2,
    enabled: true,
    refresh_interval_seconds: 60,
    platforms: [
      { platform: 'openai', enabled: false, models: ['gpt-4'] },
      { platform: 'custom-provider', enabled: true, models: ['custom-model'] }
    ],
    group_ids: [42],
    ignored_error_categories: [],
    health_thresholds: {
      minimum_sample: 70, warning_error_rate: 0.1, critical_error_rate: 0.3,
      target_ttft_ms: 1500, warning_ttft_ms: 2000, critical_ttft_ms: 5000,
      warning_cache_rate: 0.7, critical_cache_rate: 0.4,
      error_weight: 0.5, ttft_weight: 0.3, cache_weight: 0.2
    }
  }
}

async function panel(value = config()) {
  select.props = null
  mocks.getConfig.mockResolvedValue(value)
  const view = render(
    <MemoryRouter>
      <MonitorSettingsPanel />
    </MemoryRouter>
  )
  await flushPromises()
  return view
}

const button = (key: string) => screen.queryByRole('button', { name: 'channelMonitorV2.settings.' + key })
const selectExists = () => screen.queryByTestId('platform-select') !== null
const optionValues = () => (select.props?.options ?? []).map((option) => option.value)
const modelInputs = () => screen.getAllByRole('textbox') as HTMLInputElement[]

async function add(platform: string) {
  fireEvent.change(screen.getByTestId('platform-select'), { target: { value: platform } })
  await flushPromises()
  fireEvent.click(button('addPlatform')!)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.groups.mockResolvedValue([])
  mocks.updateConfig.mockImplementation(async (value) => JSON.parse(JSON.stringify(value)))
})

describe('MonitorSettingsPanel platform configuration', () => {
  it('adds a missing provider and saves its models without changing existing settings', async () => {
    const original = config()
    const view = await panel(original)
    expect(button('save')).toBeDisabled()
    expect(optionValues()).not.toContain('openai')

    const deepseek = select.props!.options.find((option) => option.label === 'DeepSeek')!
    fireEvent.change(screen.getByTestId('platform-select'), { target: { value: deepseek.value } })
    fireEvent.click(button('addPlatform')!)
    expect(button('addPlatform')).toBeDisabled()
    expect(optionValues()).not.toContain('deepseek')
    const models = modelInputs().at(-1)!
    fireEvent.change(models, { target: { value: ' deepseek-chat, deepseek-reasoner, deepseek-chat ' } })
    fireEvent.blur(models)
    fireEvent.click(button('save')!)
    await flushPromises()

    expect(mocks.updateConfig).toHaveBeenCalledWith({
      ...original,
      platforms: [...original.platforms, { platform: 'deepseek', enabled: true, models: ['deepseek-chat', 'deepseek-reasoner'] }]
    })
    expect(button('save')).toBeDisabled()
    expect(original.platforms).toHaveLength(2)

    const persisted = mocks.updateConfig.mock.results[0].value
    view.unmount()
    await panel(await persisted)
    expect(modelInputs().at(-1)!.value).toBe('deepseek-chat, deepseek-reasoner')
    expect(optionValues()).not.toContain('deepseek')
  })

  it('can start with no configured platforms and rejects duplicate additions', async () => {
    await panel({ ...config(), platforms: [] })
    expect(button('addPlatform')).toBeDisabled()
    await add('kimi')
    await add('kimi')
    fireEvent.click(button('save')!)
    await flushPromises()
    expect(mocks.updateConfig.mock.calls[0][0].platforms).toEqual([{ platform: 'kimi', enabled: true, models: [] }])
  })

  it('restores the server config and available options when saving fails', async () => {
    await panel()
    mocks.updateConfig.mockRejectedValueOnce(new Error('save failed'))
    await add('minimax')
    fireEvent.click(button('save')!)
    await flushPromises()
    expect(mocks.showError).toHaveBeenCalledOnce()
    expect(optionValues()).toContain('minimax')
    expect(modelInputs()).toHaveLength(2)
    expect(button('save')).toBeDisabled()
  })

  it('hides the add control after every supported platform is configured', async () => {
    await panel({
      ...config(),
      platforms: CONCRETE_PLATFORM_OPTIONS.map(({ value }) => ({ platform: value, enabled: true, models: [] }))
    })
    expect(selectExists()).toBe(false)
    expect(button('addPlatform')).toBeNull()
  })
})
