import type { ReactNode } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RegisterView from '@/views/auth/RegisterView'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { PublicSettings } from '@/types'
import { flushPromises, renderAt, setValue } from './authTestUtils'
import { captchaControls, resetCaptchaControls } from './captchaStub'

const { getPublicSettingsMock, registerMock, showErrorMock, pushMock } = vi.hoisted(() => ({
  getPublicSettingsMock: vi.fn(),
  registerMock: vi.fn(),
  showErrorMock: vi.fn(),
  pushMock: vi.fn()
}))

const publicSettings = {
  registration_enabled: true,
  email_verify_enabled: false,
  promo_code_enabled: false,
  invitation_code_enabled: false,
  affiliate_enabled: true,
  turnstile_enabled: true,
  turnstile_site_key: 'site-key',
  site_name: 'Sub2API',
  registration_email_suffix_whitelist: [],
  linuxdo_oauth_enabled: false,
  wechat_oauth_enabled: false,
  oidc_oauth_enabled: false,
  github_oauth_enabled: false,
  google_oauth_enabled: false
}

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => pushMock
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) =>
      key === 'auth.emailDomainRegistrationLimit'
        ? '该邮箱域名无法注册新账户。请使用主流邮箱注册；如需使用企业邮箱，请联系客服添加域名白名单。'
        : key,
    te: () => false,
    locale: 'en',
    setLocale: vi.fn()
  })
}))

