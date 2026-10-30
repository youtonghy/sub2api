import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BackupView from '../BackupView'

const { getS3Config, getImageStorageConfig, getSchedule, updateSchedule, deleteBackup, listBackups, getDownloadURL } =
  vi.hoisted(() => ({
    getS3Config: vi.fn(),
    getImageStorageConfig: vi.fn(),
    getSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    deleteBackup: vi.fn(),
    listBackups: vi.fn(),
    getDownloadURL: vi.fn()
  }))

vi.mock('@/api', () => ({
  adminAPI: {
    backup: {
      getS3Config,
      updateS3Config: vi.fn(),
      testS3Connection: vi.fn(),
      getImageStorageConfig,
      updateImageStorageConfig: vi.fn(),
      testImageStorageConnection: vi.fn(),
      getSchedule,
      updateSchedule,
      createBackup: vi.fn(),
      listBackups,
      getBackup: vi.fn(),
      deleteBackup,
      getDownloadURL,
      restoreBackup: vi.fn()
    }
  }
}))

vi.mock('@/stores', () => {
  const state = { showError: vi.fn(), showSuccess: vi.fn(), showWarning: vi.fn() }
  return { useAppStore: Object.assign(() => state, { getState: () => state }) }
})

vi.mock('@/composables/useStepUp', () => ({
  useStepUp: () => ({ run: (fn: () => unknown) => fn() }),
  isStepUpBlocked: () => false,
  isStepUpCancelled: () => false,
  stepUpBlockReason: () => ''
}))

vi.mock('@/components/auth/TotpStepUpDialog', () => ({ default: () => null }))

vi.mock('@/i18n/useI18n', () => {
  const t = (key: string, params?: Record<string, unknown>) =>
    params?.index !== undefined ? `${key}:${params.index}` : params?.day !== undefined ? `${key}:${params.day}` : key
  return { useI18n: () => ({ t, te: () => true, locale: 'en', setLocale: vi.fn() }) }
})

const baseRecord = (id: string, parts?: unknown[]) => ({
  id,
  status: 'completed',
  backup_type: 'postgres',
  file_name: `${id}.sql.gz`,
  s3_key: `backups/${id}.sql.gz`,
  parts,
  size_bytes: 10,
  triggered_by: 'manual',
  started_at: '2026-08-09T00:00:00Z'
})

const flushPromises = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })

const q = <T extends Element = HTMLInputElement>(selector: string) => document.querySelector<T>(selector)
const get = <T extends Element = HTMLInputElement>(selector: string) => {
  const el = q<T>(selector)
  if (!el) throw new Error(`missing ${selector}`)
  return el
}
const saveButton = () => get<HTMLButtonElement>('[data-testid="backup-schedule-save"]')
const archiveSwitch = () => get<HTMLButtonElement>('[data-testid="archive-enabled"]')
const setArchiveEnabled = async (enabled: boolean) => {
  if ((archiveSwitch().getAttribute('aria-checked') === 'true') !== enabled) {
    await act(async () => { fireEvent.click(archiveSwitch()) })
  }
}
const setChecked = async (selector: string, checked: boolean) => {
  const el = get(selector)
  if (el.checked !== checked) await act(async () => { fireEvent.click(el) })
}
const setValue = async (selector: string, value: string | number) => {
  await act(async () => { fireEvent.change(get(selector), { target: { value: String(value) } }) })
}
const click = async (el: Element) => {
  await act(async () => { fireEvent.click(el) })
}

function mountBackupView() {
  return render(<BackupView />)
}

