/**
 * GroupsView 测试替身（Vue 版用 global.stubs 替换子组件；React 版在各 spec 中 vi.mock 对应模块，工厂从这里取替身）。
 */
import { act } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { DataTableCellContext } from '@/components/common/DataTable'
import type { Column } from '@/components/common/types'
import { REASONING_EFFORT_LEVELS } from '@/constants/channel'
import type { PricingFormEntry } from '@/components/admin/channel/types'

export const flushPromises = () => act(async () => {})

export const i18nModule = (messages: Record<string, string> = {}) => ({
  useI18n: () => ({
    t: (key: string) => messages[key] ?? key,
    te: () => true,
    locale: 'en',
    setLocale: () => {}
  })
})

export const storeModule = <S extends object>(name: string, state: S) => {
  const hook = Object.assign((selector?: (s: S) => unknown) => (selector ? selector(state) : state), {
    getState: () => state
  })
  return { [name]: hook }
}

export const nullModule = () => ({ default: () => null })

/** Vue 版 BaseDialog 替身：show 时渲染内容与底部 */
/** 抽屉替身选项：renderWhileClosed=true 时关闭后仍渲染内容，模拟抽屉滑出动画期间的画面 */
export const drawerStub = { renderWhileClosed: false }

export const accountFormLayoutModule = async (
  importOriginal: () => Promise<typeof import('@/components/account/AccountFormLayout')>
) => {
  const actual = await importOriginal()
  return {
    ...actual,
    AccountFormDrawer: (props: { show: boolean; children?: ReactNode; footer?: ReactNode }) =>
      props.show || drawerStub.renderWhileClosed ? (
        <div data-drawer-open={String(props.show)}>
          {props.children}
          {props.footer}
        </div>
      ) : null
  }
}

/** 原生 select 替身（Vue 版 SelectStub） */
export const selectModule = () => ({
  default: (props: {
    value: unknown
    options: Array<{ value: unknown; label: string }>
    onChange?: (value: unknown) => void
  }) => (
    <select
      value={props.value == null ? '' : String(props.value)}
      onChange={(event) => props.onChange?.(event.target.value)}
    >
      {props.options.map((option) => (
        <option key={String(option.value)} value={option.value == null ? '' : String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  )
})

export interface DataTableStubOptions {
  /** 渲染第一行的这些单元格（包在 data-test="cell-<key>" 中） */
  firstRowCells?: string[]
  /** 每行都渲染的单元格 */
  rowCells?: string[]
}

export function makeDataTableModule(options: DataTableStubOptions = {}) {
  return {
    default: function DataTableStub(props: {
      columns: Column[]
      data: any[]
      cells?: Record<string, (context: DataTableCellContext) => ReactNode>
    }) {
      const renderCell = (key: string, row: any, index: number) =>
        props.cells?.[key]?.({ row, value: row?.[key], expanded: false, index }) ?? null
      return (
        <div>
          <div data-test="columns">{props.columns.map((col) => col.key).join(',')}</div>
          <div data-test="rows">{props.data.map((row) => row.name).join(',')}</div>
          {props.data.length
            ? (options.firstRowCells ?? []).map((key) => (
                <div key={key} data-test={`cell-${key}`}>
                  {renderCell(key, props.data[0], 0)}
                </div>
              ))
            : null}
          {props.data.map((row, index) => (
            <div key={row.id ?? index}>{(options.rowCells ?? []).map((key) => <span key={key}>{renderCell(key, row, index)}</span>)}</div>
          ))}
        </div>
      )
    }
  }
}

/**
 * PricingEntryCard 替身：只实现推理强度倍率区域（与 Vue 版 PricingEntryCard 的 data-reasoning-effort 输入一致），
 * 用于验证分组表单的回显与提交。真实组件由渠道页面迁移提供。
 */
export const pricingEntryCardModule = () => ({
  default: (props: { entry: PricingFormEntry; onUpdate: (entry: PricingFormEntry) => void }) => {
    const multipliers = props.entry.reasoning_effort_multipliers
    const update = (effort: string, value: string) => {
      const next = { ...multipliers }
      if (value === '') delete next[effort]
      else next[effort] = value
      props.onUpdate({ ...props.entry, reasoning_effort_multipliers: Object.keys(next).length ? next : null })
    }
    return (
      <div data-testid="reasoning-effort-multipliers">
        {Object.keys(multipliers || {}).length ? (
          <button type="button" onClick={() => props.onUpdate({ ...props.entry, reasoning_effort_multipliers: null })}>
            clear
          </button>
        ) : null}
        {REASONING_EFFORT_LEVELS.map((effort) => (
          <input
            key={effort}
            type="number"
            data-reasoning-effort={effort}
            value={multipliers?.[effort] ?? ''}
            onChange={(event) => update(effort, event.target.value)}
          />
        ))}
      </div>
    )
  }
})

export const buttonByText = (text: string) =>
  Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === text)

export const buttonContaining = (text: string) =>
  Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes(text))
