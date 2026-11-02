import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { liveStore } from './storeHarness'

const mocks = vi.hoisted(() => ({ getSettings: vi.fn(), getConfig: vi.fn() }))
vi.mock('@/api', () => ({ adminAPI: { settings: { getSettings: mocks.getSettings }, payment: { getConfig: mocks.getConfig } } }))
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.getSettings.mockResolvedValue({ ops_monitoring_enabled: true, custom_menu_items: [{ id: 'custom', title: 'Custom' }] })
  mocks.getConfig.mockResolvedValue({ data: { enabled: true } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

// Pinia creates the store on first use, so cached localStorage values written by a test are
// read at that point. A Zustand store reads them when its module is evaluated, so each test
// evaluates a fresh module to get the same "created on first use" behavior.
async function useAdminSettingsStore() {
  vi.resetModules()
  const module = await import('../adminSettings')
  return liveStore(module.useAdminSettingsStore)
}

describe('admin settings fetch retry', () => {
  it.each(['settings', 'payment'])('retries a failed initial %s request without forcing a refresh', async (source) => {
    const request = source === 'settings' ? mocks.getSettings : mocks.getConfig
    request.mockRejectedValueOnce(new Error('Temporarily unavailable'))
    const store = await useAdminSettingsStore()
    await store.fetch()
    expect(store.loaded).toBe(false)
    expect(store.loading).toBe(false)
    await store.fetch()
    expect(mocks.getSettings).toHaveBeenCalledTimes(2)
    expect(mocks.getConfig).toHaveBeenCalledTimes(2)
    expect(store.loaded).toBe(true)
    expect(store.paymentEnabled).toBe(true)
    expect(store.customMenuItems).toEqual([{ id: 'custom', title: 'Custom' }])
  })

  it('keeps cached values visible when the initial request fails', async () => {
    localStorage.setItem('ops_monitoring_enabled_cached', 'false')
    localStorage.setItem('payment_enabled_cached', 'true')
    mocks.getSettings.mockRejectedValueOnce(new Error('Offline'))
    const store = await useAdminSettingsStore()
    await store.fetch()
    expect(store.opsMonitoringEnabled).toBe(false)
    expect(store.paymentEnabled).toBe(true)
    expect(localStorage.getItem('payment_enabled_cached')).toBe('true')
  })

  it('still reuses successfully loaded settings', async () => {
    const store = await useAdminSettingsStore()
    await store.fetch()
    await store.fetch()
    expect(mocks.getSettings).toHaveBeenCalledTimes(1)
    expect(mocks.getConfig).toHaveBeenCalledTimes(1)
  })
})
