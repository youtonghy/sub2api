import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChannelMonitor } from '@/api/admin/channelMonitor'
import { makeMonitor } from '@/components/admin/monitor/__tests__/monitorFixtures'
import ChannelMonitorView from '@/views/admin/ChannelMonitorView'
import { actionsCellProps } from './channelMonitorViewHarness'

const { listMonitors, duplicateMonitor, showSuccess, showError } = vi.hoisted(() => ({
  listMonitors: vi.fn(),
  duplicateMonitor: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn()
}))

vi.mock('@/utils/featureFlags', () => ({
  isChannelMonitorV1Mode: () => true,
  isChannelMonitorV2Mode: () => false,
  getChannelMonitorMode: () => 'v1' as const
}))
vi.mock('@/features/channel-monitor-v2/MonitorSettingsPanel', () => ({ default: () => <div data-testid="v2-settings" /> }))
vi.mock('@/api/admin', () => ({
  adminAPI: {
    channelMonitor: { list: listMonitors, duplicate: duplicateMonitor, update: vi.fn(), runNow: vi.fn(), del: vi.fn() }
  }
}))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showSuccess, showError }) } }))
const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))
// 与 Vue 版 global.stubs 对应的桩
vi.mock('@/components/admin/monitor/MonitorActionsCell', async () => ({ default: (await import('./channelMonitorViewHarness')).ActionsCellStub }))
vi.mock('@/components/admin/monitor/MonitorFiltersBar', async () => ({ default: (await import('./channelMonitorViewHarness')).NullStub }))
vi.mock('@/components/admin/monitor/MonitorFormDialog', async () => ({ default: (await import('./channelMonitorViewHarness')).NullStub }))
vi.mock('@/components/admin/monitor/MonitorTemplateManagerDialog', async () => ({ default: (await import('./channelMonitorViewHarness')).NullStub }))
vi.mock('@/components/admin/monitor/MonitorRunResultDialog', async () => ({ default: (await import('./channelMonitorViewHarness')).NullStub }))
vi.mock('@/components/admin/monitor/MonitorPrimaryModelCell', async () => ({ default: (await import('./channelMonitorViewHarness')).NullStub }))
vi.mock('@/components/common/ConfirmDialog', async () => ({ default: (await import('./channelMonitorViewHarness')).NullStub }))
vi.mock('@/components/common/Pagination', async () => ({ default: (await import('./channelMonitorViewHarness')).NullStub }))

const monitor = makeMonitor()
const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
const page = (items: ChannelMonitor[]) => ({ items, total: items.length, page: 1, page_size: 20, pages: 1 })
const actions = (id = 42) => actionsCellProps.get(id)!

describe('ChannelMonitorView duplicate action', () => {
  beforeEach(() => {
    localStorage.clear()
    actionsCellProps.clear()
    for (const fn of [listMonitors, duplicateMonitor, showSuccess, showError]) fn.mockReset()
    listMonitors.mockResolvedValue(page([monitor]))
    duplicateMonitor.mockResolvedValue(makeMonitor({ id: 43, name: 'primary (Copy)', enabled: false }))
  })

  it('duplicates the selected monitor, reports success, and refreshes the list', async () => {
    const view = render(<ChannelMonitorView />)
    await flushPromises()

    act(() => actions().onDuplicate!(monitor))
    await flushPromises()

    expect(duplicateMonitor).toHaveBeenCalledTimes(1)
    expect(duplicateMonitor).toHaveBeenCalledWith(42)
    expect(showSuccess).toHaveBeenCalledWith('admin.channelMonitor.duplicateSuccess')
    expect(listMonitors.mock.calls.length).toBeGreaterThan(1)
    view.unmount()
  })

  it('keeps a successful duplicate successful when the follow-up refresh fails', async () => {
    listMonitors.mockResolvedValueOnce(page([monitor])).mockRejectedValueOnce(new Error('refresh failed'))
    const view = render(<ChannelMonitorView />)
    await flushPromises()

    act(() => actions().onDuplicate!(monitor))
    await flushPromises()

    expect(showSuccess).toHaveBeenCalledWith('admin.channelMonitor.duplicateSuccess')
    expect(showError).toHaveBeenCalledWith('refresh failed')
    expect(showError).not.toHaveBeenCalledWith('admin.channelMonitor.duplicateFailed')
    view.unmount()
  })

  it('ignores repeated clicks while a duplicate request is in flight', async () => {
    let resolveDuplicate!: (value: ChannelMonitor) => void
    duplicateMonitor.mockImplementationOnce(() => new Promise((resolve) => { resolveDuplicate = resolve }))
    const view = render(<ChannelMonitorView />)
    await flushPromises()

    const first = actions()
    act(() => {
      first.onDuplicate!(monitor)
      first.onDuplicate!(monitor)
    })

    expect(duplicateMonitor).toHaveBeenCalledTimes(1)
    expect(actions().duplicating).toBe(true)

    await act(async () => resolveDuplicate(makeMonitor({ id: 43, name: 'primary (Copy)', enabled: false })))
    await flushPromises()
    expect(actions().duplicating).toBe(false)
    view.unmount()
  })

  it('shows the API error when duplication fails', async () => {
    duplicateMonitor.mockRejectedValueOnce(new Error('duplicate failed'))
    const view = render(<ChannelMonitorView />)
    await flushPromises()

    act(() => actions().onDuplicate!(monitor))
    await flushPromises()

    expect(showError).toHaveBeenCalledWith('duplicate failed')
    view.unmount()
  })

  it('rejects a defensive duplicate event when the API key is unavailable', async () => {
    const unavailable = makeMonitor({ id: 99, api_key_decrypt_failed: true })
    listMonitors.mockResolvedValueOnce(page([unavailable]))
    const view = render(<ChannelMonitorView />)
    await flushPromises()

    act(() => actions(99).onDuplicate!(unavailable))
    await flushPromises()

    expect(duplicateMonitor).not.toHaveBeenCalled()
    expect(showError).toHaveBeenCalledWith('admin.channelMonitor.duplicateKeyUnavailable')
    view.unmount()
  })
})
