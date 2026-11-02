import type { ReactNode } from 'react'
import { fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ForgotPasswordView from '@/views/auth/ForgotPasswordView'
import { useAppStore } from '@/stores/app'
import { flushPromises, renderAt, setValue } from './authTestUtils'
import { captchaControls, resetCaptchaControls } from './captchaStub'

const { getPublicSettingsMock, forgotPasswordMock } = vi.hoisted(() => ({
  getPublicSettingsMock: vi.fn(),
  forgotPasswordMock: vi.fn()
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: 'en', setLocale: vi.fn() })
}))

vi.mock('@/layouts/AuthLayout', () => ({
  AuthFooter: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/components/captcha/CaptchaChallenge', async () => (await import('./captchaStub')).captchaModule)

vi.mock('@/api/auth', () => ({
  getPublicSettings: (...args: unknown[]) => getPublicSettingsMock(...args),
  forgotPassword: (...args: unknown[]) => forgotPasswordMock(...args)
}))

function mountForgotPassword() {
  return renderAt(<ForgotPasswordView />, '/forgot-password')
}

describe('忘记密码腾讯验证码门禁', () => {
  beforeEach(() => {
    getPublicSettingsMock.mockReset()
    forgotPasswordMock.mockReset()
    resetCaptchaControls()
    useAppStore.setState({ showError: vi.fn(), showSuccess: vi.fn() })
    getPublicSettingsMock.mockResolvedValue({
      turnstile_enabled: false,
      turnstile_site_key: '',
      tencent_captcha_enabled: true,
      tencent_captcha_app_id: '123456789',
      tencent_captcha_region: 'intl',
      aliyun_captcha_enabled: false
    })
    captchaControls.verifyAction.mockResolvedValue({ token: 'ticket-value', randstr: '@rand-value' })
    forgotPasswordMock.mockResolvedValue({ message: 'ok' })
  })

  it('把公开设置中的站点传给验证码组件', async () => {
    mountForgotPassword()
    await flushPromises()

    const props = captchaControls.props[captchaControls.props.length - 1]
    expect(props.tencentEnabled).toBe(true)
    expect(props.tencentAppId).toBe('123456789')
    expect(props.tencentRegion).toBe('intl')
  })

  it('提交前获取新票据并原样发送到忘记密码接口', async () => {
    mountForgotPassword()
    await flushPromises()
    setValue(document.getElementById('email')!, 'user@example.com')

    fireEvent.submit(document.querySelector('form')!)
    await flushPromises()

    expect(captchaControls.verifyAction).toHaveBeenCalledOnce()
    expect(forgotPasswordMock).toHaveBeenCalledWith({
      email: 'user@example.com',
      turnstile_token: undefined,
      tencent_captcha_ticket: 'ticket-value',
      tencent_captcha_randstr: '@rand-value'
    })
    expect(captchaControls.reset).toHaveBeenCalledOnce()
  })
})
