import { act, fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TimePricingSection from '../TimePricingSection'
import { createDefaultTimePricingForm, type TimePricingFormEntry } from '../types'

const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

// Vue 版的 SelectStub：记录每个 Select 的 props，渲染为按钮
interface SelectStubProps { value: unknown; options: unknown; onChange?: (value: unknown) => void }
const selects = vi.hoisted(() => ({ props: [] as SelectStubProps[] }))
vi.mock('@/components/common/Select', () => ({
  default: (props: SelectStubProps) => {
    selects.props.push(props)
    return <button type="button" data-testid="select-stub" />
  }
}))

// 每次渲染都会追加，取最近一次渲染的两个 Select
const latestSelects = () => selects.props.slice(-2)

function mountSection(value: TimePricingFormEntry) {
  const onChange = vi.fn()
  const view = render(<TimePricingSection value={value} onChange={onChange} />)
  return { ...view, onChange }
}

describe('TimePricingSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selects.props = []
  })

  it('offers every-day and weekdays-only scopes', () => {
    const value = createDefaultTimePricingForm()
    const { onChange, container } = mountSection(value)

    expect(container.querySelectorAll('[data-testid="select-stub"]')).toHaveLength(2)
    const [, scope] = latestSelects()
    expect(scope.value).toBe(false)
    expect(scope.options).toEqual([
      { value: false, label: 'admin.channels.form.timePricingEveryDay' },
      { value: true, label: 'admin.channels.form.timePricingWeekdaysOnly' }
    ])

    act(() => scope.onChange!(true))
    expect(onChange.mock.calls[0][0]).toEqual({ ...value, weekdays_only: true })
  })

  it('adds a neutral period immutably', () => {
    const value = createDefaultTimePricingForm()
    const { onChange, container } = mountSection(value)

    fireEvent.click(container.querySelector('[data-testid="add-time-period"]')!)

    expect(onChange.mock.calls[0][0]).toEqual({
      timezone: 'Asia/Shanghai',
      weekdays_only: false,
      periods: [{ start_time: '', end_time: '', multiplier: '1.00' }]
    })
    expect(value.periods).toHaveLength(0)
  })

  it('removes without mutating props', () => {
    const value = {
      timezone: 'Asia/Shanghai',
      periods: [{ start_time: '09:00:00', end_time: '12:00:00', multiplier: '2.00' }]
    } as TimePricingFormEntry
    const { onChange, container } = mountSection(value)

    const removeButton = container.querySelector('[data-testid="remove-time-period-0"]')!
    expect(removeButton.getAttribute('title')).toBe('admin.channels.form.removeTimePeriod')
    expect(removeButton.getAttribute('aria-label')).toBe('admin.channels.form.removeTimePeriod')
    fireEvent.click(removeButton)

    expect(onChange.mock.calls[0][0]).toEqual({ timezone: 'Asia/Shanghai', periods: [] })
    expect(value.periods).toHaveLength(1)
  })

  it('uses locale-independent 24-hour second inputs', () => {
    const value = {
      timezone: 'Asia/Shanghai',
      periods: [{ start_time: '09:00:00', end_time: '12:00:00', multiplier: '2.00' }]
    } as TimePricingFormEntry
    const { container } = mountSection(value)

    const timeInputs = [...container.querySelectorAll('input[inputmode="numeric"]')]
    expect(timeInputs).toHaveLength(2)
    expect(timeInputs.every((input) => input.getAttribute('type') === 'text')).toBe(true)
    expect(timeInputs.every((input) => input.getAttribute('maxlength') === '8')).toBe(true)
    expect(timeInputs.every((input) => input.getAttribute('placeholder') === 'HH:mm:ss')).toBe(true)
  })

  it('updates the timezone and normalizes full-width colons immutably', () => {
    const value = {
      timezone: 'Asia/Shanghai',
      periods: [{ start_time: '09:00:00', end_time: '12:00:00', multiplier: '2.00' }]
    } as TimePricingFormEntry
    const { onChange, container } = mountSection(value)

    const [timezone] = latestSelects()
    act(() => timezone.onChange!('Europe/London'))
    fireEvent.change(container.querySelector('input')!, { target: { value: '10：30：15' } })

    expect(onChange.mock.calls[0][0]).toEqual({ ...value, timezone: 'Europe/London' })
    expect(onChange.mock.calls[1][0]).toEqual({
      ...value,
      periods: [{ ...value.periods[0], start_time: '10:30:15' }]
    })
    expect(value).toEqual({
      timezone: 'Asia/Shanghai',
      periods: [{ start_time: '09:00:00', end_time: '12:00:00', multiplier: '2.00' }]
    })
  })

  it('normalizes 24:00:00 to 00:00:00', () => {
    const value = {
      timezone: 'Asia/Shanghai',
      periods: [{ start_time: '09:00:00', end_time: '12:00:00', multiplier: '2.00' }]
    } as TimePricingFormEntry
    const { onChange, container } = mountSection(value)

    fireEvent.change(container.querySelector('input')!, { target: { value: '24:00:00' } })

    expect(onChange.mock.calls[0][0]).toEqual({
      ...value,
      periods: [{ ...value.periods[0], start_time: '00:00:00' }]
    })
  })

  it('formats only a valid positive multiplier on blur', () => {
    const value = {
      timezone: 'Asia/Shanghai',
      periods: [{ start_time: '09:00:00', end_time: '12:00:00', multiplier: '2' }]
    } as TimePricingFormEntry
    const { onChange, container } = mountSection(value)

    const multiplier = container.querySelector('input[type="number"]')!
    expect(multiplier.getAttribute('min')).toBe('0.01')
    expect(multiplier.getAttribute('step')).toBe('0.01')
    fireEvent.blur(multiplier)

    expect(onChange.mock.calls[0][0]).toEqual({
      ...value,
      periods: [{ ...value.periods[0], multiplier: '2.00' }]
    })
  })

  it.each(['1.234', '1e2', '.5'])('keeps invalid multiplier %s unchanged on blur', (invalid) => {
    const value = {
      timezone: 'Asia/Shanghai',
      periods: [{ start_time: '09:00:00', end_time: '12:00:00', multiplier: invalid }]
    } as TimePricingFormEntry
    const { onChange, container } = mountSection(value)

    fireEvent.blur(container.querySelector('input[type="number"]')!)

    expect(onChange).not.toHaveBeenCalled()
    expect(value.periods[0].multiplier).toBe(invalid)
  })

  it('uses unique input ids across component instances', () => {
    const value = {
      timezone: 'Asia/Shanghai',
      periods: [{ start_time: '09:00:00', end_time: '12:00:00', multiplier: '2.00' }]
    } as TimePricingFormEntry
    const { container } = render(
      <div>
        <TimePricingSection value={value} />
        <TimePricingSection value={value} />
      </div>
    )

    const ids = [...container.querySelectorAll('input')].map((input) => input.getAttribute('id'))
    expect(ids).toHaveLength(6)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
