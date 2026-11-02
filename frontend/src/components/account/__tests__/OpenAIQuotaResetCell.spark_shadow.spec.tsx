import { act, cleanup, fireEvent, render, type RenderResult } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { refreshOpenAIQuota, resetOpenAIQuota, type OpenAIQuotaRefreshResult } from '@/api/admin/accounts'
import type { Account } from '@/types'
import OpenAIQuotaResetCell from '../OpenAIQuotaResetCell'

vi.mock('@/api/admin/accounts', () => ({
  refreshOpenAIQuota: vi.fn(),
  resetOpenAIQuota: vi.fn(),
  refreshOpenAIReferrals: vi.fn(),
  sendOpenAIReferralInvite: vi.fn(),
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.time ? `${key}:${params.time}` : params?.count ? `${key}:${params.count}` : key,
    te: () => true,
    locale: 'en',
  }),
}))

// ConfirmDialog 替身：显示时渲染确认按钮（Vue 版直接 emit confirm）。
// 放在 data-testid 容器里且排在单元格按钮之后，不影响 "第二个按钮是重置" 的取法。
vi.mock('@/components/common/ConfirmDialog', () => ({
  default: ({ show, onConfirm }: { show: boolean; onConfirm?: () => void }) =>
    show ? <div data-testid="confirm-dialog"><button type="button" data-testid="confirm-dialog-confirm" onClick={() => onConfirm?.()}>confirm</button></div> : null,
}))

// 缓存水合会丢弃已过期的重置卡，因此缓存类用例必须使用未来时间。
const FUTURE_EXPIRY_EARLY = '2099-07-03T04:05:06Z'
const FUTURE_EXPIRY_LATE = '2099-07-05T04:05:06Z'
const PAST_EXPIRY = '2020-07-03T04:05:06Z'

function makeAccount(overrides: Partial<Account>): Account {
  return {
    id: 1,
    name: 'acc',
    platform: 'openai',
    type: 'oauth',
    proxy_id: null,
    concurrency: 3,
    priority: 50,
    status: 'active',
    error_message: null,
    last_used_at: null,
    expires_at: null,
    auto_pause_on_expired: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    schedulable: true,
    rate_limited_at: null,
    rate_limit_reset_at: null,
    overload_until: null,
    temp_unschedulable_until: null,
    temp_unschedulable_reason: null,
    session_window_start: null,
    session_window_end: null,
    session_window_status: null,
    ...overrides,
  } as Account
}

type Mounted = RenderResult & { onAccountUpdated: ReturnType<typeof vi.fn> }

const mountCell = (account: Account): Mounted => {
  const onAccountUpdated = vi.fn()
  const view = render(<OpenAIQuotaResetCell account={account} onAccountUpdated={onAccountUpdated} />)
  return Object.assign(view, { onAccountUpdated })
}

const flushPromises = () => act(async () => {})
const buttons = (wrapper: Mounted) => Array.from(wrapper.container.querySelectorAll('button'))
const text = (wrapper: Mounted) => wrapper.container.textContent ?? ''
const click = async (element: Element) => {
  await act(async () => {
    fireEvent.click(element)
  })
}
const confirmReset = async () => {
  await click(document.querySelector('[data-testid="confirm-dialog-confirm"]')!)
}

// 第二个按钮是 reset 按钮：disabled = resetting || loading || !canReset，title = resetButtonTitle
const resetButton = (wrapper: Mounted) => buttons(wrapper)[1]
const points = (wrapper: Mounted) => wrapper.container.querySelector<HTMLButtonElement>('[data-testid="codex-credits"]')!

beforeEach(() => {
  vi.mocked(refreshOpenAIQuota).mockReset()
  vi.mocked(resetOpenAIQuota).mockReset()
})

afterEach(() => cleanup())

