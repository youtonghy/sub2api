import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import Toggle from '@/components/common/Toggle'
import type { QuotaResetMode, QuotaThresholdType } from '@/constants/account'
import { useI18n } from '@/i18n/useI18n'
import styles from './AccountForm.module.css'
import own from './QuotaLimitCard.module.css'
import QuotaDimensionRow, { type QuotaDimensionRowValues } from './QuotaDimensionRow'

export interface QuotaLimitCardValues {
  totalLimit: number | null
  dailyLimit: number | null
  weeklyLimit: number | null
  dailyResetMode: QuotaResetMode | null
  dailyResetHour: number | null
  weeklyResetMode: QuotaResetMode | null
  weeklyResetDay: number | null
  weeklyResetHour: number | null
  resetTimezone: string | null
  quotaNotifyDailyEnabled: boolean | null
  quotaNotifyDailyThreshold: number | null
  quotaNotifyDailyThresholdType: QuotaThresholdType | null
  quotaNotifyWeeklyEnabled: boolean | null
  quotaNotifyWeeklyThreshold: number | null
  quotaNotifyWeeklyThresholdType: QuotaThresholdType | null
  quotaNotifyTotalEnabled: boolean | null
  quotaNotifyTotalThreshold: number | null
  quotaNotifyTotalThresholdType: QuotaThresholdType | null
}

type QuotaLimitRequiredKeys =
  | 'totalLimit'
  | 'dailyLimit'
  | 'weeklyLimit'
  | 'dailyResetMode'
  | 'dailyResetHour'
  | 'weeklyResetMode'
  | 'weeklyResetDay'
  | 'weeklyResetHour'
  | 'resetTimezone'

export interface QuotaLimitCardProps
  extends Pick<QuotaLimitCardValues, QuotaLimitRequiredKeys>,
    Partial<Omit<QuotaLimitCardValues, QuotaLimitRequiredKeys>> {
  /** 默认 false；其余 quotaNotify* 默认 null */
  quotaNotifyGlobalEnabled?: boolean
  /** Vue 版各 update:* 事件合并为一个补丁；同一次操作的多个字段放在同一个补丁里 */
  onUpdate: (patch: Partial<QuotaLimitCardValues>) => void
}

// Common timezone options
const timezoneOptions = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'Pacific/Auckland'
]

// Hours for dropdown (0-23)
const hourOptions = Array.from({ length: 24 }, (_, i) => i)

// Day of week options
const dayOptions = [
  { value: 1, key: 'monday' },
  { value: 2, key: 'tuesday' },
  { value: 3, key: 'wednesday' },
  { value: 4, key: 'thursday' },
  { value: 5, key: 'friday' },
  { value: 6, key: 'saturday' },
  { value: 0, key: 'sunday' }
]

// 关闭开关时清空的字段
const CLEARED_LIMITS: Partial<QuotaLimitCardValues> = {
  totalLimit: null,
  dailyLimit: null,
  weeklyLimit: null,
  dailyResetMode: null,
  dailyResetHour: null,
  weeklyResetMode: null,
  weeklyResetDay: null,
  weeklyResetHour: null,
  resetTimezone: null
}

type NotifyKey = 'Daily' | 'Weekly' | 'Total'

/** 将维度行的补丁映射回卡片字段 */
function mapDimensionPatch(
  patch: Partial<QuotaDimensionRowValues>,
  notifyKey: NotifyKey,
  fields: { limit: keyof QuotaLimitCardValues; resetMode?: keyof QuotaLimitCardValues; resetHour?: keyof QuotaLimitCardValues; resetDay?: keyof QuotaLimitCardValues }
): Partial<QuotaLimitCardValues> {
  const out: Record<string, unknown> = {}
  if ('limit' in patch) out[fields.limit] = patch.limit
  if ('notifyEnabled' in patch) out[`quotaNotify${notifyKey}Enabled`] = patch.notifyEnabled
  if ('notifyThreshold' in patch) out[`quotaNotify${notifyKey}Threshold`] = patch.notifyThreshold
  if ('notifyThresholdType' in patch) out[`quotaNotify${notifyKey}ThresholdType`] = patch.notifyThresholdType
  if (fields.resetMode && 'resetMode' in patch) out[fields.resetMode] = patch.resetMode
  if (fields.resetHour && 'resetHour' in patch) out[fields.resetHour] = patch.resetHour
  if (fields.resetDay && 'resetDay' in patch) out[fields.resetDay] = patch.resetDay
  if (fields.resetMode && 'resetTimezone' in patch) out.resetTimezone = patch.resetTimezone
  return out as Partial<QuotaLimitCardValues>
}

