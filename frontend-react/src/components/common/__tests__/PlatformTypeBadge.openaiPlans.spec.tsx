import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AccountPlatform } from '@/types'
import PlatformTypeBadge from '../PlatformTypeBadge'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }),
}))

function mountPlan(platform: AccountPlatform, planType: string) {
  const { container } = render(<PlatformTypeBadge platform={platform} type="oauth" planType={planType} />)
  return {
    text: () => container.textContent ?? '',
    // Vue 版断言 Tailwind 色类（bg-violet-100 等），React 版把色系名放在 data-color 上
    colors: () => [...container.querySelectorAll('[data-color]')].map((el) => el.getAttribute('data-color')),
  }
}

describe('PlatformTypeBadge ChatGPT plan tiers', () => {
  it('labels pro / chatgptpro as Pro 200 with the Pro color', () => {
    for (const planType of ['pro', 'chatgptpro', 'PRO']) {
      const wrapper = mountPlan('openai', planType)

      expect(wrapper.text()).toContain('Pro 200')
      expect(wrapper.colors()).toContain('violet')
    }
  })

  it('labels prolite as Pro 100 sharing the Pro color', () => {
    for (const planType of ['prolite', 'PROLITE', 'pro_lite']) {
      const wrapper = mountPlan('openai', planType)

      expect(wrapper.text()).toContain('Pro 100')
      expect(wrapper.colors()).toContain('violet')
      expect(wrapper.text()).not.toContain('Pro 200')
    }
  })

  it('labels team as Business with the Team color', () => {
    const wrapper = mountPlan('openai', 'team')

    expect(wrapper.text()).toContain('Business')
    expect(wrapper.colors()).toContain('indigo')
  })

  it('labels self_serve_business_prolite as Business Premium sharing the Team color', () => {
    for (const planType of ['self_serve_business_prolite', 'selfservebusinessprolite']) {
      const wrapper = mountPlan('openai', planType)

      expect(wrapper.text()).toContain('Business Premium')
      expect(wrapper.colors()).toContain('indigo')
      expect(wrapper.text()).not.toContain('self_serve_business_prolite')
    }
  })

  it('keeps plus, free and abnormal labels unchanged', () => {
    const plus = mountPlan('openai', 'plus')
    expect(plus.text()).toContain('Plus')
    expect(plus.colors()).toContain('sky')

    const free = mountPlan('openai', 'free')
    expect(free.text()).toContain('Free')
    expect(free.colors()).toContain('gray')

    const abnormal = mountPlan('openai', 'abnormal')
    expect(abnormal.text()).toContain('admin.accounts.subscriptionAbnormal')
    expect(abnormal.colors()).toContain('red')
  })

  it('falls back to the raw value for unknown plans', () => {
    const wrapper = mountPlan('openai', 'future_sku')

    expect(wrapper.text()).toContain('future_sku')
    expect(wrapper.colors()).not.toContain('violet')
    expect(wrapper.colors()).not.toContain('indigo')
  })

  it('does not apply the ChatGPT tier naming to other platforms', () => {
    // Antigravity 的 Pro 与 Grok 的 pro 是各自产品线的档位，不能显示成 Pro 200。
    for (const platform of ['antigravity', 'grok'] as AccountPlatform[]) {
      const wrapper = mountPlan(platform, 'pro')

      expect(wrapper.text()).toContain('Pro')
      expect(wrapper.text()).not.toContain('Pro 200')
    }

    const antigravityTeam = mountPlan('antigravity', 'team')
    expect(antigravityTeam.text()).toContain('Team')
    expect(antigravityTeam.text()).not.toContain('Business')
  })
})

describe('new Codex subscription labels', () => {
  it.each([
    ['promax', 'Pro 500', 'violet'],
    ['go', 'Go', ''],
    ['ent26', 'Enterprise', 'indigo'],
    ['enterprise_cbp_automation', 'Enterprise (Automation)', 'indigo'],
    ['self_serve_business_usage_based', 'Business', 'indigo'],
    ['business', 'Enterprise', 'indigo'],
    ['edu_plus', 'Edu Plus', 'indigo'],
    ['edu_pro', 'Edu Pro', 'indigo']
  ])('displays %s', (sku, label, color) => {
    const wrapper = mountPlan('openai', sku)
    expect(wrapper.text()).toContain(label)
    if (color) expect(wrapper.colors()).toContain(color)
  })
})
