import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Account } from '@/types'
import AccountActionMenu from '../AccountActionMenu'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' })
}))

function makeAccount(overrides: Partial<Account>): Account {
  return {
    id: 1,
    name: 'test-account',
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

const anchorRect = new DOMRect(100, 100, 24, 24)

// AccountActionMenu 通过 portal 渲染到 document.body
const getBodyText = () => document.body.textContent ?? ''
const getBodyButtons = () => Array.from(document.body.querySelectorAll('button'))

const mountMenu = (account: Account, handlers: Record<string, ReturnType<typeof vi.fn>> = {}) =>
  render(<AccountActionMenu show account={account} anchorRect={anchorRect} {...handlers} />)

afterEach(() => cleanup())

describe('AccountActionMenu — spark shadow 按钮可见性', () => {
  it('普通账号显示「复制账号」按钮', () => {
    mountMenu(makeAccount({ platform: 'anthropic', type: 'apikey', parent_account_id: null }))
    expect(getBodyText()).toContain('admin.accounts.duplicateAccount')
  })

  it('影子账号隐藏「复制账号」按钮', () => {
    mountMenu(makeAccount({ platform: 'openai', type: 'oauth', parent_account_id: 42 }))
    expect(getBodyText()).not.toContain('admin.accounts.duplicateAccount')
  })

  it.each(['oauth', 'setup-token'] as const)('%s 账号隐藏「复制账号」按钮，避免共享可轮换令牌', (type) => {
    mountMenu(makeAccount({ platform: 'openai', type, parent_account_id: null }))
    expect(getBodyText()).not.toContain('admin.accounts.duplicateAccount')
  })

  it('点击「复制账号」触发 duplicate 事件并携带 account', () => {
    const account = makeAccount({ platform: 'anthropic', type: 'apikey', parent_account_id: null })
    const onDuplicate = vi.fn()
    mountMenu(account, { onDuplicate })

    const duplicateBtn = getBodyButtons().find(b => b.textContent?.includes('admin.accounts.duplicateAccount'))
    expect(duplicateBtn).toBeDefined()

    act(() => duplicateBtn!.click())

    expect(onDuplicate).toHaveBeenCalled()
    expect(onDuplicate.mock.calls[0][0]).toMatchObject({ id: account.id, name: account.name })
  })

  it('OpenAI OAuth 母账号（无 parent_account_id）显示「创建 spark 影子」按钮', () => {
    mountMenu(makeAccount({ platform: 'openai', type: 'oauth', parent_account_id: null }))
    expect(getBodyText()).toContain('admin.accounts.createSparkShadow')
  })

  it('影子账号（parent_account_id 非 null）隐藏「创建 spark 影子」按钮', () => {
    mountMenu(makeAccount({ platform: 'openai', type: 'oauth', parent_account_id: 42 }))
    expect(getBodyText()).not.toContain('admin.accounts.createSparkShadow')
  })

  it('非 OpenAI 账号隐藏「创建 spark 影子」按钮', () => {
    mountMenu(makeAccount({ platform: 'antigravity', type: 'oauth', parent_account_id: null }))
    expect(getBodyText()).not.toContain('admin.accounts.createSparkShadow')
  })

  it('影子账号隐藏凭据/隐私类操作(重授权/刷新token/隐私)— 外审 G4', () => {
    mountMenu(makeAccount({ platform: 'openai', type: 'oauth', parent_account_id: 42 }))
    const body = getBodyText()
    expect(body).not.toContain('admin.accounts.reAuthorize')
    expect(body).not.toContain('admin.accounts.refreshToken')
    expect(body).not.toContain('admin.accounts.setPrivacy')
  })

  it('普通 OpenAI OAuth 母账号仍显示凭据/隐私类操作', () => {
    mountMenu(makeAccount({ platform: 'openai', type: 'oauth', parent_account_id: null }))
    const body = getBodyText()
    expect(body).toContain('admin.accounts.reAuthorize')
    expect(body).toContain('admin.accounts.setPrivacy')
  })

  it('点击按钮触发 create-spark-shadow 事件并携带 account', () => {
    const account = makeAccount({ platform: 'openai', type: 'oauth', parent_account_id: null })
    const onCreateSparkShadow = vi.fn()
    mountMenu(account, { onCreateSparkShadow })

    const sparkBtn = getBodyButtons().find(b => b.textContent?.includes('admin.accounts.createSparkShadow'))
    expect(sparkBtn).toBeDefined()

    act(() => sparkBtn!.click())

    expect(onCreateSparkShadow).toHaveBeenCalled()
    expect(onCreateSparkShadow.mock.calls[0][0]).toMatchObject({ id: account.id, platform: 'openai' })
  })
})
