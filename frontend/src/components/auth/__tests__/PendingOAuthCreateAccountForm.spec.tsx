import type { ReactElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PendingOAuthCreateAccountForm from '../PendingOAuthCreateAccountForm'
import { useAppStore } from '@/stores/app'
import { fillOtp, flushPromises, pageText, setValue } from '@/views/auth/__tests__/authTestUtils'
import { captchaControls, resetCaptchaControls } from '@/views/auth/__tests__/captchaStub'

const { sendVerifyCode, sendPendingOAuthVerifyCode, getPublicSettings, showErrorMock, onSubmit } = vi.hoisted(() => ({
  sendVerifyCode: vi.fn(),
  sendPendingOAuthVerifyCode: vi.fn(),
  getPublicSettings: vi.fn(),
  showErrorMock: vi.fn(),
  onSubmit: vi.fn()
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: 'en', setLocale: vi.fn() })
}))

vi.mock('@/components/captcha/CaptchaChallenge', async () => (await import('@/views/auth/__tests__/captchaStub')).captchaModule)

vi.mock('@/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/api/auth')>('@/api/auth')
  return {
    ...actual,
    sendVerifyCode: (...args: any[]) => sendVerifyCode(...args),
    sendPendingOAuthVerifyCode: (...args: any[]) => sendPendingOAuthVerifyCode(...args),
    getPublicSettings: (...args: any[]) => getPublicSettings(...args)
  }
})

function mountForm(ui: ReactElement) {
  return render(ui)
}

/** 直接提交表单（对应 Vue 的 trigger('submit.prevent')，绕过按钮的 disabled） */
async function submitForm() {
  fireEvent.submit(document.querySelector('form')!)
  await flushPromises()
}

