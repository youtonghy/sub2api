import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AssociatedMonitorBrief } from '@/api/admin/channelMonitorTemplate'
import MonitorTemplateApplyPickerDialog from '../MonitorTemplateApplyPickerDialog'

const mocks = vi.hoisted(() => ({ listAssociatedMonitors: vi.fn(), apply: vi.fn(), showError: vi.fn(), showSuccess: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { channelMonitorTemplate: mocks } }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => mocks } }))
const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))
// Vue 版把 BaseDialog 换成只在 show 时渲染内容与页脚的桩
vi.mock('@/components/common/BaseDialog', () => ({
  default: ({ show, children, footer }: { show: boolean; children?: ReactNode; footer?: ReactNode }) =>
    show ? (
      <div>
        {children}
        {footer}
      </div>
    ) : null
}))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.apply.mockResolvedValue({ affected: 1 })
})

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

function deferred() {
  let resolve!: (value: { items: AssociatedMonitorBrief[] }) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<{ items: AssociatedMonitorBrief[] }>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
const items = (id: number) => ({ items: [{ id, name: `Monitor ${id}`, provider: 'openai', enabled: true } as AssociatedMonitorBrief] })

function mountDialog(onApplied = vi.fn()) {
  const view = render(<MonitorTemplateApplyPickerDialog show templateId={1} templateName="Template" onApplied={onApplied} />)
  const setProps = (props: { show: boolean; templateId?: number }) =>
    view.rerender(
      <MonitorTemplateApplyPickerDialog show={props.show} templateId={props.templateId ?? 1} templateName="Template" onApplied={onApplied} />
    )
  return { ...view, setProps, onApplied }
}

const confirmButton = () => screen.getByTestId('apply-picker-confirm')

describe('MonitorTemplateApplyPickerDialog request ordering', () => {
  it('applies the current template only to its own monitors after an older response', async () => {
    const old = deferred()
    mocks.listAssociatedMonitors.mockReturnValueOnce(old.promise).mockResolvedValueOnce(items(20))
    const view = mountDialog()
    view.setProps({ show: false })
    view.setProps({ show: true, templateId: 2 })
    await flushPromises()
    old.resolve(items(10))
    await flushPromises()
    expect(view.container.textContent).toContain('Monitor 20')
    expect(view.container.textContent).not.toContain('Monitor 10')
    fireEvent.click(confirmButton())
    await flushPromises()
    expect(mocks.apply).toHaveBeenCalledWith(2, [20])
    expect(view.onApplied.mock.calls).toEqual([[1]])
  })

  it('keeps loading the current template when an older request fails', async () => {
    const old = deferred()
    const current = deferred()
    mocks.listAssociatedMonitors.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const view = mountDialog()
    view.setProps({ show: true, templateId: 2 })
    old.reject({ message: 'Old failure' })
    await flushPromises()
    expect(mocks.showError).not.toHaveBeenCalled()
    expect(view.container.textContent).toContain('common.loading')
    expect(confirmButton()).toBeDisabled()
    current.resolve(items(20))
    await flushPromises()
    expect(view.container.textContent).toContain('Monitor 20')
  })

  it.each(['close', 'unmount'])('ignores a pending failure after %s', async (action) => {
    const pending = deferred()
    mocks.listAssociatedMonitors.mockReturnValueOnce(pending.promise)
    const view = mountDialog()
    if (action === 'close') view.setProps({ show: false })
    else view.unmount()
    pending.reject({ message: 'No longer relevant' })
    await flushPromises()
    expect(mocks.showError).not.toHaveBeenCalled()
  })

  it('still reports errors from the current request', async () => {
    mocks.listAssociatedMonitors.mockRejectedValueOnce({ message: 'Current failure' })
    const view = mountDialog()
    await flushPromises()
    expect(mocks.showError).toHaveBeenCalledWith('Current failure')
    expect(view.container.textContent).not.toContain('common.loading')
  })
})
