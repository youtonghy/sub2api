import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import OpsErrorLogTable, { type OpsErrorLogTableProps } from '../OpsErrorLogTable'
import zhLocale from '@/i18n/locales/zh'
import enLocale from '@/i18n/locales/en'
import type { OpsErrorLog } from '@/api/admin/ops'

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
vi.mock('@/components/common/Pagination', () => ({ default: () => <div className="pagination-stub" /> }))

afterEach(cleanup)

function mountTable(row: Partial<OpsErrorLog>, props: Partial<OpsErrorLogTableProps> = {}) {
  const base = {
    id: 1,
    created_at: '2026-06-05T23:59:50Z',
    phase: 'upstream',
    type: '',
    error_owner: 'provider',
    error_source: 'upstream_http',
    severity: 'error',
    status_code: 529,
    platform: 'anthropic',
    model: 'claude-opus-4-8',
    resolved: false,
    client_request_id: '',
    request_id: 'req-1',
    message: 'boom',
    user_email: '',
    account_name: '',
    group_name: '',
    ...row,
  } as OpsErrorLog

  return render(<OpsErrorLogTable rows={[base]} total={1} loading={false} page={1} pageSize={20} {...props} />)
}

describe('OpsErrorLogTable user/api-key/account columns', () => {
  // 回归:上游错误行(phase=upstream, owner=provider)以前在单一「用户」列里只显示账号、
  // 丢失用户;现在用户/API Key/账号各占独立列,三者同时可见。
  it('renders user, api key and account in separate columns for an upstream row', () => {
    const { container } = mountTable({
      user_id: 2,
      user_email: 'alice@test.com',
      api_key_id: 5,
      api_key_name: 'my-key',
      account_id: 9,
      account_name: 'acct-A',
    })

    const text = container.textContent
    expect(text).toContain('alice@test.com') // 用户列(上游行也显示用户)
    expect(text).toContain('my-key') // API Key 列
    expect(text).toContain('acct-A') // 账号列
  })

  it('shows the deleted badge for a soft-deleted api key', () => {
    const { container } = mountTable({
      api_key_id: 5,
      api_key_name: 'old-key',
      api_key_deleted: true,
    })

    expect(container.textContent).toContain('old-key')
    expect(container.textContent).toContain('admin.ops.errorLog.keyDeletedBadge')
  })
})

describe('OpsErrorLogTable column order', () => {
  it('puts time and response content first for ops without changing time sorting', () => {
    const onSort = vi.fn()
    const { container } = mountTable({}, { summaryFirst: true, onSort })

    const headers = Array.from(container.querySelectorAll('thead th'))
    expect(headers.slice(0, 3).map((header) => header.textContent?.trim())).toEqual([
      'admin.ops.errorLog.time',
      'admin.ops.errorLog.message',
      'admin.ops.errorLog.user',
    ])
    expect(container.querySelectorAll('tbody td')[1].textContent?.trim()).toBe('boom')

    fireEvent.click(headers[0])
    expect(onSort.mock.calls).toEqual([['created_at', 'asc']])
  })

  it('preserves the usage column order and visibility by default', () => {
    const { container } = mountTable({}, { visibleColumnKeys: ['created_at', 'user', 'message'] })

    expect(Array.from(container.querySelectorAll('thead th')).map((header) => header.textContent?.trim())).toEqual([
      'admin.ops.errorLog.user',
      'admin.ops.errorLog.message',
      'admin.ops.errorLog.time',
    ])
  })
})

// 防回归:组件用 admin.ops.errorLog.* 命名空间。若键写错命名空间(如误放到
// errorDetail),界面会显示原始路径字符串而非译文。直接校验 locale 对象的命名空间含这些键。
describe('OpsErrorLogTable i18n keys exist in the errorLog namespace', () => {
  const locales: Record<string, any> = { zh: zhLocale, en: enLocale }
  for (const [name, msgs] of Object.entries(locales)) {
    it(`has apiKey & keyDeletedBadge for ${name}`, () => {
      const errorLog = msgs?.admin?.ops?.errorLog
      expect(errorLog?.apiKey).toBeTruthy()
      expect(errorLog?.keyDeletedBadge).toBeTruthy()
    })
  }
})
