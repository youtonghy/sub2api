// ProxiesView 测试共用的桩：DataTable、BaseDialog、Pagination、Select 换成最小实现（对应 Vue spec 的 stubs）
import type { ReactNode } from 'react'

import type { BaseDialogProps } from '@/components/common/BaseDialog'
import type { DataTableProps } from '@/components/common/DataTable'
import type { PaginationProps } from '@/components/common/Pagination'
import type { SelectProps } from '@/components/common/Select'

export function DataTableStub({ data, cells }: DataTableProps) {
  return (
    <div>
      <div data-test="rows">{data.map((row) => row.name).join(',')}</div>
      {data.map((row, index) => (
        <div key={row.id}>{cells?.actions?.({ row, value: undefined, expanded: false, index }) as ReactNode}</div>
      ))}
    </div>
  )
}

export function BaseDialogStub({ show, children, footer }: BaseDialogProps) {
  if (!show) return null
  return (
    <div>
      {children}
      {footer}
    </div>
  )
}

export function PaginationStub({ page, onPageChange }: PaginationProps) {
  return (
    <button type="button" data-test="page" onClick={() => onPageChange?.(2)}>
      {page}
    </button>
  )
}

export function SelectStub({ value, options, placeholder, onChange }: SelectProps) {
  return (
    <select
      data-filter={placeholder}
      value={value == null ? '' : String(value)}
      onChange={(event) => onChange?.(event.target.value, null)}
    >
      {(options as Array<{ value: unknown; label: string }>).map((option) => (
        <option key={String(option.value)} value={String(option.value ?? '')}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
