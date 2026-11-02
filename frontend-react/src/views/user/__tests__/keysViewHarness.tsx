/**
 * KeysView 测试替身与组件注册表。
 * Vue 版用 global.stubs 替换子组件，并用 findComponent(...).props() / vm.$emit() 驱动；
 * React 版在 spec 中 vi.mock 对应模块，替身在渲染时把最新 props 记入注册表，
 * findComponent 返回同名接口（props / vm.$emit），emit 映射到对应的 onXxx 回调。
 */
import { act } from '@testing-library/react'
import { useId, useLayoutEffect, type ReactNode } from 'react'

import type { DataTableCellContext } from '@/components/common/DataTable'
import type { Column } from '@/components/common/types'

type AnyProps = Record<string, any>

const registry = new Map<string, Map<string, AnyProps>>()

const bucket = (name: string) => {
  let entries = registry.get(name)
  if (!entries) {
    entries = new Map()
    registry.set(name, entries)
  }
  return entries
}

/** 在替身组件内调用：记录本实例最新的 props，卸载时移除 */
export function useRegister(name: string, props: AnyProps) {
  const id = useId()
  bucket(name).set(id, props)
  useLayoutEffect(() => () => {
    bucket(name).delete(id)
  }, [name, id])
}

const propAlias: Record<string, string> = { modelValue: 'value' }
const emitAlias: Record<string, string> = {
  'update:modelValue': 'onChange',
  'update:selectedKeys': 'onSelectedKeysChange',
  'update:page': 'onPageChange',
  'update:pageSize': 'onPageSizeChange'
}
const handlerName = (event: string) =>
  emitAlias[event] ?? `on${event.charAt(0).toUpperCase()}${event.slice(1)}`

export interface ComponentHandle {
  exists: () => boolean
  props: (key: string) => any
  vm: { $emit: (event: string, ...args: unknown[]) => void }
}

function handle(name: string, id: string): ComponentHandle {
  const current = () => bucket(name).get(id)
  return {
    exists: () => current() !== undefined,
    props: (key) => current()?.[propAlias[key] ?? key],
    vm: {
      $emit: (event, ...args) => {
        const fn = current()?.[handlerName(event)]
        act(() => {
          fn?.(...args)
        })
      }
    }
  }
}

export function findAllComponents(name: string, predicate?: (props: AnyProps) => boolean): ComponentHandle[] {
  return Array.from(bucket(name).entries())
    .filter(([, props]) => !predicate || predicate(props))
    .map(([id]) => handle(name, id))
}

export function findComponent(name: string, predicate?: (props: AnyProps) => boolean): ComponentHandle {
  const found = findAllComponents(name, predicate)[0]
  if (!found) throw new Error(`Component not found: ${name}`)
  return found
}

export function resetRegistry() {
  registry.clear()
}

/** 只登记 props、不渲染内容的替身（Vue 版 stub: true） */
export const registeringStub = (name: string) => ({
  default: function RegisteringStub(props: AnyProps) {
    useRegister(name, props)
    return null
  }
})

export const nullModule = () => ({ default: () => null })

export const storeModule = <S extends object>(name: string, state: S) => {
  const hook = Object.assign((selector?: (s: S) => unknown) => (selector ? selector(state) : state), {
    getState: () => state
  })
  return { [name]: hook }
}

export const i18nModule = (messages: Record<string, string>) => ({
  useI18n: () => ({
    t: (key: string) => messages[key] ?? key,
    te: () => true,
    locale: 'en',
    setLocale: () => {}
  })
})

/** Vue 版 DataTableStub */
export const dataTableModule = () => ({
  default: function DataTableStub(props: {
    columns: Column[]
    data: any[]
    cells?: Record<string, (context: DataTableCellContext) => ReactNode>
    onSort?: (key: string, order: 'asc' | 'desc') => void
    empty?: ReactNode
  }) {
    useRegister('DataTable', props)
    const cell = (key: string, row: any, index: number) =>
      props.cells?.[key]?.({ row, value: row?.[key], expanded: false, index }) ?? null
    const hasColumn = (key: string) => props.columns.some((col) => col.key === key)
    return (
      <div>
        <div data-test="columns">{props.columns.map((col) => col.key).join(',')}</div>
        <div data-test="columns-meta">
          {JSON.stringify(props.columns.map((col) => ({ key: col.key, sortable: !!col.sortable })))}
        </div>
        <button data-test="sort-current-concurrency" onClick={() => props.onSort?.('current_concurrency', 'asc')}>
          Sort Current Concurrency
        </button>
        {props.data.map((row, index) => (
          <div key={row.id}>
            {hasColumn('id') && <div data-test="key-id">{cell('id', row, index)}</div>}
            {cell('name', row, index)}
            {cell('actions', row, index)}
            <div data-test="current-concurrency">{cell('current_concurrency', row, index)}</div>
            {hasColumn('last_used_ip') && <div data-test="last-used-ip">{cell('last_used_ip', row, index)}</div>}
          </div>
        ))}
        {props.empty}
      </div>
    )
  }
})

/** Vue 版 SelectStub */
export const selectModule = () => ({
  default: function SelectStub(props: {
    value: unknown
    options: Array<{ value: unknown; label: string }>
    onChange?: (value: unknown) => void
  }) {
    useRegister('Select', props)
    return (
      <select
        value={props.value == null ? '' : String(props.value)}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
    )
  }
})

/** Vue 版 SearchInputStub */
export const searchInputModule = () => ({
  default: function SearchInputStub(props: { value: string; onChange?: (value: string) => void }) {
    useRegister('SearchInput', props)
    return <input value={props.value} onChange={(event) => props.onChange?.(event.target.value)} />
  }
})

/** Vue 版 PaginationStub */
export const paginationModule = () => ({
  default: function PaginationStub(props: { onPageChange?: (page: number) => void; onPageSizeChange?: (size: number) => void }) {
    useRegister('Pagination', props)
    return (
      <div>
        <button data-test="page-size-50" onClick={() => props.onPageSizeChange?.(50)}>50</button>
        <button data-test="page-2" onClick={() => props.onPageChange?.(2)}>Page 2</button>
      </div>
    )
  }
})

/** Vue 版 BaseDialog 替身：show 时渲染关闭按钮、内容与底部 */
export const baseDialogModule = () => ({
  default: function BaseDialogStub(props: { show: boolean; onClose?: () => void; children?: ReactNode; footer?: ReactNode }) {
    useRegister('BaseDialog', props)
    if (!props.show) return null
    return (
      <div role="dialog">
        <button data-test="close-dialog" onClick={() => props.onClose?.()}>Close</button>
        {props.children}
        {props.footer}
      </div>
    )
  }
})
