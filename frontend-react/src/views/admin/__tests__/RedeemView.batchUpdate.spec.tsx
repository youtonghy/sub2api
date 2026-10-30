import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataTableCellContext, DataTableHeaderContext } from '@/components/common/DataTable'
import type { Column } from '@/components/common/types'
import RedeemView from '../RedeemView'

const { listRedeemCodes, batchUpdateRedeemCodes, getAllGroups, showSuccess, showError, showInfo } = vi.hoisted(() => ({
  listRedeemCodes: vi.fn(),
  batchUpdateRedeemCodes: vi.fn(),
  getAllGroups: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    redeem: {
      list: listRedeemCodes,
      generate: vi.fn(),
      delete: vi.fn(),
      batchDelete: vi.fn(),
      batchUpdate: batchUpdateRedeemCodes,
      exportCodes: vi.fn()
    },
    groups: {
      getAll: getAllGroups
    }
  }
}))

vi.mock('@/stores/app', () => {
  const app = { showSuccess, showError, showInfo }
  return { useAppStore: Object.assign(() => app, { getState: () => app }) }
})

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({
    copied: false,
    copyToClipboard: vi.fn()
  })
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' })
}))

// 渲染表头与单元格渲染函数的 DataTable 替身（Vue 版 DataTableStub）
vi.mock('@/components/common/DataTable', () => ({
  default: (props: {
    columns: Column[]
    data: any[]
    headers?: Record<string, (context: DataTableHeaderContext) => ReactNode>
    cells?: Record<string, (context: DataTableCellContext) => ReactNode>
  }) => (
    <table>
      <thead>
        <tr>
          {props.columns.map((column) => (
            <th key={column.key}>
              {props.headers?.[column.key]?.({ column, sortKey: '', sortOrder: 'asc' }) ?? column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.data.map((row, index) => (
          <tr key={row.id}>
            {props.columns.map((column) => (
              <td key={column.key}>
                {props.cells?.[column.key]?.({ row, value: row[column.key], expanded: false, index }) ?? String(row[column.key] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}))

// 原生 select 替身（Vue 版 SelectStub），透传 data-test
vi.mock('@/components/common/Select', () => ({
  default: (props: {
    value: unknown
    options: Array<{ value: unknown; label: string }>
    onChange?: (value: unknown, option: unknown) => void
    'data-test'?: string
  }) => (
    <select
      data-test={props['data-test']}
      value={String(props.value ?? '')}
      onChange={(event) => {
        const raw = event.target.value
        const option = props.options.find((item) => String(item.value ?? '') === raw)
        props.onChange?.(option ? option.value : raw, option ?? null)
      }}
    >
      {props.options.map((option) => (
        <option key={String(option.value ?? '')} value={String(option.value ?? '')}>
          {option.label}
        </option>
      ))}
    </select>
  )
}))

vi.mock('@/components/common/BaseDialog', () => ({
  default: (props: { show: boolean; children?: ReactNode; footer?: ReactNode }) =>
    props.show ? (
      <div>
        {props.children}
        {props.footer}
      </div>
    ) : null
}))
vi.mock('@/components/common/Pagination', () => ({ default: () => null }))
vi.mock('@/components/common/ConfirmDialog', () => ({ default: () => null }))
vi.mock('@/components/common/GroupBadge', () => ({ default: () => null }))
vi.mock('@/components/common/GroupOptionItem', () => ({ default: () => null }))

const flushPromises = () => act(async () => {})
const get = <T extends Element = HTMLElement>(selector: string) => {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Unable to find ${selector}`)
  return element
}

describe('admin RedeemView batch update', () => {
  beforeEach(() => {
    localStorage.clear()

    listRedeemCodes.mockReset()
    batchUpdateRedeemCodes.mockReset()
    getAllGroups.mockReset()
    showSuccess.mockReset()
    showError.mockReset()
    showInfo.mockReset()

    listRedeemCodes.mockResolvedValue({
      items: [
        {
          id: 1,
          code: 'CODE-1',
          type: 'balance',
          value: 10,
          status: 'unused',
          used_by: null,
          used_at: null,
          created_at: '2026-01-01T00:00:00Z',
          expires_at: null
        },
        {
          id: 2,
          code: 'CODE-2',
          type: 'balance',
          value: 20,
          status: 'unused',
          used_by: null,
          used_at: null,
          created_at: '2026-01-01T00:00:00Z',
          expires_at: null
        }
      ],
      total: 2,
      page: 1,
      page_size: 20,
      pages: 1
    })
    batchUpdateRedeemCodes.mockResolvedValue({ updated: 1, message: 'ok' })
    getAllGroups.mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
  })

  it('submits only checked fields for selected redeem codes', async () => {
    render(<RedeemView />)

    await flushPromises()
    // Vue 版对原生 checkbox setValue(true)；Arc checkbox 是按钮，点击切换
    fireEvent.click(document.querySelectorAll('[data-test="select-code"]')[0]!)
    fireEvent.click(get('[data-test="batch-update-open"]'))
    await flushPromises()

    fireEvent.click(get('[data-test="batch-field-status"]'))
    fireEvent.change(get('[data-test="batch-status-select"]'), { target: { value: 'disabled' } })
    fireEvent.click(get('[data-test="batch-field-notes"]'))
    fireEvent.change(get('[data-test="batch-notes-input"]'), { target: { value: 'maintenance' } })
    fireEvent.submit(get('[data-test="batch-update-form"]'))
    await flushPromises()

    expect(batchUpdateRedeemCodes).toHaveBeenCalledWith([1], {
      status: 'disabled',
      notes: 'maintenance'
    })
    expect(showSuccess).toHaveBeenCalledWith('admin.redeem.batchUpdateSuccess')
  })
})
