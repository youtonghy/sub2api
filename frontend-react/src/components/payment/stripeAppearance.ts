import type { Appearance } from '@stripe/stripe-js'

/** Stripe Elements 外观：<html data-theme="dark"> 时使用 night 主题（Vue 版读取 html.dark 类） */
export function stripeAppearance(): Appearance {
  const isDark = document.documentElement.dataset.theme === 'dark'
  return { theme: isDark ? 'night' : 'stripe', variables: { borderRadius: '8px' } }
}