vi.mock('@/layouts/AuthLayout', () => ({
  AuthFooter: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/components/captcha/CaptchaChallenge', async () => (await import('./captchaStub')).captchaModule)

vi.mock('@/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/api/auth')>('@/api/auth')
  return {
    ...actual,
    getPublicSettings: (...args: unknown[]) => getPublicSettingsMock(...args)
  }
})

function mountRegister() {
  return renderAt(<RegisterView />, '/register')
}

const field = (id: string) => document.getElementById(id)!

async function submit() {
  fireEvent.submit(document.querySelector('form')!)
  await flushPromises()
}

describe('RegisterView', () => {
  beforeEach(() => {
    getPublicSettingsMock.mockReset()
    registerMock.mockReset()
    showErrorMock.mockReset()
    pushMock.mockReset()
    resetCaptchaControls()
    useAuthStore.setState({ register: registerMock })
    useAppStore.setState({
      cachedPublicSettings: null,
      showError: showErrorMock,
      showSuccess: vi.fn(),
      showWarning: vi.fn()
    })
    sessionStorage.removeItem('register_data')
    captchaControls.verifyAction.mockResolvedValue({ token: 'ticket', randstr: 'randstr' })
    getPublicSettingsMock.mockResolvedValue(publicSettings)
    registerMock.mockResolvedValue({})
  })

  it('does not flash the promo-code field before disabled settings finish loading', async () => {
    let resolveSettings!: (settings: typeof publicSettings) => void
    getPublicSettingsMock.mockReturnValueOnce(
      new Promise<typeof publicSettings>((resolve) => {
        resolveSettings = resolve
      })
    )

    mountRegister()

    expect(document.getElementById('promo_code')).toBeNull()

    resolveSettings(publicSettings)
    await flushPromises()

    expect(document.getElementById('promo_code')).toBeNull()
  })

  it('uses injected public settings to show an enabled promo-code field on first render', () => {
    useAppStore.setState({ cachedPublicSettings: { promo_code_enabled: true } as PublicSettings })
    getPublicSettingsMock.mockReturnValueOnce(new Promise(() => {}))

    mountRegister()

    expect(document.getElementById('promo_code')).not.toBeNull()
  })

  it.each([
    ['', 'auth.confirmPasswordRequired'],
    ['different-password', 'auth.passwordsDoNotMatch']
  ])('blocks invalid confirmation %j before captcha and allows correction', async (confirmation, error) => {
    getPublicSettingsMock.mockResolvedValueOnce({
      ...publicSettings,
      turnstile_enabled: false,
      tencent_captcha_enabled: true,
      tencent_captcha_app_id: 'app-id'
    })
    mountRegister()
    await flushPromises()
    setValue(field('email'), 'user@example.com')
    setValue(field('password'), 'secret-123')
    setValue(field('confirmPassword'), confirmation)
    await submit()

    expect(showErrorMock).toHaveBeenCalledWith(error)
    expect(field('confirmPassword')).toHaveAttribute('aria-invalid', 'true')
    expect(registerMock).not.toHaveBeenCalled()
    expect(captchaControls.verifyAction).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('register_data')).toBeNull()

    setValue(field('confirmPassword'), 'secret-123')
    await submit()

    expect(field('confirmPassword')).not.toHaveAttribute('aria-invalid')
    expect(captchaControls.verifyAction).toHaveBeenCalledOnce()
    expect(registerMock).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'secret-123',
      turnstile_token: undefined,
      tencent_captcha_ticket: 'ticket',
      tencent_captcha_randstr: 'randstr',
      promo_code: undefined,
      invitation_code: undefined
    })
    expect(pushMock).toHaveBeenCalledWith('/dashboard')
  })

  it('requires matching confirmation before storing only the registration fields for email verification', async () => {
    getPublicSettingsMock.mockResolvedValueOnce({
      ...publicSettings,
      turnstile_enabled: false,
      email_verify_enabled: true
    })
    mountRegister()
    await flushPromises()
    setValue(field('email'), 'user@example.com')
    setValue(field('password'), 'secret-123')
    setValue(field('confirmPassword'), 'different-password')
    await submit()

    expect(sessionStorage.getItem('register_data')).toBeNull()
    expect(pushMock).not.toHaveBeenCalled()

    setValue(field('confirmPassword'), 'secret-123')
    await submit()

    expect(JSON.parse(sessionStorage.getItem('register_data')!)).toEqual({
      email: 'user@example.com',
      password: 'secret-123'
    })
    expect(pushMock).toHaveBeenCalledWith('/email-verify')
    expect(registerMock).not.toHaveBeenCalled()
  })

  it('keeps the optional affiliate invitation field before Turnstile', async () => {
    mountRegister()
    await flushPromises()

    const invitationField = screen.getByTestId('affiliate-invitation-field')
    const turnstile = screen.getByTestId('registration-turnstile')

    expect(invitationField.querySelector('input')?.getAttribute('id')).toBe('affiliate_code')
    expect(invitationField.textContent).toContain('common.optional')
    expect(
      invitationField.compareDocumentPosition(turnstile) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('uses the mandatory invitation field without duplicating the affiliate field', async () => {
    getPublicSettingsMock.mockResolvedValueOnce({
      ...publicSettings,
      invitation_code_enabled: true
    })

    mountRegister()
    await flushPromises()

    expect(screen.queryByTestId('affiliate-invitation-field')).toBeNull()
    expect(document.getElementById('invitation_code')).not.toBeNull()
  })

  it('submits a non-whitelist email domain so the backend can enforce its registration quota', async () => {
    getPublicSettingsMock.mockResolvedValueOnce({
      ...publicSettings,
      turnstile_enabled: false,
      registration_email_suffix_whitelist: ['allowed.com'],
      registration_email_domain_quota_enabled: true
    })

    mountRegister()
    await flushPromises()
    setValue(field('email'), 'first@custom.example')
    setValue(field('password'), 'secret-123')
    setValue(field('confirmPassword'), 'secret-123')
    await submit()

    expect(registerMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'first@custom.example' })
    )
    expect(showErrorMock).not.toHaveBeenCalled()
  })

  it('shows the localized registration domain quota message returned by the backend', async () => {
    getPublicSettingsMock.mockResolvedValueOnce({
      ...publicSettings,
      turnstile_enabled: false,
      registration_email_suffix_whitelist: ['allowed.com'],
      registration_email_domain_quota_enabled: true
    })
    registerMock.mockRejectedValueOnce({
      reason: 'EMAIL_DOMAIN_REGISTRATION_LIMIT',
      message: 'raw backend message'
    })

    mountRegister()
    await flushPromises()
    setValue(field('email'), 'second@custom.example')
    setValue(field('password'), 'secret-123')
    setValue(field('confirmPassword'), 'secret-123')
    await submit()

    expect(showErrorMock).toHaveBeenCalledWith(
      '该邮箱域名无法注册新账户。请使用主流邮箱注册；如需使用企业邮箱，请联系客服添加域名白名单。'
    )
  })

  // 域名限量注册开关默认关闭：恢复 PR5423 之前的客户端白名单预检，非白名单域名不发起注册请求。
  it('rejects a non-whitelist email domain locally when the domain quota switch is disabled', async () => {
    getPublicSettingsMock.mockResolvedValueOnce({
      ...publicSettings,
      turnstile_enabled: false,
      registration_email_suffix_whitelist: ['allowed.com']
    })

    mountRegister()
    await flushPromises()
    setValue(field('email'), 'first@custom.example')
    setValue(field('password'), 'secret-123')
    setValue(field('confirmPassword'), 'secret-123')
    await submit()

    expect(registerMock).not.toHaveBeenCalled()
    // 校验失败通过 validationToastMessage 弹 toast
    expect(showErrorMock).toHaveBeenCalledWith('auth.emailSuffixNotAllowedWithAllowed')
    expect(field('email')).toHaveAttribute('aria-invalid', 'true')
  })

  it('still submits whitelisted email domains when the domain quota switch is disabled', async () => {
    getPublicSettingsMock.mockResolvedValueOnce({
      ...publicSettings,
      turnstile_enabled: false,
      registration_email_suffix_whitelist: ['allowed.com']
    })

    mountRegister()
    await flushPromises()
    setValue(field('email'), 'user@allowed.com')
    setValue(field('password'), 'secret-123')
    setValue(field('confirmPassword'), 'secret-123')
    await submit()

    expect(registerMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'user@allowed.com' })
    )
    expect(showErrorMock).not.toHaveBeenCalled()
  })
})
