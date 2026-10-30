import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminGroup } from '@/types'
import GroupRPMOverridesModal from '../GroupRPMOverridesModal'
import { buttonByText, flushPromises, setValueAndCommit } from './groupModalHarness'

const mocks = vi.hoisted(() => ({ getGroupRPMOverrides: vi.fn(), batchSetGroupRPMOverrides: vi.fn(), showSuccess: vi.fn(), showError: vi.fn() }))
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
  mocks.getGroupRPMOverrides.mockResolvedValue([
    { user_id: 7, user_email: 'user@example.com', user_name: '', user_status: 'active', rpm_override: 100 }
  ])
})

async function openEditor() {
  const group = { id: 1, name: 'Group', platform: 'openai' } as AdminGroup
  const view = render(<GroupRPMOverridesModal show={false} group={group} onClose={vi.fn()} onSuccess={vi.fn()} />)
  view.rerender(<GroupRPMOverridesModal show group={group} onClose={vi.fn()} onSuccess={vi.fn()} />)
  await flushPromises()
  return view
}

describe('existing RPM override edits', () => {
  it.each(['', '1.5', '-1'])('does not save invalid RPM %j', async (value) => {
    await openEditor()
    setValueAndCommit(document.querySelector('tbody input[type="number"]')!, value)
    expect(buttonByText('common.save')).toBeUndefined()
    expect(mocks.batchSetGroupRPMOverrides).not.toHaveBeenCalled()
  })

  it.each([['0', 0], ['200', 200], ['1e3', 1000]] as const)('saves %s as %i', async (input, expected) => {
    await openEditor()
    setValueAndCommit(document.querySelector('tbody input[type="number"]')!, input)
    fireEvent.click(buttonByText('common.save')!)
    await flushPromises()
    expect(mocks.batchSetGroupRPMOverrides).toHaveBeenCalledWith(1, [{ user_id: 7, rpm_override: expected }])
  })
})
