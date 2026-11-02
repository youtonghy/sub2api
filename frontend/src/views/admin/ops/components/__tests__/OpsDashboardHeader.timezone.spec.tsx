import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import OpsDashboardHeader from '../OpsDashboardHeader'
import type { SelectProps } from '@/components/common/Select'

const selectProps: SelectProps[] = []

vi.mock('@/api', () => ({ adminAPI: { groups: { getAll: vi.fn().mockResolvedValue([]) } } }))
vi.mock('@/api/admin/ops', () => ({ opsAPI: { getRealtimeTrafficSummary: vi.fn().mockResolvedValue({ enabled: true, summary: null }) } }))
vi.mock('@/stores', () => {
  const state = { opsRealtimeMonitoringEnabled: true, setOpsRealtimeMonitoringEnabledLocal: vi.fn() }
  const useAdminSettingsStore = Object.assign((selector: (s: typeof state) => unknown) => selector(state), { getState: () => state })
  return { useAdminSettingsStore }
})
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
vi.mock('@/components/common/Select', () => ({
  default: (props: SelectProps) => {
    selectProps.push(props)
    return <div data-testid="select-stub" />
  }
}))
vi.mock('@/components/common/HelpTooltip', () => ({ default: () => null }))
vi.mock('@/components/common/BaseDialog', () => ({
  default: ({ show, children, footer }: { show: boolean; children?: ReactNode; footer?: ReactNode }) =>
    show ? <div>{children}{footer}</div> : null
}))

beforeEach(() => vi.stubEnv('TZ', 'Asia/Shanghai'))
afterEach(() => { cleanup(); selectProps.length = 0; vi.useRealTimers(); vi.unstubAllEnvs() })

async function openCustomRange(now: Date, onCustomTimeRangeChange = vi.fn()) {
  expect(now.getTimezoneOffset()).toBe(-480)
  vi.useFakeTimers()
  vi.setSystemTime(now)
  render(
    <OpsDashboardHeader
      platform=""
      groupId={null}
      timeRange="1h"
      queryMode="auto"
      loading={false}
      lastUpdated={null}
      onCustomTimeRangeChange={onCustomTimeRangeChange}
    />
  )
  await act(async () => {})
  const selector = [...selectProps].reverse().find(select =>
    (select.options as Array<{ value: unknown }>).some(option => option.value === 'custom')
  )!
  await act(async () => { selector.onChange?.('custom', null) })
  return onCustomTimeRangeChange
}

describe('ops custom time range timezone', () => {
  it.each([
    [14, 23, '2026-10-09T13:23', '2026-10-09T14:23'],
    [0, 15, '2026-10-08T23:15', '2026-10-09T00:15']
  ] as const)('prefills the previous local hour at %i:%i', async (hour, minute, start, end) => {
    await openCustomRange(new Date(2026, 9, 9, hour, minute))
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')]
    expect(inputs.map(input => input.value)).toEqual([start, end])
  })

  it('submits the previous real hour without applying the timezone offset twice', async () => {
    const now = new Date(2026, 9, 9, 14, 23)
    const emitted = await openCustomRange(now)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common.confirm' })) })
    expect(emitted.mock.calls).toEqual([
      [new Date(now.getTime() - 3600000).toISOString(), now.toISOString()]
    ])
  })
})
