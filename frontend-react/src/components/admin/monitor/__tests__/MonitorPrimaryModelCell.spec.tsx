import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import MonitorPrimaryModelCell from '../MonitorPrimaryModelCell'
import { makeMonitor } from './monitorFixtures'

// 占位符 "quota" 是纯配额模式主模型的存储值（数据源是账号不是模型），
// 展示层必须替换为本地化标签，不得作为假模型名透出。

const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))
vi.mock('@/components/common/MonitorQuotaView', () => ({ default: () => null }))

const makeRow = (overrides = {}) =>
  makeMonitor({
    id: 1,
    name: 'kimi-coding',
    provider: 'kimi',
    endpoint: '',
    api_key_masked: '',
    primary_model: 'quota',
    primary_status: 'operational',
    availability_7d: 100,
    check_mode: 'quota',
    account_id: 5,
    ...overrides
  })

describe('MonitorPrimaryModelCell placeholder model display', () => {
  it('replaces the quota placeholder with the localized mode label', () => {
    const { container } = render(<MonitorPrimaryModelCell row={makeRow()} />)
    expect(container.textContent).toContain('monitorCommon.checkMode.quota')
  })

  it('keeps the real model for quota_probe and probe rows', () => {
    const { container } = render(
      <MonitorPrimaryModelCell row={makeRow({ check_mode: 'quota_probe', primary_model: 'claude-sonnet-4-5' })} />
    )
    expect(container.textContent).toContain('claude-sonnet-4-5')
    expect(container.textContent).not.toContain('monitorCommon.checkMode.quota')
  })
})
