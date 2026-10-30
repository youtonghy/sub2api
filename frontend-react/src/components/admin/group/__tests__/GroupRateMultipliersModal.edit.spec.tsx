import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminGroup } from '@/types'
import GroupRateMultipliersModal from '../GroupRateMultipliersModal'
import { buttonByText, flushPromises, setValueAndCommit } from './groupModalHarness'

const mocks = vi.hoisted(() => ({ getGroupRateMultipliers: vi.fn(), batchSetGroupRateMultipliers: vi.fn(), showSuccess: vi.fn(), showError: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { groups: mocks } }))
vi.mock('@/stores/app', async () =>
  (await import('./groupModalHarness')).appStoreModule({ showSuccess: mocks.showSuccess, showError: mocks.showError })
)
vi.mock('@/i18n/useI18n', async () => (await import('./groupModalHarness')).i18nModule())
vi.mock('@/components/common/BaseDialog', async () => (await import('./groupModalHarness')).baseDialogModule())
vi.mock('@/components/common/Pagination', async () => (await import('./groupModalHarness')).nullModule())

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  mocks.getGroupRateMultipliers.mockResolvedValue([
    { user_id: 7, user_email: 'user@example.com', user_name: '', user_status: 'active', rate_multiplier: 2, rpm_override: null }
  ])
})

async function openEditor() {
  const group = { id: 1, name: 'Group', platform: 'openai', rate_multiplier: 1 } as AdminGroup
  const view = render(<GroupRateMultipliersModal show={false} group={group} onClose={vi.fn()} onSuccess={vi.fn()} />)
  view.rerender(<GroupRateMultipliersModal show group={group} onClose={vi.fn()} onSuccess={vi.fn()} />)
  await flushPromises()
  return view
}

describe('group rate multiplier edits', () => {
  it.each(['0', '-1'])('does not stage invalid custom rate %s', async (value) => {
    await openEditor()
    setValueAndCommit(document.querySelector('tbody input[type="number"]')!, value)
    expect(buttonByText('common.save')).toBeUndefined()
    expect(mocks.batchSetGroupRateMultipliers).not.toHaveBeenCalled()
  })

  it.each([['0.5', 0.5], ['1e-3', 0.001]] as const)('saves positive rate %s', async (input, expected) => {
    await openEditor()
    setValueAndCommit(document.querySelector('tbody input[type="number"]')!, input)
    fireEvent.click(buttonByText('common.save')!)
    await flushPromises()
    expect(mocks.batchSetGroupRateMultipliers).toHaveBeenCalledWith(1, [{ user_id: 7, rate_multiplier: expected }])
  })

  it('still removes an override when its input is cleared', async () => {
    await openEditor()
    setValueAndCommit(document.querySelector('tbody input[type="number"]')!, '')
    fireEvent.click(buttonByText('common.save')!)
    expect(mocks.batchSetGroupRateMultipliers).toHaveBeenCalledWith(1, [])
  })
})
