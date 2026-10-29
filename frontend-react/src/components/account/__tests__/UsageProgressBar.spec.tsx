import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import UsageProgressBar from '../UsageProgressBar'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' })
}))

// Vue 版断言 Tailwind 类（bg-green-500 / text-amber-600 / w-[32px] …）；这里改为断言等价的 data 属性：
// 填充 data-level（success/warning/danger）、标签 data-label-width（fixed/auto）。
const fill = () => screen.getByTestId('usage-bar-fill')
const percent = () => screen.getByTestId('usage-bar-percent')
const label = () => screen.getByTestId('usage-bar-label')

describe('UsageProgressBar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-17T00:00:00Z'))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('showNowWhenIdle=true 且利用率为 0 但有未来 resetsAt 时显示倒计时', () => {
    const { container } = render(
      <UsageProgressBar label="5h" utilization={0} resetsAt="2026-03-17T02:30:00Z" showNowWhenIdle color="indigo" />
    )

    expect(container.textContent).toContain('2h 30m')
    expect(container.textContent).not.toContain('usage.resetNow')
  })

  it('showNowWhenIdle=true 但利用率大于 0 时显示倒计时', () => {
    const { container } = render(
      <UsageProgressBar label="7d" utilization={12} resetsAt="2026-03-17T02:30:00Z" showNowWhenIdle color="emerald" />
    )

    expect(container.textContent).toContain('2h 30m')
    expect(container.textContent).not.toContain('usage.resetNow')
    expect(container.textContent).not.toContain('usage.resetPending')
  })

  it('showNowWhenIdle=false 时保持原有倒计时行为', () => {
    const { container } = render(
      <UsageProgressBar
        label="1d"
        utilization={0}
        resetsAt="2026-03-17T02:30:00Z"
        showNowWhenIdle={false}
        color="indigo"
      />
    )

    expect(container.textContent).toContain('2h 30m')
    expect(container.textContent).not.toContain('usage.resetNow')
  })

  it('refreshes an active window countdown when a background tab becomes visible', () => {
    const { container, unmount } = render(
      <UsageProgressBar label="5h" utilization={12} resetsAt="2026-03-17T02:30:00Z" color="indigo" />
    )

    expect(container.textContent).toContain('2h 30m')
    // Background tabs can throttle the periodic timer while time advances.
    vi.setSystemTime(new Date('2026-03-17T01:00:00Z'))
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(container.textContent).toContain('1h 30m')
    unmount()
  })

  it('resetsAt 已过期且利用率大于 0 时显示「待刷新」', () => {
    const { container } = render(
      // 早于 fake system time 2026-03-17T00:00:00Z
      <UsageProgressBar label="5h" utilization={53} resetsAt="2026-03-16T22:00:00Z" color="indigo" />
    )

    expect(container.textContent).toContain('usage.resetPending')
    expect(container.textContent).not.toContain('usage.resetNow')
  })

  it('resetsAt 已过期且利用率为 0 时仍显示「现在」', () => {
    const { container } = render(
      <UsageProgressBar label="5h" utilization={0} resetsAt="2026-03-16T22:00:00Z" color="indigo" />
    )

    expect(container.textContent).toContain('usage.resetNow')
    expect(container.textContent).not.toContain('usage.resetPending')
  })

  it('剩余容量模式在 100% 时显示满格绿色', () => {
    const { container } = render(<UsageProgressBar label="Req" utilization={100} remainingCapacity color="indigo" />)

    expect(container.textContent).toContain('100%')
    expect(fill().style.width).toBe('100%')
    expect(fill()).toHaveAttribute('data-level', 'success')
  })

  it('剩余容量模式在低量和耗尽时缩短并变红', () => {
    const { container, rerender } = render(
      <UsageProgressBar label="Req" utilization={15} remainingCapacity color="indigo" />
    )

    expect(container.textContent).toContain('15%')
    expect(fill().style.width).toBe('15%')
    expect(fill()).toHaveAttribute('data-level', 'danger')

    rerender(<UsageProgressBar label="Req" utilization={0} remainingCapacity color="indigo" />)

    expect(container.textContent).toContain('0%')
    expect(fill().style.width).toBe('0%')
    expect(fill()).toHaveAttribute('data-level', 'danger')
  })

  it('默认利用率模式仍把超限显示为满格红色', () => {
    const { container } = render(<UsageProgressBar label="5h" utilization={120} color="indigo" />)

    expect(container.textContent).toContain('120%')
    expect(fill().style.width).toBe('100%')
    expect(fill()).toHaveAttribute('data-level', 'danger')
  })

  it('默认利用率模式按 75/90 阈值提前预警分级', () => {
    const levelsAt = (utilization: number) => {
      const view = render(<UsageProgressBar label="5h" utilization={utilization} color="indigo" />)
      const result = {
        bar: fill().getAttribute('data-level'),
        text: percent().getAttribute('data-level')
      }
      view.unmount()
      return result
    }

    // 条形配色：74 绿 / 75 与 89 黄 / 90 红；百分比文本同步分级（绿档为常规文字色）
    expect(levelsAt(74)).toEqual({ bar: 'success', text: 'success' })
    expect(levelsAt(75)).toEqual({ bar: 'warning', text: 'warning' })
    expect(levelsAt(89)).toEqual({ bar: 'warning', text: 'warning' })
    expect(levelsAt(90)).toEqual({ bar: 'danger', text: 'danger' })
  })

  it('labelWidth 默认 fixed：标签保持定宽居中，百分比列不变', () => {
    render(<UsageProgressBar label="5h" utilization={30} color="indigo" />)

    expect(label()).toHaveAttribute('data-label-width', 'fixed')
    expect(percent().textContent).toBe('30%')
  })

  it('labelWidth=auto 时标签限宽截断左对齐，百分比列保持不变', () => {
    render(<UsageProgressBar label="Pro/7 天" utilization={30} color="purple" labelWidth="auto" />)

    expect(label().textContent).toBe('Pro/7 天')
    expect(label()).toHaveAttribute('data-label-width', 'auto')
    expect(label()).toHaveAttribute('data-color', 'purple')
    expect(percent().textContent).toBe('30%')
  })

  it('沿用 Arc progress 语义：progressbar 角色与取值', () => {
    render(<UsageProgressBar label="5h" utilization={120} color="indigo" />)

    const bar = screen.getByRole('progressbar', { name: '5h' })
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar).toHaveAttribute('aria-valuetext', '120%')
  })
})
