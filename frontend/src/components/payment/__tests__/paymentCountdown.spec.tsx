import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PaymentQRDialog from '../PaymentQRDialog'
import PaymentStatusPanel from '../PaymentStatusPanel'
import PaymentQRCodeView from '@/views/user/PaymentQRCodeView'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }),
}))
const pollOrderStatus = vi.hoisted(() => vi.fn())
vi.mock('@/stores/payment', () => ({
  usePaymentStore: { getState: () => ({ pollOrderStatus }) },
}))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showError: vi.fn() }) } }))
vi.mock('@/api/payment', () => ({ paymentAPI: {} }))
vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))
vi.mock('react-router', () => ({
  useSearchParams: () => [new URLSearchParams({ order_id: '42', expires_at: new Date(Date.now() + 120_000).toISOString() })],
  useNavigate: () => vi.fn(),
}))
vi.mock('@/components/common/BaseDialog', () => ({
  default: ({ show, children, footer }: { show: boolean; children?: ReactNode; footer?: ReactNode }) =>
    show ? <div>{children}{footer}</div> : null,
}))

beforeEach(() => {
  pollOrderStatus.mockReset().mockResolvedValue(null)
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-30T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

function open(kind: 'dialog' | 'panel' | 'page') {
  const props = { orderId: 42, qrCode: '', expiresAt: new Date(Date.now() + 120_000).toISOString(), paymentType: 'custom' }
  if (kind === 'page') return render(<PaymentQRCodeView />)
  if (kind === 'panel') return render(<PaymentStatusPanel {...props} />)
  const utils = render(<PaymentQRDialog {...props} show={false} />)
  utils.rerender(<PaymentQRDialog {...props} show />)
  return utils
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe.each(['dialog', 'panel', 'page'] as const)('payment countdown: %s', (kind) => {
  it('catches up after timers were suspended', async () => {
    const { container } = open(kind)
    expect(container.textContent).toContain('02:00')
    vi.setSystemTime(Date.now() + 65_000)
    await advance(1000)
    expect(container.textContent).toContain('00:54')
  })

  it('expires and stops polling on the first overdue tick', async () => {
    const { container } = open(kind)
    vi.setSystemTime(Date.now() + 121_000)
    await advance(1000)
    expect(container.textContent).toContain('payment.qr.expired')
    // 过期那一刻可能还挂着渲染/按钮动画调度的一次性定时器，数量随渲染时机波动；
    // 推进 30 秒让它们全部执行，剩下的只可能是没清掉的倒计时或轮询 interval
    const pollsAtExpiry = pollOrderStatus.mock.calls.length
    await advance(30_000)
    expect(pollOrderStatus).toHaveBeenCalledTimes(pollsAtExpiry)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('still counts down normally', async () => {
    const { container } = open(kind)
    await advance(1000)
    expect(container.textContent).toContain('01:59')
  })
})
