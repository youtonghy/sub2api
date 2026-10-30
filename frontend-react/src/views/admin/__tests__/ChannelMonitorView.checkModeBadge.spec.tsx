import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeMonitor } from '@/components/admin/monitor/__tests__/monitorFixtures'
import ChannelMonitorView from '@/views/admin/ChannelMonitorView'

// P2-7(d)：provider 徽章旁并列 check_mode 徽章，三种检测模式一眼可分
// （quota 系 = 账号配额数据源，probe = 纯探活）。

const { listMonitors } = vi.hoisted(() => ({ listMonitors: vi.fn() }))

vi.mock('@/utils/featureFlags', () => ({
  isChannelMonitorV1Mode: () => true,
  isChannelMonitorV2Mode: () => false,
  getChannelMonitorMode: () => 'v1' as const
}))
vi.mock('@/features/channel-monitor-v2/MonitorSettingsPanel', () => ({ default: () => <div data-testid="v2-settings" /> }))
vi.mock('@/api/admin', () => ({
  adminAPI: { channelMonitor: { list: listMonitors, duplicate: vi.fn(), update: vi.fn(), runNow: vi.fn(), del: vi.fn() } }
}))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) } }))
const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))
vi.mock('@/components/admin/monitor/MonitorFiltersBar', async () => ({ default: (await import('./channelMonitorViewHarness')).NullStub }))
vi.mock('@/components/admin/monitor/MonitorFormDialog', async () => ({ default: (await import('./channelMonitorViewHarness')).NullStub }))
vi.mock('@/components/admin/monitor/MonitorTemplateManagerDialog', async () => ({ default: (await import('./channelMonitorViewHarness')).NullStub }))
vi.mock('@/components/admin/monitor/MonitorRunResultDialog', async () => ({ default: (await import('./channelMonitorViewHarness')).NullStub }))
vi.mock('@/components/admin/monitor/MonitorPrimaryModelCell', async () => ({ default: (await import('./channelMonitorViewHarness')).NullStub }))
vi.mock('@/components/common/ConfirmDialog', async () => ({ default: (await import('./channelMonitorViewHarness')).NullStub }))
vi.mock('@/components/common/Pagination', async () => ({ default: (await import('./channelMonitorViewHarness')).NullStub }))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

describe('ChannelMonitorView check-mode badge', () => {
  beforeEach(() => {
    localStorage.clear()
    listMonitors.mockReset()
  })

  it.each([
    ['quota', 'monitorCommon.checkMode.quota'],
    ['quota_probe', 'monitorCommon.checkMode.quota_probe'],
    ['probe', 'monitorCommon.checkMode.probe']
  ] as const)('renders the %s badge next to the provider badge', async (mode, label) => {
    listMonitors.mockResolvedValue({ items: [makeMonitor({ check_mode: mode })], total: 1, page: 1, page_size: 20, pages: 1 })
    const view = render(<ChannelMonitorView />)
    await flushPromises()

    const badge = view.container.querySelector(`[data-check-mode="${mode}"]`)!
    expect(badge).not.toBeNull()
    expect(badge.textContent).toBe(label)
    const cell = badge.parentElement!
    // provider 徽章仍在（不因并列展示被顶掉）。
    expect(cell.textContent).toContain('monitorCommon.providers.openai')

    // quota 系 = info（蓝）、probe = 中性灰的配色区分（Vue 版断言 bg-blue-100 / bg-gray-100 类名）。
    expect(badge.getAttribute('data-tone')).toBe(mode === 'probe' ? 'neutral' : 'info')
    view.unmount()
  })
})
