import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// t() 回显 key，便于断言文案键
const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

import type { PlatformQuotaItem } from '@/api/admin/users'
import UserPlatformQuotaCell from '../UserPlatformQuotaCell'

function item(over: Partial<PlatformQuotaItem> & { platform: PlatformQuotaItem['platform'] }): PlatformQuotaItem {
  return {
    daily_limit_usd: null, weekly_limit_usd: null, monthly_limit_usd: null,
    daily_usage_usd: 0, weekly_usage_usd: 0, monthly_usage_usd: 0,
    ...over
  } as PlatformQuotaItem
}

describe('UserPlatformQuotaCell', () => {
  it('quotas 为 undefined 时渲染加载占位 …', () => {
    const { container } = render(<UserPlatformQuotaCell quotas={undefined} />)
    expect(container.textContent).toContain('…')
    expect(container.innerHTML).not.toContain('admin.users.platformQuota.cellNotConfigured')
  })

  it('空数组渲染「未配置」', () => {
    const { container } = render(<UserPlatformQuotaCell quotas={[]} />)
    expect(container.innerHTML).toContain('admin.users.platformQuota.cellNotConfigured')
  })

  it('平台有记录但全部 limit 为 null 时视为未配置', () => {
    const { container } = render(<UserPlatformQuotaCell quotas={[item({ platform: 'openai', daily_usage_usd: 5 })]} />)
    expect(container.innerHTML).toContain('admin.users.platformQuota.cellNotConfigured')
  })

  it('已配置平台渲染 已用/限额，null 档显示 —，金额去尾零', () => {
    const { container } = render(
      <UserPlatformQuotaCell
        quotas={[
          item({ platform: 'anthropic', daily_limit_usd: 100, daily_usage_usd: 30,
                 weekly_limit_usd: null, weekly_usage_usd: 0,
                 monthly_limit_usd: 2000, monthly_usage_usd: 90.5 })
        ]}
      />
    )
    const text = container.textContent ?? ''
    expect(text).toContain('anthropic')
    expect(text).toContain('30/100')
    expect(text).toContain('0/—')
    expect(text).toContain('90.5/2000')
  })

  it('多平台按固定顺序展示 TypeSafe，且仅展示有限额的平台', () => {
    const { container } = render(
      <UserPlatformQuotaCell
        quotas={[
          item({ platform: 'gemini', monthly_limit_usd: 50 }),
          item({ platform: 'typesafe', daily_limit_usd: 5 }),
          item({ platform: 'anthropic', daily_limit_usd: 10 }),
          item({ platform: 'openai', daily_usage_usd: 9 })
        ]}
      />
    )
    const text = container.textContent ?? ''
    expect(text.indexOf('anthropic')).toBeLessThan(text.indexOf('gemini'))
    expect(text.indexOf('gemini')).toBeLessThan(text.indexOf('typesafe'))
    expect(text).not.toContain('openai')
  })
})
