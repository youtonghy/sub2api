import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import OpsSystemLogTable from '../OpsSystemLogTable'
import type { LogRetentionSelectProps } from '../LogRetentionSelect'
import enLocale from '@/i18n/locales/en'
import zhLocale from '@/i18n/locales/zh'

const mocks = vi.hoisted(() => ({
  listSystemLogs: vi.fn(),
  cleanupSystemLogs: vi.fn(),
  getSystemLogSinkHealth: vi.fn(),
  getRuntimeLogConfig: vi.fn(),
  updateRuntimeLogConfig: vi.fn(),
  showError: vi.fn(),
  // LogRetentionSelect 桩：按渲染顺序记录最新 props，供用例读取 value 并触发 onChange
  retentionFields: [] as LogRetentionSelectProps[],
  i18n: { t: (key: string) => key, te: () => true, locale: 'en' }
}))

vi.mock('@/api/admin/ops', async (importOriginal) => {
  const opsAPI = {
    listSystemLogs: (...args: any[]) => mocks.listSystemLogs(...args),
    cleanupSystemLogs: (...args: any[]) => mocks.cleanupSystemLogs(...args),
    getSystemLogSinkHealth: (...args: any[]) => mocks.getSystemLogSinkHealth(...args),
    getRuntimeLogConfig: (...args: any[]) => mocks.getRuntimeLogConfig(...args),
    updateRuntimeLogConfig: (...args: any[]) => mocks.updateRuntimeLogConfig(...args),
  }
  return { ...(await importOriginal<object>()), opsAPI, default: opsAPI }
})

vi.mock('@/stores', () => {
  const app = {
    showError: (...args: any[]) => mocks.showError(...args),
    showSuccess: vi.fn(),
  }
  return { useAppStore: Object.assign((selector: (s: typeof app) => unknown) => selector(app), { getState: () => app }) }
})

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => mocks.i18n }))
vi.mock('@/components/common/Select', () => ({ default: () => <div className="select-stub" /> }))
vi.mock('@/components/common/Pagination', () => ({ default: () => <div className="pagination-stub" /> }))
vi.mock('../LogRetentionSelect', () => ({
  default: (props: LogRetentionSelectProps) => {
    const index = props.allowForever ? 1 : 0
    mocks.retentionFields[index] = props
    return <div className="retention-stub" />
  },
}))

afterEach(cleanup)

const runtimeConfig = {
  level: 'info',
  persist_access_logs: false,
  enable_sampling: false,
  sampling_initial: 100,
  sampling_thereafter: 100,
  caller: true,
  stacktrace_level: 'error',
  retention_days: 30,
  request_retention_days: 90,
}

const sinkHealth = {
  queue_depth: 0,
  queue_capacity: 5000,
  dropped_count: 0,
  write_failed_count: 0,
  written_count: 1,
  avg_write_delay_ms: 0,
}

async function mountTable() {
  const utils = render(<OpsSystemLogTable />)
  await waitFor(() => expect(mocks.getRuntimeLogConfig).toHaveBeenCalled())
  await act(async () => {})
  return utils
}

describe('OpsSystemLogTable host support', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mocks.listSystemLogs.mockResolvedValue({
      items: [
        {
          id: 1,
          created_at: '2026-07-14T00:10:01Z',
          host: 'api-node-1',
          level: 'warn',
          component: 'app',
          message: 'request failed',
        },
      ],
      total: 1,
      page: 1,
      page_size: 20,
    })
    mocks.cleanupSystemLogs.mockResolvedValue({ deleted: 1 })
    mocks.getSystemLogSinkHealth.mockResolvedValue(sinkHealth)
    mocks.getRuntimeLogConfig.mockResolvedValue(runtimeConfig)
    mocks.updateRuntimeLogConfig.mockImplementation(async (config: unknown) => config)
  })

  it('renders the host and sends it with list and cleanup filters', async () => {
    const { container } = await mountTable()
    await waitFor(() => expect(container.textContent).toContain('api-node-1'))

    const hostInput = screen.getByLabelText('admin.ops.systemLogs.host')
    fireEvent.change(hostInput, { target: { value: ' api-node-2 ' } })

    fireEvent.click(screen.getByRole('button', { name: 'admin.ops.systemLogs.search' }))
    await act(async () => {})

    expect(mocks.listSystemLogs).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'api-node-2' }))

    fireEvent.click(screen.getByRole('button', { name: 'admin.ops.systemLogs.cleanCurrentFilters' }))
    await act(async () => {})

    expect(mocks.cleanupSystemLogs).toHaveBeenCalledWith(expect.objectContaining({ host: 'api-node-2' }))
  })

  it('keeps database access-log persistence opt-in', async () => {
    await mountTable()
    const checkbox = screen.getByRole('checkbox', { name: 'admin.ops.systemLogs.persistAccessLogs' })
    expect(checkbox).not.toBeChecked()
  })

  it.each([
    ['zh', zhLocale],
    ['en', enLocale],
  ])('defines the Host translation for %s', (_name, locale) => {
    expect(locale.admin.ops.systemLogs.host).toBe('Host')
  })
})

describe('rolling log retention settings', () => {
  const saveButton = () => screen.getByRole('button', { name: 'admin.ops.systemLogs.saveAndApply' })
  const setRetention = (index: number, value: number) => act(() => { mocks.retentionFields[index]!.onChange?.(value) })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.retentionFields.length = 0
    mocks.listSystemLogs.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 })
    mocks.getSystemLogSinkHealth.mockResolvedValue(sinkHealth)
    mocks.getRuntimeLogConfig.mockResolvedValue(runtimeConfig)
    mocks.updateRuntimeLogConfig.mockImplementation(async (config: unknown) => config)
  })

  it('loads and saves separate operations and request retention windows', async () => {
    await mountTable()
    expect(mocks.retentionFields.map((field) => field.value)).toEqual([30, 90])
    setRetention(0, 7)
    setRetention(1, 180)
    fireEvent.click(saveButton())
    await act(async () => {})
    expect(mocks.updateRuntimeLogConfig).toHaveBeenCalledWith(expect.objectContaining({ retention_days: 7, request_retention_days: 180 }))
  })

  it('supports forever and rejects fractional or empty custom days', async () => {
    await mountTable()
    setRetention(1, 0)
    fireEvent.click(saveButton())
    await act(async () => {})
    expect(mocks.updateRuntimeLogConfig).toHaveBeenCalledWith(expect.objectContaining({ request_retention_days: 0 }))
    mocks.updateRuntimeLogConfig.mockClear()
    for (const value of [1.5, Number.NaN, -1, 3651]) {
      setRetention(1, value)
      fireEvent.click(saveButton())
    }
    expect(mocks.updateRuntimeLogConfig).not.toHaveBeenCalled()
    expect(mocks.showError).toHaveBeenCalledWith('admin.ops.systemLogs.retentionDaysInvalid')
  })

  it('does not overwrite saved retention with defaults after a load failure', async () => {
    mocks.getRuntimeLogConfig.mockRejectedValue(new Error('unavailable'))
    await mountTable()
    expect(saveButton()).toBeDisabled()
    fireEvent.click(saveButton())
    expect(mocks.updateRuntimeLogConfig).not.toHaveBeenCalled()
  })
})
