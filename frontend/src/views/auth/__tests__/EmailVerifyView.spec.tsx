import type { ReactNode } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import EmailVerifyView from '@/views/auth/EmailVerifyView'
import { useAppStore } from '@/stores/app'
import { useAuthStore, type PendingAuthSessionSummary } from '@/stores/auth'
import { fillOtp, flushPromises, renderAt } from './authTestUtils'
import { captchaControls, resetCaptchaControls } from './captchaStub'

const {
  pushMock,
  showSuccessMock,
  showErrorMock,
  registerMock,
  setTokenMock,
  setPendingAuthSessionMock,
  clearPendingAuthSessionMock,
  getPublicSettingsMock,
  sendVerifyCodeMock,
  sendPendingOAuthVerifyCodeMock,
  persistOAuthTokenContextMock,
  apiClientPostMock,
  authStoreState,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  showSuccessMock: vi.fn(),
  showErrorMock: vi.fn(),
  registerMock: vi.fn(),
  setTokenMock: vi.fn(),
  setPendingAuthSessionMock: vi.fn(),
  clearPendingAuthSessionMock: vi.fn(),
  getPublicSettingsMock: vi.fn(),
  sendVerifyCodeMock: vi.fn(),
  sendPendingOAuthVerifyCodeMock: vi.fn(),
  persistOAuthTokenContextMock: vi.fn(),
  apiClientPostMock: vi.fn(),
  authStoreState: {
    pendingAuthSession: null as null | {
      token: string
      token_field: 'pending_auth_token' | 'pending_oauth_token'
      provider: string
      redirect?: string
      adoption_required?: boolean
      suggested_display_name?: string
      suggested_avatar_url?: string
    }
  },
}))

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => pushMock,
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === 'auth.accountCreatedSuccess') {
        return `Account created for ${params?.siteName ?? 'Sub2API'}`
      }
      if (key === 'auth.emailDomainRegistrationLimit') {
        return '该邮箱域名无法注册新账户。请使用主流邮箱注册；如需使用企业邮箱，请联系客服添加域名白名单。'
      }
      return key
    },
    te: () => false,
    locale: 'en',
    setLocale: vi.fn(),
  }),
}))

