import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LinuxDoCallbackView from '../LinuxDoCallbackView'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { fillOtp, flushPromises, pageText, renderAt, setValue } from './authTestUtils'

const {
  replace,
  showSuccess,
  showError,
  setToken,
  setPendingAuthSession,
  clearPendingAuthSession,
  exchangePendingOAuthCompletion,
  completeLinuxDoOAuthRegistration,
  getPublicSettings,
  login2FA,
  apiClientPost,
  sendVerifyCode,
  sendPendingOAuthVerifyCode
} = vi.hoisted(() => ({
  replace: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
  setToken: vi.fn(),
  setPendingAuthSession: vi.fn(),
  clearPendingAuthSession: vi.fn(),
  exchangePendingOAuthCompletion: vi.fn(),
  completeLinuxDoOAuthRegistration: vi.fn(),
  getPublicSettings: vi.fn(),
  login2FA: vi.fn(),
  apiClientPost: vi.fn(),
  sendVerifyCode: vi.fn(),
  sendPendingOAuthVerifyCode: vi.fn()
}))

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  // Vue 版的 router.replace(path) 对应 navigate(path, { replace: true })
  useNavigate: () => (path: string, options?: { replace?: boolean }) => (options?.replace ? replace(path) : undefined)
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === 'auth.oauthFlow.totpHint') {
        return `verify ${params?.account ?? ''}`.trim()
      }
      return key
    },
    te: () => false,
    locale: 'en',
    setLocale: vi.fn()
  })
}))

vi.mock('@/api/client', () => ({
  apiClient: {
    post: (...args: any[]) => apiClientPost(...args)
  }
}))

vi.mock('@/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/api/auth')>('@/api/auth')
  return {
    ...actual,
    exchangePendingOAuthCompletion: (...args: any[]) => exchangePendingOAuthCompletion(...args),
    completeLinuxDoOAuthRegistration: (...args: any[]) => completeLinuxDoOAuthRegistration(...args),
    getPublicSettings: (...args: any[]) => getPublicSettings(...args),
    login2FA: (...args: any[]) => login2FA(...args),
    sendVerifyCode: (...args: any[]) => sendVerifyCode(...args),
    sendPendingOAuthVerifyCode: (...args: any[]) => sendPendingOAuthVerifyCode(...args)
  }
})

function mountView() {
  return renderAt(<LinuxDoCallbackView />, '/auth/linuxdo/callback')
}

