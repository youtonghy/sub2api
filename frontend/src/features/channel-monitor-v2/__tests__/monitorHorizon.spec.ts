import { describe, expect, it } from 'vitest'

import type { MonitorMatrixRow, MonitorMetric } from '@/api/channelMonitorV2'
import { coverageBucketStarts, deviationSeries, formatDeviation } from '../monitorViewModel'

const metric = (errorRate: number, requests: number) => ({ error_rate: errorRate, request_count: requests }) as MonitorMetric
const row = (errorRate: number, buckets: Array<[string, number, number]>): MonitorMatrixRow =>
  ({
    platform: 'openai',
    group_id: 3,
    group_name: 'vip',
    metrics: metric(errorRate, 100),
    health: {} as MonitorMatrixRow['health'],
    buckets: buckets.map(([start, rate, requests]) => ({ bucket_start: start, metrics: metric(rate, requests), health: {} as MonitorMatrixRow['health'] }))
  })

describe('channel monitor horizon helpers', () => {
  it('lists every bucket in the requested range, including empty ones', () => {
    const starts = coverageBucketStarts({
      bucket_seconds: 300,
      requested_start: '2026-11-02T00:00:00Z',
      requested_end: '2026-11-02T00:15:00Z',
      data_through: '2026-11-02T00:05:00Z'
    })
    expect(starts).toEqual(['2026-11-02T00:00:00.000Z', '2026-11-02T00:05:00.000Z', '2026-11-02T00:10:00.000Z'])
  })

  it('measures each bucket against the row success rate and leaves empty buckets at the baseline', () => {
    const starts = ['2026-11-02T00:00:00.000Z', '2026-11-02T00:05:00.000Z', '2026-11-02T00:10:00.000Z']
    const [series] = deviationSeries(
      [row(0.1, [['2026-11-02T00:00:00Z', 0.05, 40], ['2026-11-02T00:05:00Z', 0.4, 10], ['2026-11-02T00:10:00Z', 1, 0]])],
      starts,
      'Other'
    )
    expect(series.id).toBe('openai:3:')
    expect(series.name).toBe('openai / vip')
    // 行整体成功率 90%：95% → +5，60% → −30，无请求的桶 → 0
    expect(series.values).toEqual([5, -30, 0])
  })

  it('formats signed percentage points with a true minus sign', () => {
    expect(formatDeviation(2.34)).toBe('+2.3%')
    expect(formatDeviation(-30)).toBe('−30.0%')
    expect(formatDeviation(0.04)).toBe('0%')
  })
})
