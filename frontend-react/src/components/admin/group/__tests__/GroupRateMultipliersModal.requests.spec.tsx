import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminGroup } from '@/types'
import GroupRateMultipliersModal from '../GroupRateMultipliersModal'
import { buttonByText, flushPromises, setValueAndCommit } from './groupModalHarness'

const mocks = vi.hoisted(() => ({ getGroupRateMultipliers: vi.fn(), batchSetGroupRateMultipliers: vi.fn(), showError: vi.fn(), showSuccess: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { groups: mocks } }))
vi.mock('@/stores/app', async () =>
  (await import('./groupModalHarness')).appStoreModule({ showSuccess: mocks.showSuccess, showError: mocks.showError })
)
vi.mock('@/i18n/useI18n', async () => (await import('./groupModalHarness')).i18nModule())
vi.mock('@/components/common/BaseDialog', async () => (await import('./groupModalHarness')).baseDialogModule())
vi.mock('@/components/common/Pagination', async () => (await import('./groupModalHarness')).nullModule())

afterEach(cleanup)
beforeEach(() => vi.resetAllMocks())
afterEach(() => vi.restoreAllMocks())

function deferred() {
  let resolve!: (value: unknown) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
const group = (id: number) => ({ id, name: `Group ${id}`, platform: 'openai', rate_multiplier: 1 }) as AdminGroup
const entries = (id: number) => [{ user_id: id, user_name: '', user_email: `user${id}@example.com`, user_status: 'active', rate_multiplier: 2, rpm_override: null }]

function openGroup() {
  const view = render(<GroupRateMultipliersModal show={false} group={group(1)} onClose={vi.fn()} onSuccess={vi.fn()} />)
  view.rerender(<GroupRateMultipliersModal show group={group(1)} onClose={vi.fn()} onSuccess={vi.fn()} />)
  const setProps = (props: { show: boolean; group: AdminGroup }) =>
    view.rerender(<GroupRateMultipliersModal show={props.show} group={props.group} onClose={vi.fn()} onSuccess={vi.fn()} />)
  return { view, setProps }
}

const tbodyText = () => document.querySelector('tbody')?.textContent ?? ''

describe('group rate multiplier request ownership', () => {
  it('keeps the reopened group data when an older response finishes last', async () => {
    const old = deferred()
    mocks.getGroupRateMultipliers.mockReturnValueOnce(old.promise).mockResolvedValueOnce(entries(2))
    const { setProps } = openGroup()
    setProps({ show: false, group: group(1) })
    setProps({ show: true, group: group(2) })
    await flushPromises()
    old.resolve(entries(1))
    await flushPromises()
    expect(tbodyText()).toContain('user2@example.com')
    expect(tbodyText()).not.toContain('user1@example.com')
    setValueAndCommit(document.querySelector('tbody input[type="number"]')!, '3')
    fireEvent.click(buttonByText('common.save')!)
    expect(mocks.batchSetGroupRateMultipliers).toHaveBeenCalledWith(2, [{ user_id: 2, rate_multiplier: 3 }])
  })

  it('does not end the new load or report an error when an old request fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const old = deferred()
    const current = deferred()
    mocks.getGroupRateMultipliers.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const { setProps } = openGroup()
    setProps({ show: false, group: group(1) })
    setProps({ show: true, group: group(2) })
    old.reject(new Error('old request failed'))
    await flushPromises()
    expect(mocks.showError).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="group-overrides-loading"]')).not.toBeNull()
    current.resolve(entries(2))
    await flushPromises()
    expect(tbodyText()).toContain('user2@example.com')
  })

  it('loads a different group while the dialog remains open', async () => {
    mocks.getGroupRateMultipliers.mockResolvedValueOnce(entries(1)).mockResolvedValueOnce(entries(2))
    const { setProps } = openGroup()
    await flushPromises()
    setProps({ show: true, group: group(2) })
    await flushPromises()
    expect(mocks.getGroupRateMultipliers).toHaveBeenLastCalledWith(2)
    expect(tbodyText()).toContain('user2@example.com')
  })

  it('discards the previous group draft before loading the next group', async () => {
    mocks.getGroupRateMultipliers.mockResolvedValueOnce(entries(1)).mockReturnValueOnce(deferred().promise)
    const { setProps } = openGroup()
    await flushPromises()
    setValueAndCommit(document.querySelector('tbody input[type="number"]')!, '3')
    setProps({ show: false, group: group(1) })
    setProps({ show: true, group: group(2) })
    expect(buttonByText('common.save')).toBeUndefined()
  })

  it('ignores a request failure after unmounting', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const request = deferred()
    mocks.getGroupRateMultipliers.mockReturnValue(request.promise)
    const { view } = openGroup()
    view.unmount()
    request.reject(new Error('offline'))
    await flushPromises()
    expect(mocks.showError).not.toHaveBeenCalled()
  })
})
