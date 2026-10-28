import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import OAuthCallbackView from '@/views/auth/OAuthCallbackView'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { flushPromises, pageText, renderAt, setValue } from './authTestUtils'

const {
  routeState,
  locationState,
  routerReplaceMock,
  showErrorMock,
  showSuccessMock,
  setTokenMock,
  copyToClipboardMock,
  exchangePendingOAuthCompletionMock,
  apiPostMock,
} = vi.hoisted(() => ({
  routeState: {
    path: '/auth/callback',
    query: {} as Record<string, string>,
  },
  locationState: {
    current: {
      href: 'http://localhost/auth/callback',
      hash: '',
    } as { href: string; hash: string },
  },
  routerReplaceMock: vi.fn(),
  showErrorMock: vi.fn(),
  showSuccessMock: vi.fn(),
  setTokenMock: vi.fn(),
  copyToClipboardMock: vi.fn(),
  exchangePendingOAuthCompletionMock: vi.fn(),
  apiPostMock: vi.fn(),
}))

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => (path: string, options?: { replace?: boolean }) => (options?.replace ? routerReplaceMock(path) : undefined),
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: 'en', setLocale: vi.fn() }),
}))

vi.mock('@/api/client', () => ({
  apiClient: {
    post: (...args: any[]) => apiPostMock(...args),
  },
}))

vi.mock('@/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/api/auth')>('@/api/auth')
  return {
    ...actual,
    exchangePendingOAuthCompletion: (...args: any[]) => exchangePendingOAuthCompletionMock(...args),
    persistOAuthTokenContext: vi.fn(),
  }
})

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({
    copyToClipboard: (...args: any[]) => copyToClipboardMock(...args),
  }),
}))

function mountView() {
  const search = new URLSearchParams(routeState.query).toString()
  return renderAt(<OAuthCallbackView />, `${routeState.path}${search ? `?${search}` : ''}`)
}

describe('OAuthCallbackView', () => {
  beforeEach(() => {
    routeState.path = '/auth/callback'
    routeState.query = {}
    locationState.current = {
      href: 'http://localhost/auth/callback',
      hash: '',
    }
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: locationState.current,
    })
    routerReplaceMock.mockReset()
    showErrorMock.mockReset()
    showSuccessMock.mockReset()
    setTokenMock.mockReset()
    copyToClipboardMock.mockReset()
    exchangePendingOAuthCompletionMock.mockReset()
    apiPostMock.mockReset()
    useAuthStore.setState({ setToken: (...args: any[]) => setTokenMock(...args) })
    useAppStore.setState({
      showError: (...args: any[]) => showErrorMock(...args),
      showSuccess: (...args: any[]) => showSuccessMock(...args),
    })
    window.sessionStorage.clear()
  })

  it('renders localized callback copy actions', () => {
    routeState.query = {
      code: 'oauth-code',
      state: 'oauth-state',
    }

    mountView()

    expect(pageText()).toContain('auth.oauth.callbackTitle')
    expect(pageText()).toContain('auth.oauth.callbackHint')
    expect(pageText()).toContain('common.copy')
    expect(screen.getByDisplayValue('oauth-code')).toBeInTheDocument()
    expect(screen.getByDisplayValue('oauth-state')).toBeInTheDocument()
  })

  it('sends callback errors to toast instead of rendering inline red text', () => {
    routeState.query = {
      error: 'oauth failed',
    }

    mountView()

    expect(showErrorMock).toHaveBeenCalledWith('oauth failed')
    expect(pageText()).not.toContain('oauth failed')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not render manual copy fields for direct email oauth callback visits', async () => {
    routeState.path = '/auth/oauth/callback'
    exchangePendingOAuthCompletionMock.mockRejectedValue(new Error('pending session not found'))

    mountView()
    await flushPromises()

    expect(exchangePendingOAuthCompletionMock).toHaveBeenCalledTimes(1)
    expect(pageText()).toContain('auth.oauth.invalidCallbackTitle')
    expect(pageText()).toContain('auth.oauth.invalidCallbackHint')
    expect(document.querySelector('input[readonly]')).toBeNull()
  })

  it('forwards frontend email oauth provider callbacks back to the backend callback endpoint', async () => {
    routeState.path = '/auth/oauth/callback'
    routeState.query = {
      code: 'provider-code',
      state: 'provider-state',
    }
    window.sessionStorage.setItem('email_oauth_pending_provider', 'google')

    mountView()
    await flushPromises()

    expect(locationState.current.href).toBe(
      '/api/v1/auth/oauth/google/callback?code=provider-code&state=provider-state'
    )
    expect(exchangePendingOAuthCompletionMock).not.toHaveBeenCalled()
  })

  it('submits stored affiliate code when completing invited email oauth registration', async () => {
    routeState.path = '/auth/oauth/callback'
    exchangePendingOAuthCompletionMock.mockResolvedValue({
      error: 'invitation_required',
      provider: 'google',
      redirect: '/dashboard',
      resolved_email: 'pending@example.com',
      invitation_required: true,
    })
    apiPostMock.mockResolvedValue({
      data: {
        access_token: 'token-1',
      },
    })
    window.sessionStorage.setItem('oauth_aff_code', 'AFF456')

    mountView()
    await flushPromises()
    const passwordInputs = document.querySelectorAll('input[type="password"]')
    setValue(passwordInputs[0], 'secret-123')
    setValue(passwordInputs[1], 'secret-123')
    setValue(screen.getByLabelText('auth.invitationCodeLabel'), 'INVITE456')
    fireEvent.click(screen.getByRole('button', { name: 'auth.oidc.completeRegistration' }))
    await flushPromises()

    expect(apiPostMock).toHaveBeenCalledWith('/auth/oauth/google/complete-registration', {
      password: 'secret-123',
      invitation_code: 'INVITE456',
      aff_code: 'AFF456',
    })
    expect(setTokenMock).toHaveBeenCalledWith('token-1')
  })

  it('completes email oauth registration with readonly email and without posting email', async () => {
    routeState.path = '/auth/oauth/callback'
    exchangePendingOAuthCompletionMock.mockResolvedValue({
      error: 'registration_completion_required',
      provider: 'github',
      redirect: '/dashboard',
      resolved_email: 'verified@example.com',
      invitation_required: false,
    })
    apiPostMock.mockResolvedValue({
      data: {
        access_token: 'token-2',
      },
    })

    mountView()
    await flushPromises()

    const emailInput = document.querySelector<HTMLInputElement>('input[type="email"]')
    expect(emailInput).not.toBeNull()
    expect(emailInput!.value).toBe('verified@example.com')
    expect(emailInput).toHaveAttribute('readonly')
    expect(emailInput).toBeDisabled()

    const passwordInputs = document.querySelectorAll('input[type="password"]')
    setValue(passwordInputs[0], 'secret-456')
    setValue(passwordInputs[1], 'secret-456')
    fireEvent.click(screen.getByRole('button', { name: 'auth.oidc.completeRegistration' }))
    await flushPromises()

    expect(apiPostMock).toHaveBeenCalledWith('/auth/oauth/github/complete-registration', {
      password: 'secret-456',
    })
    expect(apiPostMock.mock.calls[0][1]).not.toHaveProperty('email')
    expect(setTokenMock).toHaveBeenCalledWith('token-2')
  })
})
