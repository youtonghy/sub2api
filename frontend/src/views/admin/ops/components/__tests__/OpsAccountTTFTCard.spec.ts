import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import OpsAccountTTFTCard from '../OpsAccountTTFTCard.vue'

const mockGetAccountTTFTStats = vi.fn()

vi.mock('@/api/admin/ops', () => ({
  opsAPI: {
    getAccountTTFTStats: (...args: unknown[]) => mockGetAccountTTFTStats(...args)
  }
}))

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return { ...actual, useI18n: () => ({ t: (key: string) => key }) }
})

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
    const wrapper = mount(OpsAccountTTFTCard, { props: { platformFilter: 'openai', groupIdFilter: 2 } })
    await flushPromises()

    const rows = wrapper.findAll('[data-ttft-account-id]')
    expect(rows.map(row => row.attributes('data-ttft-account-id'))).toEqual(['2', '1'])
    expect(rows[0].text()).toContain('2.40s')
    expect(rows[0].text()).toContain('3.80s')
    expect(mockGetAccountTTFTStats).toHaveBeenCalledWith('openai', 2)

    wrapper.unmount()
  })
})
