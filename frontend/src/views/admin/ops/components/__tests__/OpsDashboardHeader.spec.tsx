import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import OpsDashboardHeader from '../OpsDashboardHeader'
import type { OpsDashboardOverview } from '@/api/admin/ops'

vi.mock('@/api', () => ({ adminAPI: { groups: { getAll: vi.fn().mockResolvedValue([]) } } }))
vi.mock('@/api/admin/ops', () => ({ opsAPI: { getRealtimeTrafficSummary: vi.fn().mockResolvedValue({ enabled: true, summary: null }) } }))
vi.mock('@/stores', () => {
  const state = { opsRealtimeMonitoringEnabled: true, setOpsRealtimeMonitoringEnabledLocal: vi.fn() }
  const useAdminSettingsStore = Object.assign((selector: (s: typeof state) => unknown) => selector(state), { getState: () => state })
  return { useAdminSettingsStore }
})
vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key, te: () => true, locale: 'en' })
}))
vi.mock('@/components/common/Select', () => ({ default: () => <div data-testid="select-stub" /> }))
vi.mock('@/components/common/HelpTooltip', () => ({ default: () => null }))
vi.mock('@/components/common/BaseDialog', () => ({ default: ({ show, children }: { show: boolean; children?: ReactNode }) => (show ? <div>{children}</div> : null) }))

const overview = { tps: { avg: 242.7 } } as OpsDashboardOverview
const baseProps = { platform: '', groupId: null, timeRange: '1h', queryMode: 'auto', loading: false, lastUpdated: null }

async function mountHeader(value: OpsDashboardOverview = overview) {
  const utils = render(<OpsDashboardHeader {...baseProps} overview={value} />)
  await act(async () => {})
  return utils
}

describe('OpsDashboardHeader output TPS', () => {

  it('shows per-request P50, slower-tail percentiles and sample count separately from traffic TPS', async () => {
    const { rerender, unmount } = await mountHeader({ ...overview, output_tps: { p5: 2.35, p10: 3.7, p50: 55, avg: 277.75, sample_count: 4 } })
    const card = screen.getByTestId('output-tps-card')
    const get = (id: string) => card.querySelector(`[data-testid="${id}"]`)!
    expect(get('output-tps-p50').textContent).toBe('55.0')
    expect(get('output-tps-p5').textContent).toBe('2.4')
    expect(get('output-tps-p10').textContent).toBe('3.7')
    expect(get('output-tps-avg').textContent).toBe('277.8')
    expect(get('output-tps-samples').textContent).toContain('4')
    expect(card.textContent).toContain('tok/s (P50)')
    expect(card.textContent).not.toContain('242.7')
    rerender(<OpsDashboardHeader {...baseProps} fullscreen overview={{ ...overview, output_tps: { p5: 0.01, p10: 0.02, p50: 0.04, avg: 0.05, sample_count: 1 } }} />)
    await act(async () => {})
    expect(get('output-tps-p50').textContent).toBe('0.0')
    expect(get('output-tps-samples').textContent).toContain('1')
    unmount()
  })

  it.each([undefined, null, { p5: null, p10: null, p50: null, avg: null, sample_count: 0 }])('shows missing output TPS as unavailable, not zero: %s', async (output_tps) => {
    const { unmount } = await mountHeader({ ...overview, output_tps } as OpsDashboardOverview)
    for (const metric of ['p5', 'p10', 'p50', 'avg']) {
      expect(screen.getByTestId(`output-tps-${metric}`).textContent).toBe('—')
    }
    expect(screen.getByTestId('output-tps-samples').textContent).toContain(output_tps == null ? '—' : '0')
    unmount()
  })

})