describe('PendingOAuthCreateAccountForm', () => {
  beforeEach(() => {
    sendVerifyCode.mockReset()
    sendPendingOAuthVerifyCode.mockReset()
    getPublicSettings.mockReset()
    showErrorMock.mockReset()
    onSubmit.mockReset()
    resetCaptchaControls()
    useAppStore.setState({ showError: (...args: any[]) => showErrorMock(...args) })
    getPublicSettings.mockResolvedValue({
      turnstile_enabled: false,
      turnstile_site_key: ''
    })
  })

  it('does not restart the code cooldown after switching away during a send', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let finish!: (value: { countdown: number }) => void
    sendPendingOAuthVerifyCode.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const view = mountForm(<PendingOAuthCreateAccountForm testIdPrefix='oidc' initialEmail='user@example.com' isSubmitting={false} onSubmit={onSubmit} onSwitchToBind={vi.fn()} />)
    try {
      await flushPromises()
      // Arc 组件的动画库会注册自己的全局定时器，这里只断言没有新增倒计时定时器
      const baselineTimers = vi.getTimerCount()
      fireEvent.click(screen.getByTestId('oidc-create-account-send-code'))
      await flushPromises()
      expect(sendPendingOAuthVerifyCode).toHaveBeenCalledTimes(1)
      view.unmount()
      finish({ countdown: 60 })
      await flushPromises()
      expect(vi.getTimerCount()).toBe(baselineTimers)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('acquires separate proofs for pending OAuth send-code and create-account', async () => {
    getPublicSettings.mockResolvedValue({
      email_verify_enabled: true,
      turnstile_enabled: false,
      turnstile_site_key: '',
      tencent_captcha_enabled: true,
      tencent_captcha_app_id: 'tencent-app-id'
    })
    sendPendingOAuthVerifyCode.mockResolvedValue({ countdown: 0 })
    captchaControls.verifyAction
      .mockResolvedValueOnce({ token: 'ticket-1', randstr: '@rand-1' })
      .mockResolvedValueOnce({ token: 'ticket-2', randstr: '@rand-2' })
    mountForm(<PendingOAuthCreateAccountForm testIdPrefix='oidc' initialEmail='user@example.com' isSubmitting={false} onSubmit={onSubmit} onSwitchToBind={vi.fn()} />)

    await flushPromises()
    setValue(screen.getByTestId('oidc-create-account-password'), 'secret-123')
    fillOtp(screen.getByTestId('oidc-create-account-verify-code'), '246810')
    fireEvent.click(screen.getByTestId('oidc-create-account-send-code'))
    await flushPromises()
    fireEvent.click(screen.getByTestId('oidc-create-account-submit'))
    await flushPromises()

    expect(captchaControls.verifyAction).toHaveBeenCalledTimes(2)
    expect(sendPendingOAuthVerifyCode).toHaveBeenCalledWith({
      email: 'user@example.com',
      tencent_captcha_ticket: 'ticket-1',
      tencent_captcha_randstr: '@rand-1'
    })
    expect(onSubmit.mock.calls).toEqual([
      [
        expect.objectContaining({
          tencentCaptchaTicket: 'ticket-2',
          tencentCaptchaRandstr: '@rand-2'
        })
      ]
    ])
    expect(captchaControls.reset).toHaveBeenCalledTimes(2)
  })

  it('emits trimmed email, password, and verify code on submit', async () => {
    mountForm(<PendingOAuthCreateAccountForm testIdPrefix='linuxdo' initialEmail='prefill@example.com' isSubmitting={false} onSubmit={onSubmit} onSwitchToBind={vi.fn()} />)

    setValue(screen.getByTestId('linuxdo-create-account-email'), '  user@example.com  ')
    setValue(screen.getByTestId('linuxdo-create-account-password'), 'secret-123')
    fillOtp(screen.getByTestId('linuxdo-create-account-verify-code'), ' 246810 ')
    await submitForm()

    expect(onSubmit.mock.calls).toEqual([
      [
        {
          email: 'user@example.com',
          password: 'secret-123',
          verifyCode: '246810'
        }
      ]
    ])
  })

  it('renders action labels through i18n keys', () => {
    mountForm(<PendingOAuthCreateAccountForm testIdPrefix='linuxdo' initialEmail='' isSubmitting={false} onSubmit={onSubmit} onSwitchToBind={vi.fn()} />)

    expect(pageText()).toContain('auth.createAccount')
    expect(pageText()).toContain('auth.alreadyHaveAccount')
  })

  it('hides email verification controls when public settings disable email verification', async () => {
    getPublicSettings.mockResolvedValue({
      email_verify_enabled: false,
      turnstile_enabled: false,
      turnstile_site_key: ''
    })

    mountForm(<PendingOAuthCreateAccountForm testIdPrefix='linuxdo' initialEmail='prefill@example.com' isSubmitting={false} onSubmit={onSubmit} onSwitchToBind={vi.fn()} />)

    await flushPromises()
    setValue(screen.getByTestId('linuxdo-create-account-password'), 'secret-123')
    await submitForm()

    expect(screen.queryByTestId('linuxdo-create-account-verify-code')).toBeNull()
    expect(screen.queryByTestId('linuxdo-create-account-send-code')).toBeNull()
    expect(onSubmit.mock.calls).toEqual([
      [
        {
          email: 'prefill@example.com',
          password: 'secret-123',
          verifyCode: ''
        }
      ]
    ])
  })

  it('shows and emits invitation code when invitation-only signup is enabled', async () => {
    getPublicSettings.mockResolvedValue({
      invitation_code_enabled: true,
      email_verify_enabled: true,
      turnstile_enabled: false,
      turnstile_site_key: ''
    })

    mountForm(<PendingOAuthCreateAccountForm testIdPrefix='linuxdo' initialEmail='prefill@example.com' isSubmitting={false} onSubmit={onSubmit} onSwitchToBind={vi.fn()} />)

    await flushPromises()
    setValue(screen.getByTestId('linuxdo-create-account-password'), 'secret-123')
    fillOtp(screen.getByTestId('linuxdo-create-account-verify-code'), '246810')
    setValue(screen.getByTestId('linuxdo-create-account-invitation-code'), ' INVITE123 ')
    await submitForm()

    expect(onSubmit.mock.calls).toEqual([
      [
        {
          email: 'prefill@example.com',
          password: 'secret-123',
          verifyCode: '246810',
          invitationCode: 'INVITE123'
        }
      ]
    ])
  })

  it('sends a verify code for the trimmed email value', async () => {
    sendPendingOAuthVerifyCode.mockResolvedValue({
      message: 'sent',
      countdown: 60
    })

    mountForm(<PendingOAuthCreateAccountForm testIdPrefix='linuxdo' initialEmail='' isSubmitting={false} onSubmit={onSubmit} onSwitchToBind={vi.fn()} />)

    setValue(screen.getByTestId('linuxdo-create-account-email'), '  user@example.com  ')
    fireEvent.click(screen.getByTestId('linuxdo-create-account-send-code'))
    await flushPromises()

    expect(sendPendingOAuthVerifyCode).toHaveBeenCalledWith({
      email: 'user@example.com'
    })
  })

  it('shows send-code failures via toast without rendering inline error text', async () => {
    sendPendingOAuthVerifyCode.mockRejectedValue(new Error('send failed'))

    mountForm(<PendingOAuthCreateAccountForm testIdPrefix='linuxdo' initialEmail='' isSubmitting={false} onSubmit={onSubmit} onSwitchToBind={vi.fn()} />)

    setValue(screen.getByTestId('linuxdo-create-account-email'), 'user@example.com')
    fireEvent.click(screen.getByTestId('linuxdo-create-account-send-code'))
    await flushPromises()

    expect(showErrorMock).toHaveBeenCalledWith('send failed')
    expect(pageText()).not.toContain('send failed')
  })

  it('consumes the captcha proof when sending a verify code fails', async () => {
    getPublicSettings.mockResolvedValue({
      turnstile_enabled: true,
      turnstile_site_key: 'site-key'
    })
    sendPendingOAuthVerifyCode.mockRejectedValue(new Error('send failed'))

    captchaControls.verifyButton = { testId: 'turnstile-verify', token: 'proof-token' }
    mountForm(<PendingOAuthCreateAccountForm testIdPrefix='oidc' initialEmail='user@example.com' isSubmitting={false} onSubmit={onSubmit} onSwitchToBind={vi.fn()} />)

    await flushPromises()
    fireEvent.click(screen.getByTestId('turnstile-verify'))
    fireEvent.click(screen.getByTestId('oidc-create-account-send-code'))
    await flushPromises()

    expect(captchaControls.reset).toHaveBeenCalledOnce()
    expect(screen.getByTestId('oidc-create-account-send-code')).toBeDisabled()
  })

  it('requires a turnstile token before sending a verify code when turnstile is enabled', async () => {
    getPublicSettings.mockResolvedValue({
      turnstile_enabled: true,
      turnstile_site_key: 'site-key'
    })
    sendPendingOAuthVerifyCode.mockResolvedValue({
      message: 'sent',
      countdown: 60
    })

    captchaControls.verifyButton = { testId: 'turnstile-verify', token: 'turnstile-token' }
    mountForm(<PendingOAuthCreateAccountForm testIdPrefix='linuxdo' initialEmail='' isSubmitting={false} onSubmit={onSubmit} onSwitchToBind={vi.fn()} />)

    await flushPromises()
    setValue(screen.getByTestId('linuxdo-create-account-email'), '  user@example.com  ')

    expect(screen.getByTestId('linuxdo-create-account-send-code')).toBeDisabled()

    fireEvent.click(screen.getByTestId('turnstile-verify'))
    fireEvent.click(screen.getByTestId('linuxdo-create-account-send-code'))
    await flushPromises()

    expect(sendPendingOAuthVerifyCode).toHaveBeenCalledWith({
      email: 'user@example.com',
      turnstile_token: 'turnstile-token'
    })
  })

  it('requires a turnstile token before submitting when turnstile is enabled', async () => {
    getPublicSettings.mockResolvedValue({
      turnstile_enabled: true,
      turnstile_site_key: 'site-key'
    })

    captchaControls.verifyButton = { testId: 'turnstile-verify', token: 'turnstile-token' }
    mountForm(<PendingOAuthCreateAccountForm testIdPrefix='linuxdo' initialEmail='user@example.com' isSubmitting={false} onSubmit={onSubmit} onSwitchToBind={vi.fn()} />)

    await flushPromises()
    setValue(screen.getByTestId('linuxdo-create-account-password'), 'secret-123')

    expect(screen.getByTestId('linuxdo-create-account-submit')).toBeDisabled()

    // 隐式提交（输入框回车）绕过按钮 disabled，仍不能带着空票据发出请求
    await submitForm()
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('turnstile-verify'))

    expect(screen.getByTestId('linuxdo-create-account-submit')).not.toBeDisabled()

    fireEvent.click(screen.getByTestId('linuxdo-create-account-submit'))
    await flushPromises()

    expect(onSubmit.mock.calls).toEqual([
      [
        {
          email: 'user@example.com',
          password: 'secret-123',
          verifyCode: '',
          turnstileToken: 'turnstile-token',
          invitationCode: undefined
        }
      ]
    ])
  })

  it('blocks submit again after sending a verify code consumes the turnstile proof', async () => {
    getPublicSettings.mockResolvedValue({
      turnstile_enabled: true,
      turnstile_site_key: 'site-key'
    })
    sendPendingOAuthVerifyCode.mockResolvedValue({ message: 'sent', countdown: 60 })

    captchaControls.verifyButton = { testId: 'turnstile-verify', token: 'turnstile-token' }
    mountForm(<PendingOAuthCreateAccountForm testIdPrefix='linuxdo' initialEmail='user@example.com' isSubmitting={false} onSubmit={onSubmit} onSwitchToBind={vi.fn()} />)

    await flushPromises()
    setValue(screen.getByTestId('linuxdo-create-account-password'), 'secret-123')
    fireEvent.click(screen.getByTestId('turnstile-verify'))
    fireEvent.click(screen.getByTestId('linuxdo-create-account-send-code'))
    await flushPromises()

    // 发码消耗掉票据并 reset 组件，新票据回调前提交必须保持关闭
    expect(captchaControls.reset).toHaveBeenCalled()
    expect(screen.getByTestId('linuxdo-create-account-submit')).toBeDisabled()

    await submitForm()
    expect(onSubmit).not.toHaveBeenCalled()

    // 新票据回调后恢复可提交，且带上新票据
    fireEvent.click(screen.getByTestId('turnstile-verify'))
    fireEvent.click(screen.getByTestId('linuxdo-create-account-submit'))
    await flushPromises()

    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      turnstileToken: 'turnstile-token'
    })
  })
})
