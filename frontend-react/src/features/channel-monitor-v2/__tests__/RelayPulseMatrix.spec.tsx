import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { MonitorCoverage, MonitorHealth, MonitorMetric } from '@/api/channelMonitorV2'
import RelayPulseMatrix from '../RelayPulseMatrix'

const i18n = vi.hoisted(() => {
  const map: Record<string, string> = {
    'channelMonitorV2.matrix.title': '色块矩阵',
    'channelMonitorV2.matrix.description': '趋势色块视图',
    'channelMonitorV2.bucket.minutes': '{count}分钟',
    'channelMonitorV2.matrix.wheelZoomX': '滚轮缩放横向',
    'channelMonitorV2.matrix.resetZoom': '重置缩放',
    'channelMonitorV2.matrix.dimension': '维度',
    'channelMonitorV2.metrics.successRate': '成功率',
    'channelMonitorV2.metrics.ttft': '首 Token',
    'channelMonitorV2.metrics.tps': '每秒 Token',
    'channelMonitorV2.metrics.cacheRate': '缓存率',
    'channelMonitorV2.matrix.scoreLine': '评分 {score}',
    'channelMonitorV2.metrics.successRateValue': '成功率 {value}',
    'channelMonitorV2.metrics.errorRateValue': '错误率 {value}',
    'channelMonitorV2.metrics.rpmValue': 'RPM {value}',
    'channelMonitorV2.metrics.tpmValue': 'TPM {value}',
    'channelMonitorV2.metrics.tpsValue': '每秒 Token {value}',
    'channelMonitorV2.metrics.ttftValue': '首 Token {value}',
    'channelMonitorV2.metrics.durationValue': '时长 {value}',
    'channelMonitorV2.metrics.cacheRateValue': '缓存率 {value}',
    'channelMonitorV2.matrix.noTrafficAt': '{time} 无流量',
    'channelMonitorV2.matrix.noTraffic': '无流量',
    'channelMonitorV2.matrix.legendAria': '图例',
    'channelMonitorV2.matrix.bad': '差',
    'channelMonitorV2.matrix.good': '好',
    'channelMonitorV2.matrix.healthyLegend': '健康',
    'channelMonitorV2.matrix.warningLegend': '警告',
    'channelMonitorV2.matrix.criticalLegend': '异常',
    'channelMonitorV2.matrix.unknownLegend': '未知'
  }
  const t = (key: string, params?: Record<string, unknown>) =>
    (map[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? ''))
  return { t, te: (key: string) => key.startsWith('channelMonitorV2.'), locale: 'zh' }
})
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

const health: MonitorHealth = {
  overall: 'warning',
  error_rate: 'warning',
  ttft: 'healthy',
  cache: 'warning',
  score: 52,
  error_rate_score: 40,
  ttft_score: 100,
  cache_score: 50,
  minimum_sample: 20
}

function metrics(requestCount: number): MonitorMetric {
  return {
    success_requests: requestCount ? requestCount - 1 : 0,
    error_requests: requestCount ? 1 : 0,
    request_count: requestCount,
    token_count: 100,
    rpm: 1.5,
    tpm: 10.2,
    error_rate: requestCount ? 1 / requestCount : 0,
    cache_rate: 0.5,
    cache_rate_numerator: 50,
    cache_rate_denominator: 100,
    ttft: { sample_count: requestCount, p50_ms: 100, p95_ms: 300, avg_ms: 150 },
    duration: { sample_count: requestCount, p50_ms: 500, p95_ms: 900, avg_ms: 600 },
    upstream_affected_requests: 2,
    upstream_attempt_count: 3
  } as MonitorMetric
}

const cells = (container: HTMLElement) => [...container.querySelectorAll('[data-pulse-cell]')]

describe('RelayPulseMatrix', () => {
  it('shows privacy-safe hover tooltips and multi-band colors without click modal', () => {
    const coverage = {
      requested_start: '2026-08-01T00:00:00Z',
      requested_end: '2026-08-01T00:03:00Z',
      coverage_start: '2026-08-01T00:00:00Z',
      data_through: '2026-08-01T00:03:00Z',
      computed_at: '2026-08-01T00:03:00Z',
      aggregation_lag_seconds: 0,
      coverage_complete: true,
      bucket_seconds: 60
    } as MonitorCoverage
    const { container } = render(
      <RelayPulseMatrix
        rows={[
          {
            platform: 'openai',
            group_id: 7,
            group_name: '默认组',
            model: 'gpt-5',
            metrics: metrics(10),
            health,
            buckets: [
              { bucket_start: '2026-08-01T00:00:00Z', metrics: metrics(10), health },
              { bucket_start: '2026-08-01T00:01:00Z', metrics: metrics(0), health }
            ]
          }
        ]}
        coverage={coverage}
        healthMode="overall"
      />
    )

    const pulse = cells(container)
    expect(pulse).toHaveLength(3)
    // Hover tooltip content (privacy-safe: no absolute request/error counts)
    // Vue 版把提示文字放在色块内的隐藏节点里；React 版放在色块的 aria-label 中
    const tip = pulse[0].getAttribute('aria-label') ?? ''
    expect(tip).toContain('成功率')
    expect(tip).toContain('90.0%')
    expect(tip).toContain('首 Token')
    expect(tip).toContain('每秒 Token')
    expect(tip).toContain('缓存率')
    expect(tip).toContain('RPM')
    expect(tip).not.toContain('请求数')
    expect(tip).not.toContain('用户错误')
    expect(tip).not.toContain('上游受影响')
    // Summary columns: success · ttft · tokens/s · cache
    const header = container.querySelector('[data-matrix-header]')!.textContent
    expect(header).toContain('成功率')
    expect(header).toContain('首 Token')
    expect(header).toContain('每秒 Token')
    expect(header).toContain('缓存率')
    // Multi-band class from score 52 → score5
    expect(pulse[0].getAttribute('data-health')).toMatch(/^score/)
    // Redacted user payloads may have request_count=0 but still include score.
    expect(pulse[1].getAttribute('data-health')).toMatch(/^score/)
    expect(pulse[2].getAttribute('data-health')).toBe('unknown')

    // Hover shows the floating tooltip lines
    fireEvent.mouseEnter(pulse[0], { clientX: 50, clientY: 50 })
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('成功率 90.0%')

    // No click-to-open modal
    fireEvent.click(pulse[0])
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe('RelayPulseMatrix axis range', () => {
  it('uses selected requested range for the X axis even with partial coverage', () => {
    const coverage = {
      requested_start: '2026-08-01T00:00:00Z',
      requested_end: '2026-08-01T00:05:00Z',
      coverage_start: '2026-08-01T00:02:00Z',
      data_through: '2026-08-01T00:03:00Z',
      computed_at: '2026-08-01T00:03:00Z',
      aggregation_lag_seconds: 0,
      coverage_complete: false,
      bucket_seconds: 60
    } as MonitorCoverage
    const { container } = render(
      <RelayPulseMatrix
        rows={[
          {
            platform: 'openai',
            group_id: 7,
            group_name: '默认组',
            model: 'gpt-5',
            metrics: metrics(10),
            health,
            buckets: [{ bucket_start: '2026-08-01T00:02:00Z', metrics: metrics(10), health }]
          }
        ]}
        coverage={coverage}
        healthMode="overall"
      />
    )
    // 5 minutes @ 60s buckets → 5 cells spanning the selected range
    expect(cells(container)).toHaveLength(5)
  })
})
