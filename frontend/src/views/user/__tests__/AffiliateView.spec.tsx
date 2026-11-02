import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { copyToClipboard, getAffiliateDetail } = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  getAffiliateDetail: vi.fn()
}))

vi.mock('@/api/user', () => ({
  default: {
    getAffiliateDetail,
    transferAffiliateQuota: vi.fn()
  }
}))
vi.mock('@/stores/app', () => {
  const state = { showError: vi.fn(), showSuccess: vi.fn() }
  return {
    useAppStore: Object.assign((selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state), {
      getState: () => state
    })
  }
})
vi.mock('@/stores/auth', () => {
  const state = { refreshUser: vi.fn() }
  return {
    useAuthStore: Object.assign((selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state), {
      getState: () => state
    })
  }
})
vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({ copyToClipboard })
}))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

import AffiliateView from '../AffiliateView'
import styles from '../AffiliateView.module.css'

const flushPromises = () => act(async () => {})

afterEach(cleanup)

describe('AffiliateView', () => {
  const affiliateCode = 'affiliate-code-that-is-long-enough-to-overflow-a-mobile-viewport'

  beforeEach(() => {
    vi.clearAllMocks()
    copyToClipboard.mockResolvedValue(true)
    getAffiliateDetail.mockResolvedValue({
      user_id: 1,
      aff_code: affiliateCode,
      inviter_id: null,
      aff_count: 0,
      aff_quota: 0,
      aff_frozen_quota: 0,
      aff_history_quota: 0,
      effective_rebate_rate_percent: 10,
      invitees: []
    })
  })

  // Vue 版断言 Tailwind 类（flex-col → sm:flex-row 等）；这里断言承载同一响应式规则的 CSS Module 类：
  // .copyRow 手机纵向堆叠、≥640px 横排，.value 可断行且宽屏截断，.copyButton 手机满宽、宽屏自适应。
  it('stacks long values and copy controls on mobile while retaining desktop rows', async () => {
    const { container } = render(<AffiliateView />)

    await flushPromises()

    const values = Array.from(container.querySelectorAll('code'))
    expect(values).toHaveLength(2)
    for (const value of values) {
      expect(styles.value).toBeTruthy()
      expect(value).toHaveClass(styles.value)
      expect(value.parentElement).toHaveClass(styles.copyRow)
    }

    const copyButtons = screen
      .getAllByRole('button')
      .filter((button) => ['affiliate.copyCode', 'affiliate.copyLink'].includes(button.textContent?.trim() ?? ''))
    expect(copyButtons).toHaveLength(2)
    for (const button of copyButtons) {
      expect(button).toHaveClass(styles.copyButton)
    }

    await act(async () => {
      fireEvent.click(copyButtons[0])
    })
    await act(async () => {
      fireEvent.click(copyButtons[1])
    })
    await flushPromises()

    expect(copyToClipboard).toHaveBeenNthCalledWith(1, affiliateCode, 'affiliate.codeCopied')
    expect(copyToClipboard).toHaveBeenNthCalledWith(
      2,
      `${window.location.origin}/register?aff=${encodeURIComponent(affiliateCode)}`,
      'affiliate.linkCopied'
    )
  })
})
