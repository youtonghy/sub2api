import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ProxiesView from '../ProxiesView'
import { flushPromises } from './proxiesViewTestUtils'

const { listProxies, getAllWithCount } = vi.hoisted(() => ({
  listProxies: vi.fn(),
  getAllWithCount: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: { proxies: { list: listProxies, getAllWithCount } }
}))
vi.mock('@/i18n/useI18n', async () => (await import('./proxiesViewTestUtils')).i18nMock())
vi.mock('@/components/common/DataTable', async () => ({ default: (await import('./proxiesViewHarness')).DataTableStub }))
vi.mock('@/components/common/Pagination', async () => ({ default: (await import('./proxiesViewHarness')).PaginationStub }))
vi.mock('@/components/common/Select', async () => ({ default: (await import('./proxiesViewHarness')).SelectStub }))

let unmount: (() => void) | undefined

beforeEach(() => {
  vi.clearAllMocks()
  getAllWithCount.mockResolvedValue([])
  listProxies.mockResolvedValue({ items: [], total: 100, pages: 5 })
})

afterEach(() => unmount?.())

const pageButton = () => document.querySelector('[data-test="page"]') as HTMLButtonElement

describe('proxy list filter pagination', () => {
  it.each([
    ['protocol', 'admin.proxies.allProtocols', 'socks5', ''],
    ['protocol', 'admin.proxies.allProtocols', '', 'http'],
    ['status', 'admin.proxies.allStatus', 'expired', ''],
    ['status', 'admin.proxies.allStatus', '', 'active']
  ])('starts at page one when changing %s through %s to "%s"', async (field, placeholder, value, initial) => {
    unmount = render(<ProxiesView />).unmount
    await flushPromises()
    const filter = document.querySelector(`select[data-filter="${placeholder}"]`) as HTMLSelectElement
    if (initial) {
      fireEvent.change(filter, { target: { value: initial } })
      await flushPromises()
    }
    fireEvent.click(pageButton())
    await flushPromises()
    expect(listProxies.mock.lastCall?.[0]).toBe(2)
    const [, pageSize, previousFilters] = listProxies.mock.lastCall!
    listProxies.mockImplementation(async (page) => ({
      items: page === 1 ? [{ id: 1, name: 'matching-proxy' }] : [],
      total: 1,
      pages: 1
    }))

    fireEvent.change(filter, { target: { value } })
    await flushPromises()

    expect(listProxies).toHaveBeenLastCalledWith(
      1, pageSize, { ...previousFilters, [field]: value || undefined },
      { signal: expect.any(AbortSignal) }
    )
    expect(pageButton().textContent).toBe('1')
    expect(document.querySelector('[data-test="rows"]')!.textContent).toBe('matching-proxy')
  })

  it('keeps the current page when refreshing the same filter', async () => {
    unmount = render(<ProxiesView />).unmount
    await flushPromises()
    fireEvent.click(pageButton())
    await flushPromises()

    fireEvent.click(screen.getByTitle('common.refresh'))
    await flushPromises()

    expect(listProxies.mock.lastCall?.[0]).toBe(2)
    expect(pageButton().textContent).toBe('2')
  })
})
