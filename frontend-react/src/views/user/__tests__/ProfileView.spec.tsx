import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { User } from '@/types'
import ProfileView from '@/views/user/ProfileView'

const mocks = vi.hoisted(() => ({ fetchPublicSettings: vi.fn(), refreshUser: vi.fn() }))

vi.mock('@/utils/format', () => ({ formatDate: () => 'April 2026' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
vi.mock('@/components/common/StatCard', () => ({ default: () => <div className="stat-card" /> }))
vi.mock('@/components/user/profile/ProfileInfoCard', () => ({ default: () => <div data-testid="profile-info-card" /> }))
vi.mock('@/components/user/profile/ProfileBalanceNotifyCard', () => ({
  default: () => <div data-testid="profile-balance-notify-card" />
}))
vi.mock('@/components/user/profile/ProfilePasswordForm', () => ({
  default: () => <div data-testid="profile-password-form" />
}))
vi.mock('@/components/user/profile/ProfileTotpCard', () => ({ default: () => <div data-testid="profile-totp-card" /> }))
vi.mock('@/components/user/profile/ProfilePasskeyCard', () => ({ default: () => null }))

describe('ProfileView', () => {
  beforeEach(() => {
    mocks.refreshUser.mockReset().mockResolvedValue(undefined)
    mocks.fetchPublicSettings.mockReset().mockResolvedValue({
      contact_info: '',
      balance_low_notify_enabled: false,
      balance_low_notify_threshold: 0,
      linuxdo_oauth_enabled: true,
      wechat_oauth_enabled: true,
      wechat_oauth_open_enabled: true,
      wechat_oauth_mp_enabled: false,
      oidc_oauth_enabled: true,
      oidc_oauth_provider_name: 'OIDC'
    })
    useAuthStore.setState({
      refreshUser: mocks.refreshUser,
      user: {
        id: 1,
        username: 'alice',
        email: 'alice@example.com',
        role: 'user',
        balance: 10,
        concurrency: 2,
        status: 'active',
        allowed_groups: null,
        balance_notify_enabled: true,
        balance_notify_threshold: null,
        balance_notify_extra_emails: [],
        created_at: '2026-04-20T00:00:00Z',
        updated_at: '2026-04-20T00:00:00Z'
      } as User
    })
    useAppStore.setState({ fetchPublicSettings: mocks.fetchPublicSettings })
  })

  it('renders the simplified single-column profile shell without separate stat cards', async () => {
    const { container } = render(<ProfileView />)
    await act(async () => {})

    expect(container.querySelectorAll('.stat-card')).toHaveLength(0)
    const shell = screen.getByTestId('profile-shell')
    expect(shell.innerHTML).toContain('profile-info-card')
    expect(shell.innerHTML).toContain('profile-password-form')
    expect(shell.innerHTML).toContain('profile-totp-card')
  })
})
