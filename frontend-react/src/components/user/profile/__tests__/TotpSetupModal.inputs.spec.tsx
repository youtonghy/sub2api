import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TotpSetupModal from '../TotpSetupModal'
import { useAppStore } from '@/stores/app'

const api = vi.hoisted(() => ({ getVerificationMethod: vi.fn(), initiateSetup: vi.fn(), enable: vi.fn() }))
vi.mock('@/api', () => ({ totpAPI: api }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('') } }))

const flushPromises = () => act(async () => {})
const codeInputs = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[maxlength="1"]'))
const submit = () => document.querySelector('button[type="submit"]') as HTMLButtonElement

beforeEach(() => {
  vi.resetAllMocks()
  useAppStore.setState({ showError: vi.fn(), showSuccess: vi.fn() })
  api.getVerificationMethod.mockResolvedValue({ method: 'password' })
  api.initiateSetup.mockResolvedValue({ secret: 'EXAMPLE', qr_code_url: '', setup_token: 'setup-token' })
  api.enable.mockResolvedValue({ success: true })
})

async function openCodeStep(onSuccess = vi.fn()) {
  render(<TotpSetupModal onSuccess={onSuccess} />)
  await flushPromises()
  fireEvent.change(document.querySelector('input[type="password"]')!, { target: { value: 'password' } })
  await act(async () => {
    fireEvent.click(screen.getByTestId('totp-setup-next'))
  })
  await flushPromises()
  await act(async () => {
    fireEvent.click(screen.getByTestId('totp-setup-next'))
  })
  codeInputs().forEach((input, i) => fireEvent.change(input, { target: { value: String(i + 1) } }))
  return onSuccess
}

const submitForm = async () => {
  await act(async () => {
    fireEvent.submit(document.querySelector('form')!)
  })
  await flushPromises()
}

describe('TOTP setup input synchronization', () => {
  it('clears displayed digits after verification fails and focuses the first cell', async () => {
    api.enable.mockRejectedValueOnce({ message: 'Invalid code' })
    const onSuccess = await openCodeStep()
    await submitForm()
    const inputs = codeInputs()
    expect(inputs.map((input) => input.value)).toEqual(['', '', '', '', '', ''])
    expect(document.activeElement).toBe(inputs[0])
    expect(submit()).toBeDisabled()
    fireEvent.paste(inputs[0]!, { clipboardData: { getData: () => '654321' } })
    await submitForm()
    expect(api.enable).toHaveBeenLastCalledWith({ totp_code: '654321', setup_token: 'setup-token' })
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('displays retained digits when returning from the QR-code step', async () => {
    await openCodeStep()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.back' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('totp-setup-next'))
    })
    expect(codeInputs().map((input) => input.value)).toEqual(['1', '2', '3', '4', '5', '6'])
    await submitForm()
    expect(api.enable).toHaveBeenCalledWith({ totp_code: '123456', setup_token: 'setup-token' })
  })

  it('submits normally entered digits', async () => {
    const onSuccess = await openCodeStep()
    await submitForm()
    expect(api.enable).toHaveBeenCalledWith({ totp_code: '123456', setup_token: 'setup-token' })
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })
})
