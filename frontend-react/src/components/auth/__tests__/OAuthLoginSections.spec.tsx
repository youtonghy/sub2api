import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DingTalkOAuthSection from '@/components/auth/DingTalkOAuthSection'
import LinuxDoOAuthSection from '@/components/auth/LinuxDoOAuthSection'
import OidcOAuthSection from '@/components/auth/OidcOAuthSection'
import { renderAt } from '@/views/auth/__tests__/authTestUtils'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: 'en', setLocale: vi.fn() })
}))

const route = '/login?redirect=%2Fbilling%3Fplan%3Dpro&aff=AFF123'

describe('OAuth login sections', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it.each([
    ['linuxdo', LinuxDoOAuthSection],
    ['dingtalk', DingTalkOAuthSection],
    ['oidc', OidcOAuthSection]
  ] as const)('emits a %s start request from the original button', (provider, Component) => {
    const originalHref = window.location.href
    const onStart = vi.fn()
    renderAt(<Component affCode="AFF456" onStart={onStart} />, route)

    fireEvent.click(screen.getByRole('button'))

    expect(onStart.mock.calls[0]?.[0]).toEqual({
      provider,
      params: { redirect: '/billing?plan=pro' }
    })
    expect(window.sessionStorage.getItem('oauth_aff_code')).toBe('AFF456')
    expect(window.location.href).toBe(originalHref)
  })

  it('includes a trimmed promo code in the LinuxDo OAuth request', () => {
    const onStart = vi.fn()
    renderAt(<LinuxDoOAuthSection affCode="AFF456" promoCode=" PROMO789 " onStart={onStart} />, route)

    fireEvent.click(screen.getByRole('button'))

    expect(onStart.mock.calls[0]?.[0]).toEqual({
      provider: 'linuxdo',
      params: {
        redirect: '/billing?plan=pro',
        promo_code: 'PROMO789'
      }
    })
  })
})
