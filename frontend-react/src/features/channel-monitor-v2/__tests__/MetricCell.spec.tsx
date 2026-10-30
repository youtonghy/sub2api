import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import MetricCell from '../MetricCell'

// Vue 版按 Tailwind 色类（emerald / amber / red / gray）断言；React 版按数值元素的 data-state 断言
const valueState = (container: HTMLElement) => container.querySelector('strong')!.getAttribute('data-state')

describe('MetricCell', () => {
  it('renders label/value/detail with the state color', () => {
    const { container } = render(<MetricCell label="请求" value="1,234" detail="12.5 RPM" state="healthy" />)

    expect(container.querySelector('article')).not.toBeNull()
    expect(container.textContent).toContain('请求')
    expect(container.textContent).toContain('1,234')
    expect(container.textContent).toContain('12.5 RPM')
    expect(valueState(container)).toBe('healthy')
  })

  it('does not paint missing first-token dash as critical red', () => {
    const { container } = render(<MetricCell label="首 Token P50" value="-" detail="-" state="critical" />)
    expect(valueState(container)).not.toBe('critical')
    expect(valueState(container)).toBe('missing')
  })

  it('maps warning and critical health states to distinct colors', () => {
    const warning = render(<MetricCell label="错误" value="10%" detail="1 次" state="warning" />)
    expect(valueState(warning.container)).toBe('warning')

    const critical = render(<MetricCell label="错误" value="50%" detail="5 次" state="critical" />)
    expect(valueState(critical.container)).toBe('critical')
  })

  it('renders multi-part detail as non-truncated chips (AVG · P90 fully visible)', () => {
    const { container } = render(<MetricCell label="首 Token P50" value="400ms" detail="AVG 475ms · P90 800ms" state="healthy" />)
    expect(container.querySelector('small')).toBeNull()
    const chips = [...container.querySelectorAll('strong ~ div > span')].map((chip) => chip.textContent)
    expect(chips).toEqual(['AVG 475ms', 'P90 800ms'])
    expect(container.textContent).not.toContain('…')
  })
})
