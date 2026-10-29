import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Account } from '@/types'
import TempUnschedStatusModal from '../TempUnschedStatusModal'

const mocks = vi.hoisted(() => ({ getTempUnschedulableStatus: vi.fn(), recoverState: vi.fn(), showError: vi.fn(), showSuccess: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { accounts: mocks } }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => mocks } }))
vi.mock('@/utils/format', () => ({ formatDateTime: () => 'date' }))
// t 需保持稳定引用（与真实 useI18n 一致），否则依赖 t 的 effect 会在每次渲染时重跑
const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))
beforeEach(() => vi.clearAllMocks())

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

function deferred() {
  let resolve!: (value: unknown) => void
  let reject!: (value: unknown) => void
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const active = (message: string) => ({ active: true, state: { until_unix: Date.now() / 1000 + 3600, error_message: message, rule_index: -1 } })

// Vue 版用 BaseDialog 桩和 button.btn-primary 查找，React 版渲染真实对话框并按 data-testid 查找
const recoverButton = () => screen.getByTestId('temp-unsched-recover')

async function open() {
  const view = render(<TempUnschedStatusModal show={false} account={{ id: 1, name: 'first' } as Account} />)
  view.rerender(<TempUnschedStatusModal show account={{ id: 1, name: 'first' } as Account} />)
  return view
}

describe('temporary unschedulable status requests', () => {
  it('does not let a late response replace the next account status', async () => {
    const old = deferred()
    mocks.getTempUnschedulableStatus.mockReturnValueOnce(old.promise).mockResolvedValueOnce(active('current-error'))
    const view = await open()
    view.rerender(<TempUnschedStatusModal show account={{ id: 2, name: 'second' } as Account} />)
    await flushPromises()
    old.resolve(active('old-error')); await flushPromises()
    expect(document.body.textContent).toContain('current-error')
    expect(document.body.textContent).not.toContain('old-error')
  })

  it('keeps recovery disabled while loading a different account', async () => {
    const current = deferred()
    mocks.getTempUnschedulableStatus.mockResolvedValueOnce(active('old-error')).mockReturnValueOnce(current.promise)
    const view = await open(); await flushPromises()
    view.rerender(<TempUnschedStatusModal show account={{ id: 2 } as Account} />)
    expect(recoverButton()).toBeDisabled()
    current.resolve(active('current-error')); await flushPromises()
    expect(recoverButton()).not.toBeDisabled()
  })

  it('ignores old errors without dismissing the current loading state', async () => {
    const old = deferred(); const current = deferred()
    mocks.getTempUnschedulableStatus.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const view = await open()
    view.rerender(<TempUnschedStatusModal show={false} account={{ id: 1, name: 'first' } as Account} />)
    view.rerender(<TempUnschedStatusModal show account={{ id: 1, name: 'first' } as Account} />)
    old.reject(new Error('obsolete')); await flushPromises()
    expect(mocks.showError).not.toHaveBeenCalled()
    expect(screen.getByTestId('temp-unsched-loading')).toBeInTheDocument()
    current.resolve({ active: false }); await flushPromises()
    expect(document.body.textContent).toContain('admin.accounts.tempUnschedulable.notActive')
  })
})
