/* eslint-disable react-refresh/only-export-components -- 测试替身文件，不参与热更新 */
/**
 * CaptchaChallenge 的测试替身，对应 Vue spec 里的 TurnstileWidget stub。
 * 用法：vi.mock('@/components/captcha/CaptchaChallenge', async () => (await import('./captchaStub')).captchaModule)
 */
import { forwardRef, useImperativeHandle } from 'react'
import { vi } from 'vitest'

import type { CaptchaChallengeHandle, CaptchaChallengeProps } from '@/components/captcha/CaptchaChallenge'

export const captchaControls = {
  verifyAction: vi.fn(),
  reset: vi.fn(),
  /** 设置后渲染一个按钮，点击时以该 token 触发 onVerify（模拟 Turnstile 回调） */
  verifyButton: null as null | { testId: string; token: string },
  /** 每个实例最近一次渲染时的 props */
  props: [] as CaptchaChallengeProps[]
}

export function resetCaptchaControls(): void {
  captchaControls.verifyAction.mockReset()
  captchaControls.reset.mockReset()
  captchaControls.verifyButton = null
  captchaControls.props = []
}

const CaptchaChallengeStub = forwardRef<CaptchaChallengeHandle, CaptchaChallengeProps>(function CaptchaChallengeStub(props, ref) {
  useImperativeHandle(ref, () => ({
    verifyAction: (...args: []) => captchaControls.verifyAction(...args),
    reset: () => captchaControls.reset()
  }), [])
  captchaControls.props.push(props)
  const button = captchaControls.verifyButton
  if (button) {
    return (
      <button type="button" data-testid={button.testId} onClick={() => props.onVerify?.(button.token, '')}>
        verify
      </button>
    )
  }
  return <div data-testid="captcha-challenge" />
})

export const captchaModule = { default: CaptchaChallengeStub }
