import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getDetail } = vi.hoisted(() => ({ getDetail: vi.fn() }))
vi.mock('@/api/usage', () => ({ getMyErrorDetail: getDetail }))
vi.mock('@/utils/format', () => ({ formatDateTime: (value: string) => value }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
vi.mock('@/components/common/BaseDialog', () => ({
  default: ({ show, children }: { show: boolean; children?: ReactNode }) => (show ? <div data-testid="dialog">{children}</div> : null)
}))

import UserErrorDetailModal from '../UserErrorDetailModal'

const flushPromises = () => act(async () => {})

beforeEach(() => {
  getDetail.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function deferred() {
  let resolve!: (value: unknown) => void
  let reject!: (error: Error) => void
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
const detail = (model: string) => ({ model, status_code: 500, category: 'upstream', created_at: '2026-09-20' })

async function open() {
  const view = render(<UserErrorDetailModal show={false} errorId={1} />)
  const setProps = (props: { show: boolean; errorId: number | null }) =>
    act(async () => {
      view.rerender(<UserErrorDetailModal {...props} />)
    })
  let current = { show: true, errorId: 1 as number | null }
  await setProps(current)
  return {
    ...view,
    setProps: async (patch: Partial<typeof current>) => {
      current = { ...current, ...patch }
      await setProps(current)
    }
  }
}

const isLoading = () => screen.queryByTestId('error-detail-loading') !== null
const text = () => document.body.textContent ?? ''

describe('user error detail requests', () => {
  it('keeps the newer detail when an earlier request finishes last', async () => {
    const old = deferred()
    const current = deferred()
    getDetail.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const view = await open()
    await view.setProps({ show: false })
    await view.setProps({ show: true, errorId: 2 })
    current.resolve(detail('current-model'))
    await flushPromises()
    old.resolve(detail('old-model'))
    await flushPromises()
    expect(text()).toContain('current-model')
    expect(text()).not.toContain('old-model')
  })

  it('keeps loading until the current request settles', async () => {
    const old = deferred()
    const current = deferred()
    getDetail.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const view = await open()
    await view.setProps({ errorId: 2 })
    old.resolve(detail('old-model'))
    await flushPromises()
    expect(isLoading()).toBe(true)
    current.resolve(detail('current-model'))
    await flushPromises()
    expect(isLoading()).toBe(false)
    expect(text()).toContain('current-model')
  })

  it('ignores an obsolete failure, including when reopening the same record', async () => {
    const old = deferred()
    getDetail.mockReturnValueOnce(old.promise).mockResolvedValueOnce(detail('current-model'))
    const view = await open()
    await view.setProps({ show: false })
    await view.setProps({ show: true })
    await flushPromises()
    old.reject(new Error('obsolete'))
    await flushPromises()
    expect(text()).toContain('current-model')
    expect(text()).not.toContain('usage.errors.detail.loadFailed')
  })

  it('still reports a failure for the current record', async () => {
    getDetail.mockRejectedValueOnce(new Error('current failure'))
    await open()
    await flushPromises()
    expect(text()).toContain('usage.errors.detail.loadFailed')
    expect(isLoading()).toBe(false)
  })
})
