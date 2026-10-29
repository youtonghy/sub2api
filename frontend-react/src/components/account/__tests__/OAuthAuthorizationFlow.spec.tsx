import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import OAuthAuthorizationFlow, { type OAuthFlowHandle } from '../OAuthAuthorizationFlow'

vi.mock('@/api/admin', () => ({
  adminAPI: { grok: { getCapabilities: vi.fn().mockResolvedValue({ password_auth_enabled: true }) } }
}))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) } }))
vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' })
}))

afterEach(() => cleanup())

describe('OAuthAuthorizationFlow', () => {
  it('extracts the code and state from a pasted callback URL', async () => {
    const ref = createRef<OAuthFlowHandle>()
    const onStateChange = vi.fn()
    render(<OAuthAuthorizationFlow ref={ref} addMethod="oauth" platform="openai" onStateChange={onStateChange} />)

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('admin.accounts.oauth.openai.authCodePlaceholder'), {
        target: { value: 'http://localhost:1455/auth/callback?code=abc123&state=xyz' }
      })
    })

    expect(ref.current?.authCode).toBe('abc123')
    expect(ref.current?.oauthState).toBe('xyz')
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ authCode: 'abc123', oauthState: 'xyz' }))
  })

  it('keeps the raw input for Anthropic codes', async () => {
    const ref = createRef<OAuthFlowHandle>()
    render(<OAuthAuthorizationFlow ref={ref} addMethod="oauth" platform="anthropic" />)

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('admin.accounts.oauth.authCodePlaceholder'), {
        target: { value: 'code=abc#state' }
      })
    })

    expect(ref.current?.authCode).toBe('code=abc#state')
  })

  it('only shows the method selection when there is more than one option and emits method changes', async () => {
    const onInputMethodChange = vi.fn()
    const onValidateRefreshToken = vi.fn()
    const { rerender } = render(
      <OAuthAuthorizationFlow addMethod="oauth" platform="openai" showCookieOption={false} methodLabel="Method" />
    )
    expect(screen.queryByRole('radio')).toBeNull()

    rerender(
      <OAuthAuthorizationFlow
        addMethod="oauth"
        platform="openai"
        showCookieOption={false}
        showRefreshTokenOption
        methodLabel="Method"
        onInputMethodChange={onInputMethodChange}
        onValidateRefreshToken={onValidateRefreshToken}
      />
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'admin.accounts.oauth.openai.refreshTokenAuth' }))
    })
    expect(onInputMethodChange).toHaveBeenCalledWith('refresh_token')

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('admin.accounts.oauth.openai.refreshTokenPlaceholder'), {
        target: { value: '  rt-1  ' }
      })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /admin\.accounts\.oauth\.openai\.validateAndCreate/ }))
    })
    expect(onValidateRefreshToken).toHaveBeenCalledWith('rt-1')
  })

  it('resets inputs and the input method through the handle', async () => {
    const ref = createRef<OAuthFlowHandle>()
    render(
      <OAuthAuthorizationFlow ref={ref} addMethod="oauth" platform="anthropic" initialInputMethod="cookie" allowMultiple />
    )
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('admin.accounts.oauth.sessionKeyPlaceholder'), {
        target: { value: 'sk-1\nsk-2' }
      })
    })
    expect(ref.current?.sessionKey).toBe('sk-1\nsk-2')
    expect(screen.getByText('admin.accounts.oauth.batchCreateAccounts')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'admin.accounts.oauth.manualAuth' }))
    })
    expect(ref.current?.inputMethod).toBe('manual')

    await act(async () => {
      ref.current?.reset()
    })
    expect(ref.current?.sessionKey).toBe('')
    expect(ref.current?.inputMethod).toBe('cookie')
  })
})
