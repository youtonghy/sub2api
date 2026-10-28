import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import EmailOAuthButtons from '@/components/auth/EmailOAuthButtons'
import { renderAt } from '@/views/auth/__tests__/authTestUtils'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === 'auth.emailOAuth.signIn') {
        return `使用 ${params?.providerName ?? ''} 登录`
      }
      return key
    },
    te: () => false,
    locale: 'en',
    setLocale: vi.fn(),
  }),
}))

const route = '/login?redirect=%2Fbilling%3Fplan%3Dpro&aff=AFF123'

describe('EmailOAuthButtons', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('emits the GitHub OAuth request with redirect and affiliate parameters', () => {
    const onStart = vi.fn()
    renderAt(<EmailOAuthButtons githubEnabled googleEnabled={false} promoCode=" PROMO123 " onStart={onStart} />, route)

    fireEvent.click(screen.getByRole('button'))

    expect(onStart.mock.calls).toEqual([[
      {
        provider: 'github',
        params: { redirect: '/billing?plan=pro', aff_code: 'AFF123', promo_code: 'PROMO123' }
      }
    ]])
    expect(window.sessionStorage.getItem('oauth_aff_code')).toBe('AFF123')
    expect(window.sessionStorage.getItem('email_oauth_pending_provider')).toBe('github')
  })

  it('emits the Google provider without navigating directly', () => {
    const originalHref = window.location.href
    const onStart = vi.fn()
    renderAt(<EmailOAuthButtons githubEnabled={false} googleEnabled promoCode="PROMO456" onStart={onStart} />, route)

    fireEvent.click(screen.getByRole('button'))

    expect(onStart.mock.calls[0]?.[0]).toEqual({
      provider: 'google',
      params: { redirect: '/billing?plan=pro', aff_code: 'AFF123', promo_code: 'PROMO456' }
    })
    expect(window.location.href).toBe(originalHref)
  })

  it('omits an empty promo code from the OAuth request', () => {
    const onStart = vi.fn()
    renderAt(<EmailOAuthButtons githubEnabled googleEnabled={false} promoCode="   " onStart={onStart} />, route)

    fireEvent.click(screen.getByRole('button'))

    expect(onStart.mock.calls[0]?.[0]).toEqual({
      provider: 'github',
      params: { redirect: '/billing?plan=pro', aff_code: 'AFF123' }
    })
  })

  it('uses a full-width descriptive button when only GitHub is enabled', () => {
    const { container } = renderAt(<EmailOAuthButtons githubEnabled googleEnabled={false} onStart={vi.fn()} />, route)

    expect(container.querySelector('[data-columns]')).toHaveAttribute('data-columns', '1')
    expect(screen.getByRole('button').textContent).toContain('使用 GitHub 登录')
  })

  it('uses compact labels and two columns when GitHub and Google are both enabled', () => {
    const { container } = renderAt(<EmailOAuthButtons githubEnabled googleEnabled onStart={vi.fn()} />, route)

    expect(container.querySelector('[data-columns]')).toHaveAttribute('data-columns', '2')
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].textContent).toContain('GitHub')
    expect(buttons[0].textContent).not.toContain('使用 GitHub 登录')
    expect(buttons[1].textContent).toContain('Google')
    expect(buttons[1].textContent).not.toContain('使用 Google 登录')
  })
})