describe('OpenAIQuotaResetCell — Codex 点数', () => {
  const balance = { has_credits: true, unlimited: false, balance: '12345678901234567890.0123' }

  it.each([
    { name: 'decimal precision', credits: balance, expected: balance.balance },
    { name: 'zero', credits: { has_credits: false, unlimited: false, balance: '0' }, expected: '0' },
    { name: 'unlimited takes precedence', credits: { has_credits: false, unlimited: true, balance: null }, expected: 'admin.accounts.openaiQuotaReset.pointsUnlimited' },
    { name: 'hidden balance', credits: { has_credits: true, unlimited: false, balance: null }, expected: 'admin.accounts.openaiQuotaReset.pointsAvailable' },
    { name: 'invalid balance', credits: { has_credits: true, unlimited: false, balance: 'NaN' }, expected: 'admin.accounts.openaiQuotaReset.pointsAvailable' },
    { name: 'absent credits', credits: undefined, expected: '—' },
    { name: 'null credits', credits: null, expected: '—' },
  ])('queries and displays $name independently of reset cards', async ({ credits, expected }) => {
    vi.mocked(refreshOpenAIQuota).mockResolvedValue({
      credits, fetched_at: 1770000000, cache_persisted: false, credits_cache_persisted: true,
    })
    const wrapper = mountCell(makeAccount({}))
    expect(points(wrapper).textContent).toContain('—')
    await click(points(wrapper))
    await flushPromises()
    expect(refreshOpenAIQuota).toHaveBeenCalledWith(1)
    expect(points(wrapper).textContent).toContain(expected)
    expect(resetButton(wrapper)).toBeDisabled()
    expect(resetOpenAIQuota).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('rehydrates points with their query timestamp without an upstream request', () => {
    const wrapper = mountCell(makeAccount({
      extra: { codex_credits_snapshot: { credits: balance, fetched_at: 1770000000 } },
    }))
    expect(points(wrapper).textContent).toContain(balance.balance)
    expect(points(wrapper).getAttribute('title')).toContain('admin.accounts.openaiQuotaReset.pointsUpdatedAt:')
    expect(refreshOpenAIQuota).not.toHaveBeenCalled()
    expect(resetButton(wrapper)).toBeDisabled()
    wrapper.unmount()
  })

  it('keeps the last balance on a request failure, but clears it on a successful unknown response', async () => {
    const wrapper = mountCell(makeAccount({
      extra: { codex_credits_snapshot: { credits: balance, fetched_at: 1770000000 } },
    }))
    vi.mocked(refreshOpenAIQuota).mockRejectedValueOnce(new Error('network unavailable'))
    await click(points(wrapper))
    await flushPromises()
    expect(points(wrapper).textContent).toContain(balance.balance)
    expect(text(wrapper)).toContain('network unavailable')

    vi.mocked(refreshOpenAIQuota).mockResolvedValueOnce({ fetched_at: 1770000001, cache_persisted: true, credits_cache_persisted: true })
    await click(points(wrapper))
    await flushPromises()
    expect(points(wrapper).textContent).toContain('—')
    expect(text(wrapper)).not.toContain(balance.balance)
    wrapper.unmount()
  })

  it('reports a points-cache write failure while displaying the live balance', async () => {
    vi.mocked(refreshOpenAIQuota).mockResolvedValue({
      credits: balance, fetched_at: 1770000000, cache_persisted: true, credits_cache_persisted: false,
    })
    const wrapper = mountCell(makeAccount({}))
    await click(points(wrapper))
    await flushPromises()
    expect(points(wrapper).textContent).toContain(balance.balance)
    expect(text(wrapper)).toContain('admin.accounts.openaiQuotaReset.pointsCachePersistFailed')
    wrapper.unmount()
  })

  it('does not apply a pending response to another account row', async () => {
    let resolve!: (value: OpenAIQuotaRefreshResult) => void
    vi.mocked(refreshOpenAIQuota).mockReturnValue(new Promise((done) => { resolve = done }))
    const wrapper = mountCell(makeAccount({}))
    await click(points(wrapper))
    expect(points(wrapper)).toBeDisabled()
    wrapper.rerender(<OpenAIQuotaResetCell account={makeAccount({ id: 2 })} onAccountUpdated={wrapper.onAccountUpdated} />)
    resolve({ credits: balance, fetched_at: 1770000000, cache_persisted: true, credits_cache_persisted: true })
    await flushPromises()
    expect(points(wrapper).textContent).toContain('—')
    expect(points(wrapper)).not.toBeDisabled()
    wrapper.unmount()
  })
})

describe('OpenAIQuotaResetCell — 外审 F6:影子禁用重置', () => {
  it('影子账号(parent_account_id 非空)的 reset 按钮被禁用且提示在母账号重置', () => {
    const account = makeAccount({ parent_account_id: 100 })
    const wrapper = mountCell(account)

    const btn = resetButton(wrapper)
    expect(btn).toBeDisabled()
    expect(btn.getAttribute('title')).toBe('admin.accounts.openaiQuotaReset.resetTooltipShadow')
    wrapper.unmount()
  })

  it('普通账号(无 parent_account_id)未查询时禁用原因是「需先查询」而非影子提示', () => {
    const account = makeAccount({ parent_account_id: null })
    const wrapper = mountCell(account)

    const btn = resetButton(wrapper)
    // 未加载数据时本就 disabled(无次数),但提示语必须是 needQuery,不得是 shadow 提示。
    expect(btn.getAttribute('title')).toBe('admin.accounts.openaiQuotaReset.resetTooltipNeedQuery')
    wrapper.unmount()
  })

  it('从账号 extra 缓存恢复重置卡次数和到期时间', () => {
    const account = makeAccount({
      parent_account_id: null,
      extra: {
        codex_reset_credit_snapshot: {
          available_count: 2,
          credits: [
            { expires_at: FUTURE_EXPIRY_LATE },
            { expires_at: FUTURE_EXPIRY_EARLY },
          ],
        },
      },
    })
    const wrapper = mountCell(account)

    expect(refreshOpenAIQuota).not.toHaveBeenCalled()
    expect(text(wrapper)).toContain('admin.accounts.openaiQuotaReset.count')
    expect(text(wrapper)).toContain('admin.accounts.openaiQuotaReset.expiresAt:')
    expect(text(wrapper)).toContain('+1')
    expect(resetButton(wrapper)).not.toBeDisabled()
    wrapper.unmount()
  })

  it('缓存中的重置卡全部过期时视为未知,不点亮重置入口', () => {
    const account = makeAccount({
      parent_account_id: null,
      extra: {
        codex_reset_credit_snapshot: {
          available_count: 1,
          credits: [{ expires_at: PAST_EXPIRY }],
        },
      },
    })
    const wrapper = mountCell(account)

    expect(text(wrapper)).not.toContain('admin.accounts.openaiQuotaReset.expiresAt:')
    const btn = resetButton(wrapper)
    expect(btn).toBeDisabled()
    expect(btn.getAttribute('title')).toBe('admin.accounts.openaiQuotaReset.resetTooltipNeedQuery')
    wrapper.unmount()
  })

  it('缓存次数向未过期的明细数量收敛', () => {
    const account = makeAccount({
      parent_account_id: null,
      extra: {
        codex_reset_credit_snapshot: {
          available_count: 3,
          credits: [
            { expires_at: PAST_EXPIRY },
            { expires_at: FUTURE_EXPIRY_EARLY },
          ],
        },
      },
    })
    const wrapper = mountCell(account)

    expect(text(wrapper)).toContain('admin.accounts.openaiQuotaReset.count1')
    expect(text(wrapper)).not.toContain('+1')
    expect(resetButton(wrapper)).not.toBeDisabled()
    wrapper.unmount()
  })

  it('查询后默认折叠为最早到期时间,点击 +N 展开完整列表', async () => {
    vi.mocked(refreshOpenAIQuota).mockResolvedValue({
      rate_limit_reset_credits: {
        available_count: 3,
        credits: [
          { expires_at: '2026-07-05T04:05:06Z' },
          { expires_at: '2026-07-03T04:05:06Z' },
          { expires_at: 'not-a-date' },
        ],
      },
      fetched_at: 1770000000,
      cache_persisted: true,
    })

    const account = makeAccount({ parent_account_id: null })
    const wrapper = mountCell(account)

    await click(buttons(wrapper)[0])
    await flushPromises()

    expect(refreshOpenAIQuota).toHaveBeenCalledWith(1)
    expect(text(wrapper)).toContain('admin.accounts.openaiQuotaReset.expiresAt:')
    expect(text(wrapper)).toContain('+2')
    expect(text(wrapper)).not.toContain('not-a-date')

    const toggle = wrapper.container.querySelector('[data-testid="reset-credit-expiry-toggle"]')!
    expect(toggle).not.toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(wrapper.container.querySelector('[data-testid="reset-credit-expiry-details"]')).not.toBeNull()
    expect(text(wrapper)).toContain('not-a-date')
    expect(text(wrapper)).not.toContain('undefined')
    wrapper.unmount()
  })

  it('只有一张重置卡时不显示展开按钮', async () => {
    vi.mocked(refreshOpenAIQuota).mockResolvedValue({
      rate_limit_reset_credits: {
        available_count: 1,
        credits: [
          { expires_at: '2026-07-03T04:05:06Z' },
        ],
      },
      fetched_at: 1770000000,
      cache_persisted: true,
    })

    const account = makeAccount({ parent_account_id: null })
    const wrapper = mountCell(account)

    await click(buttons(wrapper)[0])
    await flushPromises()

    expect(wrapper.container.querySelector('[data-testid="reset-credit-expiry-toggle"]')).toBeNull()
    expect(wrapper.container.querySelector('[data-testid="reset-credit-expiry-details"]')).toBeNull()
    expect(text(wrapper)).toContain('admin.accounts.openaiQuotaReset.expiresAt:')
    wrapper.unmount()
  })

  // 快照写库被拒绝(上游未返回到期明细)不得吞掉这次成功的上游读取,
  // 否则次数永远显示不出来、重置入口被永久禁用。
  it('快照持久化失败时仍显示实时次数并给出警告', async () => {
    vi.mocked(refreshOpenAIQuota).mockResolvedValue({
      rate_limit_reset_credits: { available_count: 2 },
      fetched_at: 1770000000,
      cache_persisted: false,
    })

    const account = makeAccount({ parent_account_id: null })
    const wrapper = mountCell(account)

    await click(buttons(wrapper)[0])
    await flushPromises()

    expect(text(wrapper)).toContain('admin.accounts.openaiQuotaReset.count2')
    expect(text(wrapper)).toContain('admin.accounts.openaiQuotaReset.refreshCachePersistFailed')
    expect(resetButton(wrapper)).not.toBeDisabled()
    wrapper.unmount()
  })

  it('重置成功后直接使用响应中的最新缓存并回传恢复后的账号', async () => {
    const recoveredAccount = makeAccount({
      parent_account_id: null,
      status: 'active',
      error_message: null,
    })
    vi.mocked(resetOpenAIQuota).mockResolvedValue({
      code: 'success',
      windows_reset: 1,
      cache_refreshed: true,
      account_state_recovered: true,
      quota: {
        credits: { has_credits: true, unlimited: false, balance: '999.25' },
        rate_limit_reset_credits: {
          available_count: 0,
          credits: [],
        },
        fetched_at: 1770000000,
      },
      account: recoveredAccount,
    })
    const account = makeAccount({
      parent_account_id: null,
      extra: {
        codex_reset_credit_snapshot: {
          available_count: 1,
          credits: [{ expires_at: FUTURE_EXPIRY_EARLY }],
        },
      },
    })
    const wrapper = mountCell(account)

    await click(resetButton(wrapper))
    await confirmReset()
    await flushPromises()

    expect(resetOpenAIQuota).toHaveBeenCalledWith(1)
    expect(refreshOpenAIQuota).not.toHaveBeenCalled()
    expect(points(wrapper).textContent).toContain('999.25')
    expect(text(wrapper)).not.toContain('admin.accounts.openaiQuotaReset.expiresAt:')
    expect(text(wrapper)).toContain('admin.accounts.openaiQuotaReset.resetSuccess')
    expect(wrapper.onAccountUpdated.mock.calls).toEqual([[recoveredAccount]])
    wrapper.unmount()
  })

  // 缓存回读失败不影响「账号状态已恢复」这一主目标:恢复后的账号行必须照常回传,
  // 否则列表会继续显示已经不存在的限流状态。
  it('缓存刷新失败时仍回传恢复后的账号并把次数标为未知', async () => {
    const recoveredAccount = makeAccount({
      parent_account_id: null,
      status: 'active',
      rate_limit_reset_at: null,
    })
    vi.mocked(resetOpenAIQuota).mockResolvedValue({
      code: 'success',
      windows_reset: 1,
      cache_refreshed: false,
      account_state_recovered: true,
      warning_code: 'reset_credit_cache_refresh_failed',
      account: recoveredAccount,
    })
    const account = makeAccount({
      parent_account_id: null,
      extra: {
        codex_reset_credit_snapshot: {
          available_count: 1,
          credits: [{ expires_at: FUTURE_EXPIRY_EARLY }],
        },
      },
    })
    const wrapper = mountCell(account)

    await click(resetButton(wrapper))
    await confirmReset()
    await flushPromises()

    expect(refreshOpenAIQuota).not.toHaveBeenCalled()
    // 次数未知(隐藏)但仍展示已持久化的到期明细,重置入口保持禁用直到重新查询。
    expect(text(wrapper)).not.toContain('admin.accounts.openaiQuotaReset.count1')
    expect(text(wrapper)).toContain('admin.accounts.openaiQuotaReset.expiresAt:')
    expect(text(wrapper)).toContain('admin.accounts.openaiQuotaReset.resetCacheRefreshFailed')
    expect(resetButton(wrapper)).toBeDisabled()
    expect(wrapper.onAccountUpdated.mock.calls).toEqual([[recoveredAccount]])
    wrapper.unmount()
  })

  it('账号状态恢复失败时停止后续步骤并提示手动恢复', async () => {
    vi.mocked(resetOpenAIQuota).mockResolvedValue({
      code: 'success',
      windows_reset: 1,
      cache_refreshed: false,
      account_state_recovered: false,
      warning_code: 'account_state_recovery_failed',
    })
    const account = makeAccount({
      parent_account_id: null,
      extra: {
        codex_reset_credit_snapshot: {
          available_count: 1,
          credits: [{ expires_at: FUTURE_EXPIRY_EARLY }],
        },
      },
    })
    const wrapper = mountCell(account)

    await click(resetButton(wrapper))
    await confirmReset()
    await flushPromises()

    expect(refreshOpenAIQuota).not.toHaveBeenCalled()
    expect(text(wrapper)).toContain('admin.accounts.openaiQuotaReset.resetAccountRecoveryFailed')
    expect(resetButton(wrapper)).toBeDisabled()
    expect(wrapper.onAccountUpdated).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('OpenAIQuotaResetCell 自动用卡运行态', () => {
  it.each([
    ['checking', 'checking'],
    ['available', 'available'],
    ['resetting', 'resetting'],
    ['success', 'success'],
    ['no_credit', 'noCredit'],
    ['failed', 'failed'],
  ] as const)('展示 %s 状态且不需要暴露卡标识', (status, labelKey) => {
    const account = makeAccount({
      extra: {
        auto_reset_credit_enabled: true,
        codex_auto_reset_credit_state: {
          status,
          trigger_window: '5h',
          available_count: 1,
          checked_at: '2099-07-03T04:05:06Z',
          error_code: status === 'failed' ? 'RESET_FAILED' : undefined,
        },
      },
    })
    const wrapper = mountCell(account)
    const state = wrapper.container.querySelector('[data-testid="auto-reset-credit-state"]')!
    expect(state.textContent).toContain(`admin.accounts.openaiQuotaReset.autoStatus.${labelKey}`)
    expect(state.textContent).toContain('5h')
    expect(state.textContent).not.toContain('credit_id')
    wrapper.unmount()
  })

  it('开关关闭时不显示历史运行态', () => {
    const account = makeAccount({
      extra: {
        auto_reset_credit_enabled: false,
        codex_auto_reset_credit_state: { status: 'success', available_count: 1 },
      },
    })
    const wrapper = mountCell(account)
    expect(wrapper.container.querySelector('[data-testid="auto-reset-credit-state"]')).toBeNull()
    wrapper.unmount()
  })
})
