import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import WechatOAuthSection from '@/components/auth/WechatOAuthSection'
import { useAppStore } from '@/stores/app'
import type { PublicSettings } from '@/types'
import { pageText, renderAt } from '@/views/auth/__tests__/authTestUtils'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    locale: 'en',
    te: () => false,
    setLocale: vi.fn(),
    t: (key: string, params?: Record<string, string>) => {
      if (key === 'auth.wechatProviderName') {
        return 'Mock WeChat'
      }
      if (key === 'auth.oidc.signIn') {
        return `Continue with ${params?.providerName ?? ''}`.trim()
      }
      if (key === 'auth.oauthFlow.wechatSystemBrowserOnly') {
        return 'MOCK-SYSTEM-BROWSER-ONLY'
      }
      if (key === 'auth.oauthFlow.wechatBrowserOnly') {
        return 'MOCK-WECHAT-BROWSER-ONLY'
      }
      if (key === 'auth.oauthFlow.wechatNotConfigured') {
        return 'MOCK-NOT-CONFIGURED'
      }
      if (key === 'auth.oauthOrContinue') {
        return 'or continue'
      }
      return key
    },
  }),
}))

type WeChatPublicSettings = PublicSettings & {
  wechat_oauth_open_enabled?: boolean
  wechat_oauth_mp_enabled?: boolean
}

function buildPublicSettings(overrides: Partial<WeChatPublicSettings> = {}): WeChatPublicSettings {
  return {
    registration_enabled: true,
    email_verify_enabled: false,
    force_email_on_third_party_signup: false,
    registration_email_suffix_whitelist: [],
    promo_code_enabled: true,
    password_reset_enabled: false,
    invitation_code_enabled: false,
    turnstile_enabled: false,
    turnstile_site_key: '',
    site_name: 'Sub2API',
    site_logo: '',
    site_subtitle: '',
    api_base_url: '/api/v1',
    contact_info: '',
    doc_url: '',
    home_content: '',
    compact_home_enabled: false,
    hide_ccs_import_button: false,
    payment_enabled: false,
    table_default_page_size: 20,
    table_page_size_options: [10, 20, 50, 100],
    custom_menu_items: [],
    custom_endpoints: [],
    linuxdo_oauth_enabled: false,
    wechat_oauth_enabled: true,
    oidc_oauth_enabled: false,
    oidc_oauth_provider_name: 'OIDC',
    backend_mode_enabled: false,
    version: 'test',
    balance_low_notify_enabled: false,
    account_quota_notify_enabled: false,
    balance_low_notify_threshold: 0,
    ...overrides,
  }
}

function seedPublicSettings(overrides: Partial<WeChatPublicSettings> = {}): void {
  useAppStore.setState({
    cachedPublicSettings: buildPublicSettings(overrides),
    publicSettingsLoaded: true,
  })
}

function mountSection(onStart: (request: unknown) => void) {
  return renderAt(<WechatOAuthSection onStart={onStart} />, '/login?redirect=%2Fbilling%3Fplan%3Dpro')
}

describe('WechatOAuthSection', () => {
  beforeEach(() => {
    useAppStore.setState({ cachedPublicSettings: null, publicSettingsLoaded: false, fetchPublicSettings: vi.fn() })
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts the open WeChat OAuth flow with the current redirect target when open mode is configured', async () => {
    seedPublicSettings({
      wechat_oauth_open_enabled: true,
      wechat_oauth_mp_enabled: false,
    })
    const onStart = vi.fn()
    mountSection(onStart)

    expect(pageText()).toContain('Mock WeChat')

    fireEvent.click(screen.getByRole('button'))

    expect(onStart.mock.calls[0]?.[0]).toEqual({
      provider: 'wechat',
      params: { mode: 'open', redirect: '/billing?plan=pro' }
    })
  })

  it('uses mp mode inside the WeChat browser when mp mode is configured', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 MicroMessenger',
    })
    seedPublicSettings({
      wechat_oauth_open_enabled: false,
      wechat_oauth_mp_enabled: true,
    })
    const onStart = vi.fn()
    mountSection(onStart)

    fireEvent.click(screen.getByRole('button'))

    expect(onStart.mock.calls[0]?.[0]).toEqual({
      provider: 'wechat',
      params: { mode: 'mp', redirect: '/billing?plan=pro' }
    })
  })

  it('disables the button outside the WeChat browser when only mp mode is configured', async () => {
    seedPublicSettings({
      wechat_oauth_open_enabled: false,
      wechat_oauth_mp_enabled: true,
    })
    const onStart = vi.fn()
    mountSection(onStart)

    expect(screen.getByRole('button')).toBeDisabled()
    expect(pageText()).toContain('MOCK-WECHAT-BROWSER-ONLY')

    fireEvent.click(screen.getByRole('button'))

    expect(onStart).not.toHaveBeenCalled()
  })

  it('disables the button inside the WeChat browser when only open mode is configured', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 MicroMessenger',
    })
    seedPublicSettings({
      wechat_oauth_open_enabled: true,
      wechat_oauth_mp_enabled: false,
    })
    const onStart = vi.fn()
    mountSection(onStart)

    expect(screen.getByRole('button')).toBeDisabled()
    expect(pageText()).toContain('MOCK-SYSTEM-BROWSER-ONLY')

    fireEvent.click(screen.getByRole('button'))

    expect(onStart).not.toHaveBeenCalled()
  })

  it('uses the legacy overall enabled flag when per-mode settings are not present', async () => {
    seedPublicSettings({
      wechat_oauth_enabled: true,
    })
    const onStart = vi.fn()
    mountSection(onStart)

    fireEvent.click(screen.getByRole('button'))

    expect(onStart.mock.calls[0]?.[0]).toEqual({
      provider: 'wechat',
      params: { mode: 'open', redirect: '/billing?plan=pro' }
    })
  })

  it('shows the localized not-configured hint when WeChat OAuth is unavailable', async () => {
    seedPublicSettings({
      wechat_oauth_enabled: false,
      wechat_oauth_open_enabled: false,
      wechat_oauth_mp_enabled: false,
    })

    const onStart = vi.fn()
    mountSection(onStart)

    expect(pageText()).toContain('MOCK-NOT-CONFIGURED')
  })
})
