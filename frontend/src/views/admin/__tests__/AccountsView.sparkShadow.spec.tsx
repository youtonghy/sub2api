import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AccountsView from '../AccountsView'
import homepageStyles from '../AccountsView.module.css'
import { app, captured, confirmDialogs, resetCaptured } from './accountsViewHarness'

// 外审 F2:AccountActionMenu 触发 create-spark-shadow,但 AccountsView 此前未监听,
// 导致按钮点击无效。本测试通过菜单的回调触发该事件,断言父页面接线调用 API。
const {
  listAccounts,
  listWithEtag,
  getBatchTodayStats,
  getAllProxies,
  getAllGroups,
  duplicateAccount,
  createSparkShadow,
  tableMode
} = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  listWithEtag: vi.fn(),
  getBatchTodayStats: vi.fn(),
  getAllProxies: vi.fn(),
  getAllGroups: vi.fn(),
  duplicateAccount: vi.fn(),
  createSparkShadow: vi.fn(),
  // 第一组用例不渲染单元格，第二组用例渲染名称与平台单元格（对应 Vue 版两种挂载方式）
  tableMode: { current: 'empty' as 'empty' | 'rows' }
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      list: listAccounts,
      listWithEtag,
      getBatchTodayStats,
      duplicate: duplicateAccount,
      getUpstreamBillingProbeSettings: vi.fn().mockResolvedValue({ enabled: true, interval_minutes: 30 }),
      createSparkShadow,
      delete: vi.fn(),
      batchClearError: vi.fn(),
      batchRefresh: vi.fn(),
      toggleSchedulable: vi.fn()
    },
    proxies: { getAll: getAllProxies },
    groups: { getAll: getAllGroups }
  }
}))

vi.mock('@/i18n/useI18n', async () => (await import('./accountsViewHarness')).i18nModule())
vi.mock('@/stores/app', async () => (await import('./accountsViewHarness')).appStoreModule())
vi.mock('@/stores/auth', async () => (await import('./accountsViewHarness')).authStoreModule())
vi.mock('@/components/account', async () => (await import('./accountsViewHarness')).accountBarrelModule())
vi.mock('@/components/account/AccountCapacityCell', async () => (await import('./accountsViewHarness')).stubModule('AccountCapacityCell'))
vi.mock('@/components/account/AccountGroupsCell', async () => (await import('./accountsViewHarness')).stubModule('AccountGroupsCell'))
vi.mock('@/components/account/AccountSortOrderModal', async () => (await import('./accountsViewHarness')).stubModule('AccountSortOrderModal'))
vi.mock('@/components/account/AccountStatusIndicator', async () => (await import('./accountsViewHarness')).stubModule('AccountStatusIndicator'))
vi.mock('@/components/account/AccountTodayStatsCell', async () => (await import('./accountsViewHarness')).stubModule('AccountTodayStatsCell'))
vi.mock('@/components/account/AccountUsageCell', async () => (await import('./accountsViewHarness')).stubModule('AccountUsageCell'))
vi.mock('@/components/account/UpstreamBillingRateCell', async () => (await import('./accountsViewHarness')).stubModule('UpstreamBillingRateCell'))
vi.mock('@/components/admin/ErrorPassthroughRulesModal', async () => (await import('./accountsViewHarness')).stubModule('ErrorPassthroughRulesModal'))
vi.mock('@/components/admin/TLSFingerprintProfilesModal', async () => (await import('./accountsViewHarness')).stubModule('TLSFingerprintProfilesModal'))
vi.mock('@/components/admin/account/AccountModelTestPanel', async () => (await import('./accountsViewHarness')).stubModule('AccountModelTestPanel'))
vi.mock('@/components/admin/account/AccountStatsModal', async () => (await import('./accountsViewHarness')).stubModule('AccountStatsModal'))
vi.mock('@/components/admin/account/AccountTestModal', async () => (await import('./accountsViewHarness')).stubModule('AccountTestModal'))
vi.mock('@/components/admin/account/ImportDataModal', async () => (await import('./accountsViewHarness')).stubModule('ImportDataModal'))
vi.mock('@/components/admin/account/ReAuthAccountModal', async () => (await import('./accountsViewHarness')).stubModule('ReAuthAccountModal'))
vi.mock('@/components/admin/account/ScheduledTestsPanel', async () => (await import('./accountsViewHarness')).stubModule('ScheduledTestsPanel'))
vi.mock('@/components/admin/account/AccountBulkActionsBar', async () => (await import('./accountsViewHarness')).stubModule('AccountBulkActionsBar'))
vi.mock('@/components/admin/account/AccountTableFilters', async () => (await import('./accountsViewHarness')).stubModule('AccountTableFilters'))
vi.mock('@/components/admin/account/AccountActionMenu', async () => (await import('./accountsViewHarness')).stubModule('AccountActionMenu'))
vi.mock('@/components/auth/TotpStepUpDialog', async () => (await import('./accountsViewHarness')).stubModule('TotpStepUpDialog'))
vi.mock('@/components/common/ConfirmDialog', async () => ({ default: (await import('./accountsViewHarness')).ConfirmDialogStub }))
vi.mock('@/components/common/Pagination', async () => (await import('./accountsViewHarness')).stubModule('Pagination'))
vi.mock('@/components/common/PlatformTypeBadge', async () => (await import('./accountsViewHarness')).platformTypeBadgeModule())
vi.mock('@/components/common/HelpTooltip', async () => (await import('./accountsViewHarness')).helpTooltipModule())
vi.mock('@/components/common/DataTable', async () => {
  const harness = await import('./accountsViewHarness')
  const EmptyTable = harness.makeDataTableStub()
  // 使用能透传 row 数据的替身，以便渲染单元格
  const RowsTable = harness.makeDataTableStub({ cells: ['name', 'platform_type'] })
  return { default: (props: any) => (tableMode.current === 'rows' ? <RowsTable {...props} /> : <EmptyTable {...props} />) }
})

