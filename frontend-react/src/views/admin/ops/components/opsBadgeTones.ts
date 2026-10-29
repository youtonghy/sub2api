/**
 * Ops 错误/日志相关徽章的 Arc badge 色调映射。
 * Vue 版用 Tailwind 色板类（statusCodeBadgeClass、getSeverityClass 等），React 版换成语义色调：
 * 红 → danger、琥珀/橙 → warning、蓝/紫/靛 → info、灰 → neutral、绿 → success。
 */
import type { BadgeTone } from '@/components/arc/badge/badge'

/** 状态码：≥500 danger、429 info（Vue 紫色）、≥400 warning、其余 neutral */
export function statusCodeTone(code: number | null | undefined): BadgeTone {
  const value = typeof code === 'number' ? code : 0
  if (value >= 500) return 'danger'
  if (value === 429) return 'info'
  if (value >= 400) return 'warning'
  return 'neutral'
}

/** 严重级别：P0 danger、P1/P2 warning、其余（含 P3）info */
export function severityTone(severity: string | null | undefined): BadgeTone {
  const value = String(severity || '')
  if (value === 'P0') return 'danger'
  if (value === 'P1' || value === 'P2') return 'warning'
  return 'info'
}

/** 系统日志级别：error/fatal danger、warn warning、debug neutral、其余 info */
export function logLevelTone(level: string | null | undefined): BadgeTone {
  const value = String(level || '').toLowerCase()
  if (value === 'error' || value === 'fatal') return 'danger'
  if (value === 'warn' || value === 'warning') return 'warning'
  if (value === 'debug') return 'neutral'
  return 'info'
}
