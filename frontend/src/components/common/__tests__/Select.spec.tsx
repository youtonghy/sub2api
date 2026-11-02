import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Select, { type SelectProps } from '../Select'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }),
}))

const originalInnerWidth = window.innerWidth

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  })
}

const mockTriggerRect = (left: number, width: number) => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: left,
    y: 20,
    top: 20,
    right: left + width,
    bottom: 60,
    left,
    width,
    height: 40,
    toJSON: () => ({}),
  })
}

const trigger = () => screen.getByRole('button', { name: 'Select option' })
const dropdown = () => document.body.querySelector<HTMLElement>('[role="listbox"]')
const searchInput = () => dropdown()?.querySelector<HTMLInputElement>('input') ?? null
const optionLabels = () => [...(dropdown()?.querySelectorAll('[role="option"]') ?? [])].map((el) => el.textContent)

const openSelect = () => {
  render(
    <Select
      value={null}
      options={[{ value: 'example', label: 'very-long-unbroken-option-value-that-must-not-overflow' }]}
    />
  )
  fireEvent.click(trigger())
  return dropdown()
}

afterEach(() => {
  setViewportWidth(originalInnerWidth)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Select dropdown viewport constraints', () => {
  it('preserves the existing 200px minimum width when space is available', () => {
    setViewportWidth(1024)
    mockTriggerRect(20, 80)

    const el = openSelect()

    expect(el).not.toBeNull()
    expect(el?.style.left).toBe('20px')
    expect(el?.style.minWidth).toBe('200px')
    expect(el?.style.maxWidth).toBe('996px')
  })

  it('shrinks the minimum width to fit near the right viewport edge', () => {
    setViewportWidth(320)
    mockTriggerRect(220, 80)

    const el = openSelect()

    expect(el).not.toBeNull()
    expect(el?.style.left).toBe('220px')
    expect(el?.style.minWidth).toBe('92px')
    expect(el?.style.maxWidth).toBe('92px')
  })

  it('clamps a trigger left of the viewport to the safe padding', () => {
    setViewportWidth(320)
    mockTriggerRect(-20, 80)

    const el = openSelect()

    expect(el).not.toBeNull()
    expect(el?.style.left).toBe('8px')
    expect(el?.style.minWidth).toBe('200px')
    expect(el?.style.maxWidth).toBe('304px')
  })

  it('clamps an offscreen-right trigger position to the viewport boundary', () => {
    setViewportWidth(320)
    mockTriggerRect(400, 80)

    const el = openSelect()

    expect(el).not.toBeNull()
    expect(el?.style.left).toBe('312px')
    expect(el?.style.minWidth).toBe('0px')
    expect(el?.style.maxWidth).toBe('0px')
  })
})

describe('Select remote search', () => {
  const renderRemoteSelect = (props: Partial<SelectProps> = {}) => {
    const onSearch = vi.fn()
    render(
      <Select
        value={null}
        remote
        onSearch={onSearch}
        options={[
          { value: 'alpha', label: 'Alpha account' },
          { value: 'beta', label: 'Beta account' },
        ]}
        {...props}
      />
    )
    return onSearch
  }

  const typeSearchQuery = (query: string) => {
    const input = searchInput()
    expect(input).not.toBeNull()
    fireEvent.change(input!, { target: { value: query } })
  }

  it('emits debounced search events and skips local filtering in remote mode', async () => {
    vi.useFakeTimers()
    const onSearch = renderRemoteSelect()
    fireEvent.click(trigger())

    typeSearchQuery('zzz')

    // 防抖窗口内不触发。
    expect(onSearch).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(300))

    expect(onSearch.mock.calls).toEqual([['zzz']])
    // 远程模式不做本地过滤：无命中的 query 下选项仍完整展示（由父组件更新 options）。
    expect(optionLabels()).toContain('Alpha account')
    expect(optionLabels()).toContain('Beta account')
  })

  it('does not emit search when the dropdown closes and the query resets', async () => {
    vi.useFakeTimers()
    const onSearch = renderRemoteSelect()
    fireEvent.click(trigger())

    typeSearchQuery('hidden')

    // 关闭下拉：排队中的防抖定时器应被取消，也不应因 query 重置而尾随 emit。
    fireEvent.click(trigger())
    await act(() => vi.advanceTimersByTimeAsync(300))

    expect(onSearch).not.toHaveBeenCalled()
  })

  it('shows the loading text instead of empty text while loading with no options', () => {
    renderRemoteSelect({ options: [], loading: true })
    fireEvent.click(trigger())

    expect(screen.getByRole('status').textContent).toContain('common.loading')
  })

  it('keeps local filtering and emits nothing when remote is not set', async () => {
    vi.useFakeTimers()
    const onSearch = vi.fn()
    render(
      <Select
        value={null}
        searchable
        onSearch={onSearch}
        options={[
          { value: 'alpha', label: 'Alpha account' },
          { value: 'beta', label: 'Beta account' },
        ]}
      />
    )
    fireEvent.click(trigger())

    typeSearchQuery('alpha')
    await act(() => vi.advanceTimersByTimeAsync(300))

    expect(onSearch).not.toHaveBeenCalled()
    expect(optionLabels()).toEqual(['Alpha account'])
  })
})

// 移植自 disabledSelectors.spec.ts 的 Select 部分
describe('selectors disabled while open', () => {
  it('closes an open Select and can reopen when enabled again', () => {
    const onChange = vi.fn()
    const options = [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }]
    const view = render(<Select value={1} options={options} onChange={onChange} />)
    fireEvent.click(trigger())
    expect(dropdown()).not.toBeNull()
    view.rerender(<Select value={1} options={options} onChange={onChange} disabled />)
    expect(dropdown()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    view.rerender(<Select value={1} options={options} onChange={onChange} />)
    fireEvent.click(trigger())
    expect(dropdown()).not.toBeNull()
  })
})
