/* eslint-disable react-refresh/only-export-components -- 测试替身集合，不参与热更新 */
/**
 * AccountsView 测试替身（Vue 版用 global.stubs 替换子组件；React 版在各 spec 中 vi.mock 对应模块，
 * 工厂从这里取替身）。替身把最近一次收到的 props 记在 captured 中，测试通过调用其中的回调来模拟
 * Vue 版的 vm.$emit。
 */
import { vi } from 'vitest'
import type { ReactNode } from 'react'

import type { DataTableCellContext, DataTableHeaderContext } from '@/components/common/DataTable'
import type { Column } from '@/components/common/types'

/** 每个替身最近一次渲染时的 props */
export const captured: Record<string, any> = {}
/** ConfirmDialog 按标题记录（页面上同时存在多个确认框） */
export const confirmDialogs: Record<string, any> = {}

export function resetCaptured() {
  for (const key of Object.keys(captured)) delete captured[key]
  for (const key of Object.keys(confirmDialogs)) delete confirmDialogs[key]
}

/** 渲染为空的替身，记录 props */
export function capturing(name: string, render?: (props: any) => ReactNode) {
  return function Stub(props: any) {
    captured[name] = props
    return render ? <>{render(props)}</> : null
  }
}

export const stubModule = (name: string, render?: (props: any) => ReactNode) => ({ default: capturing(name, render) })

export const ConfirmDialogStub = (props: any) => {
  confirmDialogs[props.title] = props
  return null
}

/** 账号单元格模块（account 组件桶文件）的替身 */
export const accountBarrelModule = (overrides: Record<string, (props: any) => ReactNode> = {}) => ({
  CreateAccountModal: capturing('CreateAccountModal', overrides.CreateAccountModal),
  EditAccountModal: capturing('EditAccountModal', overrides.EditAccountModal),
  BulkEditAccountModal: capturing('BulkEditAccountModal', overrides.BulkEditAccountModal),
  SyncFromCrsModal: capturing('SyncFromCrsModal'),
  TempUnschedStatusModal: capturing('TempUnschedStatusModal'),
  AccountFailureHeatmap: capturing('AccountFailureHeatmap')
})

export const platformTypeBadgeModule = () => ({
  default: (props: any) => (
    <span
      data-test="platform-type-badge"
      data-plan-type={props.planType === undefined ? '__undefined__' : String(props.planType)}
      data-privacy-mode={props.privacyMode === undefined ? '__undefined__' : String(props.privacyMode)}
      data-subscription-expires-at={props.subscriptionExpiresAt ?? ''}
    />
  )
})

/** 展示内容的 HelpTooltip 替身（Vue 版 usage-windows-hint 替身），保留自定义触发内容 */
export const helpTooltipModule = () => ({
  default: (props: any) => (
    <>
      <span data-test="usage-windows-hint" data-width={props.width} className={props.className}>
        {props.content}
      </span>
      {props.triggerContent}
    </>
  )
})

export const plainHelpTooltipModule = () => ({
  default: (props: any) => <>{props.triggerContent}</>
})

// ===== 应用与认证 store =====

export const app = {
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn()
}

export const appStoreModule = () => {
  const useAppStore = Object.assign((selector?: (state: typeof app) => unknown) => (selector ? selector(app) : app), {
    getState: () => app
  })
  return { useAppStore }
}

export const auth = { token: 'test-token', isSimpleMode: false }

export const authStoreModule = () => {
  const useAuthStore = Object.assign((selector?: (state: typeof auth) => unknown) => (selector ? selector(auth) : auth), {
    getState: () => auth
  })
  return { useAuthStore }
}

export const i18nModule = () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en', setLocale: () => {} })
})

// ===== DataTable 替身 =====

export interface DataTableStubOptions {
  /** 渲染列键：'column-key' → <span data-test="column-key">key</span>；'data-column' → 带 sortable/fixed 文本 */
  columnKeys?: 'column-key' | 'data-column'
  /** 渲染的表头：列键 → data-test */
  headers?: Record<string, string>
  /** 每行渲染的单元格：列键，或 [列键, 包裹 div 的 data-test] */
  cells?: Array<string | [string, string]>
  /** 行容器属性 */
  rowAttrs?: (row: any) => Record<string, string>
  /** 渲染一个触发 onSort('priority', 'desc') 的按钮 */
  sortButton?: boolean
}

export function makeDataTableStub(options: DataTableStubOptions = {}) {
  return function DataTableStub(props: {
    columns: Column[]
    data: any[]
    cells?: Record<string, (context: DataTableCellContext) => ReactNode>
    headers?: Record<string, (context: DataTableHeaderContext) => ReactNode>
    onSort?: (key: string, order: 'asc' | 'desc') => void
  }) {
    captured.DataTable = props
    const renderCell = (key: string, row: any, index: number) =>
      props.cells?.[key]?.({ row, value: row?.[key], expanded: false, index }) ?? null
    return (
      <div data-test="data-table">
        {options.columnKeys === 'column-key' &&
          props.columns.map((column) => (
            <span key={column.key} data-test="column-key">
              {column.key}
            </span>
          ))}
        {options.columnKeys === 'data-column' &&
          props.columns.map((column) => (
            <span key={column.key} data-column={column.key}>
              {column.sortable ? 'sortable' : 'fixed'}
            </span>
          ))}
        {options.headers &&
          props.columns
            .filter((column) => options.headers![column.key])
            .map((column) => (
              <div key={column.key} data-test={options.headers![column.key]}>
                {props.headers?.[column.key]?.({ column, sortKey: '', sortOrder: 'asc' })}
              </div>
            ))}
        {options.sortButton && <button type="button" data-test="sort-priority" onClick={() => props.onSort?.('priority', 'desc')} />}
        {props.data.map((row, index) => (
          <div key={row.id ?? index} {...(options.rowAttrs?.(row) ?? {})}>
            {(options.cells ?? []).map((cell) => {
              const [key, testId] = Array.isArray(cell) ? cell : [cell, undefined]
              return testId ? (
                <div key={key} data-test={testId}>
                  {renderCell(key, row, index)}
                </div>
              ) : (
                <span key={key}>{renderCell(key, row, index)}</span>
              )
            })}
          </div>
        ))}
      </div>
    )
  }
}