vi.mock('@/layouts/AuthLayout', () => ({
  AuthFooter: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/captcha/CaptchaChallenge', async () => (await import('./captchaStub')).captchaModule)

vi.mock('@/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/api/auth')>('@/api/auth')
  return {
    ...actual,
    getPublicSettings: (...args: any[]) => getPublicSettingsMock(...args),
    sendVerifyCode: (...args: any[]) => sendVerifyCodeMock(...args),
    sendPendingOAuthVerifyCode: (...args: any[]) => sendPendingOAuthVerifyCodeMock(...args),
    persistOAuthTokenContext: (...args: any[]) => persistOAuthTokenContextMock(...args),
  }
})

vi.mock('@/api/client', () => ({
  apiClient: {
    post: (...args: any[]) => apiClientPostMock(...args),
  },
}))

/** 以 authStoreState.pendingAuthSession 作为认证状态挂载页面 */
function mountView() {
  useAuthStore.setState({
    pendingAuthSession: authStoreState.pendingAuthSession as PendingAuthSessionSummary | null,
    register: (...args: any[]) => registerMock(...args),
    setToken: (...args: any[]) => setTokenMock(...args),
    setPendingAuthSession: (...args: any[]) => setPendingAuthSessionMock(...args),
    clearPendingAuthSession: (...args: any[]) => clearPendingAuthSessionMock(...args),
  })
  return renderAt(<EmailVerifyView />, '/email-verify')
}

const submitButton = () => document.querySelector('button[type="submit"]')!

describe('EmailVerifyView', () => {
  beforeEach(() => {
    pushMock.mockReset()
    showSuccessMock.mockReset()
    showErrorMock.mockReset()
    registerMock.mockReset()
    setTokenMock.mockReset()
    setPendingAuthSessionMock.mockReset()
    clearPendingAuthSessionMock.mockReset()
    getPublicSettingsMock.mockReset()
    sendVerifyCodeMock.mockReset()
    sendPendingOAuthVerifyCodeMock.mockReset()
    persistOAuthTokenContextMock.mockReset()
    apiClientPostMock.mockReset()
    resetCaptchaControls()
    authStoreState.pendingAuthSession = null
    useAppStore.setState({
      showSuccess: (...args: any[]) => showSuccessMock(...args),
      showError: (...args: any[]) => showErrorMock(...args),
    })
    sessionStorage.clear()
    localStorage.clear()

    getPublicSettingsMock.mockResolvedValue({
      turnstile_enabled: false,
      turnstile_site_key: '',
      site_name: 'Sub2API',
      registration_email_suffix_whitelist: [],
    })
    sendVerifyCodeMock.mockResolvedValue({ countdown: 60 })
    sendPendingOAuthVerifyCodeMock.mockResolvedValue({ countdown: 60 })
    setTokenMock.mockResolvedValue({})
  })

  it('acquires a fresh Tencent proof for each resend action', async () => {
    getPublicSettingsMock.mockResolvedValue({
      turnstile_enabled: false,
      turnstile_site_key: '',
      tencent_captcha_enabled: true,
      tencent_captcha_app_id: 'tencent-app-id',
      site_name: 'Sub2API',
      registration_email_suffix_whitelist: [],
    })
    sendVerifyCodeMock.mockResolvedValue({ countdown: 0 })
    captchaControls.verifyAction
      .mockResolvedValueOnce({ token: 'ticket-1', randstr: '@rand-1' })
      .mockResolvedValueOnce({ token: 'ticket-2', randstr: '@rand-2' })
    sessionStorage.setItem(
      'register_data',
      JSON.stringify({
        email: 'fresh@example.com',
        password: 'secret-123',
        tencent_captcha_ticket: 'initial-ticket',
        tencent_captcha_randstr: '@initial-rand',
      })
    )

    mountView()

    await flushPromises()
    const resendButton = () => screen.getByRole('button', { name: 'auth.clickToResend' })

    fireEvent.click(resendButton())
    await flushPromises()
    fireEvent.click(resendButton())
    await flushPromises()

    expect(captchaControls.verifyAction).toHaveBeenCalledTimes(2)
    expect(sendVerifyCodeMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      tencent_captcha_ticket: 'ticket-1',
      tencent_captcha_randstr: '@rand-1',
    }))
    expect(sendVerifyCodeMock).toHaveBeenNthCalledWith(3, expect.objectContaining({
      tencent_captcha_ticket: 'ticket-2',
      tencent_captcha_randstr: '@rand-2',
    }))
  })

  it('uses the pending oauth verify-code endpoint when register data carries a pending auth session', async () => {
    authStoreState.pendingAuthSession = {
      token: 'pending-token-1',
      token_field: 'pending_auth_token',
      provider: 'wechat',
      redirect: '/profile',
    }
    sessionStorage.setItem(
      'register_data',
      JSON.stringify({
        email: 'fresh@example.com',
        password: 'secret-123',
      })
    )

    mountView()

    await flushPromises()

    expect(sendPendingOAuthVerifyCodeMock).toHaveBeenCalledWith({
      email: 'fresh@example.com',
      pending_auth_token: 'pending-token-1',
    })
    expect(sendVerifyCodeMock).not.toHaveBeenCalled()
  })

  it('requires a fresh captcha proof after the initial send-code request fails', async () => {
    getPublicSettingsMock.mockResolvedValue({
      turnstile_enabled: true,
      turnstile_site_key: 'site-key',
      site_name: 'Sub2API',
      registration_email_suffix_whitelist: [],
    })
    sendVerifyCodeMock.mockRejectedValue(new Error('send failed'))
    sessionStorage.setItem(
      'register_data',
      JSON.stringify({
        email: 'fresh@example.com',
        password: 'secret-123',
        turnstile_token: 'initial-proof',
      })
    )

    captchaControls.verifyButton = { testId: 'resend-captcha', token: 'fresh-proof' }
    mountView()

    await flushPromises()

    expect(sendVerifyCodeMock).toHaveBeenCalledWith(expect.objectContaining({
      turnstile_token: 'initial-proof',
    }))
    expect(screen.getByTestId('resend-captcha')).toBeInTheDocument()
  })

  it('skips the registration email suffix whitelist for pending oauth verification', async () => {
    authStoreState.pendingAuthSession = {
      token: 'pending-token-2',
      token_field: 'pending_auth_token',
      provider: 'oidc',
      redirect: '/profile',
    }
    getPublicSettingsMock.mockResolvedValue({
      turnstile_enabled: false,
      turnstile_site_key: '',
      site_name: 'Sub2API',
      registration_email_suffix_whitelist: ['allowed.com'],
    })
    sessionStorage.setItem(
      'register_data',
      JSON.stringify({
        email: 'fresh@example.com',
        password: 'secret-123',
      })
    )

    mountView()

    await flushPromises()

    expect(sendPendingOAuthVerifyCodeMock).toHaveBeenCalledWith({
      email: 'fresh@example.com',
      pending_auth_token: 'pending-token-2',
    })
    expect(showErrorMock).not.toHaveBeenCalled()
  })

  it('sends a verification code for a non-whitelist email domain', async () => {
    getPublicSettingsMock.mockResolvedValue({
      turnstile_enabled: false,
      turnstile_site_key: '',
      site_name: 'Sub2API',
      registration_email_suffix_whitelist: ['allowed.com'],
      registration_email_domain_quota_enabled: true,
    })
    sessionStorage.setItem(
      'register_data',
      JSON.stringify({
        email: 'first@custom.example',
        password: 'secret-123',
      })
    )

    mountView()

    await flushPromises()

    expect(sendVerifyCodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'first@custom.example' })
    )
    expect(showErrorMock).not.toHaveBeenCalled()
  })

  it('shows the localized domain quota message when sending a verification code is rejected', async () => {
    getPublicSettingsMock.mockResolvedValue({
      turnstile_enabled: false,
      turnstile_site_key: '',
      site_name: 'Sub2API',
      registration_email_suffix_whitelist: ['allowed.com'],
      registration_email_domain_quota_enabled: true,
    })
    sendVerifyCodeMock.mockRejectedValueOnce({
      reason: 'EMAIL_DOMAIN_REGISTRATION_LIMIT',
      message: 'raw backend message',
    })
    sessionStorage.setItem(
      'register_data',
      JSON.stringify({
        email: 'second@custom.example',
        password: 'secret-123',
      })
    )

    mountView()

    await flushPromises()

    expect(showErrorMock).toHaveBeenLastCalledWith(
      '该邮箱域名无法注册新账户。请使用主流邮箱注册；如需使用企业邮箱，请联系客服添加域名白名单。'
    )
  })

  it('shows the localized domain quota message when verified registration is rejected', async () => {
    getPublicSettingsMock.mockResolvedValue({
      turnstile_enabled: false,
      turnstile_site_key: '',
      site_name: 'Sub2API',
      registration_email_suffix_whitelist: ['allowed.com'],
      registration_email_domain_quota_enabled: true,
    })
    sessionStorage.setItem(
      'register_data',
      JSON.stringify({
        email: 'second@custom.example',
        password: 'secret-123',
      })
    )
    registerMock.mockRejectedValueOnce({
      reason: 'EMAIL_DOMAIN_REGISTRATION_LIMIT',
      message: 'raw backend message',
    })

    mountView()

    await flushPromises()
    fillOtp(screen.getByTestId('verify-code'), '123456')
    fireEvent.submit(document.querySelector('form')!)
    await flushPromises()

    expect(registerMock).toHaveBeenCalled()
    expect(showErrorMock).toHaveBeenLastCalledWith(
      '该邮箱域名无法注册新账户。请使用主流邮箱注册；如需使用企业邮箱，请联系客服添加域名白名单。'
    )
  })

  // 域名限量注册开关默认关闭：恢复 PR5423 之前的客户端白名单预检，非白名单域名不发送验证码。
  it('blocks sending a verification code for a non-whitelist email domain when the quota switch is disabled', async () => {
    getPublicSettingsMock.mockResolvedValue({
      turnstile_enabled: false,
      turnstile_site_key: '',
      site_name: 'Sub2API',
      registration_email_suffix_whitelist: ['allowed.com'],
    })
    sessionStorage.setItem(
      'register_data',
      JSON.stringify({
        email: 'first@custom.example',
        password: 'secret-123',
      })
    )

    mountView()

    await flushPromises()

    expect(sendVerifyCodeMock).not.toHaveBeenCalled()
    expect(showErrorMock).toHaveBeenCalledWith('auth.emailSuffixNotAllowedWithAllowed')
  })

  it('uses the pending oauth verify-code endpoint when auth store only carries the pending provider', async () => {
    authStoreState.pendingAuthSession = {
      token: '',
      token_field: 'pending_oauth_token',
      provider: 'oidc',
      redirect: '/profile',
    }
    getPublicSettingsMock.mockResolvedValue({
      turnstile_enabled: false,
      turnstile_site_key: '',
      site_name: 'Sub2API',
      registration_email_suffix_whitelist: ['allowed.com'],
    })
    sessionStorage.setItem(
      'register_data',
      JSON.stringify({
        email: 'fresh@example.com',
        password: 'secret-123',
      })
    )

    mountView()

    await flushPromises()

    expect(sendPendingOAuthVerifyCodeMock).toHaveBeenCalledWith({
      email: 'fresh@example.com',
      pending_oauth_token: undefined,
    })
    expect(sendVerifyCodeMock).not.toHaveBeenCalled()
    expect(showErrorMock).not.toHaveBeenCalled()
  })

  it('returns to the oauth callback flow when pending send-code detects an existing account email', async () => {
    authStoreState.pendingAuthSession = {
      token: '',
      token_field: 'pending_oauth_token',
      provider: 'oidc',
      redirect: '/profile/security',
    }
    getPublicSettingsMock.mockResolvedValue({
      turnstile_enabled: false,
      turnstile_site_key: '',
      site_name: 'Sub2API',
      registration_email_suffix_whitelist: ['allowed.com'],
    })
    sendPendingOAuthVerifyCodeMock.mockResolvedValue({
      auth_result: 'pending_session',
      provider: 'oidc',
      redirect: '/profile/security',
    })
    sessionStorage.setItem(
      'register_data',
      JSON.stringify({
        email: 'fresh@example.com',
        password: 'secret-123',
      })
    )

    mountView()

    await flushPromises()

    expect(setPendingAuthSessionMock).toHaveBeenCalledWith({
      token: '',
      token_field: 'pending_oauth_token',
      provider: 'oidc',
      redirect: '/profile/security',
    })
    expect(pushMock).toHaveBeenCalledWith('/auth/oidc/callback')
    expect(showErrorMock).not.toHaveBeenCalled()
  })

  it('submits pending auth account creation when session storage has no pending metadata but auth store does', async () => {
    authStoreState.pendingAuthSession = {
      token: 'pending-token-1',
      token_field: 'pending_auth_token',
      provider: 'wechat',
      redirect: '/profile',
    }
    sessionStorage.setItem(
      'register_data',
      JSON.stringify({
        email: 'fresh@example.com',
        password: 'secret-123',
        aff_code: 'AFF123',
      })
    )
    apiClientPostMock.mockResolvedValue({
      data: {
        access_token: 'oauth-access-token',
        refresh_token: 'oauth-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    })

    mountView()

    await flushPromises()
    fillOtp(screen.getByTestId('verify-code'), '123456')
    fireEvent.submit(document.querySelector('form')!)
    await flushPromises()

    expect(apiClientPostMock).toHaveBeenCalledWith('/auth/oauth/pending/create-account', {
      email: 'fresh@example.com',
      password: 'secret-123',
      verify_code: '123456',
      aff_code: 'AFF123',
    })
    expect(persistOAuthTokenContextMock).toHaveBeenCalledWith({
      access_token: 'oauth-access-token',
      refresh_token: 'oauth-refresh-token',
      expires_in: 3600,
      token_type: 'Bearer',
    })
    expect(setTokenMock).toHaveBeenCalledWith('oauth-access-token')
    expect(clearPendingAuthSessionMock).toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledWith('/profile')
    expect(registerMock).not.toHaveBeenCalled()
  })

  it('requires and submits a fresh turnstile token for pending oauth account creation', async () => {
    authStoreState.pendingAuthSession = {
      token: 'pending-token-3',
      token_field: 'pending_auth_token',
      provider: 'oidc',
      redirect: '/profile',
    }
    getPublicSettingsMock.mockResolvedValue({
      turnstile_enabled: true,
      turnstile_site_key: 'site-key',
      site_name: 'Sub2API',
      registration_email_suffix_whitelist: ['allowed.com'],
    })
    sessionStorage.setItem(
      'register_data',
      JSON.stringify({
        email: 'fresh@example.com',
        password: 'secret-123',
        turnstile_token: 'send-code-token',
      })
    )
    apiClientPostMock.mockResolvedValue({
      data: {
        access_token: 'oauth-access-token',
        refresh_token: 'oauth-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    })

    captchaControls.verifyButton = { testId: 'create-turnstile', token: 'create-token' }
    mountView()

    await flushPromises()

    expect(sendPendingOAuthVerifyCodeMock).toHaveBeenCalledWith({
      email: 'fresh@example.com',
      pending_auth_token: 'pending-token-3',
      turnstile_token: 'send-code-token',
    })

    fillOtp(screen.getByTestId('verify-code'), '123456')
    expect(submitButton()).toBeDisabled()

    fireEvent.click(screen.getByTestId('create-turnstile'))
    expect(submitButton()).not.toBeDisabled()

    fireEvent.submit(document.querySelector('form')!)
    await flushPromises()

    expect(apiClientPostMock).toHaveBeenCalledWith('/auth/oauth/pending/create-account', {
      email: 'fresh@example.com',
      password: 'secret-123',
      verify_code: '123456',
      turnstile_token: 'create-token',
    })
    expect(setTokenMock).toHaveBeenCalledWith('oauth-access-token')
  })

  it('resets the pending oauth create-account turnstile after submit failure', async () => {
    authStoreState.pendingAuthSession = {
      token: 'pending-token-4',
      token_field: 'pending_auth_token',
      provider: 'oidc',
      redirect: '/profile',
    }
    getPublicSettingsMock.mockResolvedValue({
      turnstile_enabled: true,
      turnstile_site_key: 'site-key',
      site_name: 'Sub2API',
      registration_email_suffix_whitelist: ['allowed.com'],
    })
    sessionStorage.setItem(
      'register_data',
      JSON.stringify({
        email: 'fresh@example.com',
        password: 'secret-123',
        turnstile_token: 'send-code-token',
      })
    )
    apiClientPostMock.mockRejectedValue(new Error('invalid verify code'))

    captchaControls.verifyButton = { testId: 'create-turnstile', token: 'create-token' }
    mountView()

    await flushPromises()
    fillOtp(screen.getByTestId('verify-code'), '123456')
    fireEvent.click(screen.getByTestId('create-turnstile'))
    expect(submitButton()).not.toBeDisabled()

    fireEvent.submit(document.querySelector('form')!)
    await flushPromises()

    expect(apiClientPostMock).toHaveBeenCalledWith('/auth/oauth/pending/create-account', {
      email: 'fresh@example.com',
      password: 'secret-123',
      verify_code: '123456',
      turnstile_token: 'create-token',
    })
    expect(captchaControls.reset).toHaveBeenCalled()
    expect(submitButton()).toBeDisabled()
  })

  it('returns to the oauth callback flow when pending account creation becomes bind-login', async () => {
    authStoreState.pendingAuthSession = {
      token: '',
      token_field: 'pending_oauth_token',
      provider: 'oidc',
      redirect: '/profile/security',
    }
    getPublicSettingsMock.mockResolvedValue({
      turnstile_enabled: false,
      turnstile_site_key: '',
      site_name: 'Sub2API',
      registration_email_suffix_whitelist: ['allowed.com'],
    })
    sessionStorage.setItem(
      'register_data',
      JSON.stringify({
        email: 'fresh@example.com',
        password: 'secret-123',
      })
    )
    apiClientPostMock.mockResolvedValue({
      data: {
        auth_result: 'pending_session',
        provider: 'oidc',
        step: 'bind_login_required',
        redirect: '/profile/security',
        email: 'fresh@example.com',
      },
    })

    mountView()

    await flushPromises()
    fillOtp(screen.getByTestId('verify-code'), '123456')
    fireEvent.submit(document.querySelector('form')!)
    await flushPromises()

    expect(apiClientPostMock).toHaveBeenCalledWith('/auth/oauth/pending/create-account', {
      email: 'fresh@example.com',
      password: 'secret-123',
      verify_code: '123456',
    })
    expect(setPendingAuthSessionMock).toHaveBeenCalledWith({
      token: '',
      token_field: 'pending_oauth_token',
      provider: 'oidc',
      redirect: '/profile/security',
    })
    expect(pushMock).toHaveBeenCalledWith('/auth/oidc/callback')
    expect(setTokenMock).not.toHaveBeenCalled()
    expect(persistOAuthTokenContextMock).not.toHaveBeenCalled()
    expect(clearPendingAuthSessionMock).not.toHaveBeenCalled()
    expect(showSuccessMock).not.toHaveBeenCalled()
  })

  it('keeps the normal email registration flow unchanged', async () => {
    sessionStorage.setItem(
      'register_data',
      JSON.stringify({
        email: 'normal@example.com',
        password: 'secret-456',
        promo_code: 'PROMO',
        invitation_code: 'INVITE',
      })
    )
    registerMock.mockResolvedValue({})

    mountView()

    await flushPromises()
    fillOtp(screen.getByTestId('verify-code'), '654321')
    fireEvent.submit(document.querySelector('form')!)
    await flushPromises()

    expect(registerMock).toHaveBeenCalledWith({
      email: 'normal@example.com',
      password: 'secret-456',
      verify_code: '654321',
      turnstile_token: undefined,
      tencent_captcha_ticket: undefined,
      tencent_captcha_randstr: undefined,
      promo_code: 'PROMO',
      invitation_code: 'INVITE',
    })
    expect(apiClientPostMock).not.toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledWith('/dashboard')
  })

  it('does not require another Tencent proof for final email registration', async () => {
    getPublicSettingsMock.mockResolvedValue({
      turnstile_enabled: false,
      turnstile_site_key: '',
      tencent_captcha_enabled: true,
      tencent_captcha_app_id: 'tencent-app-id',
      site_name: 'Sub2API',
      registration_email_suffix_whitelist: [],
    })
    sessionStorage.setItem(
      'register_data',
      JSON.stringify({
        email: 'normal@example.com',
        password: 'secret-456',
        tencent_captcha_ticket: 'send-code-ticket',
        tencent_captcha_randstr: '@send-code-rand',
      })
    )
    registerMock.mockResolvedValue({})

    mountView()

    await flushPromises()
    expect(sendVerifyCodeMock).toHaveBeenCalledWith(expect.objectContaining({
      tencent_captcha_ticket: 'send-code-ticket',
      tencent_captcha_randstr: '@send-code-rand',
    }))
    expect(JSON.parse(sessionStorage.getItem('register_data') || '{}')).toEqual({
      email: 'normal@example.com',
      password: 'secret-456',
    })

    fillOtp(screen.getByTestId('verify-code'), '654321')
    fireEvent.submit(document.querySelector('form')!)
    await flushPromises()

    expect(registerMock).toHaveBeenCalledWith(expect.objectContaining({
      email: 'normal@example.com',
      verify_code: '654321',
      tencent_captcha_ticket: undefined,
      tencent_captcha_randstr: undefined,
    }))
  })
})
