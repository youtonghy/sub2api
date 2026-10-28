import { beforeEach, describe, expect, it, vi } from 'vitest'

import WechatPaymentCallbackView from '@/views/auth/WechatPaymentCallbackView'
import { useAppStore } from '@/stores/app'
import { flushPromises, pageText, renderAt } from './authTestUtils'

const { replaceMock, locationState, showErrorMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  locationState: {
    current: {
      href: 'http://localhost/auth/wechat/payment/callback',
      hash: '',
      search: '',
      pathname: '/auth/wechat/payment/callback',
      origin: 'http://localhost',
    } as Location & { origin: string },
  },
  showErrorMock: vi.fn(),
}))

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => replaceMock,
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      if (key === 'auth.wechatPayment.callbackTitle') return '正在恢复微信支付'
      if (key === 'auth.wechatPayment.callbackProcessing') return '正在恢复微信支付...'
      if (key === 'auth.wechatPayment.backToPayment') return '返回支付页'
      if (key === 'auth.wechatPayment.callbackMissingResumeToken') return '微信支付回调缺少恢复令牌。'
      return key
    },
    te: () => false,
    locale: 'zh',
    setLocale: vi.fn(),
  }),
}))

/** Vue 版 router.replace({ path, query }) 对应 navigate({ pathname, search }, { replace: true }) */
function expectReplacedWith(path: string, query: Record<string, string>) {
  expect(replaceMock).toHaveBeenCalledTimes(1)
  const [target, options] = replaceMock.mock.calls[0]
  expect(options).toEqual({ replace: true })
  expect(target.pathname).toBe(path)
  expect(Object.fromEntries(new URLSearchParams(target.search))).toEqual(query)
}

describe('WechatPaymentCallbackView', () => {
  beforeEach(() => {
    replaceMock.mockReset()
    showErrorMock.mockReset()
    useAppStore.setState({ showError: (...args: any[]) => showErrorMock(...args) })
    locationState.current = {
      href: 'http://localhost/auth/wechat/payment/callback',
      hash: '',
      search: '',
      pathname: '/auth/wechat/payment/callback',
      origin: 'http://localhost',
    } as Location & { origin: string }
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: locationState.current,
    })
  })

  it('redirects back to purchase with an opaque resume token from hash fragment', async () => {
    locationState.current.hash = '#wechat_resume_token=resume-token-123&redirect=%2Fpurchase%3Ffrom%3Dwechat'

    renderAt(<WechatPaymentCallbackView />, '/auth/wechat/payment/callback')
    await flushPromises()

    expectReplacedWith('/purchase', {
      from: 'wechat',
      wechat_resume: '1',
      wechat_resume_token: 'resume-token-123',
    })
  })

  it('redirects legacy openid callback payloads back to purchase while preserving resume context', async () => {
    locationState.current.hash =
      '#openid=openid-123&state=oauth-state&scope=snsapi_base&payment_type=wxpay_direct&amount=128&order_type=subscription&plan_id=7&redirect=%2Fpayment%3Ffrom%3Dwechat'

    renderAt(<WechatPaymentCallbackView />, '/auth/wechat/payment/callback')
    await flushPromises()

    expectReplacedWith('/purchase', {
      from: 'wechat',
      wechat_resume: '1',
      openid: 'openid-123',
      state: 'oauth-state',
      scope: 'snsapi_base',
      payment_type: 'wxpay_direct',
      amount: '128',
      order_type: 'subscription',
      plan_id: '7',
    })
  })

  it('shows an error when the callback payload is missing the resume token', async () => {
    locationState.current.hash = '#payment_type=wxpay'

    renderAt(<WechatPaymentCallbackView />, '/auth/wechat/payment/callback')
    await flushPromises()

    expect(replaceMock).not.toHaveBeenCalled()
    expect(showErrorMock).toHaveBeenCalledWith('微信支付回调缺少恢复令牌。')
    expect(pageText()).toContain('微信支付回调缺少恢复令牌。')
  })
})
