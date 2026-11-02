import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { MonitorMatrixRow, MonitorMetric } from '@/api/channelMonitorV2'
import MonitorRadarComparison from '../MonitorRadarComparison'

const i18n = vi.hoisted(() => {
  const map: Record<string, string> = {
    'radarUi.title': '渠道对比',
    'radarUi.chartLabel': '渠道对比',
    'radarUi.axes.success': '成功率',
    'radarUi.axes.ttft': '首字速度 P50',
    'radarUi.axes.ttftTail': '首字速度 P90',
    'radarUi.axes.cache': '缓存命中率',
    'radarUi.axes.throughput': '吞吐量',
    'radarUi.axes.volume': '请求量',
    'radarUi.values.tokensPerSecond': '{value} tokens/s',
    'radarUi.values.rpm': '{value} RPM',
    'radarUi.values.noData': '无数据',
    'radarUi.chart.measure': '指标',
    'radarUi.chart.roleDescription': '雷达图',
    'radarUi.empty.title': '暂无可对比的渠道',
    'channelMonitorV2.otherModels': '其他模型'
  }
  const t = (key: string, params?: Record<string, unknown>) =>
    (map[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? ''))
  return { t, te: () => true, locale: 'zh' }
})
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

const row = (model: string, requests: number, p50: number, tpm: number): MonitorMatrixRow => ({
  platform: 'openai',
  group_id: 3,
  group_name: 'vip',
  model,
  metrics: {
    request_count: requests,
    error_rate: 0.015,
    cache_rate: 0.8,
    cache_rate_denominator: 100,
    tpm,
    rpm: 12,
    ttft: { sample_count: requests, p50_ms: p50, p90_ms: p50 * 2, p95_ms: null, avg_ms: null }
  } as MonitorMetric,
  health: {} as MonitorMatrixRow['health'],
  buckets: []
})

const rows = [row('a', 10, 820, 600), row('b', 300, 400, 6000), row('c', 50, 1200, 1200), row('d', 120, 600, 3000)]

describe('MonitorRadarComparison', () => {
  it('compares the top three rows by requests and shows real values, not scores', () => {
    render(<MonitorRadarComparison rows={rows} showThroughput />)
    const table = screen.getByRole('table', { hidden: true })
    const headers = Array.from(table.querySelectorAll('thead th')).map((cell) => cell.textContent)
    expect(headers).toEqual(['指标', 'openai / vip / b', 'openai / vip / d', 'openai / vip / c'])
    const ttftRow = Array.from(table.querySelectorAll('tbody tr')).find((tr) => tr.querySelector('th')?.textContent === '首字速度 P50')
    expect(Array.from(ttftRow?.querySelectorAll('td') || []).map((cell) => cell.textContent)).toEqual(['400ms', '600ms', '1.2s'])
    const successRow = Array.from(table.querySelectorAll('tbody tr')).find((tr) => tr.querySelector('th')?.textContent === '成功率')
    expect(successRow?.querySelector('td')?.textContent).toBe('98.5%')
    expect(table.textContent).toContain('100 tokens/s')
    expect(table.textContent).toContain('12 RPM')
  })

  it('drops throughput and volume axes when throughput is hidden', () => {
    render(<MonitorRadarComparison rows={rows} showThroughput={false} />)
    const table = screen.getByRole('table', { hidden: true })
    const measures = Array.from(table.querySelectorAll('tbody th')).map((cell) => cell.textContent)
    expect(measures).toEqual(['成功率', '首字速度 P50', '首字速度 P90', '缓存命中率'])
    expect(table.textContent).not.toContain('tokens/s')
    expect(table.textContent).not.toContain('RPM')
  })

  it('shows the empty state when no row has requests', () => {
    render(<MonitorRadarComparison rows={[row('a', 0, 500, 0)]} showThroughput />)
    expect(screen.getByText('暂无可对比的渠道')).toBeTruthy()
    expect(screen.queryByRole('table', { hidden: true })).toBeNull()
  })
})
