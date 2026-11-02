import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SubscriptionBulkAction, SubscriptionBulkActionResult } from '@/api/admin/subscriptions'
import type { UserSubscription } from '@/types'
import BulkSubscriptionActionDialog from '../BulkSubscriptionActionDialog'

const { bulkAction, dialogProps } = vi.hoisted(() => ({
  bulkAction: vi.fn(),
  // BaseDialog 替身最近一次收到的 props（Vue 版 findComponent({ name: 'BaseDialog' }).props()）
  dialogProps: { current: null as any }
}))

vi.mock('@/api/admin', () => ({ adminAPI: { subscriptions: { bulkAction } } }))
vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    te: () => true,
    locale: 'en'
  })
}))
vi.mock('@/components/common/BaseDialog', () => ({
  default: (props: { title: string; children?: ReactNode; footer?: ReactNode }) => {
    dialogProps.current = props
    return (
      <section>
        <h2>{props.title}</h2>
        {props.children}
        <footer>{props.footer}</footer>
      </section>
    )
  }
}))

function subscription(id: number): UserSubscription {
  return {
    id,
    user_id: id,
    group_id: 8,
    status: 'active',
    user: { email: `user${id}@example.com` },
    group: { name: 'Subscription group' }
  } as UserSubscription
}

const successResult: SubscriptionBulkActionResult = {
  success_count: 2,
  failed_count: 0,
  results: [
    { subscription_id: 1, success: true },
    { subscription_id: 2, success: true }
  ]
}

const onClose = vi.fn()
const onCompleted = vi.fn()

function mountDialog(action: SubscriptionBulkAction = 'extend', subscriptions = [subscription(1), subscription(2)]) {
  const view = render(
    <BulkSubscriptionActionDialog show action={action} subscriptions={subscriptions} onClose={onClose} onCompleted={onCompleted} />
  )
  const setProps = (next: { action?: SubscriptionBulkAction; subscriptions?: UserSubscription[] }) =>
    view.rerender(
      <BulkSubscriptionActionDialog
        show
        action={next.action ?? action}
        subscriptions={next.subscriptions ?? subscriptions}
        onClose={onClose}
        onCompleted={onCompleted}
      />
    )
  return { ...view, setProps }
}

const flushPromises = () => act(async () => {})
const text = () => document.body.textContent ?? ''
const daysInput = () => document.querySelector<HTMLInputElement>('input[type="number"]')!
const form = () => document.querySelector('form')!
const submitForm = async () => {
  fireEvent.submit(form())
  await flushPromises()
}
const setDays = (value: string | number) => fireEvent.change(daysInput(), { target: { value: String(value) } })
// Vue 版用原生 checkbox 的 name 定位；Arc checkbox 是 role="checkbox" 的按钮，按标签定位
const windowCheckbox = (name: string) => screen.getByRole('checkbox', { name: `admin.subscriptions.${name}` })
const footerButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('footer button'))

let adminId = 100

