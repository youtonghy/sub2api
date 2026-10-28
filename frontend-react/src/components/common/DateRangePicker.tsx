/**
 * 日期范围选择，对应 Vue 版 DateRangePicker.vue，基于 Arc date-range-picker。
 * 保留 Vue 版的预设区间（今天、昨天、近 24 小时、近 7/14/30 天、本月、上月）、
 * 最大可选日期（明天，兼容服务器与本地时区差）与输出格式（YYYY-MM-DD 本地日期 + 预设名）。
 * 草稿在“应用”之前不会生效，关闭面板即丢弃。
 */
import { useMemo } from 'react'

import {
  DateRangePicker as ArcDateRangePicker,
  useToday,
  type DateRange,
  type DateRangePreset
} from '@/components/arc/date-range-picker/date-range-picker'
import { useI18n } from '@/i18n/useI18n'

export interface DateRangeValue {
  startDate: string
  endDate: string
  /** 与某个预设区间一致时为预设名（today、yesterday、last24Hours、7days、14days、30days、thisMonth、lastMonth），否则为 null */
  preset: string | null
}

export interface DateRangePickerProps {
  /** YYYY-MM-DD */
  startDate: string
  /** YYYY-MM-DD */
  endDate: string
  /** 点击“应用”后回调（合并 Vue 版 update:startDate、update:endDate 与 change） */
  onChange?: (range: DateRangeValue) => void
  className?: string
}

interface PresetDefinition {
  labelKey: string
  value: string
  range: (today: Date) => DateRange
}

const addDays = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount)

// Helper function to format date to YYYY-MM-DD using local timezone
const formatDateToString = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const parseDate = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/** 预设顺序与 Vue 版一致；按顺序匹配，第一个区间相同的预设即为当前预设 */
const PRESETS: PresetDefinition[] = [
  { labelKey: 'dates.today', value: 'today', range: (today) => ({ start: today, end: today }) },
  {
    labelKey: 'dates.yesterday',
    value: 'yesterday',
    range: (today) => ({ start: addDays(today, -1), end: addDays(today, -1) })
  },
  // 近 24 小时：从昨天此刻到现在，按日期即昨天到今天
  { labelKey: 'dates.last24Hours', value: 'last24Hours', range: (today) => ({ start: addDays(today, -1), end: today }) },
  { labelKey: 'dates.last7Days', value: '7days', range: (today) => ({ start: addDays(today, -6), end: today }) },
  { labelKey: 'dates.last14Days', value: '14days', range: (today) => ({ start: addDays(today, -13), end: today }) },
  { labelKey: 'dates.last30Days', value: '30days', range: (today) => ({ start: addDays(today, -29), end: today }) },
  {
    labelKey: 'dates.thisMonth',
    value: 'thisMonth',
    range: (today) => ({ start: new Date(today.getFullYear(), today.getMonth(), 1), end: today })
  },
  {
    labelKey: 'dates.lastMonth',
    value: 'lastMonth',
    range: (today) => ({
      start: new Date(today.getFullYear(), today.getMonth() - 1, 1),
      end: new Date(today.getFullYear(), today.getMonth(), 0)
    })
  }
]

/** 查找与区间一致的预设名（基于本地今天） */
function detectDatePreset(startDate: string, endDate: string, today: Date = new Date()): string | null {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  for (const preset of PRESETS) {
    const range = preset.range(base)
    if (formatDateToString(range.start) === startDate && formatDateToString(range.end) === endDate) {
      return preset.value
    }
  }
  return null
}

export default function DateRangePicker({ startDate, endDate, onChange, className }: DateRangePickerProps) {
  const { t, locale } = useI18n()
  const today = useToday()

  const presets = useMemo<DateRangePreset[]>(
    () => PRESETS.map((preset) => ({ label: t(preset.labelKey), range: preset.range })),
    // locale 变化时重新生成预设文案
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale]
  )

  const value = useMemo<DateRange | null>(() => {
    const start = parseDate(startDate)
    const end = parseDate(endDate)
    return start && end ? { start, end } : null
  }, [startDate, endDate])

  // Tomorrow's date - used for max date to handle timezone differences
  // When user is in a timezone behind the server, "today" on server might be "tomorrow" locally
  const maxDate = today ? addDays(today, 1) : undefined

  return (
    <ArcDateRangePicker
      className={className}
      value={value}
      label={t('dates.selectDateRange')}
      placeholder={t('dates.selectDateRange')}
      presets={presets}
      maxDate={maxDate}
      locale={locale === 'zh' ? 'zh-CN' : 'en-US'}
      labels={{
        noDates: t('shell.dateRange.noDates'),
        dayCount: (days) => t('shell.dateRange.dayCount', { n: days }, days),
        presets: t('shell.dateRange.presets'),
        previousMonth: t('shell.dateRange.previousMonth'),
        nextMonth: t('shell.dateRange.nextMonth'),
        pickEndDate: t('shell.dateRange.pickEndDate'),
        cancel: t('common.cancel'),
        apply: t('dates.apply'),
      }}
      onChange={(range) => {
        const nextStart = formatDateToString(range.start)
        const nextEnd = formatDateToString(range.end)
        onChange?.({
          startDate: nextStart,
          endDate: nextEnd,
          preset: detectDatePreset(nextStart, nextEnd, today ?? new Date())
        })
      }}
    />
  )
}
