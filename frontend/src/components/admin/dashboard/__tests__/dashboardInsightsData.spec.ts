import { describe, expect, it } from 'vitest'

import type { GroupStat, ModelStat, TrendDataPoint, UserUsageTrendPoint } from '@/types'
import {
  BREAKDOWN_DAYS,
  KPI_SERIES_DAYS,
  buildBreakdownRows,
  buildCumulativeRaceFrames,
  buildDailySeries,
  buildKpis,
  dailyDates,
  formatDollarTick,
  formatPeriodLabel,
  groupSources,
  insightWindows,
  magnitudeFormat,
  modelSources,
  raceFrameDuration,
  shiftIsoDate
} from '../dashboardInsightsData'

const trendPoint = (date: string, requests: number, extra: Partial<TrendDataPoint> = {}): TrendDataPoint => ({
  date,
  requests,
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
  total_tokens: requests * 10,
  cost: requests * 2,
  actual_cost: requests,
  ...extra
})

const modelStat = (model: string, actual: number): ModelStat => ({
  model,
  requests: actual * 10,
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
  total_tokens: actual * 100,
  cost: actual * 2,
  actual_cost: actual
})

const groupStat = (id: number, name: string, actual: number): GroupStat => ({
  group_id: id,
  group_name: name,
  requests: actual,
  total_tokens: actual,
  cost: actual,
  actual_cost: actual
})

const userPoint = (date: string, userId: number, actual: number, username = `u${userId}`): UserUsageTrendPoint => ({
  date,
  user_id: userId,
  email: `${username}@example.com`,
  username,
  requests: 1,
  tokens: 1,
  cost: actual,
  actual_cost: actual
})

