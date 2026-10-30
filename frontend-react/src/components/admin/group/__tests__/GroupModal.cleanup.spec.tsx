import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminGroup } from '@/types'
import GroupRateMultipliersModal from '../GroupRateMultipliersModal'
import GroupRPMOverridesModal from '../GroupRPMOverridesModal'

const mocks = vi.hoisted(() => ({
  list: vi.fn().mockResolvedValue({ items: [] }),
  getGroupRPMOverrides: vi.fn().mockResolvedValue([]),
  getGroupRateMultipliers: vi.fn().mockResolvedValue([]),
  showError: vi.fn(),
  showSuccess: vi.fn()
}))
vi.mock('@/api/admin', () => ({ adminAPI: { users: mocks, groups: mocks } }))
vi.mock('@/stores/app', async () =>
  (await import('./groupModalHarness')).appStoreModule({ showSuccess: mocks.showSuccess, showError: mocks.showError })
)
vi.mock('@/i18n/useI18n', async () => (await import('./groupModalHarness')).i18nModule())
vi.mock('@/components/common/BaseDialog', async () => (await import('./groupModalHarness')).baseDialogModule())
vi.mock('@/components/common/Pagination', async () => (await import('./groupModalHarness')).nullModule())

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe.each([GroupRPMOverridesModal, GroupRateMultipliersModal])('group modal lifecycle', (Component) => {
  function open() {
    return render(
      <Component
        show
        group={{ id: 1, name: 'Group', platform: 'openai' } as AdminGroup}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )
  }

  it('removes its document click listener on unmount', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const view = open()
    const handlers = add.mock.calls.filter(([event]) => event === 'click').map(([, handler]) => handler)
    expect(handlers.length).toBeGreaterThan(0)
    view.unmount()
    for (const handler of handlers) expect(remove).toHaveBeenCalledWith('click', handler)
  })

  it('cancels a queued search when navigating away', async () => {
    const view = open()
    fireEvent.change(document.querySelector('input[type="text"]')!, { target: { value: 'alice' } })
    view.unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
