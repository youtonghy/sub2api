import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import DateRangePicker from '../DateRangePicker'

const messages: Record<string, string> = {
  'dates.today': 'Today',
  'dates.yesterday': 'Yesterday',
  'dates.last24Hours': 'Last 24 Hours',
  'dates.last7Days': 'Last 7 Days',
  'dates.last14Days': 'Last 14 Days',
  'dates.last30Days': 'Last 30 Days',
  'dates.thisMonth': 'This Month',
  'dates.lastMonth': 'Last Month',
  'dates.startDate': 'Start Date',
  'dates.endDate': 'End Date',
  'dates.apply': 'Apply',
  'common.cancel': 'Cancel',
  'shell.dateRange.nextMonth': 'Next month',
  'shell.dateRange.previousMonth': 'Previous month',
  'dates.selectDateRange': 'Select date range'
}

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => messages[key] ?? key, te: () => true, locale: 'en' })
}))

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const trigger = () => screen.getByRole('button', { name: /^Select date range:/ })
const preset = (label: string) => screen.getByRole('button', { name: label })
const apply = () => screen.getByRole('button', { name: 'Apply' })

afterEach(() => vi.useRealTimers())

/** 日历中某一天的按钮；不在当前可见月份时向后翻页查找 */
const dayButton = (key: string) => {
  for (let i = 0; i < 3; i++) {
    const button = document.querySelector<HTMLButtonElement>(`button[data-date="${key}"]`)
    if (button) return button
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
  }
  throw new Error(`day ${key} not found`)
}

// 与 Vue 版不同：Arc 触发器显示格式化后的日期而不是预设名，预设识别体现在面板中预设按钮的按下状态
describe('DateRangePicker', () => {
  it('uses last 24 hours as the default recognized preset', () => {
    const now = new Date()
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    render(<DateRangePicker startDate={formatLocalDate(yesterday)} endDate={formatLocalDate(now)} />)
    fireEvent.click(trigger())

    expect(preset('Last 24 Hours')).toHaveAttribute('aria-pressed', 'true')
  })

  it('emits range updates with last24Hours preset when applied', () => {
    const today = formatLocalDate(new Date())
    const onChange = vi.fn()

    render(<DateRangePicker startDate={today} endDate={today} onChange={onChange} />)

    fireEvent.click(trigger())
    fireEvent.click(preset('Last 24 Hours'))
    fireEvent.click(apply())

    const nowAfterClick = new Date()
    const yesterdayAfterClick = new Date(nowAfterClick.getTime() - 24 * 60 * 60 * 1000)
    expect(onChange.mock.calls[0]).toEqual([
      {
        startDate: formatLocalDate(yesterdayAfterClick),
        endDate: formatLocalDate(nowAfterClick),
        preset: 'last24Hours'
      }
    ])
  })
})

// DateRangePicker.dismiss.spec.ts
describe('DateRangePicker unapplied changes', () => {
  const chooseDraft = () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 13, 12))
    const onChange = vi.fn()
    let current = { startDate: '2026-09-13', endDate: '2026-09-13' }
    const view = render(<DateRangePicker {...current} onChange={(range) => {
      onChange(range)
      current = { startDate: range.startDate, endDate: range.endDate }
      view.rerender(<DateRangePicker {...current} onChange={onChange} />)
    }} />)
    fireEvent.click(trigger())
    fireEvent.click(preset('Last 7 Days'))
    return onChange
  }

  // Arc 面板打开时触发器不可交互（inert），因此 Vue 版的“再次点击触发器”改为“取消”按钮
  it.each(['outside', 'escape', 'cancel'])('discards draft dates when dismissed with %s', (method) => {
    const onChange = chooseDraft()
    if (method === 'outside') {
      act(() => {
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      })
    } else if (method === 'escape') {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    }
    expect(onChange).not.toHaveBeenCalled()
    expect(trigger().getAttribute('aria-label')).toContain('Sep 13, 2026')
    fireEvent.click(trigger())
    expect(preset('Today')).toHaveAttribute('aria-pressed', 'true')
    expect(preset('Last 7 Days')).toHaveAttribute('aria-pressed', 'false')
  })

  it('retains a newly applied range after the parent accepts both updates', () => {
    const onChange = chooseDraft()
    fireEvent.click(apply())
    expect(onChange.mock.calls).toEqual([[{ startDate: '2026-09-07', endDate: '2026-09-13', preset: '7days' }]])
    fireEvent.click(trigger())
    expect(preset('Last 7 Days')).toHaveAttribute('aria-pressed', 'true')
  })
})

// DateRangePicker.midnight.spec.ts
describe('date presets after midnight', () => {
  const reopenNextDay = async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 30, 23, 59))
    const onChange = vi.fn()
    render(<DateRangePicker startDate="2026-09-30" endDate="2026-09-30" onChange={onChange} />)
    fireEvent.click(trigger())
    // 面板中“明天”（2026-10-01）可选，后天不可选
    expect(dayButton('2026-10-01')).not.toBeDisabled()
    expect(dayButton('2026-10-02')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    // 等面板退出动画结束再跨过午夜
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    vi.setSystemTime(new Date(2026, 9, 1, 0, 1))
    // 页面跨过午夜后，窗口重新获得焦点时 Arc 会重新读取“今天”
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    fireEvent.click(trigger())
    return onChange
  }

  it.each([
    ['Today', '2026-10-01'],
    ['Last 7 Days', '2026-09-25'],
    ['This Month', '2026-10-01'],
  ])('refreshes %s when the page stays mounted overnight', async (label, startDate) => {
    const onChange = await reopenNextDay()
    fireEvent.click(preset(label))
    fireEvent.click(apply())
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ startDate, endDate: '2026-10-01' })
  })

  it('updates the maximum selectable date when reopened', async () => {
    await reopenNextDay()
    expect(dayButton('2026-10-02')).not.toBeDisabled()
    expect(dayButton('2026-10-03')).toBeDisabled()
  })
})
