import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import UsageCleanupDialog from '../UsageCleanupDialog'

const { listCleanupTasks, showError, paginationProps } = vi.hoisted(() => ({
  listCleanupTasks: vi.fn(),
  showError: vi.fn(),
  paginationProps: { current: null as null | { page: number; onPageChange?: (page: number) => void } }
}))

vi.mock('../UsageFilters', () => ({ default: () => <div /> }))
vi.mock('@/api/admin/usage', () => ({ adminUsageAPI: { listCleanupTasks } }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showError }) } }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
vi.mock('@/components/common/BaseDialog', () => ({
  default: ({ show, children, footer }: { show: boolean; children?: ReactNode; footer?: ReactNode }) =>
    show ? (
      <div>
        {children}
        {footer}
      </div>
    ) : null
}))
vi.mock('@/components/common/ConfirmDialog', () => ({ default: () => null }))
vi.mock('@/components/common/Pagination', () => ({
  default: (props: { page: number; onPageChange?: (page: number) => void }) => {
    paginationProps.current = props
    return <div data-testid="pagination" data-page={props.page} />
  }
}))

const flushPromises = () => act(async () => {})

beforeEach(() => {
  vi.clearAllMocks()
  paginationProps.current = null
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const page = (number: number) => ({ items: [{ id: number, status: 'succeeded', deleted_rows: number, filters: {} }], total: 15, page: number, page_size: 5 })
const props = { filters: {}, startDate: '2026-09-01', endDate: '2026-09-02' }

async function openDialog() {
  listCleanupTasks.mockResolvedValueOnce(page(1))
  const view = render(<UsageCleanupDialog show={false} {...props} />)
  view.rerender(<UsageCleanupDialog show {...props} />)
  await flushPromises()
  return view
}

const emitPage = async (value: number) => {
  await act(async () => {
    paginationProps.current?.onPageChange?.(value)
  })
}

describe('cleanup task pagination', () => {
  it.each(['success', 'failure'])('ignores an older page request that completes with %s', async (outcome) => {
    await openDialog()
    let resolve!: (value: object) => void
    let reject!: (error: Error) => void
    listCleanupTasks.mockImplementationOnce(
      () =>
        new Promise((res, rej) => {
          resolve = res
          reject = rej
        })
    )
    await emitPage(2)
    listCleanupTasks.mockResolvedValueOnce(page(3))
    await emitPage(3)
    await flushPromises()
    await act(async () => {
      if (outcome === 'success') resolve(page(2))
      else reject(new Error('old failure'))
    })
    await flushPromises()
    expect(screen.getByTestId('pagination')).toHaveAttribute('data-page', '3')
    expect(document.body.textContent).toContain('#3')
    expect(showError).not.toHaveBeenCalled()
  })

  it('ignores a pending result after the dialog is closed and reopened', async () => {
    const view = await openDialog()
    let resolve!: (value: object) => void
    listCleanupTasks.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolve = res
        })
    )
    await emitPage(2)
    view.rerender(<UsageCleanupDialog show={false} {...props} />)
    listCleanupTasks.mockResolvedValueOnce(page(1))
    view.rerender(<UsageCleanupDialog show {...props} />)
    await flushPromises()
    await act(async () => {
      resolve(page(2))
    })
    await flushPromises()
    expect(screen.getByTestId('pagination')).toHaveAttribute('data-page', '1')
    expect(document.body.textContent).toContain('#1')
  })
})
