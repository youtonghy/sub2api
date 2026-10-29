import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import OpsErrorDetailModal from '../OpsErrorDetailModal'
import OpsErrorDetailsModal, { type OpsErrorDetailsModalProps } from '../OpsErrorDetailsModal'

const mocks = vi.hoisted(() => ({
  getRequestErrorDetail: vi.fn(),
  listRequestErrorUpstreamErrors: vi.fn(),
  listRequestErrors: vi.fn()
}))

vi.mock('@/api/admin/ops', async (importOriginal) => {
  const opsAPI = {
    getRequestErrorDetail: mocks.getRequestErrorDetail,
    getUpstreamErrorDetail: vi.fn(),
    listRequestErrorUpstreamErrors: mocks.listRequestErrorUpstreamErrors,
    listRequestErrors: mocks.listRequestErrors,
    listUpstreamErrors: vi.fn()
  }
  return { ...(await importOriginal<object>()), opsAPI, default: opsAPI }
})

// 真实 t 是模块级稳定引用，mock 也保持稳定，避免依赖 t 的回调每次渲染都变化
const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

// 对话框只保留内容，避免 Radix portal 干扰文本断言
vi.mock('@/components/common/BaseDialog', () => ({
  default: ({ show, children, footer }: { show: boolean; children?: ReactNode; footer?: ReactNode }) =>
    show ? <div data-testid="dialog">{children}{footer}</div> : null
}))

vi.mock('@/components/common/Select', () => ({ default: () => <div data-testid="select-stub" /> }))
vi.mock('@/components/common/Pagination', () => ({ default: () => null }))

afterEach(cleanup)

describe('OpsErrorDetailModal', () => {
  beforeEach(() => {
    mocks.getRequestErrorDetail.mockReset()
    mocks.listRequestErrorUpstreamErrors.mockReset()
    mocks.listRequestErrorUpstreamErrors.mockResolvedValue({ items: [] })
  })

  it('prioritizes upstream root cause and deduplicates diagnostic payloads', async () => {
    mocks.getRequestErrorDetail.mockResolvedValue({
      id: 1,
      created_at: '2026-08-19T00:00:00Z',
      phase: 'request',
      type: 'upstream_error',
      error_owner: 'provider',
      error_source: 'gateway',
      severity: 'P1',
      status_code: 502,
      upstream_status_code: 429,
      platform: 'openai',
      model: 'gpt-5.6',
      resolved: false,
      request_id: 'rid-1',
      message: 'All available accounts exhausted',
      error_body: '{"error":"same"}',
      upstream_error_message: 'provider rate limit exhausted',
      upstream_error_detail: '{"error":"same"}',
      upstream_errors: '[]',
      account_name: 'account',
      group_name: 'group',
      is_business_limited: false
    })

    const { getByTestId } = render(<OpsErrorDetailModal show errorId={1} errorType="request" />)
    await waitFor(() => expect(getByTestId('dialog').textContent).toContain('provider rate limit exhausted'))

    const dialog = getByTestId('dialog')
    expect(dialog.textContent).toContain('admin.ops.errorDetail.upstreamStatus')
    expect(dialog.textContent).toContain('429')
    expect(dialog.querySelectorAll('pre')).toHaveLength(2)
    expect(dialog.textContent).not.toContain('admin.ops.errorDetail.payloads.upstream_detail')
  })
})

// React 版补充：错误列表弹窗从单条详情返回（resumeState=true）时保留筛选与分页，
// 父组件随后把 resumeState 复位为 false 也不能触发重置或重新请求（对应 Vue 的 watch(show) 语义）。
describe('OpsErrorDetailsModal resume state', () => {
  beforeEach(() => {
    mocks.listRequestErrors.mockReset()
    mocks.listRequestErrors.mockResolvedValue({ items: [], total: 0 })
  })

  it('resets on a manual open but keeps state when resuming', async () => {
    const base: OpsErrorDetailsModalProps = { show: false, timeRange: '1h', errorType: 'request' }
    const { rerender } = render(<OpsErrorDetailsModal {...base} />)
    rerender(<OpsErrorDetailsModal {...base} show />)
    await waitFor(() => expect(mocks.listRequestErrors).toHaveBeenCalledTimes(1))
    expect(mocks.listRequestErrors).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, page_size: 10, view: 'errors' }))

    rerender(<OpsErrorDetailsModal {...base} show={false} />)
    rerender(<OpsErrorDetailsModal {...base} show resumeState />)
    rerender(<OpsErrorDetailsModal {...base} show resumeState={false} />)
    await act(async () => {})
    expect(mocks.listRequestErrors).toHaveBeenCalledTimes(1)

    rerender(<OpsErrorDetailsModal {...base} show={false} />)
    rerender(<OpsErrorDetailsModal {...base} show />)
    await waitFor(() => expect(mocks.listRequestErrors).toHaveBeenCalledTimes(2))
  })
})
