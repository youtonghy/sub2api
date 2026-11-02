import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MonitorDetailDialog, { type MonitorDetailDialogProps } from '../MonitorDetailDialog'
import { useAppStore } from '@/stores/app'

const mocks = vi.hoisted(() => ({ status: vi.fn(), showError: vi.fn() }))
vi.mock('@/api/channelMonitor', () => ({ status: mocks.status }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
vi.mock('@/components/common/BaseDialog', () => ({
  default: ({ show, children }: { show: boolean; children?: ReactNode }) => (show ? <div>{children}</div> : null)
}))

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ showError: mocks.showError })
})

function deferred() {
  let resolve!: (value: unknown) => void
  let reject!: (value: unknown) => void
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
const detail = (model: string) => ({ models: [{ model, latest_status: 'operational' }] })
const flushPromises = () => act(async () => {})

function open() {
  let props: MonitorDetailDialogProps = { show: true, monitorId: 1, title: 'Monitor' }
  const view = render(<MonitorDetailDialog {...props} />)
  return {
    ...view,
    setProps(next: Partial<MonitorDetailDialogProps>) {
      props = { ...props, ...next }
      view.rerender(<MonitorDetailDialog {...props} />)
    }
  }
}

describe('monitor detail request ownership', () => {
  it('keeps the new monitor response when the old response arrives last', async () => {
    const old = deferred()
    mocks.status.mockReturnValueOnce(old.promise).mockResolvedValueOnce(detail('new-model'))
    const w = open()
    w.setProps({ monitorId: 2 })
    await flushPromises()
    await act(async () => old.resolve(detail('old-model')))
    expect(w.container.textContent).toContain('new-model')
    expect(w.container.textContent).not.toContain('old-model')
  })

  it('ignores a previous failure while the current monitor is loading', async () => {
    const old = deferred()
    const current = deferred()
    mocks.status.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const w = open()
    w.setProps({ show: false })
    w.setProps({ show: true })
    await act(async () => old.reject(new Error('old failure')))
    expect(mocks.showError).not.toHaveBeenCalled()
    expect(w.container.textContent).toContain('common.loading')
    await act(async () => current.resolve(detail('current')))
    expect(w.container.textContent).toContain('current')
  })

  it('reports a failure for the current monitor', async () => {
    mocks.status.mockRejectedValueOnce(new Error('current failure'))
    const w = open()
    await flushPromises()
    expect(mocks.showError).toHaveBeenCalledWith('current failure')
    expect(w.container.textContent).toContain('channelStatus.detailLoadError')
  })
})