beforeEach(() => {
  bulkAction.mockReset()
  bulkAction.mockResolvedValue(successResult)
  onClose.mockReset()
  onCompleted.mockReset()
  localStorage.setItem('auth_user', JSON.stringify({ id: ++adminId }))
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('BulkSubscriptionActionDialog', () => {
  it.each([30, -7, 36500, -36500])('submits whole-day adjustments of %s and shows target identities', async (days) => {
    mountDialog()
    expect(text()).toContain('user1@example.com')
    expect(text()).toContain('Subscription group')
    setDays(days)
    await submitForm()
    expect(bulkAction).toHaveBeenCalledWith({ subscription_ids: [1, 2], action: 'extend', days }, expect.any(String))
    expect(onCompleted.mock.calls).toEqual([[successResult]])
    expect(document.querySelector('button[type="submit"]')).toBeNull()
  })

  it.each([0, 1.5, 36501, -36501, ''])('rejects invalid day value %s', async (days) => {
    mountDialog()
    setDays(days)
    await submitForm()
    expect(text()).toContain('admin.subscriptions.bulk.invalidDays')
    expect(bulkAction).not.toHaveBeenCalled()
  })

  it('defaults to all quota windows and validates at least one selected window', async () => {
    mountDialog('reset_quota')
    for (const name of ['daily', 'weekly', 'monthly']) {
      expect(windowCheckbox(name).getAttribute('aria-checked')).toBe('true')
      fireEvent.click(windowCheckbox(name))
    }
    await submitForm()
    expect(bulkAction).not.toHaveBeenCalled()
    expect(text()).toContain('admin.subscriptions.bulk.selectWindow')

    fireEvent.click(windowCheckbox('weekly'))
    await submitForm()
    expect(bulkAction).toHaveBeenCalledWith(
      { subscription_ids: [1, 2], action: 'reset_quota', daily: false, weekly: true, monthly: false },
      expect.any(String)
    )
  })

  it.each(['revoke', 'restore'] as const)('submits %s without unrelated parameters', async (action) => {
    mountDialog(action)
    expect(text()).toContain(`admin.subscriptions.bulk.${action}Hint`)
    await submitForm()
    expect(bulkAction).toHaveBeenCalledWith({ subscription_ids: [1, 2], action }, expect.any(String))
  })

  it.each([0, 101])('rejects a selection of %s subscriptions', async (count) => {
    mountDialog(
      'revoke',
      Array.from({ length: count }, (_, index) => subscription(index + 1))
    )
    await submitForm()
    expect(bulkAction).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
  })

  it('prevents duplicate submits, parameter edits, and closing while submitting', async () => {
    let resolve!: (value: SubscriptionBulkActionResult) => void
    bulkAction.mockReturnValue(
      new Promise<SubscriptionBulkActionResult>((done) => {
        resolve = done
      })
    )
    mountDialog()
    fireEvent.submit(form())
    fireEvent.submit(form())
    act(() => dialogProps.current.onClose())
    expect(bulkAction).toHaveBeenCalledTimes(1)
    expect(daysInput().disabled).toBe(true)
    expect(dialogProps.current.closeOnEscape).toBe(false)
    expect(dialogProps.current.showCloseButton).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
    resolve(successResult)
    await flushPromises()
    expect(dialogProps.current.closeOnEscape).toBe(true)
  })

  it('shows partial failures and keeps the original target list after the parent refreshes', async () => {
    const partial: SubscriptionBulkActionResult = {
      success_count: 1,
      failed_count: 1,
      results: [
        { subscription_id: 1, success: true },
        { subscription_id: 2, success: false, error: 'Subscription is revoked' }
      ]
    }
    bulkAction.mockResolvedValue(partial)
    const view = mountDialog('reset_quota')
    await submitForm()
    view.setProps({ subscriptions: [subscription(2)] })
    expect(text()).toContain('user1@example.com')
    expect(text()).toContain('user2@example.com')
    expect(text()).toContain('Subscription is revoked')
    expect(onCompleted.mock.calls).toEqual([[partial]])
    expect(footerButtons()).toHaveLength(1)
    await submitForm()
    expect(bulkAction).toHaveBeenCalledTimes(1)
    fireEvent.click(footerButtons()[0]!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('retries an unknown outcome with the original payload and key, even when props change', async () => {
    bulkAction.mockRejectedValueOnce({ status: 0, message: 'Connection lost' })
    const view = mountDialog()
    setDays(-7)
    await submitForm()
    expect(text()).toContain('Connection lost')
    expect(text()).toContain('admin.subscriptions.bulk.retryHint')
    expect(daysInput().disabled).toBe(true)
    expect(dialogProps.current.closeOnEscape).toBe(true)
    view.setProps({ action: 'revoke', subscriptions: [subscription(3)] })
    await submitForm()
    expect(bulkAction.mock.calls[1]).toEqual(bulkAction.mock.calls[0])
    expect(bulkAction.mock.calls[1]![0]).toEqual({ subscription_ids: [1, 2], action: 'extend', days: -7 })
    expect(onCompleted.mock.calls).toEqual([[successResult]])
  })

  it('retains a pending key across closing and reopening, then releases it on completion', async () => {
    bulkAction.mockRejectedValueOnce({ status: 503, message: 'Unavailable' })
    const first = mountDialog()
    await submitForm()
    fireEvent.click(document.querySelector('footer button[type="button"]')!)
    expect(onClose).toHaveBeenCalledTimes(1)
    first.unmount()

    const retry = mountDialog('extend', [subscription(2), subscription(1)])
    await submitForm()
    expect(bulkAction.mock.calls[1]).toEqual(bulkAction.mock.calls[0])
    retry.unmount()

    mountDialog()
    await submitForm()
    expect(bulkAction.mock.calls[2]![1]).not.toBe(bulkAction.mock.calls[0]![1])
  })

  it('uses a new key after a definitive initial validation failure and allows correcting parameters', async () => {
    bulkAction.mockRejectedValueOnce({ status: 400, message: 'Invalid adjustment' })
    mountDialog()
    await submitForm()
    expect(daysInput().disabled).toBe(false)
    setDays(7)
    await submitForm()
    expect(bulkAction.mock.calls[1]![0].days).toBe(7)
    expect(bulkAction.mock.calls[1]![1]).not.toBe(bulkAction.mock.calls[0]![1])
  })

  it('keeps the pending key when a retry is rate limited after an unknown outcome', async () => {
    bulkAction.mockRejectedValueOnce({ status: 0 }).mockRejectedValueOnce({ status: 429 })
    mountDialog()
    for (let attempt = 0; attempt < 3; attempt++) {
      await submitForm()
    }
    expect(bulkAction.mock.calls[1]).toEqual(bulkAction.mock.calls[0])
    expect(bulkAction.mock.calls[2]).toEqual(bulkAction.mock.calls[0])
  })
})