describe('admin BackupView', () => {
  beforeEach(() => {
    getS3Config.mockResolvedValue({})
    getImageStorageConfig.mockResolvedValue({ config: {}, secret_configured: false })
    getSchedule.mockResolvedValue({ enabled: false, cron_expr: '', retain_days: 14, retain_count: 10 })
    updateSchedule.mockReset().mockResolvedValue({})
    deleteBackup.mockReset().mockResolvedValue(undefined)
    listBackups.mockResolvedValue({ items: [] })
    getDownloadURL.mockReset()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it.each(['backup', 'restore'])('does not resume %s polling after navigation during initial loading', async (operation) => {
    vi.useFakeTimers()
    let finish!: (value: object) => void
    listBackups.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const view = mountBackupView()
    try {
      await flushPromises()
      view.unmount()
      // 首次渲染时第三方动画库可能留下与轮询无关的定时器，只断言卸载后没有新增定时器
      const baseline = vi.getTimerCount()
      finish({
        items: [
          {
            ...baseRecord('pending'),
            status: operation === 'backup' ? 'running' : 'completed',
            restore_status: operation === 'restore' ? 'running' : undefined
          }
        ]
      })
      await flushPromises()
      expect(vi.getTimerCount()).toBe(baseline)
    } finally {
      view.unmount()
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('显示分卷数并在下载时列出每个分卷链接', async () => {
    listBackups.mockResolvedValue({ items: [baseRecord('split', [{ index: 1 }, { index: 2 }, { index: 3 }])] })
    getDownloadURL.mockResolvedValue({
      parts: [
        { index: 1, size_bytes: 5, url: 'https://example.test/part-1' },
        { index: 2, size_bytes: 6, url: 'https://example.test/part-2' },
        { index: 3, size_bytes: 7, url: 'https://example.test/part-3' }
      ]
    })

    const { container } = mountBackupView()
    await flushPromises()

    expect(container.textContent).toContain('3')
    const downloadButton = screen.getAllByRole('button').find((button) => button.textContent?.includes('admin.backup.actions.download'))
    expect(downloadButton).toBeDefined()
    await click(downloadButton!)
    await flushPromises()

    expect(document.body.textContent).toContain('admin.backup.actions.partLabel:1')
    expect(document.body.textContent).toContain('admin.backup.actions.partLabel:3')
    expect(document.body.querySelector('a[href="https://example.test/part-2"]')).not.toBeNull()
  })

  it('旧单文件记录仍使用单个下载地址', async () => {
    listBackups.mockResolvedValue({ items: [baseRecord('legacy')] })
    getDownloadURL.mockResolvedValue({ url: 'https://example.test/legacy.sql.gz' })

    mountBackupView()
    await flushPromises()
    const downloadButton = screen.getAllByRole('button').find((button) => button.textContent?.includes('admin.backup.actions.download'))
    await click(downloadButton!)
    await flushPromises()

    expect(getDownloadURL).toHaveBeenCalledWith('legacy')
    expect(document.body.textContent).not.toContain('admin.backup.actions.downloadParts')
  })

  it('运行中的备份不显示删除入口', async () => {
    listBackups.mockResolvedValue({ items: [{ ...baseRecord('running'), status: 'running', progress: 'uploading' }] })

    mountBackupView()
    await flushPromises()

    expect(get('tbody tr td:nth-child(5)').textContent).toBe('-')
    expect(screen.getAllByRole('button').some((button) => button.textContent === 'common.delete')).toBe(false)
  })

  it('兼容旧配置并保留 0 值，不自动启用月度归档', async () => {
    getSchedule.mockResolvedValue({ enabled: true, cron_expr: '0 4 * * *', retain_days: 0, retain_count: 0 })
    mountBackupView()
    await flushPromises()
    expect(get('[data-testid="backup-retain-days"]').value).toBe('0')
    expect(get('[data-testid="backup-retain-count"]').value).toBe('0')
    expect(archiveSwitch()).toHaveAttribute('aria-checked', 'false')
    await click(saveButton())
    await flushPromises()
    expect(updateSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ retain_days: 0, retain_count: 0, monthly_archive: expect.objectContaining({ enabled: false }) })
    )
  })

  it('多选日期，手填份数；永久保留隐藏数量并在取消后恢复', async () => {
    mountBackupView()
    await flushPromises()
    await setArchiveEnabled(true)
    await click(get('#backup-archive-dates'))
    await setChecked('#backup-archive-options input[value="15"]', true)
    await setChecked('#backup-archive-options input[value="last"]', true)
    expect(get('#backup-archive-dates').getAttribute('aria-expanded')).toBe('true')
    expect(q('[data-testid="archive-count"]')).toBeNull()
    await setChecked('[data-testid="archive-forever"]', false)
    await setValue('[data-testid="archive-count"]', 17)
    await setChecked('[data-testid="archive-forever"]', true)
    expect(q('[data-testid="archive-count"]')).toBeNull()
    expect(get('section[aria-labelledby="backup-archive-title"]').textContent).not.toContain('admin.backup.archive.copies')
    await setChecked('[data-testid="archive-forever"]', false)
    expect(get('[data-testid="archive-count"]').value).toBe('17')
    await click(saveButton())
    await flushPromises()
    expect(updateSchedule).toHaveBeenLastCalledWith(
      expect.objectContaining({ monthly_archive: { enabled: true, days: [1, 15], include_month_end: true, retain_count: 17 } })
    )
    await setChecked('[data-testid="archive-forever"]', true)
    await click(saveButton())
    expect(updateSchedule).toHaveBeenLastCalledWith(
      expect.objectContaining({ monthly_archive: expect.objectContaining({ retain_count: 0 }) })
    )
  })

  it('空日期和非法份数不可保存，输入 0 不会误选永久保留', async () => {
    mountBackupView()
    await flushPromises()
    await setArchiveEnabled(true)
    await click(get('#backup-archive-dates'))
    await setChecked('#backup-archive-options input[value="1"]', false)
    expect(saveButton()).toBeDisabled()
    await setChecked('#backup-archive-options input[value="15"]', true)
    await setChecked('[data-testid="archive-forever"]', false)
    for (const value of ['0', '-1', '1.5', '']) {
      await setValue('[data-testid="archive-count"]', value)
      expect(saveButton()).toBeDisabled()
      expect(get('[data-testid="archive-forever"]').checked).toBe(false)
    }
    await click(saveButton())
    expect(updateSchedule).not.toHaveBeenCalled()
  })

  it('关闭月度归档后不提交隐藏的归档参数，重新启用时保留编辑值', async () => {
    getSchedule.mockResolvedValue({
      enabled: true,
      cron_expr: '0 4 * * *',
      retain_days: 14,
      retain_count: 10,
      monthly_archive: { enabled: true, days: [1, 15], include_month_end: false, retain_count: 12 }
    })
    mountBackupView()
    await flushPromises()
    await setValue('[data-testid="archive-count"]', 1)
    await setArchiveEnabled(false)
    expect(q('[data-testid="archive-count"]')).toBeNull()
    await click(saveButton())
    await flushPromises()
    expect(updateSchedule).toHaveBeenLastCalledWith(
      expect.objectContaining({ monthly_archive: { enabled: false, days: [1, 15], include_month_end: false, retain_count: 12 } })
    )
    await setArchiveEnabled(true)
    expect(get('[data-testid="archive-count"]').value).toBe('1')
    // A hidden invalid count neither blocks saving nor reaches the request.
    await setValue('[data-testid="archive-count"]', '')
    expect(saveButton()).toBeDisabled()
    await setArchiveEnabled(false)
    expect(saveButton()).not.toBeDisabled()
    await click(saveButton())
    await flushPromises()
    expect(updateSchedule).toHaveBeenLastCalledWith(
      expect.objectContaining({ monthly_archive: { enabled: false, days: [1, 15], include_month_end: false, retain_count: 12 } })
    )
    await setArchiveEnabled(true)
    await setValue('[data-testid="archive-count"]', 1)
    await click(saveButton())
    await flushPromises()
    expect(updateSchedule).toHaveBeenLastCalledWith(
      expect.objectContaining({ monthly_archive: { enabled: true, days: [1, 15], include_month_end: false, retain_count: 1 } })
    )
  })

  it('加载归档设置并支持键盘关闭日期选择器', async () => {
    getSchedule.mockResolvedValue({
      enabled: true,
      cron_expr: '0 4 * * *',
      retain_days: 14,
      retain_count: 10,
      monthly_archive: { enabled: true, days: [1, 15], include_month_end: true, retain_count: 23 }
    })
    mountBackupView()
    await flushPromises()
    expect(get('[data-testid="archive-count"]').value).toBe('23')
    await act(async () => { fireEvent.keyDown(get('#backup-archive-dates'), { key: 'ArrowDown' }) })
    await flushPromises()
    expect(q('#backup-archive-options')).not.toBeNull()
    expect(get('#backup-archive-options input[value="15"]').checked).toBe(true)
    await act(async () => { fireEvent.keyDown(get('#backup-archive-options'), { key: 'Escape' }) })
    expect(q('#backup-archive-options')).toBeNull()
  })

  it('归档删除需要单独确认，有限归档不会显示永不过期', async () => {
    listBackups.mockResolvedValue({
      items: [{ ...baseRecord('archived'), monthly_archive: { dates: ['2026-09-01', '2026-09-15'], retain_count: 12 } }]
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { container } = mountBackupView()
    await flushPromises()
    expect(container.textContent).toContain('admin.backup.archive.badge')
    expect(get('tbody tr td:nth-child(6)').textContent).toBe('admin.backup.archive.retainLatest')
    const button = screen.getAllByRole('button').find((b) => b.textContent === 'common.delete')!
    await click(button)
    expect(confirm).toHaveBeenCalledWith('admin.backup.archive.deleteConfirm')
    expect(deleteBackup).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await click(button)
    await flushPromises()
    expect(deleteBackup).toHaveBeenCalledWith('archived', true)
  })
})
