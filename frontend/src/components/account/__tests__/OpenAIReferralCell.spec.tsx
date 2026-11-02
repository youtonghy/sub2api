import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { refreshOpenAIReferrals, sendOpenAIReferralInvite } from '@/api/admin/accounts'
import type { Account } from '@/types'
import type { OpenAIReferralEligibility, OpenAIReferralRefreshResult } from '@/types/openaiReferrals'
import OpenAIReferralCell from '../OpenAIReferralCell'

vi.mock('@/api/admin/accounts', () => ({ refreshOpenAIReferrals: vi.fn(), sendOpenAIReferralInvite: vi.fn() }))
vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${Object.values(params).join(',')}` : key),
    te: () => true,
    locale: 'en'
  })
}))

const eligibility: OpenAIReferralEligibility = {
  should_show: true,
  remaining_send_capacity: 3,
  remaining_reward_capacity: 2,
  requires_explicit_confirmation: true,
  program_id: 'codex_referral_consumer',
  available_invites: 2,
  fetched_at: 1770000000,
  title: 'Test offer',
  rules: ['Test eligibility rule']
}
const account = (overrides: Partial<Account> = {}) =>
  ({
    id: 1,
    name: 'Test account',
    platform: 'openai',
    type: 'oauth',
    ...overrides
  }) as Account

const flushPromises = () => act(async () => {})
const mountCell = (value = account()) => render(<OpenAIReferralCell account={value} />)
const open = async () => {
  fireEvent.click(screen.getByTestId('referral-open'))
  await flushPromises()
}
// 对话框经 Radix Portal 渲染到 document.body
const emailInput = () => screen.getByTestId('referral-email') as HTMLInputElement
const consent = () => screen.getByTestId('referral-consent')
const sendButton = () => screen.getByTestId('referral-send')
const form = () => document.body.querySelector('form') as HTMLFormElement
const setEmail = (value: string) => fireEvent.change(emailInput(), { target: { value } })
// Arc 复选框（Radix）是 role=checkbox 的按钮，点击切换
const checkConsent = () => {
  if (consent().getAttribute('aria-checked') !== 'true') fireEvent.click(consent())
}
const completeForm = () => {
  setEmail('friend@example.com')
  checkConsent()
}
const submit = () => fireEvent.submit(form())

beforeEach(() => {
  vi.mocked(refreshOpenAIReferrals).mockReset().mockResolvedValue({ eligibility: { ...eligibility }, cache_persisted: true })
  vi.mocked(sendOpenAIReferralInvite).mockReset()
})
afterEach(cleanup)

describe('OpenAIReferralCell', () => {
  it('shows cached capacity without sending requests, then refreshes when opening the form', async () => {
    mountCell(account({ extra: { codex_referral_snapshot: eligibility } }))
    expect(screen.getByTestId('referral-count').textContent).toContain('2')
    expect(refreshOpenAIReferrals).not.toHaveBeenCalled()
    await open()
    expect(refreshOpenAIReferrals).toHaveBeenCalledWith(1)
    expect(document.body.textContent).toContain('Test account')
    expect(document.body.textContent).toContain('Test eligibility rule')
    expect(sendButton()).toBeDisabled()
    expect(sendOpenAIReferralInvite).not.toHaveBeenCalled()
  })

  it('requires a valid email and consent, and clears consent when the recipient changes', async () => {
    mountCell()
    await open()
    setEmail('invalid')
    checkConsent()
    submit()
    expect(sendOpenAIReferralInvite).not.toHaveBeenCalled()
    setEmail('friend@example.com')
    expect(consent()).toHaveAttribute('aria-checked', 'false')
    expect(sendButton()).toBeDisabled()
    checkConsent()
    expect(sendButton()).not.toBeDisabled()
  })

  it.each([0, null])('blocks sends when remaining capacity is %s', async (capacity) => {
    vi.mocked(refreshOpenAIReferrals).mockResolvedValue({
      eligibility: { ...eligibility, available_invites: capacity },
      cache_persisted: true
    })
    mountCell()
    await open()
    completeForm()
    submit()
    expect(sendOpenAIReferralInvite).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('admin.accounts.openaiReferral.unavailable')
  })

  it('sends once and displays the recipient and refreshed count', async () => {
    vi.mocked(sendOpenAIReferralInvite).mockResolvedValue({
      sent: true,
      email: 'friend@example.com',
      eligibility: { ...eligibility, available_invites: 1 },
      cache_persisted: true,
      refresh_failed: false
    })
    mountCell()
    await open()
    completeForm()
    submit()
    submit()
    await flushPromises()
    expect(sendOpenAIReferralInvite).toHaveBeenCalledTimes(1)
    expect(sendOpenAIReferralInvite).toHaveBeenCalledWith(1, {
      email: 'friend@example.com',
      program_id: 'codex_referral_consumer',
      confirmed: true
    })
    expect(document.body.textContent).toContain('admin.accounts.openaiReferral.sent:friend@example.com')
    expect(screen.getByTestId('referral-count').textContent).toContain('1')
    expect(emailInput().value).toBe('')
  })

  it('keeps send success when the capacity refresh fails and disables another send', async () => {
    vi.mocked(sendOpenAIReferralInvite).mockResolvedValue({
      sent: true,
      email: 'friend@example.com',
      eligibility: null,
      cache_persisted: true,
      refresh_failed: true
    })
    mountCell()
    await open()
    completeForm()
    submit()
    await flushPromises()
    expect(document.body.textContent).toContain('admin.accounts.openaiReferral.sent:friend@example.com')
    expect(document.body.textContent).toContain('admin.accounts.openaiReferral.refreshFailed')
    expect(screen.getByTestId('referral-count').textContent).toContain('—')
    completeForm()
    expect(sendButton()).toBeDisabled()
  })

  it('does not automatically retry an uncertain send', async () => {
    vi.mocked(sendOpenAIReferralInvite).mockRejectedValue({ reason: 'OPENAI_REFERRAL_SEND_UNKNOWN' })
    mountCell()
    await open()
    completeForm()
    submit()
    await flushPromises()
    expect(document.body.textContent).toContain('admin.accounts.openaiReferral.sendUnknown')
    expect(sendOpenAIReferralInvite).toHaveBeenCalledTimes(1)
    expect(sendButton()).toBeDisabled()
  })

  it('prevents sending from a shadow account', () => {
    mountCell(account({ parent_account_id: 100 }))
    expect(screen.getByTestId('referral-open')).toBeDisabled()
    expect(screen.getByTestId('referral-open').getAttribute('title')).toContain('shadowHint')
  })

  it('does not apply a pending query to a different account', async () => {
    let resolve!: (value: OpenAIReferralRefreshResult) => void
    vi.mocked(refreshOpenAIReferrals).mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    const view = mountCell()
    fireEvent.click(screen.getByTestId('referral-count'))
    view.rerender(<OpenAIReferralCell account={account({ id: 2 })} />)
    resolve({ eligibility, cache_persisted: true })
    await flushPromises()
    expect(screen.getByTestId('referral-count').textContent).toContain('—')
  })
})