const flushPromises = () => act(async () => {})

const mountView = async () => {
  const view = render(<AccountsView />)
  await flushPromises()
  return view
}

const resetApiMocks = () => {
  for (const fn of [listAccounts, listWithEtag, getBatchTodayStats, getAllProxies, getAllGroups, duplicateAccount, createSparkShadow, app.showSuccess, app.showError]) {
    fn.mockReset()
  }
}

const shownConfirmDialog = () => Object.values(confirmDialogs).find((dialog) => dialog.show)

describe('admin AccountsView — 外审 F2:spark 影子创建接线', () => {
  beforeEach(() => {
    localStorage.clear()
    resetCaptured()
    tableMode.current = 'empty'
    resetApiMocks()
    listAccounts.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20, pages: 0 })
    listWithEtag.mockResolvedValue({ notModified: true, etag: null, data: null })
    getBatchTodayStats.mockResolvedValue({ stats: {} })
    getAllProxies.mockResolvedValue([])
    getAllGroups.mockResolvedValue([])
    duplicateAccount.mockResolvedValue({ id: 998, name: 'parent-acc (Copy)' })
    createSparkShadow.mockResolvedValue({ id: 999, name: 'parent-acc (Spark)' })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('AccountActionMenu 的 duplicate 事件一键复制账号并刷新列表', async () => {
    await mountView()

    await act(async () => {
      captured.AccountActionMenu.onDuplicate({ id: 42, name: 'parent-acc' })
    })
    await flushPromises()

    expect(duplicateAccount).toHaveBeenCalledTimes(1)
    expect(duplicateAccount).toHaveBeenCalledWith(42)
    expect(app.showSuccess).toHaveBeenCalledWith('admin.accounts.duplicateSuccess')
    expect(listAccounts.mock.calls.length).toBeGreaterThan(1)
  })

  it('同一账号复制请求未完成时忽略重复点击', async () => {
    let resolveDuplicate!: (account: { id: number; name: string }) => void
    duplicateAccount.mockImplementationOnce(() => new Promise((resolve) => { resolveDuplicate = resolve }))
    await mountView()

    await act(async () => {
      captured.AccountActionMenu.onDuplicate({ id: 42, name: 'parent-acc' })
      captured.AccountActionMenu.onDuplicate({ id: 42, name: 'parent-acc' })
    })
    await flushPromises()

    expect(duplicateAccount).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveDuplicate({ id: 998, name: 'parent-acc (Copy)' })
    })
    await flushPromises()
  })

  it('复制失败时显示后端错误', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    duplicateAccount.mockRejectedValueOnce(new Error('duplicate failed'))
    await mountView()

    await act(async () => {
      captured.AccountActionMenu.onDuplicate({ id: 42, name: 'parent-acc' })
    })
    await flushPromises()

    expect(app.showError).toHaveBeenCalledWith('duplicate failed')
    consoleError.mockRestore()
  })

  it('AccountActionMenu 的 create-spark-shadow 事件触发 createSparkShadow API + 成功提示', async () => {
    await mountView()

    expect(captured.AccountActionMenu).toBeDefined()

    await act(async () => {
      captured.AccountActionMenu.onCreateSparkShadow({ id: 42, name: 'parent-acc' })
    })
    await flushPromises()

    // 不再用原生 confirm,改用应用内 ConfirmDialog:先弹出,点确认才调 API
    const dialog = shownConfirmDialog()
    expect(dialog).toBeTruthy()
    await act(async () => {
      dialog?.onConfirm()
    })
    await flushPromises()

    expect(createSparkShadow).toHaveBeenCalledTimes(1)
    expect(createSparkShadow).toHaveBeenCalledWith(42, { name: 'parent-acc (Spark)' })
    expect(app.showSuccess).toHaveBeenCalledWith('admin.accounts.createSparkShadowSuccess')
  })

  it('用户取消确认时不调用 API', async () => {
    await mountView()

    await act(async () => {
      captured.AccountActionMenu.onCreateSparkShadow({ id: 42, name: 'parent-acc' })
    })
    await flushPromises()

    // 弹出 ConfirmDialog 后点取消,不应调用 API
    const dialog = shownConfirmDialog()
    expect(dialog).toBeTruthy()
    await act(async () => {
      dialog?.onCancel()
    })
    await flushPromises()

    expect(createSparkShadow).not.toHaveBeenCalled()
  })
})

