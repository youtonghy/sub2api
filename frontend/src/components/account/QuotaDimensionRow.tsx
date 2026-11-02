import type { QuotaResetMode, QuotaThresholdType } from '@/constants/account'
import { useI18n } from '@/i18n/useI18n'
import styles from './AccountForm.module.css'
import own from './QuotaLimitCard.module.css'
import QuotaNotifyToggle from './QuotaNotifyToggle'

export interface QuotaDimensionRowValues {
  limit: number | null
  notifyEnabled: boolean | null
  notifyThreshold: number | null
  notifyThresholdType: QuotaThresholdType | null
  resetMode: QuotaResetMode | null
  resetHour: number | null
  resetDay: number | null
  resetTimezone: string | null
}

export interface QuotaDimensionRowProps extends QuotaDimensionRowValues {
  dim: 'daily' | 'weekly' | 'total'
  label: string
  quotaNotifyGlobalEnabled: boolean
  hintRolling: string
  hintFixed: string
  hourOptions: number[]
  dayOptions: { value: number; key: string }[]
  timezoneOptions?: string[]
  /** Vue 版各 update:* 事件合并为一个补丁；同一次操作的多个字段放在同一个补丁里 */
  onUpdate: (patch: Partial<QuotaDimensionRowValues>) => void
}

function getTimezoneOffsetLabel(tz: string): string {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
    const parts = dtf.formatToParts(new Date())
    const tzPart = parts.find((p) => p.type === 'timeZoneName')
    return tzPart ? (tzPart.value === 'GMT' ? 'GMT+0' : tzPart.value) : ''
  } catch {
    return ''
  }
}

/** 单个配额维度（日 / 周 / 总）：限额、告警阈值与重置方式 */
export default function QuotaDimensionRow({
  dim,
  label,
  limit,
  quotaNotifyGlobalEnabled,
  notifyEnabled,
  notifyThreshold,
  notifyThresholdType,
  resetMode,
  resetHour,
  resetDay,
  resetTimezone,
  hintRolling,
  hintFixed,
  hourOptions,
  dayOptions,
  timezoneOptions,
  onUpdate
}: QuotaDimensionRowProps) {
  const { t } = useI18n()
  const hasResetMode = dim !== 'total'
  const showNotify = quotaNotifyGlobalEnabled && !!limit && limit > 0

  const onLimitInput = (input: HTMLInputElement) => {
    const raw = input.valueAsNumber
    onUpdate({ limit: Number.isNaN(raw) ? null : raw })
  }

  const onModeChange = (val: QuotaResetMode) => {
    const patch: Partial<QuotaDimensionRowValues> = { resetMode: val }
    if (val === 'fixed') {
      if (resetHour == null) patch.resetHour = 0
      if (dim === 'weekly' && resetDay == null) patch.resetDay = 1
      if (!resetTimezone) patch.resetTimezone = 'UTC'
    }
    onUpdate(patch)
  }

  return (
    <div className={own.dimension}>
      {/* Title row (only when global notify is enabled) */}
      {quotaNotifyGlobalEnabled ? (
        <div className={own.dimensionTitles}>
          <span className={own.dimensionLabel}>{label}</span>
          {showNotify ? <span className={own.dimensionLabel}>{t('admin.accounts.quotaNotify.alert')}</span> : null}
        </div>
      ) : (
        <label className={own.dimensionLabel}>{label}</label>
      )}

      {/* Input row */}
      <div className={own.dimensionInputs}>
        <div className={own.moneyInput}>
          <span className={own.currency} aria-hidden="true">
            $
          </span>
          <input
            value={limit ?? ''}
            onChange={(e) => onLimitInput(e.target)}
            type="number"
            min={0}
            step={0.01}
            className={styles.input}
            aria-label={label}
            placeholder={t('admin.accounts.quotaLimitPlaceholder')}
          />
        </div>
        {showNotify ? (
          <QuotaNotifyToggle
            enabled={notifyEnabled}
            threshold={notifyThreshold}
            thresholdType={notifyThresholdType}
            onUpdate={(patch) =>
              onUpdate({
                ...('enabled' in patch ? { notifyEnabled: patch.enabled } : {}),
                ...('threshold' in patch ? { notifyThreshold: patch.threshold } : {}),
                ...('thresholdType' in patch ? { notifyThresholdType: patch.thresholdType } : {})
              })
            }
          />
        ) : null}
      </div>

      {/* Reset mode row (daily/weekly only) */}
      {hasResetMode ? (
        <div className={own.resetRow}>
          <label className={own.resetLabel}>{t('admin.accounts.quotaResetMode')}</label>
          <select
            value={resetMode || 'rolling'}
            onChange={(e) => onModeChange(e.target.value as QuotaResetMode)}
            className={`${styles.select} ${own.compactSelect}`}
          >
            <option value="rolling">{t('admin.accounts.quotaResetModeRolling')}</option>
            <option value="fixed">{t('admin.accounts.quotaResetModeFixed')}</option>
          </select>
          {resetMode === 'fixed' ? (
            <>
              {/* Weekly: day of week selector */}
              {dim === 'weekly' ? (
                <>
                  <label className={own.resetLabel}>{t('admin.accounts.quotaWeeklyResetDay')}</label>
                  <select
                    value={resetDay ?? 1}
                    onChange={(e) => onUpdate({ resetDay: Number(e.target.value) })}
                    className={`${styles.select} ${own.compactSelect}`}
                  >
                    {dayOptions.map((d) => (
                      <option key={d.value} value={d.value}>
                        {t('admin.accounts.dayOfWeek.' + d.key)}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
              <label className={own.resetLabel}>{t('admin.accounts.quotaResetHour')}</label>
              <select
                value={resetHour ?? 0}
                onChange={(e) => onUpdate({ resetHour: Number(e.target.value) })}
                className={`${styles.select} ${own.compactSelect}`}
              >
                {hourOptions.map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
              {timezoneOptions && timezoneOptions.length > 0 ? (
                <select
                  value={resetTimezone || 'UTC'}
                  onChange={(e) => onUpdate({ resetTimezone: e.target.value })}
                  className={`${styles.select} ${own.compactSelect}`}
                >
                  {timezoneOptions.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz} ({getTimezoneOffsetLabel(tz)})
                    </option>
                  ))}
                </select>
              ) : null}
            </>
          ) : null}
          <span className={styles.hint}>{resetMode === 'fixed' ? hintFixed : hintRolling}</span>
        </div>
      ) : (
        /* Total dimension hint (no reset mode) */
        <p className={styles.hint}>{hintRolling}</p>
      )}
    </div>
  )
}
