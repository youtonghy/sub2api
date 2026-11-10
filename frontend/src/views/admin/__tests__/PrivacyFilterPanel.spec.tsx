import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PrivacyFilterPanel from '../riskControl/PrivacyFilterPanel'
import type { AdminGroup } from '@/types'

const { getPrivacyFilterConfig, updatePrivacyFilterConfig, getPrivacyFilterStatus, showError, showSuccess } = vi.hoisted(() => ({
  getPrivacyFilterConfig: vi.fn(),
  updatePrivacyFilterConfig: vi.fn(),
  getPrivacyFilterStatus: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: { riskControl: { getPrivacyFilterConfig, updatePrivacyFilterConfig, getPrivacyFilterStatus } }
}))

vi.mock('@/stores/app', () => ({
  useAppStore: { getState: () => ({ showError, showSuccess }) }
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key })
}))

const groups = [
  { id: 1, name: 'alpha', platform: 'anthropic' },
  { id: 2, name: 'beta', platform: 'openai' }
] as AdminGroup[]

const status = {
  scanned_requests: 3,
  hit_requests: 1,
  redacted_requests: 0,
  failed_requests: 0,
  fields: 1,
  restored_tokens: 2,
  unresolved_tokens: 0,
  category_counts: {},
  started_at: '2026-11-09T00:00:00Z'
}

describe('PrivacyFilterPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPrivacyFilterConfig.mockResolvedValue({ mode: 'off', group_ids: [], categories: ['credential'] })
    getPrivacyFilterStatus.mockResolvedValue(status)
    updatePrivacyFilterConfig.mockImplementation(async (payload) => payload)
  })

  it('saves the chosen group and category', async () => {
    render(<PrivacyFilterPanel groups={groups} />)
    await screen.findByText('admin.riskControl.privacyFilter.title')

    fireEvent.click(screen.getByRole('button', { name: /alpha/ }))
    fireEvent.click(screen.getByRole('switch', { name: 'admin.riskControl.privacyFilter.categories.email.label' }))
    fireEvent.click(screen.getByRole('button', { name: /admin.riskControl.privacyFilter.save/ }))

    await waitFor(() => expect(updatePrivacyFilterConfig).toHaveBeenCalledTimes(1))
    expect(updatePrivacyFilterConfig).toHaveBeenCalledWith({
      mode: 'off',
      group_ids: [1],
      categories: ['credential', 'email']
    })
    await waitFor(() => expect(showSuccess).toHaveBeenCalled())
  })

  it('warns that redaction cannot be undone', async () => {
    getPrivacyFilterConfig.mockResolvedValue({ mode: 'redact', group_ids: [1], categories: ['credential'] })
    render(<PrivacyFilterPanel groups={groups} />)
    expect(await screen.findByText('admin.riskControl.privacyFilter.redactWarning')).toBeTruthy()
  })

  it('offers the restore mode and explains its limits', async () => {
    getPrivacyFilterConfig.mockResolvedValue({ mode: 'restore', group_ids: [1], categories: ['credential'] })
    render(<PrivacyFilterPanel groups={groups} />)
    expect(await screen.findByText('admin.riskControl.privacyFilter.restoreNotice')).toBeTruthy()
    expect(screen.getByText('admin.riskControl.privacyFilter.stats.restored')).toBeTruthy()
  })

  it('reports a load failure', async () => {
    getPrivacyFilterConfig.mockRejectedValue(new Error('nope'))
    render(<PrivacyFilterPanel groups={groups} />)
    await waitFor(() => expect(showError).toHaveBeenCalled())
    expect(screen.queryByText('admin.riskControl.privacyFilter.title')).toBeNull()
  })
})
