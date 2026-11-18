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

  describe('snapshot and manual probe precedence', () => {
    const percents = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('[data-testid="usage-bar-percent"]')).map((el) => el.textContent)
    const withExtra = (extra: Record<string, unknown>, id = account.id) =>
      ({ ...account, id, extra: { ...(account.extra as Record<string, unknown>), ...extra } }) as unknown as Account
    const probe = async (container: HTMLElement) => {
      await act(async () => {
        fireEvent.click(container.querySelector('[data-test="cn-provider-quota-probe"]')!)
      })
      await flushPromises()
    }

    it('renders replacement quota values and windows for the same account without probing', async () => {
      const view = render(<CNProviderQuotaCell account={account} />)
      view.rerender(
        <CNProviderQuotaCell
          account={withExtra({
            zhipu_5h_used_percent: 52,
            zhipu_weekly_used_percent: null,
            zhipu_monthly_used_percent: 81,
            zhipu_monthly_reset_at: '2026-12-01T00:00:00Z'
          })}
        />
      )
      expect(percents(view.container)).toEqual(['52%', '81%'])
      expect(view.container.textContent).toContain('admin.accounts.cnProviders.windowMonthly')
      expect(queryQuota).not.toHaveBeenCalled()
    })

    it('removes bars when a refreshed snapshot clears all quota windows', async () => {
      const view = render(<CNProviderQuotaCell account={account} />)
      view.rerender(<CNProviderQuotaCell account={withExtra({ zhipu_5h_used_percent: null, zhipu_weekly_used_percent: null })} />)
      expect(percents(view.container)).toEqual([])
      expect(queryQuota).not.toHaveBeenCalled()
    })

    it('keeps a manual result through unrelated refreshes, then adopts a changed snapshot', async () => {
      queryQuota.mockResolvedValue({ success: true, tiers: [{ window: '5h', used_percent: 44 }] })
      const view = render(<CNProviderQuotaCell account={account} />)
      await probe(view.container)
      view.rerender(<CNProviderQuotaCell account={withExtra({ unrelated_field: true })} />)
      expect(percents(view.container)).toEqual(['44%'])
      view.rerender(<CNProviderQuotaCell account={withExtra({ zhipu_5h_used_percent: 66 })} />)
      expect(percents(view.container)).toEqual(['66%', '27%'])
      expect(queryQuota).toHaveBeenCalledTimes(1)
    })

    it('adopts a new snapshot version even if its quota values equal the old snapshot', async () => {
      queryQuota.mockResolvedValue({ success: true, tiers: [{ window: '5h', used_percent: 44 }] })
      const view = render(<CNProviderQuotaCell account={account} />)
      await probe(view.container)
      expect(percents(view.container)).toEqual(['44%'])
      view.rerender(
        <CNProviderQuotaCell account={withExtra({ zhipu_usage_updated_at: new Date(Date.now() + 1000).toISOString() })} />
      )
      expect(percents(view.container)).toEqual(['0%', '27%'])
    })

    it('keeps the new account snapshot when the previous account probe finishes late', async () => {
      let resolveProbe!: (value: unknown) => void
      queryQuota.mockReturnValue(new Promise((resolve) => (resolveProbe = resolve)))
      const view = render(<CNProviderQuotaCell account={account} />)
      await act(async () => {
        fireEvent.click(view.container.querySelector('[data-test="cn-provider-quota-probe"]')!)
      })
      view.rerender(<CNProviderQuotaCell account={withExtra({ zhipu_5h_used_percent: 91 }, 8)} />)
      expect(percents(view.container)[0]).toBe('91%')
      await act(async () => {
        resolveProbe({ success: true, tiers: [{ window: '5h', used_percent: 44 }] })
      })
      await flushPromises()
      expect(percents(view.container)[0]).toBe('91%')
      expect(view.container.querySelector('[data-test="cn-provider-quota-probe"]')?.hasAttribute('disabled')).toBe(false)
    })
  })
})
