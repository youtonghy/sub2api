import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import GrokFreeIcon from '../GrokFreeIcon'
import PlatformTypeBadge from '../PlatformTypeBadge'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }),
}))

// Vue 版断言 Tailwind 色类（如 bg-purple-100），React 版把同一色系名放在 data-color 上。
const colors = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-color]')].map((el) => el.getAttribute('data-color'))

describe('PlatformTypeBadge Grok plans', () => {
  it('renders FREE and BASIC as Grok Free with a lightweight plan icon', () => {
    const view = render(
      <PlatformTypeBadge platform="grok" type="oauth" planType="BASIC" subscriptionExpiresAt="2027-01-01T00:00:00Z" />,
    )

    expect(view.container.textContent).toContain('Grok Free')
    expect(view.container.querySelector('[data-testid="grok-free-plan-icon"]')).not.toBeNull()
    expect(view.container.querySelector('[data-testid="grok-plan-icon"]')).toBeNull()
    expect(view.container.textContent).not.toContain('2027-01-01')

    view.rerender(<PlatformTypeBadge platform="grok" type="oauth" planType="FREE" subscriptionExpiresAt="2027-01-01T00:00:00Z" />)
    expect(view.container.textContent).toContain('Grok Free')
    expect(view.container.querySelector('[data-testid="grok-free-plan-icon"]')).not.toBeNull()
  })

  it('keeps SuperGrok labels compatible and marks paid Grok plans', () => {
    const view = render(<PlatformTypeBadge platform="grok" type="oauth" planType="SuperGrok Heavy" />)

    expect(view.container.textContent).toContain('SuperGrok Heavy')
    expect(view.container.querySelector('[data-testid="grok-plan-icon"]')).not.toBeNull()
    expect(view.container.querySelector('[data-testid="grok-free-plan-icon"]')).toBeNull()
    // Heavy uses purple plan chip
    expect(colors(view.container)).toContain('purple')

    // Vue 版用 setProps 切换平台；Arc badge 会让旧文字淡出，因此这里重新挂载以断言新状态。
    view.unmount()
    const openai = render(<PlatformTypeBadge platform="openai" type="oauth" planType="free" />)
    expect(openai.container.textContent).toContain('Free')
    expect(openai.container.textContent).not.toContain('Grok Free')
    expect(openai.container.querySelector('[data-testid="grok-plan-icon"]')).toBeNull()
  })

  it('colors free gray, SuperGrok cyan, and Heavy purple', () => {
    const free = render(<PlatformTypeBadge platform="grok" type="oauth" planType="free" />)
    expect(colors(free.container)).toContain('gray')
    expect(colors(free.container)).not.toContain('purple')
    expect(colors(free.container)).not.toContain('cyan')

    const superGrok = render(<PlatformTypeBadge platform="grok" type="oauth" planType="supergrok" />)
    expect(superGrok.container.textContent).toContain('SuperGrok')
    expect(colors(superGrok.container)).toContain('cyan')
    expect(superGrok.container.querySelector('[data-testid="grok-plan-icon"]')).not.toBeNull()

    const heavy = render(<PlatformTypeBadge platform="grok" type="oauth" planType="Heavy" />)
    expect(heavy.container.textContent).toContain('Heavy')
    expect(colors(heavy.container)).toContain('purple')
    expect(heavy.container.querySelector('[data-testid="grok-plan-icon"]')).not.toBeNull()

    const lite = render(<PlatformTypeBadge platform="grok" type="oauth" planType="supergrok_lite" />)
    expect(lite.container.textContent).toContain('SuperGrok Lite')
    expect(colors(lite.container)).toContain('cyan')
  })

  it('uses a dedicated 12px currentColor Grok mark with a Free sparkle', () => {
    const { container } = render(<GrokFreeIcon />)
    const svg = container.firstElementChild!

    expect(svg.tagName.toLowerCase()).toBe('svg')
    expect(svg.getAttribute('fill')).toBe('currentColor')
    // Vue 版断言 h-3 w-3（12px）类名，React 版直接设置 12px 宽高
    expect(svg.getAttribute('width')).toBe('12')
    expect(svg.getAttribute('height')).toBe('12')
    expect(svg.querySelectorAll('path')).toHaveLength(2)
  })
})

describe('PlatformTypeBadge OpenAI authentication modes', () => {
  it('distinguishes Agent Identity, PAT, and OAuth accounts', () => {
    const agent = render(<PlatformTypeBadge platform="openai" type="oauth" authMode="agentIdentity" />)
    expect(agent.container.textContent).toContain('Agent Identity')
    agent.unmount()

    const pat = render(<PlatformTypeBadge platform="openai" type="oauth" authMode="personalAccessToken" />)
    expect(pat.container.textContent).toContain('PAT')
    expect(pat.container.textContent).not.toContain('Agent Identity')
    pat.unmount()

    const oauth = render(<PlatformTypeBadge platform="openai" type="oauth" />)
    expect(oauth.container.textContent).toContain('OAuth')
  })
})

describe('PlatformTypeBadge MiniMax', () => {
  it('labels MiniMax API keys as MiniMax, not Gemini', () => {
    const { container } = render(<PlatformTypeBadge platform="minimax" type="apikey" />)

    expect(container.textContent).toContain('MiniMax')
    expect(container.textContent).toContain('Key')
    expect(container.textContent).not.toContain('Gemini')
    expect(colors(container)).toContain('rose')
  })
})
