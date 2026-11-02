/**
 * 渠道对比雷达图的纯函数：从已加载的矩阵行里挑选对比对象，并把各项指标归一成 0–100 的“越高越好”分数。
 * 分数只决定形状；提示框和读屏表格显示每行的真实数值（raw）。
 */
import type { MonitorMatrixRow } from '@/api/channelMonitorV2'
import { tokensPerSecondFromTpm } from './monitorFormat'
import { monitorRowKey, monitorRowLabel } from './monitorViewModel'

export type MonitorRadarAxisKey = 'success' | 'ttft' | 'ttftTail' | 'cache' | 'throughput' | 'volume'

/** 最多同时对比的行数（雷达图最多画 3 个轮廓） */
export const MAX_COMPARED_ROWS = 3

export interface MonitorRadarProfile {
  key: string
  label: string
  /** 0–100，越高越好 */
  scores: Record<MonitorRadarAxisKey, number>
  /** 真实数值：成功率与缓存率为 0–1 的比例，延迟为毫秒，吞吐为 tokens/s，请求量为 RPM；null 表示没有数据 */
  raw: Record<MonitorRadarAxisKey, number | null>
}

/** 隐藏吞吐量时去掉吞吐与请求量两个轴，其余四个轴始终显示 */
export function monitorRadarAxisKeys(showThroughput: boolean): MonitorRadarAxisKey[] {
  const keys: MonitorRadarAxisKey[] = ['success', 'ttft', 'ttftTail', 'cache']
  if (showThroughput) keys.push('throughput', 'volume')
  return keys
}

/** 有请求的行，按请求量从高到低排序（相同请求量保持原顺序） */
export function comparableMonitorRows(rows: MonitorMatrixRow[]): MonitorMatrixRow[] {
  return rows
    .filter((row) => (row.metrics?.request_count || 0) > 0)
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.metrics.request_count - a.row.metrics.request_count || a.index - b.index)
    .map((entry) => entry.row)
}

/** 默认对比：请求量前 3 的行 */
export function defaultComparedKeys(rows: MonitorMatrixRow[]): string[] {
  return comparableMonitorRows(rows).slice(0, MAX_COMPARED_ROWS).map(monitorRowKey)
}

/** 用户选择中仍存在于当前数据的行；一个都不剩（或从未选择）时回落到默认的前 3 */
export function resolveComparedKeys(selected: string[], rows: MonitorMatrixRow[]): string[] {
  const available = new Set(comparableMonitorRows(rows).map(monitorRowKey))
  const kept = selected.filter((key) => available.has(key)).slice(0, MAX_COMPARED_ROWS)
  return kept.length ? kept : defaultComparedKeys(rows)
}

/** 选择超过上限时保留最近选的几项（丢弃最早的） */
export function limitComparedKeys(next: string[], max = MAX_COMPARED_ROWS): string[] {
  const unique = [...new Set(next)]
  return unique.length > max ? unique.slice(unique.length - max) : unique
}

function positive(value: number | null | undefined): number | null {
  const n = Number(value)
  return value != null && Number.isFinite(n) && n > 0 ? n : null
}

function finiteOrNull(value: number | null | undefined): number | null {
  const n = Number(value)
  return value != null && Number.isFinite(n) ? n : null
}

const round1 = (value: number) => Math.round(value * 10) / 10
const clampScore = (value: number) => round1(Math.min(100, Math.max(0, value)))

/** 越小越好的指标：对比组内最快的一行记 100，其余按 最快值 / 本行值 缩放 */
function inverseScore(value: number | null, best: number | null): number {
  if (value == null || best == null) return 0
  return clampScore((best / value) * 100)
}

/** 越大越好且没有固定上限的指标：对比组内最大的一行记 100，其余按比例缩放 */
function relativeScore(value: number | null, top: number | null): number {
  if (value == null || top == null || top <= 0) return 0
  return clampScore((value / top) * 100)
}

function rawReadings(row: MonitorMatrixRow): MonitorRadarProfile['raw'] {
  const metrics = row.metrics
  const errorRate = finiteOrNull(metrics.error_rate)
  const cacheRate = finiteOrNull(metrics.cache_rate)
  const noCacheSample = metrics.cache_rate_denominator === 0
  return {
    success: errorRate == null ? null : Math.min(1, Math.max(0, 1 - errorRate)),
    ttft: positive(metrics.ttft?.p50_ms),
    ttftTail: positive(metrics.ttft?.p90_ms),
    cache: cacheRate == null || noCacheSample ? null : Math.min(1, Math.max(0, cacheRate)),
    throughput: finiteOrNull(metrics.tpm) == null ? null : Math.max(0, tokensPerSecondFromTpm(metrics.tpm)),
    volume: finiteOrNull(metrics.rpm) == null ? null : Math.max(0, metrics.rpm)
  }
}

function minOf(values: Array<number | null>): number | null {
  const list = values.filter((value): value is number => value != null)
  return list.length ? Math.min(...list) : null
}

function maxOf(values: Array<number | null>): number | null {
  const list = values.filter((value): value is number => value != null)
  return list.length ? Math.max(...list) : null
}

/**
 * 按 keys 的顺序生成对比轮廓。延迟、吞吐和请求量相对于对比组内的最优行缩放，
 * 成功率和缓存率直接按百分比计分。
 */
export function buildMonitorRadarProfiles(
  rows: MonitorMatrixRow[],
  keys: string[],
  otherModelsLabel: string
): MonitorRadarProfile[] {
  const byKey = new Map(rows.map((row) => [monitorRowKey(row), row]))
  const picked = keys.map((key) => byKey.get(key)).filter((row): row is MonitorMatrixRow => row != null)
  const readings = picked.map(rawReadings)
  const fastest = minOf(readings.map((raw) => raw.ttft))
  const fastestTail = minOf(readings.map((raw) => raw.ttftTail))
  const topThroughput = maxOf(readings.map((raw) => raw.throughput))
  const topVolume = maxOf(readings.map((raw) => raw.volume))

  return picked.map((row, index) => {
    const raw = readings[index]
    return {
      key: monitorRowKey(row),
      label: monitorRowLabel(row, otherModelsLabel),
      raw,
      scores: {
        success: raw.success == null ? 0 : clampScore(raw.success * 100),
        ttft: inverseScore(raw.ttft, fastest),
        ttftTail: inverseScore(raw.ttftTail, fastestTail),
        cache: raw.cache == null ? 0 : clampScore(raw.cache * 100),
        throughput: relativeScore(raw.throughput, topThroughput),
        volume: relativeScore(raw.volume, topVolume)
      }
    }
  })
}