describe('LinuxDoCallbackView', () => {
  beforeEach(() => {
    replace.mockReset()
    showSuccess.mockReset()
    showError.mockReset()
    setToken.mockReset()
    setPendingAuthSession.mockReset()
    clearPendingAuthSession.mockReset()
    exchangePendingOAuthCompletion.mockReset()
    completeLinuxDoOAuthRegistration.mockReset()
    getPublicSettings.mockReset()
    login2FA.mockReset()
    apiClientPost.mockReset()
    sendVerifyCode.mockReset()
    sendPendingOAuthVerifyCode.mockReset()
    getPublicSettings.mockResolvedValue({
      turnstile_enabled: false,
      turnstile_site_key: ''
    })
    useAuthStore.setState({ setToken, setPendingAuthSession, clearPendingAuthSession })
    useAppStore.setState({ showSuccess, showError })
    window.location.hash = ''
    localStorage.clear()
    sessionStorage.clear()
  })

  it('accepts the legacy fragment token success callback without pending-session exchange', async () => {
    window.location.hash =
      '#access_token=legacy-access-token&refresh_token=legacy-refresh-token&expires_in=3600&token_type=Bearer&redirect=%2Flegacy-dashboard'
    setToken.mockResolvedValue({})

    mountView()
    await flushPromises()

    expect(exchangePendingOAuthCompletion).not.toHaveBeenCalled()
    expect(setToken).toHaveBeenCalledWith('legacy-access-token')
    expect(localStorage.getItem('refresh_token')).toBe('legacy-refresh-token')
    expect(localStorage.getItem('token_expires_at')).not.toBeNull()
    expect(showSuccess).toHaveBeenCalledWith('auth.loginSuccess')
    expect(replace).toHaveBeenCalledWith('/legacy-dashboard')
  })

  it('accepts the legacy pending oauth invitation fragment without pending-session exchange', async () => {
    window.location.hash = '#error=invitation_required&pending_oauth_token=legacy-pending-token&redirect=%2Flegacy-invite'
    apiClientPost.mockResolvedValue({
      data: {
        access_token: 'legacy-access-token',
        refresh_token: 'legacy-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer'
      }
    })
    setToken.mockResolvedValue({})

    mountView()
    await flushPromises()

    expect(exchangePendingOAuthCompletion).not.toHaveBeenCalled()
    setValue(screen.getByLabelText('auth.invitationCodeLabel'), 'invite-code')
    fireEvent.click(screen.getByRole('button', { name: 'auth.linuxdo.completeRegistration' }))
    await flushPromises()

    expect(apiClientPost).toHaveBeenCalledWith('/auth/oauth/linuxdo/complete-registration', {
      adopt_display_name: true,
      adopt_avatar: true,
      pending_oauth_token: 'legacy-pending-token',
      invitation_code: 'invite-code'
    })
    expect(setToken).toHaveBeenCalledWith('legacy-access-token')
    expect(replace).toHaveBeenCalledWith('/legacy-invite')
  })

  it('does not send adoption decisions during the initial exchange', async () => {
    exchangePendingOAuthCompletion.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      redirect: '/dashboard',
      adoption_required: true
    })
    setToken.mockResolvedValue({})

    mountView()
    await flushPromises()

    expect(exchangePendingOAuthCompletion).toHaveBeenCalledTimes(1)
    expect(exchangePendingOAuthCompletion).toHaveBeenCalledWith()
  })

  it('waits for explicit adoption confirmation before finishing a non-invitation login', async () => {
    exchangePendingOAuthCompletion
      .mockResolvedValueOnce({
        redirect: '/dashboard',
        adoption_required: true,
        suggested_display_name: 'LinuxDo Nick',
        suggested_avatar_url: 'https://cdn.example/linuxdo.png'
      })
      .mockResolvedValueOnce({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        redirect: '/dashboard'
      })
    setToken.mockResolvedValue({})

    mountView()
    await flushPromises()

    expect(pageText()).toContain('LinuxDo Nick')
    expect(setToken).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1])

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    await flushPromises()

    expect(exchangePendingOAuthCompletion).toHaveBeenCalledTimes(2)
    expect(exchangePendingOAuthCompletion).toHaveBeenNthCalledWith(1)
    expect(exchangePendingOAuthCompletion).toHaveBeenNthCalledWith(2, {
      adoptDisplayName: true,
      adoptAvatar: false
    })
    expect(setToken).toHaveBeenCalledWith('access-token')
    expect(replace).toHaveBeenCalledWith('/dashboard')
  })

  it('treats a completion without token as bind success and returns to profile', async () => {
    exchangePendingOAuthCompletion.mockResolvedValue({})

    mountView()
    await flushPromises()

    expect(setToken).not.toHaveBeenCalled()
    expect(showSuccess).toHaveBeenCalledWith('profile.authBindings.bindSuccess')
    expect(replace).toHaveBeenCalledWith('/profile')
  })

  it('supports bind completion after adoption confirmation', async () => {
    exchangePendingOAuthCompletion
      .mockResolvedValueOnce({
        redirect: '/dashboard',
        adoption_required: true,
        suggested_display_name: 'LinuxDo Nick',
        suggested_avatar_url: 'https://cdn.example/linuxdo.png'
      })
      .mockResolvedValueOnce({
        redirect: '/profile/security'
      })

    mountView()
    await flushPromises()

    fireEvent.click(screen.getAllByRole('button')[0])
    await flushPromises()

    expect(exchangePendingOAuthCompletion).toHaveBeenNthCalledWith(2, {
      adoptDisplayName: true,
      adoptAvatar: true
    })
    expect(setToken).not.toHaveBeenCalled()
    expect(showSuccess).toHaveBeenCalledWith('profile.authBindings.bindSuccess')
    expect(replace).toHaveBeenCalledWith('/profile/security')
  })

  it('keeps rendering pending bind-login UI when adoption confirmation leads to another pending step', async () => {
    exchangePendingOAuthCompletion
      .mockResolvedValueOnce({
        redirect: '/profile/security',
        adoption_required: true,
        suggested_display_name: 'LinuxDo Nick',
        suggested_avatar_url: 'https://cdn.example/linuxdo.png'
      })
      .mockResolvedValueOnce({
        step: 'bind_login_required',
        redirect: '/profile/security',
        email: 'existing@example.com',
        adoption_required: true,
        suggested_display_name: 'LinuxDo Nick',
        suggested_avatar_url: 'https://cdn.example/linuxdo.png'
      })

    mountView()
    await flushPromises()
    fireEvent.click(screen.getAllByRole('button')[0])
    await flushPromises()

    expect(showSuccess).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(screen.getByTestId<HTMLInputElement>('linuxdo-bind-login-email').value).toBe('existing@example.com')
  })

  it('keeps rendering bind-login UI for legacy pending bind responses instead of treating them as success', async () => {
    exchangePendingOAuthCompletion.mockResolvedValue({
      error: 'adopt_existing_user_by_email',
      redirect: '/profile/security',
      email: 'existing@example.com'
    })

    mountView()
    await flushPromises()

    expect(showSuccess).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(screen.getByTestId<HTMLInputElement>('linuxdo-bind-login-email').value).toBe('existing@example.com')
  })

  it('persists a pending auth session when the oauth flow still needs account creation', async () => {
    exchangePendingOAuthCompletion.mockResolvedValue({
      error: 'email_required',
      redirect: '/welcome'
    })

    mountView()
    await flushPromises()

    expect(setPendingAuthSession).toHaveBeenCalledWith({
      token: '',
      token_field: 'pending_oauth_token',
      provider: 'linuxdo',
      redirect: '/welcome'
    })
  })

  it('renders adoption choices for invitation flow and submits the selected values', async () => {
    exchangePendingOAuthCompletion.mockResolvedValue({
      error: 'invitation_required',
      redirect: '/dashboard',
      adoption_required: true,
      suggested_display_name: 'LinuxDo Nick',
      suggested_avatar_url: 'https://cdn.example/linuxdo.png'
    })
    completeLinuxDoOAuthRegistration.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      token_type: 'Bearer'
    })
    setToken.mockResolvedValue({})

    mountView()
    await flushPromises()

    expect(pageText()).toContain('LinuxDo Nick')
    expect(exchangePendingOAuthCompletion).toHaveBeenCalledTimes(1)
    expect(exchangePendingOAuthCompletion).toHaveBeenCalledWith()

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)

    fireEvent.click(checkboxes[0])
    setValue(screen.getByLabelText('auth.invitationCodeLabel'), 'invite-code')
    fireEvent.click(screen.getByRole('button', { name: 'auth.linuxdo.completeRegistration' }))
    await flushPromises()

    expect(completeLinuxDoOAuthRegistration).toHaveBeenCalledWith('invite-code', {
      adoptDisplayName: false,
      adoptAvatar: true
    })
  })

  it('keeps the oauth flow active when complete-registration returns another pending step', async () => {
    exchangePendingOAuthCompletion.mockResolvedValue({
      error: 'invitation_required',
      redirect: '/dashboard',
      adoption_required: true,
      suggested_display_name: 'LinuxDo Nick',
      suggested_avatar_url: 'https://cdn.example/linuxdo.png'
    })
    completeLinuxDoOAuthRegistration.mockResolvedValue({
      auth_result: 'pending_session',
      step: 'choose_account_action_required',
      redirect: '/dashboard',
      email: 'fresh@example.com',
      resolved_email: 'fresh@example.com',
      force_email_on_signup: true,
      adoption_required: true
    })

    mountView()
    await flushPromises()
    setValue(screen.getByLabelText('auth.invitationCodeLabel'), 'invite-code')
    fireEvent.click(screen.getByRole('button', { name: 'auth.linuxdo.completeRegistration' }))
    await flushPromises()

    expect(completeLinuxDoOAuthRegistration).toHaveBeenCalledWith('invite-code', {
      adoptDisplayName: true,
      adoptAvatar: true
    })
    expect(setToken).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(pageText()).toContain('auth.oauthFlow.bindExistingAccount')
    expect(pageText()).toContain('auth.oauthFlow.createNewAccount')
  })

  it('collects email, password, and verify code for pending oauth account creation and submits adoption decisions', async () => {
    getPublicSettings.mockResolvedValue({
      invitation_code_enabled: true,
      turnstile_enabled: false,
      turnstile_site_key: ''
    })
    exchangePendingOAuthCompletion.mockResolvedValue({
      error: 'email_required',
      redirect: '/welcome',
      adoption_required: true,
      suggested_display_name: 'LinuxDo Nick',
      suggested_avatar_url: 'https://cdn.example/linuxdo.png'
    })
    apiClientPost.mockResolvedValue({
      data: {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer'
      }
    })
    setToken.mockResolvedValue({})

    mountView()
    await flushPromises()

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
    fireEvent.click(checkboxes[1])
    setValue(screen.getByTestId('linuxdo-create-account-email'), '  new@example.com  ')
    setValue(screen.getByTestId('linuxdo-create-account-password'), 'secret-123')
    fillOtp(screen.getByTestId('linuxdo-create-account-verify-code'), '246810')
    setValue(screen.getByTestId('linuxdo-create-account-invitation-code'), ' INVITE123 ')
    fireEvent.click(screen.getByTestId('linuxdo-create-account-submit'))
    await flushPromises()

    expect(apiClientPost).toHaveBeenCalledWith('/auth/oauth/pending/create-account', {
      email: 'new@example.com',
      password: 'secret-123',
      verify_code: '246810',
      invitation_code: 'INVITE123',
      adopt_display_name: true,
      adopt_avatar: false
    })
    expect(setToken).toHaveBeenCalledWith('new-access-token')
    expect(replace).toHaveBeenCalledWith('/welcome')
  })

  it('switches to bind-login when create-account returns EMAIL_EXISTS', async () => {
    exchangePendingOAuthCompletion.mockResolvedValue({
      error: 'email_required',
      redirect: '/welcome'
    })
    apiClientPost.mockRejectedValue({
      response: {
        data: {
          reason: 'EMAIL_EXISTS',
          message: 'email already exists'
        }
      }
    })

    mountView()
    await flushPromises()
    setValue(screen.getByTestId('linuxdo-create-account-email'), 'existing@example.com')
    setValue(screen.getByTestId('linuxdo-create-account-password'), 'secret-123')
    fireEvent.click(screen.getByTestId('linuxdo-create-account-submit'))
    await flushPromises()

    expect(screen.getByTestId<HTMLInputElement>('linuxdo-bind-login-email').value).toBe('existing@example.com')
  })

  it('shows create-account failures through toast without inline error text', async () => {
    exchangePendingOAuthCompletion.mockResolvedValue({
      error: 'email_required',
      redirect: '/welcome'
    })
    apiClientPost.mockRejectedValue(new Error('create failed'))

    mountView()
    await flushPromises()
    setValue(screen.getByTestId('linuxdo-create-account-email'), 'new@example.com')
    setValue(screen.getByTestId('linuxdo-create-account-password'), 'secret-123')
    fireEvent.click(screen.getByTestId('linuxdo-create-account-submit'))
    await flushPromises()

    expect(showError).toHaveBeenCalledWith('create failed')
    expect(pageText()).not.toContain('create failed')
  })

  it('sends a verify code for pending oauth account creation', async () => {
    exchangePendingOAuthCompletion.mockResolvedValue({
      error: 'email_required',
      redirect: '/welcome'
    })
    sendPendingOAuthVerifyCode.mockResolvedValue({
      message: 'sent',
      countdown: 60
    })

    mountView()
    await flushPromises()

    setValue(screen.getByTestId('linuxdo-create-account-email'), '  new@example.com  ')
    fireEvent.click(screen.getByTestId('linuxdo-create-account-send-code'))
    await flushPromises()

    expect(sendPendingOAuthVerifyCode).toHaveBeenCalledWith({
      email: 'new@example.com'
    })
  })

  it('shows bind-login form for existing account binding and submits credentials with adoption decisions', async () => {
    exchangePendingOAuthCompletion.mockResolvedValue({
      error: 'bind_login_required',
      redirect: '/profile/security',
      email: 'existing@example.com',
      adoption_required: true,
      suggested_display_name: 'LinuxDo Nick',
      suggested_avatar_url: 'https://cdn.example/linuxdo.png'
    })
    apiClientPost.mockResolvedValue({
      data: {
        access_token: 'bind-access-token',
        refresh_token: 'bind-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer'
      }
    })
    setToken.mockResolvedValue({})

    mountView()
    await flushPromises()

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
    fireEvent.click(checkboxes[0])
    setValue(screen.getByTestId('linuxdo-bind-login-email'), 'existing@example.com')
    setValue(screen.getByTestId('linuxdo-bind-login-password'), 'secret-password')
    fireEvent.click(screen.getByTestId('linuxdo-bind-login-submit'))
    await flushPromises()

    expect(apiClientPost).toHaveBeenCalledWith('/auth/oauth/pending/bind-login', {
      email: 'existing@example.com',
      password: 'secret-password',
      adopt_display_name: false,
      adopt_avatar: true
    })
    expect(setToken).toHaveBeenCalledWith('bind-access-token')
    expect(replace).toHaveBeenCalledWith('/profile/security')
  })

  it('handles bind-login 2FA challenge before redirecting', async () => {
    exchangePendingOAuthCompletion.mockResolvedValue({
      error: 'bind_login_required',
      redirect: '/profile',
      email: 'existing@example.com',
      adoption_required: true,
      suggested_display_name: 'LinuxDo Nick',
      suggested_avatar_url: 'https://cdn.example/linuxdo.png'
    })
    apiClientPost.mockResolvedValue({
      data: {
        requires_2fa: true,
        temp_token: 'temp-123',
        user_email_masked: 'o***g@example.com'
      }
    })
    login2FA.mockResolvedValue({
      access_token: '2fa-access-token'
    })
    setToken.mockResolvedValue({})

    mountView()
    await flushPromises()

    setValue(screen.getByTestId('linuxdo-bind-login-password'), 'secret-password')
    fireEvent.click(screen.getByTestId('linuxdo-bind-login-submit'))
    await flushPromises()

    expect(pageText()).toContain('o***g@example.com')
    expect(login2FA).not.toHaveBeenCalled()

    fillOtp(screen.getByTestId('linuxdo-bind-login-totp'), '123456')
    fireEvent.click(screen.getByTestId('linuxdo-bind-login-totp-submit'))
    await flushPromises()

    expect(login2FA).toHaveBeenCalledWith({
      temp_token: 'temp-123',
      totp_code: '123456'
    })
    expect(setToken).toHaveBeenCalledWith('2fa-access-token')
    expect(replace).toHaveBeenCalledWith('/profile')
  })
})
