import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { SubscriptionPlan } from '@/types/payment'
import SubscriptionPlanCard from '../SubscriptionPlanCard'

// Vue 版测试环境的 vue-i18n 为 runtime-only 构建，t() 原样返回 key；这里保持同样行为
vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }),
}))

const mountPlanCard = (groupPlatform: string, overrides: Partial<SubscriptionPlan> = {}) =>
  render(
    <SubscriptionPlanCard
      plan={{
        id: 1,
        group_id: 10,
        group_platform: groupPlatform,
        name: 'Pro',
        price: 10,
        amount: 1000,
        features: [],
        rate_multiplier: 1,
        validity_days: 30,
        validity_unit: 'day',
        supported_model_scopes: ['claude', 'gemini_text', 'gemini_image'],
        is_active: true,
        ...overrides,
      } as unknown as SubscriptionPlan}
    />,
  )

const cardText = (groupPlatform: string, overrides: Partial<SubscriptionPlan> = {}) => {
  const { container, unmount } = mountPlanCard(groupPlatform, overrides)
  const text = container.textContent ?? ''
  unmount()
  return text
}

describe('SubscriptionPlanCard', () => {
  it('does not show Antigravity model scopes for OpenAI plans', () => {
    const text = cardText('openai')

    expect(text).not.toContain('Claude')
    expect(text).not.toContain('Gemini')
    expect(text).not.toContain('Imagen')
  })

  it('shows model scopes for Antigravity plans', () => {
    const text = cardText('antigravity')

    expect(text).toContain('Claude')
    expect(text).toContain('Gemini')
    expect(text).toContain('Imagen')
  })

  // #4607：管理端保存的单位是复数（months/weeks），此前用户侧只匹配单数
  // 'month'，「1 个月」的套餐卡片被显示成「1天」。t() 原样返回 key，故按 key 断言单位分支。
  it('renders plural admin-form validity units instead of mislabeled days (#4607)', () => {
    expect(cardText('openai', { validity_days: 1, validity_unit: 'months' })).toContain('/ payment.perMonth')
    expect(cardText('openai', { validity_days: 3, validity_unit: 'months' })).toContain('/ 3payment.months')
    expect(cardText('openai', { validity_days: 2, validity_unit: 'weeks' })).toContain('/ 2payment.weeks')
    expect(cardText('openai', { validity_days: 30, validity_unit: 'day' })).toContain('/ 30payment.days')
  })

  it('uses the configured currency symbol while preserving USD for legacy plans', () => {
    const cnyPlan = cardText('openai', { currency: 'CNY', original_price: 20 })

    expect(cnyPlan).toContain('¥10CNY')
    expect(cnyPlan).toContain('¥20CNY')
    expect(cardText('openai', { currency: 'USD' })).toContain('$10USD')
    expect(cardText('openai', { currency: '' })).toContain('$10')
  })

  // Vue 版断言 Tailwind 类名（h-12 / line-clamp-2 / break-words）；两行限高由 CSS Module 实现，
  // 这里断言完整标题文本与 title 属性仍然可访问。
  it.each([
    ['long Chinese', '企业全球加速专业订阅套餐（含高级模型与优先支持）'],
    ['long English', 'Enterprise Global Acceleration Subscription with Priority Support'],
    ['unbroken token', 'EnterpriseGlobalAccelerationSubscriptionWithPrioritySupport1234567890'],
  ])('keeps the full %s plan title accessible in a bounded two-line area', (_label, name) => {
    mountPlanCard('openai', { name })
    const title = screen.getByRole('heading', { level: 3 })

    expect(title.textContent).toBe(name)
    expect(title).toHaveAttribute('title', name)
  })

  it('keeps title, badge, price, description, and purchase action in separate bounded regions', () => {
    mountPlanCard('openai', {
      name: 'Enterprise Global Acceleration Subscription with Priority Support',
      price: 123.45,
      currency: 'USD',
      description: 'Includes advanced models and priority support.',
    })
    const title = screen.getByRole('heading', { level: 3 })
    const priceBlock = screen.getByTestId('plan-price-block')
    const validity = screen.getByTestId('plan-validity')

    // 标题与价格分属不同区域，徽章与有效期同一行
    expect(priceBlock.contains(title)).toBe(false)
    expect(priceBlock.contains(validity)).toBe(true)
    expect(validity.textContent).toContain('OpenAI')
    expect(validity.textContent).toContain('/ 30payment.days')
    expect(screen.getByTestId('plan-price').textContent).toBe('123.45')
    expect(screen.getByText('Includes advanced models and priority support.').tagName).toBe('P')
    expect(screen.getByRole('button').textContent).toBe('payment.subscribeNow')
  })

  it('keeps short plan titles compact and aligned', () => {
    mountPlanCard('openai', { name: 'Pro', description: '' })
    const title = screen.getByRole('heading', { level: 3 })

    expect(title.textContent).toBe('Pro')
    expect(title).toHaveAttribute('title', 'Pro')
    expect(screen.getByTestId('plan-validity').textContent).toContain('/ 30payment.days')
  })
})
