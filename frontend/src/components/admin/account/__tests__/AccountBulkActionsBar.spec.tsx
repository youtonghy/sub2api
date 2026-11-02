import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AccountBulkActionsBar from '../AccountBulkActionsBar'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' })
}))

afterEach(() => cleanup())

describe('AccountBulkActionsBar', () => {
  it('allows selecting all results before any row is selected', async () => {
    const onSelectAllResults = vi.fn()
    render(
      <AccountBulkActionsBar
        selectedIds={[]}
        totalResults={45}
        selectingAll={false}
        allResultsSelected={false}
        onSelectAllResults={onSelectAllResults}
      />
    )

    const button = screen.getAllByRole('button').find(item =>
      item.textContent?.includes('admin.accounts.bulkActions.selectAllResults')
    )

    expect(button).toBeDefined()
    await userEvent.click(button!)
    expect(onSelectAllResults).toHaveBeenCalledTimes(1)
  })

  it('preserves the upstream billing probe action from v0.1.166', async () => {
    const onProbeUpstreamBilling = vi.fn()
    render(
      <AccountBulkActionsBar
        selectedIds={[1]}
        totalResults={45}
        selectingAll={false}
        allResultsSelected={false}
        onProbeUpstreamBilling={onProbeUpstreamBilling}
      />
    )

    const button = screen.getAllByRole('button').find(item =>
      item.textContent?.includes('admin.accounts.bulkActions.probeUpstreamBilling')
    )

    expect(button).toBeDefined()
    await userEvent.click(button!)
    expect(onProbeUpstreamBilling).toHaveBeenCalledTimes(1)
  })
})