/** 配额限制卡片：开关 + 可折叠的日 / 周 / 总配额行 */
export default function QuotaLimitCard({
  totalLimit,
  dailyLimit,
  weeklyLimit,
  dailyResetMode,
  dailyResetHour,
  weeklyResetMode,
  weeklyResetDay,
  weeklyResetHour,
  resetTimezone,
  quotaNotifyGlobalEnabled = false,
  quotaNotifyDailyEnabled = null,
  quotaNotifyDailyThreshold = null,
  quotaNotifyDailyThresholdType = null,
  quotaNotifyWeeklyEnabled = null,
  quotaNotifyWeeklyThreshold = null,
  quotaNotifyWeeklyThresholdType = null,
  quotaNotifyTotalEnabled = null,
  quotaNotifyTotalThreshold = null,
  quotaNotifyTotalThresholdType = null,
  onUpdate
}: QuotaLimitCardProps) {
  const { t } = useI18n()

  const enabled =
    (totalLimit != null && totalLimit > 0) ||
    (dailyLimit != null && dailyLimit > 0) ||
    (weeklyLimit != null && weeklyLimit > 0)

  const [localEnabled, setLocalEnabled] = useState(enabled)
  const [collapsed, setCollapsed] = useState(false)

  // Sync when props change externally
  const [prevEnabled, setPrevEnabled] = useState(enabled)
  if (prevEnabled !== enabled) {
    setPrevEnabled(enabled)
    setLocalEnabled(enabled)
    if (!enabled) setCollapsed(false)
  }

  const toggleEnabled = (value: boolean) => {
    setLocalEnabled(value)
    if (!value) setCollapsed(false)
  }

  // When toggle is turned off, clear all values and expand（与 Vue 版 watch(localEnabled) 相同，不在挂载时触发）
  const onUpdateRef = useRef(onUpdate)
  useEffect(() => {
    onUpdateRef.current = onUpdate
  })
  const prevLocalEnabled = useRef(localEnabled)
  useEffect(() => {
    if (prevLocalEnabled.current === localEnabled) return
    prevLocalEnabled.current = localEnabled
    if (!localEnabled) onUpdateRef.current({ ...CLEARED_LIMITS })
  }, [localEnabled])

  // Precomputed hint strings for the weekly fixed mode
  const weeklyDayKey = dayOptions.find((d) => d.value === (weeklyResetDay ?? 1))?.key || 'monday'
  const weeklyFixedHint = t('admin.accounts.quotaWeeklyLimitHintFixed', {
    day: t('admin.accounts.dayOfWeek.' + weeklyDayKey),
    hour: String(weeklyResetHour ?? 0).padStart(2, '0'),
    timezone: resetTimezone || 'UTC'
  })
  const dailyFixedHint = t('admin.accounts.quotaDailyLimitHintFixed', {
    hour: String(dailyResetHour ?? 0).padStart(2, '0'),
    timezone: resetTimezone || 'UTC'
  })

  return (
    <div className={own.card}>
      {/* Header: toggle + collapse */}
      <div className={own.header}>
        <button
          type="button"
          className={own.headerToggle}
          aria-expanded={localEnabled ? !collapsed : undefined}
          disabled={!localEnabled}
          onClick={() => {
            if (localEnabled) setCollapsed((v) => !v)
          }}
        >
          {localEnabled ? (
            <ChevronDown size={16} aria-hidden="true" className={own.chevron} data-collapsed={collapsed ? 'true' : undefined} />
          ) : null}
          <span className={own.headerText}>
            <span className={styles.label}>{t('admin.accounts.quotaLimitToggle')}</span>
            <span className={styles.hint}>{t('admin.accounts.quotaLimitToggleHint')}</span>
          </span>
        </button>
        <Toggle value={localEnabled} onChange={toggleEnabled} aria-label={t('admin.accounts.quotaLimitToggle')} />
      </div>

      {/* Collapsible content */}
      {localEnabled && !collapsed ? (
        <div className={own.body}>
          {/* Daily quota */}
          <QuotaDimensionRow
            dim="daily"
            label={t('admin.accounts.quotaDailyLimit')}
            limit={dailyLimit}
            quotaNotifyGlobalEnabled={quotaNotifyGlobalEnabled}
            notifyEnabled={quotaNotifyDailyEnabled}
            notifyThreshold={quotaNotifyDailyThreshold}
            notifyThresholdType={quotaNotifyDailyThresholdType}
            resetMode={dailyResetMode}
            resetHour={dailyResetHour}
            resetDay={null}
            resetTimezone={resetTimezone}
            hintRolling={t('admin.accounts.quotaDailyLimitHint')}
            hintFixed={dailyFixedHint}
            hourOptions={hourOptions}
            dayOptions={dayOptions}
            timezoneOptions={timezoneOptions}
            onUpdate={(patch) =>
              onUpdate(mapDimensionPatch(patch, 'Daily', { limit: 'dailyLimit', resetMode: 'dailyResetMode', resetHour: 'dailyResetHour' }))
            }
          />

          {/* Weekly quota */}
          <QuotaDimensionRow
            dim="weekly"
            label={t('admin.accounts.quotaWeeklyLimit')}
            limit={weeklyLimit}
            quotaNotifyGlobalEnabled={quotaNotifyGlobalEnabled}
            notifyEnabled={quotaNotifyWeeklyEnabled}
            notifyThreshold={quotaNotifyWeeklyThreshold}
            notifyThresholdType={quotaNotifyWeeklyThresholdType}
            resetMode={weeklyResetMode}
            resetHour={weeklyResetHour}
            resetDay={weeklyResetDay}
            resetTimezone={resetTimezone}
            hintRolling={t('admin.accounts.quotaWeeklyLimitHint')}
            hintFixed={weeklyFixedHint}
            hourOptions={hourOptions}
            dayOptions={dayOptions}
            timezoneOptions={timezoneOptions}
            onUpdate={(patch) =>
              onUpdate(
                mapDimensionPatch(patch, 'Weekly', {
                  limit: 'weeklyLimit',
                  resetMode: 'weeklyResetMode',
                  resetHour: 'weeklyResetHour',
                  resetDay: 'weeklyResetDay'
                })
              )
            }
          />

          {/* Total quota */}
          <QuotaDimensionRow
            dim="total"
            label={t('admin.accounts.quotaTotalLimit')}
            limit={totalLimit}
            quotaNotifyGlobalEnabled={quotaNotifyGlobalEnabled}
            notifyEnabled={quotaNotifyTotalEnabled}
            notifyThreshold={quotaNotifyTotalThreshold}
            notifyThresholdType={quotaNotifyTotalThresholdType}
            resetMode={null}
            resetHour={null}
            resetDay={null}
            resetTimezone={null}
            hintRolling={t('admin.accounts.quotaTotalLimitHint')}
            hintFixed=""
            hourOptions={hourOptions}
            dayOptions={dayOptions}
            onUpdate={(patch) => onUpdate(mapDimensionPatch(patch, 'Total', { limit: 'totalLimit' }))}
          />
        </div>
      ) : null}
    </div>
  )
}
