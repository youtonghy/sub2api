import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MonitorTemplateManagerDialog from '../MonitorTemplateManagerDialog'

const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const { list, showError } = vi.hoisted(() => ({ list: vi.fn(), showError: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { channelMonitorTemplate: { list } } }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showError }) } }))
// Vue 版用 shallowMount + BaseDialog 桩（始终渲染内容）；子对话框不参与本用例
vi.mock('@/components/common/BaseDialog', () => ({ default: ({ children }: { children?: ReactNode }) => <div>{children}</div> }))
vi.mock('../MonitorTemplateApplyPickerDialog', () => ({ default: () => null }))
vi.mock('@/components/common/ConfirmDialog', () => ({ default: () => null }))

const response = (name: string) => ({ items: [{ id: 1, name, provider: 'anthropic', body_override_mode: 'off', associated_monitors: 0 }] })
const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

function mountDialog() {
  const view = render(<MonitorTemplateManagerDialog show />)
  const setShow = (show: boolean) => view.rerender(<MonitorTemplateManagerDialog show={show} />)
  return { ...view, setShow }
}

describe('monitor template list requests', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it.each(['resolve', 'reject'] as const)('ignores an old dialog request that %ss', async (outcome) => {
    const old = deferred<ReturnType<typeof response>>()
    list.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response('current-template'))
    const view = mountDialog()
    view.setShow(false)
    view.setShow(true)
    await flushPromises()
    if (outcome === 'resolve') old.resolve(response('old-template'))
    else old.reject(new Error('obsolete error'))
    await flushPromises()
    expect(view.container.textContent).toContain('current-template')
    expect(view.container.textContent).not.toContain('old-template')
    expect(showError).not.toHaveBeenCalled()
  })

  it('keeps the reopened dialog loading until its own request completes', async () => {
    const old = deferred<ReturnType<typeof response>>()
    const current = deferred<ReturnType<typeof response>>()
    list.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const view = mountDialog()
    view.setShow(false)
    view.setShow(true)
    old.resolve(response('old-template'))
    await flushPromises()
    expect(view.container.textContent).toContain('common.loading')
    current.resolve(response('current-template'))
    await flushPromises()
    expect(view.container.textContent).toContain('current-template')
  })

  it('does not report an error after closing the dialog', async () => {
    const request = deferred<ReturnType<typeof response>>()
    list.mockReturnValueOnce(request.promise)
    const view = mountDialog()
    view.setShow(false)
    request.reject(new Error('closed dialog'))
    await flushPromises()
    expect(showError).not.toHaveBeenCalled()
  })
})
