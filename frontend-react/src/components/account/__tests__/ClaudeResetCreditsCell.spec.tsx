import { act, cleanup, fireEvent, render, type RenderResult } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Account } from '@/types'
import ClaudeResetCreditsCell from '../ClaudeResetCreditsCell'

const getCredits = vi.hoisted(() => vi.fn())
const redeem = vi.hoisted(() => vi.fn())
vi.mock('@/api/admin/claudeResetCredits', () => ({ getClaudeResetCredits: getCredits, redeemClaudeResetCredit: redeem }))
const t = vi.hoisted(() => vi.fn((key: string, _params?: Record<string, unknown>) => key))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t, te: () => true, locale: 'en' }) }))
// Minimal stand-in exposing the dialog's show state and confirm/cancel events.
vi.mock('@/components/common/ConfirmDialog', () => ({
  default: (props: { show: boolean; message: string; danger?: boolean; onConfirm?: () => void; onCancel?: () => void }) =>
    props.show ? (
      <div data-testid="confirm-dialog" data-danger={String(Boolean(props.danger))}>
        {props.message}
        <button data-testid="confirm-ok" onClick={() => props.onConfirm?.()}>ok</button>
        <button data-testid="confirm-cancel" onClick={() => props.onCancel?.()}>cancel</button>
      </div>
    ) : null
}))
const account = { id: 1, platform: 'anthropic', type: 'oauth' } as Account
const credit = {
  label: 'Launch reset', resets_left: 1,
  expires_at: '2026-10-22T16:00:00Z', clears: ['five_hour', 'seven_day'],
  percent_used: {}, blocking: [], use_requires_limit: false, redeemable: true
}
const snapshot = { eligible: true, available_count: 1, credits: [credit], fetched_at: '2026-09-25T00:00:00Z' }

type Mounted = RenderResult & { onRedeemed: ReturnType<typeof vi.fn>; props: { account: Account; preActions?: ReactNode } }
const mountCell = (props: { account: Account; preActions?: ReactNode }): Mounted => {
  const onRedeemed = vi.fn()
  const view = render(<ClaudeResetCreditsCell {...props} onRedeemed={onRedeemed} />)
  return Object.assign(view, { onRedeemed, props })
}
const setAccount = (wrapper: Mounted, next: Account) => {
  wrapper.props = { ...wrapper.props, account: next }
  wrapper.rerender(<ClaudeResetCreditsCell {...wrapper.props} onRedeemed={wrapper.onRedeemed} />)
}
const flushPromises = () => act(async () => {})
const find = (wrapper: Mounted, selector: string) => wrapper.container.querySelector<HTMLElement>(selector)
const get = (wrapper: Mounted, selector: string) => {
  const element = find(wrapper, selector)
  if (!element) throw new Error(`missing ${selector}`)
  return element
}
const click = async (element: Element) => {
  await act(async () => {
    fireEvent.click(element)
  })
}
const countButton = (wrapper: Mounted) => find(wrapper, '[data-testid="claude-reset-count"]')
const redeemButton = (wrapper: Mounted) => get(wrapper, '[data-testid="claude-reset-redeem"]')
async function queried(result: unknown = snapshot) {
  getCredits.mockResolvedValue(result)
  const wrapper = mountCell({ account })
  await click(countButton(wrapper)!)
  await flushPromises()
  return wrapper
}
async function confirmReset(wrapper: Mounted) {
  await click(redeemButton(wrapper))
  await click(get(wrapper, '[data-testid="confirm-ok"]'))
  await flushPromises()
}

afterEach(() => cleanup())