// 账号行展示
describe('admin AccountsView — 账号行展示', () => {
  beforeEach(() => {
    localStorage.clear()
    resetCaptured()
    tableMode.current = 'rows'
    resetApiMocks()
    listWithEtag.mockResolvedValue({ notModified: true, etag: null, data: null })
    getBatchTodayStats.mockResolvedValue({ stats: {} })
    getAllProxies.mockResolvedValue([])
    getAllGroups.mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const planTypes = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[data-test="platform-type-badge"]')).map((badge) => {
      const value = badge.getAttribute('data-plan-type')
      return value === '__undefined__' ? undefined : value
    })

  it('影子行 email 单元格显示 parent_email，PlatformTypeBadge 接收 parent_plan_type/parent_privacy_mode', async () => {
    const shadowAccount = {
      id: 100,
      name: '影子账号',
      platform: 'openai',
      type: 'oauth',
      parent_account_id: 1,
      parent_email: 'parent@example.com',
      parent_plan_type: 'plus',
      parent_privacy_mode: 'false',
      parent_subscription_expires_at: '2027-01-01T00:00:00Z',
      parent_chatgpt_account_id: 'chatgpt-abc123'
    }

    listAccounts.mockResolvedValue({ items: [shadowAccount], total: 1, page: 1, page_size: 20, pages: 1 })

    const { container } = await mountView()

    // 1. email 单元格通过 OR 兜底渲染 parent_email
    expect(container.textContent).toContain('parent@example.com')

    // 2. PlatformTypeBadge 收到 parent_plan_type 和 parent_privacy_mode
    const badge = container.querySelector('[data-test="platform-type-badge"]')
    expect(badge).not.toBeNull()
    expect(badge!.getAttribute('data-plan-type')).toBe('plus')
    expect(badge!.getAttribute('data-privacy-mode')).toBe('false')
    expect(badge!.getAttribute('data-subscription-expires-at')).toBe('2027-01-01T00:00:00Z')
  })

  it('仅将具有安全 base_url 的 API Key 账号名称链接到站点主页', async () => {
    listAccounts.mockResolvedValue({
      items: [
        { id: 101, name: 'relay-account', platform: 'openai', type: 'apikey', credentials: { base_url: 'https://relay.example.com/api/v1/' } },
        { id: 102, name: 'oauth-account', platform: 'openai', type: 'oauth', credentials: { base_url: 'https://oauth.example.com/v1' } },
        { id: 103, name: 'invalid-url', platform: 'openai', type: 'apikey', credentials: { base_url: 'javascript:alert(1)' } }
      ],
      total: 3,
      page: 1,
      page_size: 20,
      pages: 1
    })

    const { container } = await mountView()

    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(1)
    const [link] = Array.from(links)
    expect(link.textContent).toBe('relay-account')
    expect(link.getAttribute('href')).toBe('https://relay.example.com')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    // Vue 版断言 border-dotted / text-gray-900 等 Tailwind 类；这里断言承载相同外观（虚线下划线、前景色）的模块类
    expect(link.classList.contains(homepageStyles.homepageLink)).toBe(true)
    const tooltip = container.querySelector('[data-test="usage-windows-hint"]')!
    expect(tooltip.textContent).toBe('https://relay.example.com')
    // Vue 版 widthClass 为 'w-max max-w-sm break-all'；React 版 HelpTooltip 以 CSS 长度表示宽度（max-w-sm = 24rem）
    expect(tooltip.getAttribute('data-width')).toBe('24rem')
    expect(tooltip.classList.contains(homepageStyles.homepageTooltip)).toBe(true)
    expect(container.textContent).toContain('oauth-account')
    expect(container.textContent).toContain('invalid-url')
  })

  it('prefers persisted Grok JWT tier over lagging billing/quota snapshots', async () => {
    const grokAccounts = [
      {
        id: 201,
        name: 'oauth-tier',
        platform: 'grok',
        type: 'oauth',
        credentials: { subscription_tier: 'FREE', plan_type: 'legacy' },
        extra: {
          grok_billing_snapshot: { plan: 'SuperGrok' },
          subscription_tier: 'BASIC'
        }
      },
      {
        id: 202,
        name: 'billing-tier',
        platform: 'grok',
        type: 'oauth',
        credentials: {},
        extra: {
          grok_billing_snapshot: { plan: 'SuperGrok Heavy' },
          subscription_tier: 'BASIC'
        }
      },
      {
        id: 203,
        name: 'quota-tier',
        platform: 'grok',
        type: 'oauth',
        credentials: { subscription_tier: 'FREE' },
        extra: {
          grok_quota_snapshot: { subscription_tier: 'SuperGrok' },
          subscription_tier: 'BASIC'
        }
      },
      {
        id: 204,
        name: 'extra-tier',
        platform: 'grok',
        type: 'oauth',
        credentials: { plan_type: 'SuperGrok' },
        extra: { subscription_tier: 'BASIC' }
      },
      {
        id: 205,
        name: 'legacy-tier',
        platform: 'grok',
        type: 'oauth',
        credentials: { plan_type: 'SuperGrok' }
      },
      {
        id: 206,
        name: 'supergrokpro-responses-quota',
        platform: 'grok',
        type: 'oauth',
        credentials: { subscription_tier: 'SuperGrokPro' },
        extra: {
          grok_billing_snapshot: { plan: 'SuperGrok' },
          grok_usage_snapshot: {
            model: 'grok-4.5',
            last_headers_seen_at: new Date().toISOString(),
            requests: { limit: 8300 },
            tokens: { limit: 53_000_000 }
          },
          grok_quota_snapshot: {
            model: 'grok-4.6',
            last_headers_seen_at: new Date().toISOString(),
            requests: { limit: 8300 },
            tokens: { limit: 53_000_000 }
          }
        }
      },
      {
        id: 207,
        name: 'supergrokpro-other-model-quota',
        platform: 'grok',
        type: 'oauth',
        credentials: { subscription_tier: 'SuperGrokPro' },
        extra: {
          grok_billing_snapshot: { plan: 'SuperGrok' },
          grok_usage_snapshot: {
            model: 'grok-4.6',
            last_headers_seen_at: new Date().toISOString(),
            requests: { limit: 8300 },
            tokens: { limit: 53_000_000 }
          }
        }
      },
      {
        id: 208,
        name: 'usage-over-legacy-quota',
        platform: 'grok',
        type: 'oauth',
        credentials: {},
        extra: {
          grok_usage_snapshot: { subscription_tier: 'SuperGrok' },
          grok_quota_snapshot: { subscription_tier: 'Free' }
        }
      },
      {
        id: 209,
        name: 'legacy-quota-alias',
        platform: 'grok',
        type: 'oauth',
        credentials: {},
        extra: { grok_quota_snapshot: { subscription_tier: 'SuperGrok' } }
      }
    ]

    listAccounts.mockResolvedValue({ items: grokAccounts, total: grokAccounts.length, page: 1, page_size: 20, pages: 1 })

    const { container } = await mountView()

    expect(planTypes(container)).toEqual([
      'FREE',
      'SuperGrok Heavy',
      'FREE',
      'BASIC',
      'SuperGrok',
      'SuperGrok Heavy',
      'SuperGrok',
      'SuperGrok',
      'SuperGrok'
    ])
  })

  it('skips malformed Grok plan fields and safely uses the next valid fallback', async () => {
    const grokAccounts = [
      {
        id: 210,
        name: 'legacy-fallback',
        platform: 'grok',
        type: 'oauth',
        credentials: {},
        extra: {
          grok_usage_snapshot: { subscription_tier: { name: 'SuperGrok Heavy' } },
          grok_quota_snapshot: { subscription_tier: 'SuperGrok' }
        }
      },
      {
        id: 211,
        name: 'credential-plan-fallback',
        platform: 'grok',
        type: 'oauth',
        credentials: { subscription_tier: 0, plan_type: 'SuperGrok Heavy' },
        extra: {
          grok_billing_snapshot: { plan: {} },
          grok_usage_snapshot: { subscription_tier: 1 },
          grok_quota_snapshot: { subscription_tier: [] },
          subscription_tier: '   '
        }
      },
      {
        id: 212,
        name: 'no-valid-plan',
        platform: 'grok',
        type: 'oauth',
        credentials: { subscription_tier: {}, plan_type: 2 },
        parent_plan_type: [],
        extra: {
          grok_billing_snapshot: { plan: [] },
          grok_usage_snapshot: { subscription_tier: 1 },
          grok_quota_snapshot: { subscription_tier: {} },
          subscription_tier: null
        }
      }
    ]

    listAccounts.mockResolvedValue({ items: grokAccounts, total: grokAccounts.length, page: 1, page_size: 20, pages: 1 })

    const { container } = await mountView()

    expect(planTypes(container)).toEqual(['SuperGrok', 'SuperGrok Heavy', undefined])
  })

  it('replaces a Grok row when auto refresh returns a changed canonical usage snapshot', async () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    localStorage.setItem('account-auto-refresh', JSON.stringify({ enabled: true, interval_seconds: 5 }))

    const initialAccount = {
      id: 213,
      name: 'refresh-tier',
      platform: 'grok',
      type: 'oauth',
      extra: { grok_usage_snapshot: { subscription_tier: 'Free', status_code: 200 } }
    }
    const refreshedAccount = {
      ...initialAccount,
      extra: { grok_usage_snapshot: { subscription_tier: 'SuperGrok', status_code: 200 } }
    }
    listAccounts.mockResolvedValue({ items: [initialAccount], total: 1, page: 1, page_size: 20, pages: 1 })
    listWithEtag.mockResolvedValueOnce({
      notModified: false,
      etag: 'grok-snapshot-2',
      data: { items: [refreshedAccount], total: 1, page: 1, page_size: 20, pages: 1 }
    })

    const { container } = await mountView()
    expect(planTypes(container)).toEqual(['Free'])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    await flushPromises()

    expect(listWithEtag).toHaveBeenCalledTimes(1)
    expect(planTypes(container)).toEqual(['SuperGrok'])
  })
})
