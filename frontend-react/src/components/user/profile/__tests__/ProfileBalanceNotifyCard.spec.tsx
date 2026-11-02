import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ProfileBalanceNotifyCard, { type ProfileBalanceNotifyCardProps } from '../ProfileBalanceNotifyCard'
import { useAppStore } from '@/stores/app'

const api = vi.hoisted(() => ({ sendNotifyEmailCode: vi.fn(), verifyNotifyEmail: vi.fn(), getProfile: vi.fn() }))

vi.mock('@/api', () => ({ userAPI: api }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const baseProps: ProfileBalanceNotifyCardProps = {
  enabled: true,
  threshold: null,
  extraEmails: [],
  systemDefaultThreshold: 5,
  userEmail: ''
}

const flushPromises = () => act(async () => {})
const pendingRows = () => screen.queryAllByTestId('balance-notify-pending-row')
const pendingEmails = () => pendingRows().map((row) => row.querySelector('span')!.textContent)
const clickButton = async (name: string, scope: HTMLElement = document.body) => {
  await act(async () => {
    fireEvent.click(within(scope).getAllByRole('button', { name })[0]!)
  })
}
const addEmail = async (email: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'profile.balanceNotify.emailPlaceholder' }), {
    target: { value: email }
  })
  await clickButton('common.add')
}

describe('ProfileBalanceNotifyCard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    useAppStore.setState({ showSuccess: vi.fn(), showError: vi.fn() })
    api.sendNotifyEmailCode.mockResolvedValue({})
    api.getProfile.mockResolvedValue({ balance_notify_extra_emails: [] })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it.each(['remove', 'unmount'])('does not start a pending email timer after %s', async (action) => {
    const request = deferred()
    api.sendNotifyEmailCode.mockReturnValueOnce(request.promise)
    const view = render(<ProfileBalanceNotifyCard {...baseProps} />)
    await addEmail('new@example.com')
    await clickButton('profile.balanceNotify.sendCode')
    if (action === 'remove') await clickButton('profile.balanceNotify.removeEmail')
    else view.unmount()
    // Arc 组件自身的动画定时器在挂载期间存在，这里只断言请求返回后没有新增倒计时定时器
    const timersBeforeResolve = action === 'unmount' ? 0 : vi.getTimerCount()

    await act(async () => {
      request.resolve()
    })
    expect(vi.getTimerCount()).toBe(timersBeforeResolve)
  })

  it('does not start a saved email timer after unmount', async () => {
    const request = deferred()
    api.sendNotifyEmailCode.mockReturnValueOnce(request.promise)
    const view = render(
      <ProfileBalanceNotifyCard
        {...baseProps}
        extraEmails={[{ email: 'saved@example.com', disabled: false, verified: false }]}
      />
    )
    await clickButton('profile.balanceNotify.verify')
    view.unmount()
    await act(async () => {
      request.resolve()
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([0, 1])('removes only verified emails when request %i finishes first', async (first) => {
    const emails = ['first@example.com', 'second@example.com', 'third@example.com']
    const requests = [deferred(), deferred()]
    api.verifyNotifyEmail.mockImplementation((email: string) => requests[emails.indexOf(email)]!.promise)
    render(<ProfileBalanceNotifyCard {...baseProps} />)

    for (const email of emails) {
      await addEmail(email)
    }
    for (const row of pendingRows()) {
      await clickButton('profile.balanceNotify.sendCode', row)
    }
    await flushPromises()
    for (const row of pendingRows()) {
      fireEvent.change(row.querySelector('input')!, { target: { value: '123456' } })
    }
    for (const row of pendingRows().slice(0, 2)) {
      await clickButton('profile.balanceNotify.verify', row)
    }
    expect(api.verifyNotifyEmail.mock.calls).toEqual(emails.slice(0, 2).map((email) => [email, '123456']))

    await act(async () => {
      requests[first]!.resolve()
    })
    expect(pendingEmails()).toEqual(emails.filter((_, index) => index !== first))

    await act(async () => {
      requests[1 - first]!.resolve()
    })
    expect(pendingEmails()).toEqual([emails[2]])
    expect(pendingRows()[0]!.querySelector('input')!.value).toBe('123456')
    expect(api.getProfile).toHaveBeenCalledTimes(2)
  })
})
