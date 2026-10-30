/**
 * 备份月度归档设置（对应 Vue 版 BackupArchiveSettings.vue）。
 * v-model 改为 value + onChange；日期多选弹层保留键盘与点击外部关闭行为。
 */
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'

import type { BackupMonthlyArchiveConfig } from '@/api/admin/backup'
import { SettingSwitch } from '@/components/admin/settings/SettingsLayout'
import { cx } from '@/components/admin/settings/settingsUtils'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { useI18n } from '@/i18n/useI18n'
import styles from './BackupArchiveSettings.module.css'

export interface BackupArchiveSettingsProps {
  value: BackupMonthlyArchiveConfig
  onChange: (value: BackupMonthlyArchiveConfig) => void
}

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1)

export default function BackupArchiveSettings({ value, onChange }: BackupArchiveSettingsProps) {
  const { t } = useI18n()
  const [datesOpen, setDatesOpen] = useState(false)
  const datePicker = useRef<HTMLDivElement>(null)
  const dateTrigger = useRef<HTMLButtonElement>(null)
  const [lastFiniteCount, setLastFiniteCount] = useState(12)
  const focusFirstOnOpen = useRef(false)
  const forever = value.retain_count === 0
  const selectedLabels = [
    ...[...value.days].sort((a, b) => a - b).map((day) => t('admin.backup.archive.day', { day })),
    ...(value.include_month_end ? [t('admin.backup.archive.monthEnd')] : [])
  ]

  // 记住最近一次有效的有限份数，取消“永久保留”时恢复
  if (Number.isInteger(value.retain_count) && value.retain_count > 0 && value.retain_count !== lastFiniteCount) {
    setLastFiniteCount(value.retain_count)
  }

  // 关闭归档时收起日期弹层
  const [prevEnabled, setPrevEnabled] = useState(value.enabled)
  if (prevEnabled !== value.enabled) {
    setPrevEnabled(value.enabled)
    if (!value.enabled) setDatesOpen(false)
  }

  function update(patch: Partial<BackupMonthlyArchiveConfig>) {
    onChange({ ...value, ...patch })
  }

  function toggleDay(day: number) {
    const days = value.days.includes(day) ? value.days.filter((item) => item !== day) : [...value.days, day]
    update({ days: days.sort((a, b) => a - b) })
  }

  function setCount(raw: number) {
    // Zero is the wire representation of permanent retention, selected only by
    // the checkbox. Typing zero must remain an invalid finite count.
    update({ retain_count: raw === 0 ? Number.NaN : raw })
  }

  function toggleForever(checked: boolean) {
    update({ retain_count: checked ? 0 : lastFiniteCount })
  }

  function closeDates(focus = false) {
    setDatesOpen(false)
    if (focus) dateTrigger.current?.focus()
  }

  function openDatesWithKeyboard() {
    focusFirstOnOpen.current = true
    setDatesOpen(true)
  }

  useEffect(() => {
    if (!datesOpen || !focusFirstOnOpen.current) return
    focusFirstOnOpen.current = false
    datePicker.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [datesOpen])

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (event.target instanceof Node && !datePicker.current?.contains(event.target)) setDatesOpen(false)
    }
    document.addEventListener('click', handleOutsideClick)
    return () => document.removeEventListener('click', handleOutsideClick)
  }, [])

  function handleFocusOut(event: FocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && !datePicker.current?.contains(event.relatedTarget)) closeDates()
  }

  function handlePickerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    event.preventDefault()
    closeDates(true)
  }

  return (
    <section className={styles.root} aria-labelledby="backup-archive-title">
      <div className={styles.head}>
        <h4 id="backup-archive-title" className={s.label}>
          {t('admin.backup.archive.title')}
        </h4>
        <label className={s.inline}>
          <SettingSwitch
            checked={value.enabled}
            onChange={(enabled) => update({ enabled })}
            data-testid="archive-enabled"
            aria-label={t('admin.backup.archive.enabled')}
          />
          <span className={s.hint}>{t('admin.backup.archive.enabled')}</span>
        </label>
      </div>
      {value.enabled ? (
        <div className={s.column}>
          <div className={s.grid2}>
            <div className={s.field}>
              <label htmlFor="backup-archive-dates" className={s.label}>
                {t('admin.backup.archive.dates')}
              </label>
              <div ref={datePicker} className={styles.picker} onKeyDown={handlePickerKeyDown} onBlur={handleFocusOut}>
                <button
                  id="backup-archive-dates"
                  ref={dateTrigger}
                  type="button"
                  className={cx(s.input, styles.trigger)}
                  aria-expanded={datesOpen}
                  aria-controls="backup-archive-options"
                  aria-describedby="backup-archive-dates-hint"
                  onClick={() => setDatesOpen((open) => !open)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      openDatesWithKeyboard()
                    }
                  }}
                >
                  <span className={s.chips}>
                    {!selectedLabels.length ? <span className={s.muted}>{t('admin.backup.archive.selectDates')}</span> : null}
                    {selectedLabels.slice(0, 3).map((label) => (
                      <span key={label} className={s.chip}>
                        {label}
                      </span>
                    ))}
                    {selectedLabels.length > 3 ? <span className={s.hint}>+{selectedLabels.length - 3}</span> : null}
                  </span>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                {datesOpen ? (
                  <div id="backup-archive-options" className={styles.popover}>
                    <div className={styles.popoverHead}>
                      <span>{t('admin.backup.archive.selectedDates', { count: selectedLabels.length })}</span>
                      <button type="button" className={styles.done} onClick={() => closeDates(true)}>
                        {t('admin.backup.archive.done')}
                      </button>
                    </div>
                    <div className={styles.days} role="group" aria-label={t('admin.backup.archive.dates')}>
                      {DAYS.map((day) => (
                        <label key={day} className={styles.day}>
                          <input
                            type="checkbox"
                            value={day}
                            checked={value.days.includes(day)}
                            aria-label={t('admin.backup.archive.day', { day })}
                            onChange={() => toggleDay(day)}
                          />
                          {day}
                        </label>
                      ))}
                      <label className={styles.day}>
                        <input
                          type="checkbox"
                          value="last"
                          checked={value.include_month_end}
                          aria-label={t('admin.backup.archive.monthEnd')}
                          onChange={(event) => update({ include_month_end: event.target.checked })}
                        />
                        {t('admin.backup.archive.monthEnd')}
                      </label>
                    </div>
                  </div>
                ) : null}
              </div>
              <p id="backup-archive-dates-hint" className={s.hint}>
                {t('admin.backup.archive.datesHint')}
              </p>
            </div>
            <div className={s.field}>
              <span className={s.label}>{t('admin.backup.archive.retention')}</span>
              <div className={s.inline}>
                {!forever ? (
                  <label className={cx(s.inline, s.grow)}>
                    <input
                      data-testid="archive-count"
                      value={Number.isNaN(value.retain_count) ? '' : value.retain_count}
                      type="number"
                      min="1"
                      step="1"
                      className={s.input}
                      aria-label={t('admin.backup.archive.count')}
                      aria-describedby="backup-archive-retention-hint"
                      onChange={(event) => setCount(event.target.valueAsNumber)}
                    />
                    <span className={styles.suffix}>{t('admin.backup.archive.copies')}</span>
                  </label>
                ) : null}
                <label className={s.checkboxLabel}>
                  <input
                    data-testid="archive-forever"
                    type="checkbox"
                    checked={forever}
                    onChange={(event) => toggleForever(event.target.checked)}
                  />
                  {t('admin.backup.archive.forever')}
                </label>
              </div>
              <p id="backup-archive-retention-hint" className={s.hint}>
                {t(forever ? 'admin.backup.archive.foreverHint' : 'admin.backup.archive.countHint')}
              </p>
            </div>
          </div>
          <p className={s.hint}>{t('admin.backup.archive.fallbackHint')}</p>
          <p className={s.hint}>{t('admin.backup.archive.independentHint')}</p>
        </div>
      ) : (
        <p className={s.hint}>{t('admin.backup.archive.disabledHint')}</p>
      )}
    </section>
  )
}
