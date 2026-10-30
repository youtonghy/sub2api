/**
 * Shared formatting helpers for channel monitor views (admin + user).
 * 对应 Vue 版 composables/useChannelMonitorFormat.ts。
 *
 * Centralises:
 *  - status / provider / check-mode label lookups
 *  - latency / availability / percent number formatting
 *  - relative time
 *
 * Vue 版返回 Tailwind 类名的 *BadgeClass / providerPickerClass 在 React 版改为语义色调：
 * 状态与检测模式返回 Arc badge 的 tone；provider 配色用 components/admin/channel/platformTone
 * （provider 与平台 id 一致）。装饰性的 providerGradient 不再提供。
 *
 * i18n keys live under `monitorCommon.*` so admin and user views share the
 * same translation source.
 */
import type { CheckMode, MonitorStatus, Provider } from '@/api/admin/channelMonitor'
import type { BadgeTone } from '@/components/arc/badge/badge'
import {
  CHECK_MODE_QUOTA,
  CHECK_MODE_QUOTA_PROBE,
  PROVIDERS,
  STATUS_DEGRADED,
  STATUS_FAILED,
  STATUS_OPERATIONAL
} from '@/constants/channelMonitor'
import { useI18n } from '@/i18n/useI18n'

/** Availability HSL hue multiplier: 0%=red(0) / 50%=yellow(60) / 100%=green(120). */
const HSL_HUE_PER_PERCENT = 1.2
const HSL_SATURATION = 72
const HSL_LIGHTNESS = 42

/**
 * Display label for a monitor's primary model. Pure-quota monitors carry the
 * literal placeholder "quota" (the probe target is an account, not a model),
 * which must not leak into the UI as a fake model name — render the
 * localized mode label instead. quota_probe keeps a real model name.
 */
const QUOTA_MODEL_PLACEHOLDER = 'quota'

export interface AvailabilityRow {
  primary_status: MonitorStatus | ''
  availability_7d: number | null | undefined
}

/** 状态徽章色调（Vue 版 statusBadgeClass：绿 / 琥珀 / 红 / 中性） */
export function monitorStatusTone(s: MonitorStatus | ''): BadgeTone {
  switch (s) {
    case STATUS_OPERATIONAL:
      return 'success'
    case STATUS_DEGRADED:
      return 'warning'
    case STATUS_FAILED:
      return 'danger'
    default:
      return 'neutral'
  }
}

/**
 * 检测模式徽章色调：带配额的模式 = info（数据源是账号配额），纯探活 = 中性。
 */
export function checkModeTone(m: CheckMode | string): BadgeTone {
  return m === CHECK_MODE_QUOTA || m === CHECK_MODE_QUOTA_PROBE ? 'info' : 'neutral'
}

export function useChannelMonitorFormat() {
  const { t } = useI18n()

  function statusLabel(s: MonitorStatus | ''): string {
    if (!s) return t('monitorCommon.status.unknown')
    return t(`monitorCommon.status.${s}`)
  }

  function providerLabel(p: Provider | string): string {
    if (PROVIDERS.includes(p as Provider)) {
      return t(`monitorCommon.providers.${p}`)
    }
    return p || '-'
  }

  function checkModeLabel(m: CheckMode | string): string {
    if (m === 'probe' || m === 'quota' || m === 'quota_probe') {
      return t(`monitorCommon.checkMode.${m}`)
    }
    return m || '-'
  }

  function formatMonitorModel(model: string): string {
    if (model === QUOTA_MODEL_PLACEHOLDER) {
      return t('monitorCommon.checkMode.quota')
    }
    return model
  }

  function formatLatency(ms: number | null | undefined): string {
    if (ms == null) return t('monitorCommon.latencyEmpty')
    return String(Math.round(ms))
  }

  function formatPercent(v: number | null | undefined): string {
    if (v == null || Number.isNaN(v)) return '-'
    return `${v.toFixed(2)}%`
  }

  function formatAvailability(row: AvailabilityRow): string {
    if (!row.primary_status) return '-'
    return formatPercent(row.availability_7d)
  }

  function formatRelativeTime(iso: string | null | undefined): string {
    if (!iso) return t('monitorCommon.latencyEmpty')
    const ts = Date.parse(iso)
    if (Number.isNaN(ts)) return t('monitorCommon.latencyEmpty')
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
    if (diffSec < 60) return t('monitorCommon.relativeSecondsAgo', { n: diffSec })
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return t('monitorCommon.relativeMinutesAgo', { n: diffMin })
    const diffHour = Math.floor(diffMin / 60)
    if (diffHour < 24) return t('monitorCommon.relativeHoursAgo', { n: diffHour })
    const diffDay = Math.floor(diffHour / 24)
    return t('monitorCommon.relativeDaysAgo', { n: diffDay })
  }

  return {
    statusLabel,
    statusTone: monitorStatusTone,
    providerLabel,
    checkModeLabel,
    checkModeTone,
    formatMonitorModel,
    formatLatency,
    formatPercent,
    formatAvailability,
    formatRelativeTime
  }
}

/**
 * Map availability percent to an HSL colour (red -> yellow -> green).
 * Returns undefined for null/NaN so callers can fall back to a neutral colour.
 */
export function hslForPct(pct: number | null | undefined): string | undefined {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return undefined
  const clamped = Math.max(0, Math.min(100, pct))
  const hue = clamped * HSL_HUE_PER_PERCENT
  return `hsl(${hue} ${HSL_SATURATION}% ${HSL_LIGHTNESS}%)`
}
