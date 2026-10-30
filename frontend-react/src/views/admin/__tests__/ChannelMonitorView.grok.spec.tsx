import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MonitorFormDialog from '@/components/admin/monitor/MonitorFormDialog'
import { DEFAULT_GROK_ENDPOINT, DEFAULT_GROK_MODEL, PROVIDER_GROK, PROVIDERS } from '@/constants/channelMonitor'

const { listTemplates, accountsList, accountsGetById } = vi.hoisted(() => ({
  listTemplates: vi.fn(),
  accountsList: vi.fn(),
  accountsGetById: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    channelMonitor: { create: vi.fn(), update: vi.fn() },
    channelMonitorTemplate: { list: listTemplates },
    accounts: {
      list: (...args: unknown[]) => accountsList(...args),
      getById: (...args: unknown[]) => accountsGetById(...args)
    }
  }
}))
vi.mock('@/api/keys', () => ({ keysAPI: { list: vi.fn() } }))
vi.mock('@/api/groups', () => ({ userGroupsAPI: { getUserGroupRates: vi.fn() } }))
vi.mock('@/stores/app', () => {
  const state = { cachedPublicSettings: null, showError: vi.fn(), showSuccess: vi.fn() }
  const useAppStore = Object.assign((selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state), {
    getState: () => state
  })
  return { useAppStore }
})
const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))
vi.mock('@/components/common/Select', () => ({ default: () => null }))
vi.mock('@/components/admin/channel/ModelTagInput', () => ({ default: () => null }))
vi.mock('@/components/admin/monitor/MonitorKeyPickerDialog', () => ({ default: () => null }))
vi.mock('@/components/admin/monitor/MonitorAdvancedRequestConfig', () => ({ default: () => null }))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

function mountDialog() {
  return render(<MonitorFormDialog show monitor={null} />)
}

const endpoint = () => screen.getByTestId('monitor-endpoint') as HTMLInputElement
const model = () => screen.getByTestId('monitor-primary-model') as HTMLInputElement
const providerButton = (provider: string) => screen.getByTestId(`monitor-provider-${provider}`)

describe('channel monitor Grok provider', () => {
  beforeEach(() => {
    listTemplates.mockReset().mockResolvedValue({ items: [] })
    accountsList.mockReset().mockResolvedValue({ items: [] })
    accountsGetById.mockReset()
  })

  it('offers Grok in the responsive provider grid and prefills its official defaults', async () => {
    mountDialog()
    await flushPromises()

    expect(PROVIDERS).toContain(PROVIDER_GROK)
    const providerButtons = screen.getAllByTestId(/^monitor-provider-/).filter((el) => el.tagName === 'BUTTON')
    expect(providerButtons).toHaveLength(10)
    // Vue 版断言父元素的 grid-cols-2 / sm:grid-cols-4 类名；React 版的两列 / 四列网格在 CSS Module 中，这里只断言同一网格容器
    expect(providerButtons.every((button) => button.parentElement === screen.getByTestId('monitor-provider-grid'))).toBe(true)

    const grokButton = providerButton('grok')
    expect(grokButton.querySelector('svg')).not.toBeNull()
    expect(grokButton.textContent).toContain('monitorCommon.providers.grok')
    fireEvent.click(grokButton)
    // Vue 版按 zinc 色类判断选中，React 版按 aria-pressed 与平台色调判断
    expect(grokButton.getAttribute('aria-pressed')).toBe('true')
    expect(grokButton.getAttribute('data-platform')).toBe('grok')

    expect(endpoint().value).toBe(DEFAULT_GROK_ENDPOINT)
    expect(model().value).toBe(DEFAULT_GROK_MODEL)

    fireEvent.click(providerButton('anthropic'))
    expect(endpoint().value).toBe('')
    expect(model().value).toBe('')

    fireEvent.click(providerButton('grok'))
    fireEvent.change(endpoint(), { target: { value: 'https://gateway.example.com' } })
    fireEvent.change(model(), { target: { value: 'grok-custom' } })
    fireEvent.click(providerButton('openai'))
    expect(endpoint().value).toBe('https://gateway.example.com')
    expect(model().value).toBe('grok-custom')
  })

  it('prefills only empty Grok fields and preserves existing provider values', async () => {
    mountDialog()
    await flushPromises()

    fireEvent.change(endpoint(), { target: { value: 'https://gateway.example.com' } })
    fireEvent.click(providerButton('grok'))
    expect(endpoint().value).toBe('https://gateway.example.com')
    expect(model().value).toBe(DEFAULT_GROK_MODEL)

    fireEvent.click(providerButton('anthropic'))
    expect(endpoint().value).toBe('https://gateway.example.com')
    expect(model().value).toBe('')

    fireEvent.change(endpoint(), { target: { value: '' } })
    fireEvent.change(model(), { target: { value: 'grok-custom' } })
    fireEvent.click(providerButton('grok'))
    expect(endpoint().value).toBe(DEFAULT_GROK_ENDPOINT)
    expect(model().value).toBe('grok-custom')
  })
})
