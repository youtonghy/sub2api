import type { ReactNode } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LoginView from '@/views/auth/LoginView'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { flushPromises, renderAt, setValue } from './authTestUtils'
import { captchaControls, resetCaptchaControls } from './captchaStub'

const { loginMock, loginWithPasskeyMock, getPublicSettingsMock, startOAuthLoginMock, locationState } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  loginWithPasskeyMock: vi.fn(),
  getPublicSettingsMock: vi.fn(),
  startOAuthLoginMock: vi.fn(),
  locationState: { href: 'http://localhost/login' }
}))

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => vi.fn()
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: 'en', setLocale: vi.fn() })
}))

vi.mock('@/layouts/AuthLayout', () => ({
  AuthFooter: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/components/captcha/CaptchaChallenge', async () => (await import('./captchaStub')).captchaModule)

// 对应 Vue spec 的 OAuthButtonStub：点击即发起 GitHub 登录请求
vi.mock('@/components/auth/EmailOAuthButtons', () => ({
  default: ({ onStart }: { onStart: (request: unknown) => void }) => (
    <button
      type="button"
      data-testid="oauth-start"
      onClick={() => onStart({ provider: 'github', params: { redirect: '/dashboard' } })}
    />
  )
}))

vi.mock('@/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/api/auth')>('@/api/auth')
  return {
    ...actual,
    getPublicSettings: (...args: unknown[]) => getPublicSettingsMock(...args),
    startOAuthLogin: (...args: unknown[]) => startOAuthLoginMock(...args),
    isTotp2FARequired: () => false,
    isWeChatWebOAuthEnabled: () => false
  }
})

function mountLogin() {
  return renderAt(<LoginView />, '/login')
}

async function submitLogin() {
  fireEvent.submit(document.querySelector('form')!)
  await flushPromises()
}

describe('Tencent captcha action gate', () => {
  beforeEach(() => {
    loginMock.mockReset()
    loginWithPasskeyMock.mockReset()
    getPublicSettingsMock.mockReset()
    startOAuthLoginMock.mockReset()
    resetCaptchaControls()
    useAuthStore.setState({ login: loginMock, loginWithPasskey: loginWithPasskeyMock })
    useAppStore.setState({ showError: vi.fn(), showSuccess: vi.fn(), showWarning: vi.fn() })
    getPublicSettingsMock.mockResolvedValue({
      turnstile_enabled: false,
      turnstile_site_key: '',
      tencent_captcha_enabled: true,
      tencent_captcha_app_id: 'tencent-app-id',
      backend_mode_enabled: false,
      password_reset_enabled: false,
      passkey_enabled: true,
      github_oauth_enabled: true,
      google_oauth_enabled: false
    })
    loginMock.mockResolvedValue({})
    loginWithPasskeyMock.mockResolvedValue({})
    startOAuthLoginMock.mockResolvedValue({ authorize_url: 'https://github.example/authorize' })
    captchaControls.verifyAction.mockResolvedValue({ token: 'ticket-1', randstr: '@rand-1' })
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      value: class PublicKeyCredential {}
    })
    locationState.href = 'http://localhost/login'
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: locationState
    })
  })

  it('clicking login opens Tencent captcha before calling login', async () => {
    mountLogin()
    await flushPromises()
    setValue(document.getElementById('email')!, 'user@example.com')
    setValue(document.getElementById('password')!, 'secret-123')

    await submitLogin()

    expect(captchaControls.verifyAction).toHaveBeenCalledOnce()
    expect(loginMock).toHaveBeenCalledWith(expect.objectContaining({
      tencent_captcha_ticket: 'ticket-1',
      tencent_captcha_randstr: '@rand-1'
    }))
  })

  it('does not call login when Tencent captcha is closed', async () => {
    captchaControls.verifyAction.mockResolvedValue(null)
    mountLogin()
    await flushPromises()
    setValue(document.getElementById('email')!, 'user@example.com')
    setValue(document.getElementById('password')!, 'secret-123')

    await submitLogin()

    expect(captchaControls.verifyAction).toHaveBeenCalledOnce()
    expect(loginMock).not.toHaveBeenCalled()
  })

  it('does not open Tencent captcha when login form validation fails', async () => {
    mountLogin()
    await flushPromises()

    await submitLogin()

    expect(captchaControls.verifyAction).not.toHaveBeenCalled()
    expect(loginMock).not.toHaveBeenCalled()
  })

  it('starts OAuth through the Tencent gate before navigating', async () => {
    mountLogin()
    await flushPromises()

    fireEvent.click(screen.getByTestId('oauth-start'))
    await flushPromises()

    expect(captchaControls.verifyAction).toHaveBeenCalledOnce()
    expect(startOAuthLoginMock).toHaveBeenCalledWith(
      { provider: 'github', params: { redirect: '/dashboard' } },
      {
        tencent_captcha_ticket: 'ticket-1',
        tencent_captcha_randstr: '@rand-1'
      }
    )
    expect(locationState.href).toBe('https://github.example/authorize')
    expect(captchaControls.reset).toHaveBeenCalledOnce()
  })

  it('does not start OAuth when Tencent captcha is closed', async () => {
    captchaControls.verifyAction.mockResolvedValue(null)
    mountLogin()
    await flushPromises()

    fireEvent.click(screen.getByTestId('oauth-start'))
    await flushPromises()

    expect(startOAuthLoginMock).not.toHaveBeenCalled()
    expect(locationState.href).toBe('http://localhost/login')
  })

  it('passes a fresh Tencent proof to Passkey login', async () => {
    mountLogin()
    await flushPromises()

    fireEvent.click(screen.getByRole('button', { name: 'auth.passkeySignIn' }))
    await flushPromises()

    expect(captchaControls.verifyAction).toHaveBeenCalledOnce()
    expect(loginWithPasskeyMock).toHaveBeenCalledWith({
      tencent_captcha_ticket: 'ticket-1',
      tencent_captcha_randstr: '@rand-1'
    })
    expect(captchaControls.reset).toHaveBeenCalledOnce()
  })

  it('does not invoke Passkey when Tencent captcha is closed', async () => {
    captchaControls.verifyAction.mockResolvedValue(null)
    mountLogin()
    await flushPromises()

    fireEvent.click(screen.getByRole('button', { name: 'auth.passkeySignIn' }))
    await flushPromises()

    expect(loginWithPasskeyMock).not.toHaveBeenCalled()
  })
})