describe('date windows', () => {
  it('shifts calendar dates across month and year boundaries', () => {
    expect(shiftIsoDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftIsoDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftIsoDate('2026-11-02', 0)).toBe('2026-11-02')
  })

  it('lists days oldest first ending on the given date', () => {
    expect(dailyDates('2026-11-02', 3)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02'])
  })

  it('ends every window yesterday and covers 180 trend days and two 30-day breakdown periods', () => {
    const windows = insightWindows('2026-11-02')
    expect(windows).toEqual({
      end: '2026-11-01',
      trendStart: '2026-05-06',
      currentStart: '2026-10-03',
      previousStart: '2026-09-03',
      previousEnd: '2026-10-02'
    })
    expect(dailyDates(windows.end, KPI_SERIES_DAYS)[0]).toBe(windows.trendStart)
    expect(dailyDates(windows.end, BREAKDOWN_DAYS)[0]).toBe(windows.currentStart)
    expect(dailyDates(windows.previousEnd, BREAKDOWN_DAYS)[0]).toBe(windows.previousStart)
  })
})

describe('buildDailySeries', () => {
  it('fills missing days with zero and sums duplicate days', () => {
    const dates = dailyDates('2026-11-03', 4)
    const trend = [trendPoint('2026-11-01', 5), trendPoint('2026-11-03', 2), trendPoint('2026-11-03', 1), trendPoint('2026-10-01', 99)]
    expect(buildDailySeries(trend, dates, 'requests')).toEqual([0, 5, 0, 3])
    expect(buildDailySeries(trend, dates, 'cost')).toEqual([0, 10, 0, 6])
  })
})

describe('buildBreakdownRows', () => {
  it('keeps the top segments, folds the rest into other, and compares each with the previous period', () => {
    const current = modelSources([modelStat('a', 50), modelStat('b', 30), modelStat('c', 15), modelStat('d', 5), modelStat('zero', 0)])
    const previous = modelSources([modelStat('a', 40), modelStat('c', 20), modelStat('d', 2), modelStat('gone', 8)])
    const rows = buildBreakdownRows(current, previous, 'actual_cost', 'Other', 2)

    expect(rows.map((row) => row.name)).toEqual(['a', 'b', 'Other'])
    expect(rows.map((row) => row.share)).toEqual([0.5, 0.3, 0.2])
    expect(rows.map((row) => row.value)).toEqual([50, 30, 20])
    expect(rows[0]).toMatchObject({ delta: 0.25, isNew: false })
    // b had nothing before: marked new instead of an infinite change
    expect(rows[1]).toMatchObject({ delta: 0, isNew: true })
    // other = c + d now (20) against c + d + gone before (30)
    expect(rows[2].delta).toBeCloseTo(-1 / 3)
    expect(rows[2].isNew).toBe(false)
  })

  it('uses the requested metric and returns nothing when the period is empty', () => {
    const current = modelSources([modelStat('a', 1), modelStat('b', 3)])
    expect(buildBreakdownRows(current, [], 'total_tokens', 'Other').map((row) => row.name)).toEqual(['b', 'a'])
    expect(buildBreakdownRows(modelSources([modelStat('a', 0)]), [], 'requests', 'Other')).toEqual([])
  })

  it('keys groups by id and labels unnamed groups', () => {
    const current = groupSources([groupStat(0, '', 4), groupStat(2, 'pro', 6)], 'No group')
    const previous = groupSources([groupStat(2, 'renamed', 3)], 'No group')
    const rows = buildBreakdownRows(current, previous, 'requests', 'Other')
    expect(rows.map((row) => [row.name, row.delta, row.isNew])).toEqual([
      ['pro', 1, false],
      ['No group', 0, true]
    ])
  })
})

describe('buildKpis', () => {
  it('builds 180-day summed totals with model and group breakdowns', () => {
    const kpis = buildKpis({
      definitions: [
        { id: 'requests', label: 'Requests', description: 'd', format: {} },
        { id: 'actual_cost', label: 'Cost', description: 'd', format: { prefix: '$', decimals: 2 } }
      ],
      trend: [trendPoint('2026-11-01', 1500), trendPoint('2026-05-06', 1)],
      end: '2026-11-01',
      stats: {
        models: { current: [modelStat('m', 1)], previous: [] },
        groups: { current: [groupStat(1, 'g', 1)], previous: [groupStat(1, 'g', 2)] }
      },
      otherLabel: 'Other',
      noGroupLabel: 'No group'
    })

    expect(kpis.map((kpi) => kpi.id)).toEqual(['requests', 'actual_cost'])
    for (const kpi of kpis) {
      expect(kpi).toMatchObject({ kind: 'total', aggregate: 'sum' })
      expect(kpi.series).toHaveLength(KPI_SERIES_DAYS)
    }
    expect(kpis[0].series[0]).toBe(1)
    expect(kpis[0].series[KPI_SERIES_DAYS - 1]).toBe(1500)
    expect(kpis[0].format).toEqual({ divisor: 1000, suffix: 'K', decimals: 2 })
    expect(kpis[1].format).toEqual({ prefix: '$', divisor: 1000, suffix: 'K', decimals: 2 })
    expect(kpis[1].breakdowns.model).toEqual([{ name: 'm', value: 1, share: 1, delta: 0, isNew: true }])
    expect(kpis[1].breakdowns.group).toEqual([{ name: 'g', value: 1, share: 1, delta: -0.5, isNew: false }])
  })
})

describe('magnitudeFormat', () => {
  it('picks one unit from the daily peak and keeps the base prefix', () => {
    expect(magnitudeFormat([12, 900])).toEqual({ decimals: 0 })
    expect(magnitudeFormat([2_500_000_000])).toEqual({ divisor: 1_000_000_000, suffix: 'B', decimals: 2 })
    expect(magnitudeFormat([3.5], { prefix: '$', decimals: 2 })).toEqual({ prefix: '$', decimals: 2 })
  })
})

describe('formatPeriodLabel', () => {
  it('reads naturally in Chinese and English', () => {
    expect(formatPeriodLabel('2026-11-02', 'zh-CN')).toBe('11月2日')
    expect(formatPeriodLabel('2026-11-02', 'en-US')).toBe('Nov 2')
    expect(formatPeriodLabel('2026-11-02 14:00', 'zh-CN')).toBe('11月2日 14:00')
    expect(formatPeriodLabel('2026-11-02', 'zh-CN', true)).toBe('2026年11月2日')
    expect(formatPeriodLabel('week 3', 'en-US')).toBe('week 3')
  })
})

describe('buildCumulativeRaceFrames', () => {
  const label = (point: UserUsageTrendPoint) => point.username
  const period = (date: string, withYear: boolean) => (withYear ? `Y${date}` : date)

  it('accumulates actual cost per user across sorted periods and ranks items by total', () => {
    const race = buildCumulativeRaceFrames(
      [
        userPoint('2026-11-02', 1, 1),
        userPoint('2026-11-01', 1, 2),
        userPoint('2026-11-01', 2, 1),
        userPoint('2026-11-02', 2, 5),
        userPoint('2026-11-03', 3, 0)
      ],
      label,
      period
    )

    expect(race.items).toEqual([
      { id: 'user-2', label: 'u2' },
      { id: 'user-1', label: 'u1' }
    ])
    expect(race.frames).toEqual([
      { period: '2026-11-01', values: { 'user-2': 1, 'user-1': 2 } },
      { period: '2026-11-02', values: { 'user-2': 6, 'user-1': 3 } },
      { period: '2026-11-03', values: { 'user-2': 6, 'user-1': 3 } }
    ])
  })

  it('adds the year when the range spans years and returns nothing without spend', () => {
    const race = buildCumulativeRaceFrames([userPoint('2026-12-31', 1, 1), userPoint('2027-01-01', 1, 1)], label, period)
    expect(race.frames.map((frame) => frame.period)).toEqual(['Y2026-12-31', 'Y2027-01-01'])
    expect(buildCumulativeRaceFrames([userPoint('2026-11-01', 1, 0)], label, period)).toEqual({ items: [], frames: [] })
  })
})

describe('formatDollarTick', () => {
  it('prints short dollar amounts for the race axis', () => {
    expect(formatDollarTick(20)).toBe('$20')
    expect(formatDollarTick(1500)).toBe('$1.5K')
    expect(formatDollarTick(Number.NaN)).toBe('$0')
  })
})

describe('raceFrameDuration', () => {
  it('shortens frames so a long race still plays in about 16 seconds', () => {
    expect(raceFrameDuration(1)).toBe(1400)
    expect(raceFrameDuration(7)).toBe(1400)
    expect(raceFrameDuration(48)).toBe(333)
    expect(raceFrameDuration(500)).toBe(250)
  })
})
