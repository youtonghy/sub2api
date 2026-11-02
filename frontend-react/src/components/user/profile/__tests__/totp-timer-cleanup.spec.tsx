import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import TotpDisableDialog from '@/components/user/profile/TotpDisableDialog'
import TotpSetupModal from '@/components/user/profile/TotpSetupModal'
import { useAppStore } from '@/stores/app'

const mocks = vi.hoisted(() => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  getVerificationMethod: vi.fn(),
  sendVerifyCode: vi.fn(),
  initiateSetup: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn()
}))

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

vi.mock('@/api', () => ({
  totpAPI: {
    getVerificationMethod: mocks.getVerificationMethod,
    sendVerifyCode: mocks.sendVerifyCode,
    initiateSetup: mocks.initiateSetup,
    enable: mocks.enable,
    disable: mocks.disable
  }
}))

const flushPromises = () => act(async () => {})
const sendButton = () => screen.getAllByRole('button').find((b) => b.textContent?.includes('profile.totp.sendCode'))

describe('TOTP 弹窗定时器清理', () => {
  // jsdom 用 setInterval(16ms) 模拟 requestAnimationFrame（Arc 组件的动画会触发），
  // 断言只统计组件自身 1000ms 的倒计时定时器
  const cooldownTimers = () =>
    setIntervalSpy.mock.calls
      .map((call, index) => ({ delay: call[1], id: setIntervalSpy.mock.results[index]?.value }))
      .filter((item) => item.delay === 1000)

  let intervalSeed = 1000
  let setIntervalSpy: MockInstance<typeof window.setInterval>
  let clearIntervalSpy: MockInstance<typeof window.clearInterval>

  beforeEach(() => {
    intervalSeed = 1000
    Object.values(mocks).forEach((mock) => mock.mockReset())
    useAppStore.setState({ showSuccess: mocks.showSuccess, showError: mocks.showError })

    mocks.getVerificationMethod.mockResolvedValue({ method: 'email' })
    mocks.sendVerifyCode.mockResolvedValue({ success: true })
    mocks.initiateSetup.mockResolvedValue({
      qr_code_url: 'otpauth://totp/Sub2API:test?secret=ABC123',
      secret: 'ABC123',
      setup_token: 'setup-token'
    })
    mocks.enable.mockResolvedValue({ success: true })
    mocks.disable.mockResolvedValue({ success: true })

    setIntervalSpy = vi.spyOn(window, 'setInterval').mockImplementation(((handler: TimerHandler) => {
      void handler
      intervalSeed += 1
      return intervalSeed as unknown as number
    }) as typeof window.setInterval)
    clearIntervalSpy = vi.spyOn(window, 'clearInterval')
  })

  afterEach(() => {
    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })

  it.each([TotpSetupModal, TotpDisableDialog] as ComponentType[])(
    'does not start a cooldown after unmounting during send',
    async (Component) => {
      let resolve!: (value: unknown) => void
      mocks.sendVerifyCode.mockReturnValueOnce(new Promise((res) => (resolve = res)))
      const view = render(<Component />)
      await flushPromises()
      await act(async () => {
        fireEvent.click(sendButton()!)
      })
      view.unmount()
      await act(async () => {
        resolve({ success: true })
      })
      expect(cooldownTimers()).toHaveLength(0)
      expect(mocks.showSuccess).not.toHaveBeenCalled()
    }
  )

  it('TotpSetupModal 卸载时清理倒计时定时器', async () => {
    const view = render(<TotpSetupModal />)
    await flushPromises()

    expect(sendButton()).toBeTruthy()
    await act(async () => {
      fireEvent.click(sendButton()!)
    })
    await flushPromises()

    expect(cooldownTimers()).toHaveLength(1)
    const timerId = cooldownTimers()[0]?.id

    view.unmount()

    expect(clearIntervalSpy).toHaveBeenCalledWith(timerId)
  })

  it('TotpDisableDialog 卸载时清理倒计时定时器', async () => {
    const view = render(<TotpDisableDialog />)
    await flushPromises()

    expect(sendButton()).toBeTruthy()
    await act(async () => {
      fireEvent.click(sendButton()!)
    })
    await flushPromises()

    expect(cooldownTimers()).toHaveLength(1)
    const timerId = cooldownTimers()[0]?.id

    view.unmount()

    expect(clearIntervalSpy).toHaveBeenCalledWith(timerId)
  })

  it('TotpSetupModal 失败时改用 toast 并不渲染内联错误', async () => {
    mocks.getVerificationMethod.mockResolvedValue({ method: 'password' })
    mocks.initiateSetup.mockRejectedValue({ response: { data: { message: 'setup failed' } } })

    render(<TotpSetupModal />)
    await flushPromises()

    fireEvent.change(document.querySelector('input[type="password"]')!, {
      target: { value: 'correct horse battery staple' }
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    })
    await flushPromises()

    expect(mocks.showError).toHaveBeenCalledWith('setup failed')
    expect(document.body.textContent).not.toContain('setup failed')
  })

  it('TotpDisableDialog 失败时改用 toast 并不渲染内联错误', async () => {
    mocks.getVerificationMethod.mockResolvedValue({ method: 'password' })
    mocks.disable.mockRejectedValue({ response: { data: { message: 'disable failed' } } })

    render(<TotpDisableDialog />)
    await flushPromises()

    fireEvent.change(document.querySelector('input[type="password"]')!, {
      target: { value: 'correct horse battery staple' }
    })
    await act(async () => {
      fireEvent.submit(document.querySelector('form')!)
    })
    await flushPromises()

    expect(mocks.showError).toHaveBeenCalledWith('disable failed')
    expect(document.body.textContent).not.toContain('disable failed')
  })
})
