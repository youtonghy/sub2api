import { describe, expect, it } from 'vitest'

import type { MonitorMatrixRow, MonitorMetric } from '@/api/channelMonitorV2'
import {
  buildMonitorRadarProfiles,
  comparableMonitorRows,
  defaultComparedKeys,
  limitComparedKeys,
  monitorRadarAxisKeys,
  resolveComparedKeys
} from '../monitorRadar'

interface RowInput {
  model: string
  requests: number
  errorRate?: number
  p50?: number | null
  p90?: number | null
  cacheRate?: number
  cacheDenominator?: number
  tpm?: number
  rpm?: number
}

const row = ({ model, requests, errorRate = 0, p50 = 1000, p90 = 2000, cacheRate = 0.5, cacheDenominator = 100, tpm = 600, rpm = 10 }: RowInput): MonitorMatrixRow => ({
  platform: 'openai',
  group_id: 3,
  group_name: 'vip',
  model,
  metrics: {
    request_count: requests,
    error_rate: errorRate,
    cache_rate: cacheRate,
    cache_rate_denominator: cacheDenominator,
    tpm,
    rpm,
    ttft: { sample_count: requests, p50_ms: p50, p90_ms: p90, p95_ms: null, avg_ms: null }
  } as MonitorMetric,
  health: {} as MonitorMatrixRow['health'],
  buckets: []
})

describe('channel monitor radar helpers', () => {
  it('drops throughput and volume axes when throughput is hidden', () => {
    expect(monitorRadarAxisKeys(true)).toEqual(['success', 'ttft', 'ttftTail', 'cache', 'throughput', 'volume'])
    expect(monitorRadarAxisKeys(false)).toEqual(['success', 'ttft', 'ttftTail', 'cache'])
  })

  it('defaults to the top three rows by request count and skips rows without requests', () => {
    const rows = [
      row({ model: 'a', requests: 10 }),
      row({ model: 'b', requests: 0 }),
      row({ model: 'c', requests: 300 }),
      row({ model: 'd', requests: 50 }),
      row({ model: 'e', requests: 120 })
    ]
    expect(comparableMonitorRows(rows).map((item) => item.model)).toEqual(['c', 'e', 'd', 'a'])
    expect(defaultComparedKeys(rows)).toEqual(['openai:3:c', 'openai:3:e', 'openai:3:d'])
  })

  it('keeps picks that still exist and falls back to the default when none remain', () => {
    const rows = [row({ model: 'a', requests: 10 }), row({ model: 'b', requests: 20 })]
    expect(resolveComparedKeys(['openai:3:a', 'openai:3:gone'], rows)).toEqual(['openai:3:a'])
    expect(resolveComparedKeys(['openai:3:gone'], rows)).toEqual(['openai:3:b', 'openai:3:a'])
    expect(resolveComparedKeys([], rows)).toEqual(['openai:3:b', 'openai:3:a'])
  })

  it('caps the selection at three by replacing the earliest pick', () => {
    expect(limitComparedKeys(['a', 'b', 'c', 'd'])).toEqual(['b', 'c', 'd'])
    expect(limitComparedKeys(['a', 'a', 'b'])).toEqual(['a', 'b'])
  })

  it('scores higher-is-better axes from 0 to 100 and keeps the real values', () => {
    const rows = [
      row({ model: 'fast', requests: 100, errorRate: 0.015, p50: 400, p90: 900, cacheRate: 0.8, tpm: 6000, rpm: 40 }),
      row({ model: 'slow', requests: 50, errorRate: 0.1, p50: 800, p90: 3600, cacheRate: 0.2, tpm: 1500, rpm: 10 })
    ]
    const [fast, slow] = buildMonitorRadarProfiles(rows, ['openai:3:fast', 'openai:3:slow'], 'Other')

    expect(fast.label).toBe('openai / vip / fast')
    expect(fast.scores).toEqual({ success: 98.5, ttft: 100, ttftTail: 100, cache: 80, throughput: 100, volume: 100 })
    expect(slow.scores).toEqual({ success: 90, ttft: 50, ttftTail: 25, cache: 20, throughput: 25, volume: 25 })
    expect(fast.raw).toEqual({ success: 0.985, ttft: 400, ttftTail: 900, cache: 0.8, throughput: 100, volume: 40 })
    expect(slow.raw.throughput).toBe(25)
  })

  it('scores missing readings as zero and reports them as null', () => {
    const rows = [
      row({ model: 'a', requests: 10, p50: null, p90: null, cacheDenominator: 0, tpm: 0, rpm: 0 }),
      row({ model: '__other__', requests: 5, p50: 500 })
    ]
    const [missing, other] = buildMonitorRadarProfiles(rows, ['openai:3:a', 'openai:3:__other__'], 'Other models')

    expect(missing.raw.ttft).toBeNull()
    expect(missing.raw.ttftTail).toBeNull()
    expect(missing.raw.cache).toBeNull()
    expect(missing.scores.ttft).toBe(0)
    expect(missing.scores.cache).toBe(0)
    expect(missing.scores.throughput).toBe(0)
    expect(other.label).toBe('openai / vip / Other models')
    expect(other.scores.ttft).toBe(100)
  })

  it('keeps the requested order and ignores unknown keys', () => {
    const rows = [row({ model: 'a', requests: 10 }), row({ model: 'b', requests: 20 })]
    const profiles = buildMonitorRadarProfiles(rows, ['openai:3:b', 'missing', 'openai:3:a'], 'Other')
    expect(profiles.map((profile) => profile.key)).toEqual(['openai:3:b', 'openai:3:a'])
  })
})
