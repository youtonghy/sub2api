import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

import OpsAccountTTFTCard from '../OpsAccountTTFTCard'

const { mockGetAccountTTFTStats } = vi.hoisted(() => ({ mockGetAccountTTFTStats: vi.fn() }))

vi.mock('@/api/admin/ops', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  opsAPI: {
    getAccountTTFTStats: (...args: unknown[]) => mockGetAccountTTFTStats(...args)
  }
}))

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

describe('OpsAccountTTFTCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAccountTTFTStats.mockResolvedValue({
      start_time: '2026-08-12T00:00:00Z',
      end_time: '2026-08-12T00:30:00Z',
      items: [
        { account_id: 1, account_name: 'Fast', platform: 'openai', avg_ms: 420, p95_ms: 700, max_ms: 900, sample_count: 12 },
        { account_id: 2, account_name: 'Slow', platform: 'openai', avg_ms: 2400, p95_ms: 3800, max_ms: 5100, sample_count: 8 }
      ]
    })
  })

  it('sorts accounts by average TTFT from slowest to fastest', async () => {
    const { container, unmount } = render(<OpsAccountTTFTCard platformFilter="openai" groupIdFilter={2} />)

    await waitFor(() => expect(container.querySelectorAll('[data-ttft-account-id]')).toHaveLength(2))

    const rows = Array.from(container.querySelectorAll('[data-ttft-account-id]'))
    expect(rows.map((row) => row.getAttribute('data-ttft-account-id'))).toEqual(['2', '1'])
    expect(rows[0].textContent).toContain('2.40s')
    expect(rows[0].textContent).toContain('3.80s')
    expect(mockGetAccountTTFTStats).toHaveBeenCalledWith('openai', 2)

    unmount()
  })
})
