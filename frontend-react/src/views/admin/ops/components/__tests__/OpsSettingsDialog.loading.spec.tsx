import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import OpsSettingsDialog from '../OpsSettingsDialog'

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const { opsAPI, showError } = vi.hoisted(() => ({
  opsAPI: {
    getAlertRuntimeSettings: vi.fn(), getEmailNotificationConfig: vi.fn(),
    getAdvancedSettings: vi.fn(), getMetricThresholds: vi.fn(),
    updateAlertRuntimeSettings: vi.fn(), updateEmailNotificationConfig: vi.fn(),
    updateAdvancedSettings: vi.fn(), updateMetricThresholds: vi.fn(),
  }, showError: vi.fn(),
}))
vi.mock('@/api/admin/ops', () => ({ opsAPI }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showError, showSuccess: vi.fn() }) } }))

const flushPromises = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
const saveButton = () => screen.getByRole('button', { name: 'common.save' })

// Vue 版直接调用 vm.saveAllSettings() 验证守卫；React 版没有实例方法，改为对按钮派发点击（禁用时不会触发保存）。
async function trySave() {
  fireEvent.click(saveButton())
  await flushPromises()
}

function renderDialog() {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  const view = render(<OpsSettingsDialog show={false} onSaved={onSaved} onClose={onClose} />)
  const setShow = (show: boolean) => view.rerender(<OpsSettingsDialog show={show} onSaved={onSaved} onClose={onClose} />)
  return { setShow, onSaved }
}

async function openDialog() {
  const harness = renderDialog()
  await act(async () => { harness.setShow(true) })
  return harness
}

describe('ops settings load guard', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    opsAPI.getAlertRuntimeSettings.mockResolvedValue({ evaluation_interval_seconds: 30 })
    opsAPI.getEmailNotificationConfig.mockResolvedValue({ alert: { enabled: false }, report: { enabled: false } })
    opsAPI.getAdvancedSettings.mockResolvedValue({ data_retention: { error_log_retention_days: 7, minute_metrics_retention_days: 7, hourly_metrics_retention_days: 7 }, aggregation: {} })
    opsAPI.getMetricThresholds.mockResolvedValue({ sla_percent_min: 98 })
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('blocks saving while any settings request is still loading', async () => {
    const pending = deferred<object>()
    opsAPI.getMetricThresholds.mockReturnValueOnce(pending.promise)
    const { onSaved } = await openDialog()
    expect(saveButton()).toBeDisabled()
    await trySave()
    expect(opsAPI.updateMetricThresholds).not.toHaveBeenCalled()
    await act(async () => { pending.resolve({ sla_percent_min: 98 }) })
    await flushPromises()
    expect(saveButton()).toBeEnabled()
    fireEvent.click(saveButton())
    await flushPromises()
    expect(opsAPI.updateMetricThresholds).toHaveBeenCalledWith(expect.objectContaining({ sla_percent_min: 98 }))
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('does not save default thresholds after a failed initial load', async () => {
    opsAPI.getMetricThresholds.mockRejectedValueOnce(new Error('load failed'))
    const { onSaved } = await openDialog()
    await flushPromises()
    expect(saveButton()).toBeDisabled()
    await trySave()
    expect(opsAPI.updateMetricThresholds).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('blocks saving stale settings after a failed reopen and allows a later retry', async () => {
    const { setShow } = await openDialog()
    await flushPromises()
    await act(async () => { setShow(false) })
    opsAPI.getMetricThresholds.mockRejectedValueOnce(new Error('refresh failed'))
    await act(async () => { setShow(true) })
    await flushPromises()
    expect(saveButton()).toBeDisabled()
    await trySave()
    expect(opsAPI.updateAlertRuntimeSettings).not.toHaveBeenCalled()
    await act(async () => { setShow(false) })
    await act(async () => { setShow(true) })
    await flushPromises()
    await waitFor(() => expect(saveButton()).toBeEnabled())
  })
})
