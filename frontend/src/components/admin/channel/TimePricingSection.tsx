/**
 * 时间段定价，对应 Vue 版 TimePricingSection.vue：时区（可搜索、可自定义）、生效日期范围
 * （每天 / 仅工作日）与若干时间段倍率。所有更新都不修改传入的对象。
 */
import { Trash2 } from 'lucide-react'
import { useId, useMemo } from 'react'

import arcInput from '@/components/arc/input/input.module.css'
import Select, { type SelectValue } from '@/components/common/Select'
import { useI18n } from '@/i18n/useI18n'
import {
  COMMON_TIMEZONES,
  formatTimezoneOffset,
  isValidTimePricingMultiplier,
  type TimePricingFormEntry,
  type TimePricingPeriodFormEntry
} from './types'
import form from './channelForm.module.css'
import styles from './TimePricingSection.module.css'

export interface TimePricingSectionProps {
  /** Vue 版 modelValue */
  value: TimePricingFormEntry
  /** Vue 版 update:modelValue */
  onChange?: (value: TimePricingFormEntry) => void
}

const inputClass = [arcInput.input, form.small].join(' ')

function normalizeClockTime(value: string): string {
  const normalized = value.replace(/：/g, ':')
  return normalized === '24:00:00' ? '00:00:00' : normalized
}

export default function TimePricingSection({ value, onChange }: TimePricingSectionProps) {
  const { t } = useI18n()
  const inputIdPrefix = `time-pricing-${useId().replace(/:/g, '')}`

  const timezoneOptions = useMemo(
    () =>
      COMMON_TIMEZONES.map((zone) => {
        const offset = formatTimezoneOffset(zone)
        return { value: zone, label: offset ? `${zone} (${offset})` : zone }
      }),
    []
  )

  const dayScopeOptions = [
    { value: false, label: t('admin.channels.form.timePricingEveryDay') },
    { value: true, label: t('admin.channels.form.timePricingWeekdaysOnly') }
  ]

  const emit = (next: TimePricingFormEntry) => onChange?.(next)

  const updateTimezone = (zone: SelectValue) => {
    emit({ ...value, timezone: String(zone ?? '') })
  }

  const updateDayScope = (scope: SelectValue) => {
    emit({ ...value, weekdays_only: scope === true })
  }

  const addPeriod = () => {
    emit({
      ...value,
      periods: [...value.periods, { start_time: '', end_time: '', multiplier: '1.00' }]
    })
  }

  const updatePeriod = (index: number, field: keyof TimePricingPeriodFormEntry, next: string) => {
    const periods = value.periods.map((period, current) => (current === index ? { ...period, [field]: next } : period))
    emit({ ...value, periods })
  }

  const formatMultiplier = (index: number, raw: string) => {
    if (!isValidTimePricingMultiplier(raw)) return
    updatePeriod(index, 'multiplier', Number(raw).toFixed(2))
  }

  const removePeriod = (index: number) => {
    emit({ ...value, periods: value.periods.filter((_period, current) => current !== index) })
  }

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div className={styles.settings}>
          <span className={form.label}>{t('admin.channels.form.timePricing')}</span>
          <div className={styles.settingsGrid}>
            <div className={form.field}>
              <span className={form.subLabel}>{t('admin.channels.form.timezone')}</span>
              <Select
                value={value.timezone}
                options={timezoneOptions}
                aria-label={t('admin.channels.form.timezone')}
                searchable
                creatable
                onChange={updateTimezone}
              />
            </div>
            <div className={form.field}>
              <span className={form.subLabel}>{t('admin.channels.form.timePricingDayScope')}</span>
              <Select
                value={value.weekdays_only}
                options={dayScopeOptions}
                aria-label={t('admin.channels.form.timePricingDayScope')}
                onChange={updateDayScope}
              />
            </div>
          </div>
        </div>
        <button type="button" className={[form.linkButton, styles.add].join(' ')} data-testid="add-time-period" onClick={addPeriod}>
          + {t('admin.channels.form.addTimePeriod')}
        </button>
      </div>

      {value.periods.length > 0 && (
        <div className={styles.periods}>
          {value.periods.map((period, index) => (
            <div key={index} className={styles.period}>
              <div className={form.field}>
                <label htmlFor={`${inputIdPrefix}-start-${index}`} className={form.subLabel}>
                  {t('admin.channels.form.startTime')}
                </label>
                <input
                  id={`${inputIdPrefix}-start-${index}`}
                  value={period.start_time}
                  type="text"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="HH:mm:ss"
                  pattern="[0-9]{2}:[0-9]{2}:[0-9]{2}"
                  autoComplete="off"
                  className={inputClass}
                  onChange={(event) => updatePeriod(index, 'start_time', normalizeClockTime(event.target.value))}
                />
              </div>
              <div className={form.field}>
                <label htmlFor={`${inputIdPrefix}-end-${index}`} className={form.subLabel}>
                  {t('admin.channels.form.endTime')}
                </label>
                <input
                  id={`${inputIdPrefix}-end-${index}`}
                  value={period.end_time}
                  type="text"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="HH:mm:ss"
                  pattern="[0-9]{2}:[0-9]{2}:[0-9]{2}"
                  autoComplete="off"
                  className={inputClass}
                  onChange={(event) => updatePeriod(index, 'end_time', normalizeClockTime(event.target.value))}
                />
              </div>
              <div className={form.field}>
                <label htmlFor={`${inputIdPrefix}-multiplier-${index}`} className={form.subLabel}>
                  {t('admin.channels.form.multiplier')}
                </label>
                <input
                  id={`${inputIdPrefix}-multiplier-${index}`}
                  value={String(period.multiplier)}
                  type="number"
                  min="0.01"
                  step="0.01"
                  className={inputClass}
                  onChange={(event) => updatePeriod(index, 'multiplier', event.target.value)}
                  onBlur={(event) => formatMultiplier(index, event.target.value)}
                />
              </div>
              <button
                type="button"
                className={[form.iconButton, styles.remove].join(' ')}
                title={t('admin.channels.form.removeTimePeriod')}
                aria-label={t('admin.channels.form.removeTimePeriod')}
                data-testid={`remove-time-period-${index}`}
                onClick={() => removePeriod(index)}
              >
                <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
