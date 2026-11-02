import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Account } from '@/types'
import CNProviderQuotaCell from '../CNProviderQuotaCell'
import local from '../CNProviderQuotaCell.module.css'

const { queryQuota, barProps } = vi.hoisted(() => ({
  queryQuota: vi.fn(),
  // 每次渲染 UsageProgressBar 时记录 props（Vue 版 findAllComponents(UsageProgressBar).props()）
  barProps: [] as Array<Record<string, any>>
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    cnProviders: { queryQuota }
  }
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' })
}))

// 包一层真实 UsageProgressBar：照常渲染并记录 props
vi.mock('../UsageProgressBar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../UsageProgressBar')>()
  const Real = actual.default
  return {
    ...actual,
    default: (props: any) => {
      barProps.push(props)
      return <Real {...props} />
    }
  }
})

const flushPromises = () => act(async () => {})

const account = {
  id: 7,
  platform: 'zhipu',
  type: 'apikey',
  credentials: { account_mode: 'coding' },
  extra: {
    zhipu_5h_used_percent: 0,
    zhipu_weekly_used_percent: 27,
    zhipu_5h_reset_at: '2026-08-18T12:30:00+08:00',
    zhipu_weekly_reset_at: '2026-08-22T00:00:00+08:00',
    zhipu_usage_updated_at: new Date().toISOString()
  }
} as unknown as Account

describe('CNProviderQuotaCell', () => {
  beforeEach(() => {
    queryQuota.mockReset()
    barProps.length = 0
  })

  afterEach(() => cleanup())

  it('renders tier rows through the shared UsageProgressBar inside the account table cell', async () => {
    queryQuota.mockResolvedValue({
      success: true,
      tiers: [
        { window: '5h', used_percent: 0, reset_at: '2026-08-18T12:30:00+08:00' },
        { window: 'weekly', used_percent: 27, reset_at: '2026-08-22T00:00:00+08:00' }
      ]
    })
    const { container } = render(<CNProviderQuotaCell account={account} />)

    const root = container.querySelector('[data-test="cn-provider-quota"]')!
    // Vue 版断言 min-w-[220px]；这里断言提供 220px 最小宽度的模块类
    expect(root.classList.contains(local.root)).toBe(true)

    // 新鲜快照：挂载即渲染条形图，不触发探测
    await flushPromises()
    expect(queryQuota).not.toHaveBeenCalled()
    expect(container.textContent).toContain('27%')

    // probe 按钮文案是动词 key（i18n mock 返回 key 本身），点击触发查询
    const probeButton = root.querySelector('[data-test="cn-provider-quota-probe"]')!
    expect(probeButton.textContent).toBe('admin.accounts.cnProviders.probe')
    await act(async () => {
      fireEvent.click(probeButton)
    })
    await flushPromises()
    expect(queryQuota).toHaveBeenCalledWith(account.id)

    // tier 行由 UsageProgressBar 渲染：数量、label/color/utilization/reset 逐行对齐
    expect(root.querySelectorAll('[data-test="cn-provider-quota-tier"]')).toHaveLength(2)
    const bars = barProps.slice(-2)
    expect(bars).toHaveLength(2)
    expect(bars[0].label).toBe('admin.accounts.cnProviders.window5h')
    expect(bars[0].utilization).toBe(0)
    expect(bars[0].color).toBe('indigo')
    expect(bars[0].resetsAt).toBe('2026-08-18T12:30:00+08:00')
    expect(bars[1].label).toBe('admin.accounts.cnProviders.windowWeekly')
    expect(bars[1].utilization).toBe(27)
    expect(bars[1].color).toBe('emerald')
    expect(bars[1].resetsAt).toBe('2026-08-22T00:00:00+08:00')
  })

  it('labels the refresh control with an explicit action verb, not a data caption', async () => {
    const { container } = render(<CNProviderQuotaCell account={account} />)
    await flushPromises()

    // The snapshot is fresh (usage_updated_at = now): bars render without probing.
    expect(queryQuota).not.toHaveBeenCalled()
    expect(container.textContent).toContain('27%')

    // The control reads as an action ("query"), unlike the old noun label
    // ("5-hour window/weekly window") which looked like a passive caption.
    // The i18n mock returns the key itself.
    const probeButton = container.querySelector('[data-test="cn-provider-quota-probe"]')!
    expect(probeButton.textContent).toBe('admin.accounts.cnProviders.probe')

    await act(async () => {
      fireEvent.click(probeButton)
    })
    await flushPromises()
    expect(queryQuota).toHaveBeenCalledWith(account.id)
  })
})
