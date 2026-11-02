import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import ProfileInfoCard, { type ProfileInfoCardProps } from '@/components/user/profile/ProfileInfoCard'
import type { User } from '@/types'

const i18n = vi.hoisted(() => ({
  t: (key: string, params?: Record<string, string>) => {
    if (key === 'profile.accountBalance') return 'Account Balance'
    if (key === 'profile.concurrencyLimit') return 'Concurrency Limit'
    if (key === 'profile.memberSince') return 'Member Since'
    if (key === 'profile.administrator') return 'Administrator'
    if (key === 'profile.user') return 'User'
    if (key === 'profile.authBindings.providers.email') return 'Email'
    if (key === 'profile.authBindings.providers.linuxdo') return 'LinuxDo'
    if (key === 'profile.authBindings.providers.dingtalk') return 'DingTalk'
    if (key === 'profile.authBindings.providers.wechat') return 'WeChat'
    if (key === 'profile.authBindings.providers.oidc') return params?.providerName || 'OIDC'
    if (key === 'profile.authBindings.source.avatar') {
      return `Avatar synced from ${params?.providerName || 'provider'}`
    }
    if (key === 'profile.authBindings.source.username') {
      return `Username synced from ${params?.providerName || 'provider'}`
    }
    return key
  },
  te: () => true,
  locale: 'en'
}))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

function createUser(overrides: Partial<User> = {}): User {
  return {
    id: 5,
    username: 'alice',
    email: 'alice@example.com',
    avatar_url: null,
    role: 'user',
    balance: 10,
    concurrency: 2,
    status: 'active',
    allowed_groups: null,
    balance_notify_enabled: true,
    balance_notify_threshold: null,
    balance_notify_extra_emails: [],
    created_at: '2026-04-20T00:00:00Z',
    updated_at: '2026-04-20T00:00:00Z',
    ...overrides
  }
}

function mountCard(props: ProfileInfoCardProps) {
  return render(
    <MemoryRouter initialEntries={['/profile']}>
      <ProfileInfoCard {...props} />
    </MemoryRouter>
  )
}

describe('ProfileInfoCard', () => {
  it.each([
    { avatar_source: 'dingtalk', username_source: 'dingtalk' },
    { profile_sources: { avatar: { provider: 'dingtalk' }, username: { provider: 'dingtalk' } } }
  ])('shows DingTalk as the synchronized profile source', (sources) => {
    const { container, unmount } = mountCard({ user: createUser(sources as Partial<User>), dingtalkEnabled: true })
    expect(container.textContent).toContain('Avatar synced from DingTalk')
    expect(container.textContent).toContain('Username synced from DingTalk')
    unmount()
  })

  it('renders basic account information inside the new overview shell', () => {
    const { container } = mountCard({ user: createUser() })

    expect(container.textContent).toContain('alice@example.com')
    expect(container.textContent).toContain('alice')
    expect(container.textContent).toContain('User')
    expect(screen.getByTestId('profile-basics-panel')).toBeInTheDocument()
    expect(screen.getByTestId('profile-auth-bindings-panel')).toBeInTheDocument()
  })

  it('renders third-party source hints from profile sources', () => {
    const { container } = mountCard({
      user: createUser({
        avatar_url: 'https://cdn.example.com/linuxdo.png',
        profile_sources: {
          avatar: { provider: 'linuxdo', source: 'linuxdo' },
          username: { provider: 'linuxdo', source: 'linuxdo' }
        }
      })
    })

    expect(container.textContent).toContain('Avatar synced from LinuxDo')
    expect(container.textContent).toContain('Username synced from LinuxDo')
  })

  it('uses the configured OIDC provider name in source hints', () => {
    const { container } = mountCard({
      user: createUser({ profile_sources: { username: { provider: 'oidc', source: 'oidc' } } }),
      oidcProviderName: 'ExampleID'
    })

    expect(container.textContent).toContain('Username synced from ExampleID')
  })

  it('does not display synthetic oauth-only emails as a real bound email', () => {
    const { container } = mountCard({
      user: createUser({
        email: 'legacy-user@oidc-connect.invalid',
        email_bound: false,
        auth_bindings: { email: { bound: false } }
      })
    })

    expect(container.textContent).not.toContain('legacy-user@oidc-connect.invalid')
  })

  it('does not display synthetic oauth-only emails when only legacy identity bindings mark email as unbound', () => {
    const { container } = mountCard({
      user: createUser({
        email: 'legacy-user@wechat-connect.invalid',
        identity_bindings: { email: { bound: false } }
      })
    })

    expect(container.textContent).not.toContain('legacy-user@wechat-connect.invalid')
  })

  it('renders the approved overview hero and two-column content shell', () => {
    mountCard({ user: createUser() })

    expect(screen.getByTestId('profile-overview-hero').textContent).toContain('alice@example.com')
    expect(screen.getByTestId('profile-overview-metric-balance').textContent).toContain('Account Balance')
    expect(screen.getByTestId('profile-overview-metric-concurrency').textContent).toContain('Concurrency Limit')
    expect(screen.getByTestId('profile-overview-metric-member-since').textContent).toContain('Member Since')
    expect(screen.queryByTestId('profile-info-summary-grid')).toBeNull()
    expect(screen.getByTestId('profile-main-column')).toBeInTheDocument()
    expect(screen.getByTestId('profile-side-column')).toBeInTheDocument()
    expect(screen.getByTestId('profile-basics-panel')).toBeInTheDocument()
    expect(screen.getByTestId('profile-auth-bindings-panel')).toBeInTheDocument()
  })
})
