import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ScheduledTestsPanel from '../ScheduledTestsPanel'
import { useAppStore } from '@/stores/app'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: 'en', setLocale: vi.fn() })
}))

// Vue 版 shallowMount 并把 BaseDialog 替换为只渲染默认插槽的桩
vi.mock('@/components/common/BaseDialog', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>
}))
vi.mock('@/components/common/ConfirmDialog', () => ({ default: () => null }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const { listByAccount, listResults, showError } = vi.hoisted(() => ({
  listByAccount: vi.fn(), listResults: vi.fn(), showError: vi.fn()
}))
vi.mock('@/api/admin', () => ({ adminAPI: { scheduledTests: { listByAccount, listResults } } }))

const flushPromises = () => act(async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
})

async function openPanel() {
  const view = render(<ScheduledTestsPanel show={false} accountId={1} modelOptions={[]} onClose={vi.fn()} />)
  view.rerender(<ScheduledTestsPanel show accountId={1} modelOptions={[]} onClose={vi.fn()} />)
  await flushPromises()
  return view
}
const headers = () => screen.getAllByTestId('scheduled-plan-header')
const click = (element: HTMLElement) => act(() => { fireEvent.click(element) })
const result = (id: number) => ({ id, latency_ms: id, status: 'success', started_at: '2026-10-03T00:00:00Z' })

describe('scheduled test result selection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useAppStore.setState({ showError })
    listByAccount.mockResolvedValue([1, 2].map(id => ({ id, model_id: `model-${id}`, enabled: true })))
  })

  it.each(['resolve', 'reject'] as const)('ignores an old plan request that later %ss', async outcome => {
    const old = deferred<ReturnType<typeof result>[]>()
    listResults.mockReturnValueOnce(old.promise).mockResolvedValueOnce([result(22)])
    const { container } = await openPanel()
    click(headers()[0])
    click(headers()[1])
    await flushPromises()
    const current = container.innerHTML
    if (outcome === 'resolve') old.resolve([result(11)])
    else old.reject(new Error('obsolete error'))
    await flushPromises()
    expect(container.innerHTML).toBe(current)
    expect(showError).not.toHaveBeenCalled()
  })

  it('keeps loading the current plan when the previous request completes', async () => {
    const old = deferred<ReturnType<typeof result>[]>()
    const current = deferred<ReturnType<typeof result>[]>()
    listResults.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const { container } = await openPanel()
    click(headers()[0])
    click(headers()[1])
    old.resolve([result(11)])
    await flushPromises()
    expect(container.textContent).toContain('common.loading')
    current.resolve([result(22)])
    await flushPromises()
    expect(container.textContent).not.toContain('common.loading')
  })

  it('invalidates a request when the same plan is collapsed and reopened', async () => {
    const old = deferred<ReturnType<typeof result>[]>()
    listResults.mockReturnValueOnce(old.promise).mockResolvedValueOnce([result(22)])
    const { container } = await openPanel()
    click(headers()[0])
    click(headers()[0])
    click(headers()[0])
    await flushPromises()
    const current = container.innerHTML
    old.resolve([result(11)])
    await flushPromises()
    expect(container.innerHTML).toBe(current)
  })
})
