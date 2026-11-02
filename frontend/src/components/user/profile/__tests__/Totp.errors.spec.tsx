import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TotpDisableDialog from '../TotpDisableDialog'
import TotpSetupModal from '../TotpSetupModal'
import { useAppStore } from '@/stores/app'

const mocks = vi.hoisted(() => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
  totpAPI: {
    getVerificationMethod: vi.fn(),
    sendVerifyCode: vi.fn(),
    initiateSetup: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn()
  }
}))
vi.mock('@/api', () => ({ totpAPI: mocks.totpAPI }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,qr') } }))

const flushPromises = () => act(async () => {})
const passwordInput = () => document.querySelector('input[type="password"]') as HTMLInputElement

beforeEach(() => {
  vi.resetAllMocks()
  useAppStore.setState({ showError: mocks.showError, showSuccess: mocks.showSuccess })
  mocks.totpAPI.getVerificationMethod.mockResolvedValue({ method: 'password' })
})

interface DialogProps {
  onClose?: () => void
  onSuccess?: () => void
}

describe.each([
  { name: 'setup', Component: TotpSetupModal as ComponentType<DialogProps>, action: mocks.totpAPI.initiateSetup, fallback: 'profile.totp.setupFailed' },
  { name: 'disable', Component: TotpDisableDialog as ComponentType<DialogProps>, action: mocks.totpAPI.disable, fallback: 'profile.totp.disableFailed' }
])('TOTP $name errors', ({ name, Component, action, fallback }) => {
  it('shows the verification-method API error before closing', async () => {
    mocks.totpAPI.getVerificationMethod.mockRejectedValue({ status: 503, message: 'Verification is temporarily unavailable' })
    const onClose = vi.fn()
    render(<Component onClose={onClose} />)
    await flushPromises()
    expect(mocks.showError).toHaveBeenCalledWith('Verification is temporarily unavailable')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows why the email verification code cannot be sent', async () => {
    mocks.totpAPI.getVerificationMethod.mockResolvedValue({ method: 'email' })
    mocks.totpAPI.sendVerifyCode.mockRejectedValue({ status: 429, message: 'Please wait before requesting another code' })
    render(<Component />)
    await flushPromises()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'profile.totp.sendCode' }))
    })
    await flushPromises()
    expect(mocks.showError).toHaveBeenCalledWith('Please wait before requesting another code')
  })

  it.each([
    [{ status: 400, message: 'Incorrect password' }, 'Incorrect password'],
    [{ response: { data: { message: 'Legacy message' } } }, 'Legacy message'],
    [{}, fallback]
  ])('preserves the action error or localized fallback: %j', async (error, expected) => {
    action.mockRejectedValue(error)
    const onSuccess = vi.fn()
    render(<Component onSuccess={onSuccess} />)
    await flushPromises()
    fireEvent.change(passwordInput(), { target: { value: 'incorrect-password' } })
    await act(async () => {
      if (name === 'setup') fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
      else fireEvent.submit(document.querySelector('form')!)
    })
    await flushPromises()
    expect(mocks.showError).toHaveBeenCalledWith(expected)
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

it('shows the reason a TOTP code was rejected', async () => {
  mocks.totpAPI.initiateSetup.mockResolvedValue({ secret: 'EXAMPLE', qr_code_url: '', setup_token: 'setup-token' })
  mocks.totpAPI.enable.mockRejectedValue({ status: 400, message: 'Invalid TOTP code' })
  const onSuccess = vi.fn()
  render(<TotpSetupModal onSuccess={onSuccess} />)
  await flushPromises()
  fireEvent.change(passwordInput(), { target: { value: 'password' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
  })
  await flushPromises()
  await act(async () => {
    fireEvent.click(screen.getByTestId('totp-setup-next'))
  })
  for (const input of document.querySelectorAll('input[maxlength="1"]')) {
    fireEvent.change(input, { target: { value: '1' } })
  }
  await act(async () => {
    fireEvent.submit(document.querySelector('form')!)
  })
  await flushPromises()
  expect(mocks.totpAPI.enable).toHaveBeenCalledWith({ totp_code: '111111', setup_token: 'setup-token' })
  expect(mocks.showError).toHaveBeenCalledWith('Invalid TOTP code')
  expect(onSuccess).not.toHaveBeenCalled()
})