describe('Claude reset credit status', () => {
  beforeEach(() => { getCredits.mockReset(); redeem.mockReset() })

  it('queries only on explicit request and shows count and expiry', async () => {
    getCredits.mockResolvedValue(snapshot)
    const wrapper = mountCell({ account })
    expect(getCredits).not.toHaveBeenCalled()
    expect(countButton(wrapper)!.textContent).toBe('admin.accounts.claudeResetCredits.count')
    await click(countButton(wrapper)!)
    await flushPromises()
    expect(getCredits).toHaveBeenCalledWith(1)
    expect(countButton(wrapper)!.textContent).toBe('admin.accounts.claudeResetCredits.count1')
    const expiry = get(wrapper, '[data-testid="claude-reset-expiry"]')
    expect(expiry.getAttribute('title')).toContain('Launch reset')
  })

  it('counts held resets and prefers the next redeemable grant', async () => {
    const later = { ...credit, label: 'Later', expires_at: '2026-12-01T00:00:00Z', redeemable: false }
    const next = { ...credit, label: 'Next', expires_at: '2026-11-01T00:00:00Z', redeemable: true }
    getCredits.mockResolvedValue({ ...snapshot, available_count: 1, credits: [later, next] })
    const wrapper = mountCell({ account })
    await click(countButton(wrapper)!)
    await flushPromises()
    expect(countButton(wrapper)!.textContent).toBe('admin.accounts.claudeResetCredits.count2')
    expect(get(wrapper, '[data-testid="claude-reset-expiry"]').getAttribute('title')).toContain('Next')
    expect(find(wrapper, '[data-testid="claude-reset-not-usable"]')).toBeNull()
  })

  it('flags held resets that cannot be used yet', async () => {
    const waiting = { ...credit, use_requires_limit: true, redeemable: false }
    getCredits.mockResolvedValue({ ...snapshot, available_count: 0, credits: [waiting] })
    const wrapper = mountCell({ account })
    await click(countButton(wrapper)!)
    await flushPromises()
    expect(countButton(wrapper)!.textContent).toBe('admin.accounts.claudeResetCredits.count1')
    expect(find(wrapper, '[data-testid="claude-reset-not-usable"]')).not.toBeNull()
  })

  it('disables reset until a query shows a redeemable credit', async () => {
    const wrapper = mountCell({ account })
    expect(redeemButton(wrapper)).toBeDisabled()
    await click(redeemButton(wrapper))
    expect(find(wrapper, '[data-testid="confirm-dialog"]')).toBeNull()

    const waiting = await queried({ ...snapshot, available_count: 0, credits: [{ ...credit, redeemable: false }] })
    expect(redeemButton(waiting)).toBeDisabled()

    let resolve!: (value: typeof snapshot) => void
    getCredits.mockReturnValue(new Promise(r => { resolve = r }))
    const loading = mountCell({ account })
    await click(countButton(loading)!)
    expect(redeemButton(loading)).toBeDisabled()
    await act(async () => {
      resolve(snapshot)
    })
    await flushPromises()
    expect(redeemButton(loading)).not.toBeDisabled()
    expect(redeem).not.toHaveBeenCalled()
  })

  it('never redeems without confirmation, and the count button never redeems', async () => {
    const wrapper = await queried()
    await click(countButton(wrapper)!)
    await flushPromises()
    await click(redeemButton(wrapper))
    const dialog = get(wrapper, '[data-testid="confirm-dialog"]')
    expect(dialog.getAttribute('data-danger')).toBe('true')
    expect(dialog.textContent).toContain('admin.accounts.claudeResetCredits.confirmMessage')
    // Known windows render as readable labels; count is what remains after this use.
    expect(t).toHaveBeenCalledWith('admin.accounts.claudeResetCredits.confirmMessage', {
      windows: 'admin.accounts.claudeResetCredits.windows.fiveHour, admin.accounts.claudeResetCredits.windows.sevenDay',
      count: 0
    })
    await click(get(wrapper, '[data-testid="confirm-cancel"]'))
    await flushPromises()
    expect(find(wrapper, '[data-testid="confirm-dialog"]')).toBeNull()
    expect(redeem).not.toHaveBeenCalled()
  })

  it('redeems after confirmation, reports success, refreshes and notifies the parent', async () => {
    const wrapper = await queried()
    redeem.mockResolvedValue({ outcome: 'reset', cleared: ['five_hour'], replayed: false })
    getCredits.mockResolvedValue({ ...snapshot, available_count: 0, credits: [] })
    await confirmReset(wrapper)
    expect(redeem).toHaveBeenCalledTimes(1)
    expect(redeem.mock.calls[0][0]).toBe(1)
    expect(redeem.mock.calls[0][1]).toMatch(/^claude-reset-1-/)
    expect(get(wrapper, '[data-testid="claude-reset-feedback"]').textContent).toBe('admin.accounts.claudeResetCredits.outcome.reset')
    expect(getCredits).toHaveBeenCalledTimes(2)
    expect(wrapper.onRedeemed).toHaveBeenCalledTimes(1)
    expect(redeemButton(wrapper)).toBeDisabled()
  })

  it('reuses the key when retrying a failed confirmation and rotates it after an answer', async () => {
    const wrapper = await queried()
    redeem.mockRejectedValueOnce({ status: 0, message: 'Network Error' })
    await confirmReset(wrapper)
    expect(get(wrapper, '[data-testid="claude-reset-feedback"]').textContent).toBe('Network Error')
    redeem.mockResolvedValueOnce({ outcome: 'not_limited', replayed: false })
    await confirmReset(wrapper)
    expect(redeem.mock.calls[1][1]).toBe(redeem.mock.calls[0][1])
    redeem.mockResolvedValueOnce({ outcome: 'not_limited', replayed: false })
    await confirmReset(wrapper)
    expect(redeem.mock.calls[2][1]).not.toBe(redeem.mock.calls[0][1])
  })

  it.each([
    ['already_used', 'alreadyUsed'],
    ['cooldown', 'cooldown'],
    ['not_limited', 'notLimited'],
    ['ineligible', 'ineligible'],
    ['unknown', 'unknown']
  ])('maps outcome %s to a clear message', async (outcome, key) => {
    const wrapper = await queried()
    redeem.mockResolvedValue({ outcome, replayed: false })
    await confirmReset(wrapper)
    expect(get(wrapper, '[data-testid="claude-reset-feedback"]').textContent).toBe(`admin.accounts.claudeResetCredits.outcome.${key}`)
    expect(getCredits).toHaveBeenCalledTimes(2)
  })

  it('maps server refusals to clear messages', async () => {
    const wrapper = await queried()
    redeem.mockRejectedValueOnce({ status: 409, reason: 'CLAUDE_RESET_UNRESOLVED', message: 'x' })
    await confirmReset(wrapper)
    expect(get(wrapper, '[data-testid="claude-reset-feedback"]').textContent).toBe('admin.accounts.claudeResetCredits.outcome.unknown')
    redeem.mockRejectedValueOnce({ status: 409, reason: 'CLAUDE_RESET_BUSY', message: 'x' })
    await confirmReset(wrapper)
    expect(get(wrapper, '[data-testid="claude-reset-feedback"]').textContent).toBe('admin.accounts.claudeResetCredits.outcome.busy')
  })

  it.each(['CLAUDE_RESET_BUSY', 'CLAUDE_RESET_NOT_AVAILABLE', 'CLAUDE_RESET_UNRESOLVED', 'CLAUDE_RESET_UPSTREAM_UNAVAILABLE'])(
    'rotates the key after pre-claim refusal %s',
    async reason => {
      const wrapper = await queried()
      redeem.mockRejectedValueOnce({ status: 409, reason, message: 'x' })
      await confirmReset(wrapper)
      redeem.mockResolvedValueOnce({ outcome: 'not_limited', replayed: false })
      await confirmReset(wrapper)
      expect(redeem.mock.calls[1][1]).not.toBe(redeem.mock.calls[0][1])
    }
  )

  it.each([
    ['IDEMPOTENCY_IN_PROGRESS', 'inProgress'],
    ['IDEMPOTENCY_RETRY_BACKOFF', 'retryBackoff'],
    ['CLAUDE_RESET_UPSTREAM_UNAVAILABLE', 'unavailable']
  ])('maps %s to a clear message', async (reason, key) => {
    const wrapper = await queried()
    redeem.mockRejectedValueOnce({ status: 409, reason, message: 'x' })
    await confirmReset(wrapper)
    expect(get(wrapper, '[data-testid="claude-reset-feedback"]').textContent).toBe(`admin.accounts.claudeResetCredits.outcome.${key}`)
  })

  it('reuses the key after an idempotency conflict', async () => {
    const wrapper = await queried()
    redeem.mockRejectedValueOnce({ status: 409, reason: 'IDEMPOTENCY_IN_PROGRESS', message: 'x' })
    await confirmReset(wrapper)
    redeem.mockResolvedValueOnce({ outcome: 'not_limited', replayed: false })
    await confirmReset(wrapper)
    expect(redeem.mock.calls[1][1]).toBe(redeem.mock.calls[0][1])
  })

  it('labels cleared windows and falls back to the raw key for unknown ones', async () => {
    const wrapper = await queried()
    redeem.mockResolvedValue({ outcome: 'reset', cleared: ['seven_day_overage_included', 'future_window'], replayed: false })
    await confirmReset(wrapper)
    expect(t).toHaveBeenCalledWith('admin.accounts.claudeResetCredits.outcome.reset', {
      windows: 'admin.accounts.claudeResetCredits.windows.sevenDayOverage, future_window'
    })
  })

  it('tells the operator to retry later after an explicit unavailable answer', async () => {
    const wrapper = await queried()
    redeem.mockResolvedValue({ outcome: 'unknown', reason: 'upstream_unavailable', replayed: false })
    await confirmReset(wrapper)
    expect(get(wrapper, '[data-testid="claude-reset-feedback"]').textContent).toBe('admin.accounts.claudeResetCredits.outcome.unavailable')
  })

  it('keeps slot content for setup tokens and discards responses after account changes', async () => {
    let resolve!: (value: typeof snapshot) => void
    getCredits.mockReturnValue(new Promise(r => { resolve = r }))
    const wrapper = mountCell({ account, preActions: <button data-testid="local-query">q</button> })
    await click(countButton(wrapper)!)
    setAccount(wrapper, { ...account, id: 2, type: 'setup-token' } as Account)
    await act(async () => {
      resolve(snapshot)
    })
    await flushPromises()
    expect(countButton(wrapper)).toBeNull()
    expect(find(wrapper, '[data-testid="local-query"]')).not.toBeNull()
    expect(find(wrapper, '[data-testid="claude-reset-expiry"]')).toBeNull()
  })

  it('falls back to the earliest parsed expiry across offsets, invalid last', async () => {
    const a = { ...credit, label: 'Tokyo', expires_at: '2026-11-01T08:00:00+09:00', redeemable: false }
    const b = { ...credit, label: 'Chicago', expires_at: '2026-10-31T20:00:00-05:00', redeemable: false }
    const bad = { ...credit, label: 'Bad', expires_at: 'not-a-date', redeemable: false }
    const none = { ...credit, label: 'None', expires_at: undefined, redeemable: false }
    getCredits.mockResolvedValue({ ...snapshot, available_count: 0, credits: [none, bad, b, a] })
    const wrapper = mountCell({ account })
    await click(countButton(wrapper)!)
    await flushPromises()
    expect(get(wrapper, '[data-testid="claude-reset-expiry"]').getAttribute('title')).toContain('Tokyo')
    expect(get(wrapper, '[data-testid="claude-reset-expiry"]').getAttribute('title')).not.toContain('Chicago')
  })

  it('hides a cooldown hint that is already in the past', async () => {
    getCredits.mockResolvedValue({ ...snapshot, cooldown_until: '2000-01-01T00:00:00Z' })
    const wrapper = mountCell({ account })
    await click(countButton(wrapper)!)
    await flushPromises()
    expect(find(wrapper, '[data-testid="claude-reset-cooldown"]')).toBeNull()
  })

  it('discards in-flight responses when the same account changes type', async () => {
    let resolve!: (value: typeof snapshot) => void
    getCredits.mockReturnValue(new Promise(r => { resolve = r }))
    const wrapper = mountCell({ account })
    await click(countButton(wrapper)!)
    setAccount(wrapper, { ...account, type: 'setup-token' } as Account)
    setAccount(wrapper, { ...account })
    await act(async () => {
      resolve(snapshot)
    })
    await flushPromises()
    expect(countButton(wrapper)!.textContent).toBe('admin.accounts.claudeResetCredits.count')
    expect(countButton(wrapper)).not.toBeDisabled()
    expect(find(wrapper, '[data-testid="claude-reset-expiry"]')).toBeNull()
  })
})
