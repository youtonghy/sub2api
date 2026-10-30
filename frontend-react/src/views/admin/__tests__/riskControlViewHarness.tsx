// RiskControlView 测试桩：抽屉、标签页、下拉、模型白名单、代理选择、数据表换成最小实现（对应 Vue spec 的 stubs）
import { createContext, useContext, type ReactNode } from 'react'

import type { DataTableProps } from '@/components/common/DataTable'
import type { SelectProps } from '@/components/common/Select'

export function DrawerStub({ open, children }: { open?: boolean; children?: ReactNode }) {
  return open ? <div data-test="drawer">{children}</div> : null
}

export function DrawerContentStub({ children }: { children?: ReactNode }) {
  return <div>{children}</div>
}

const TabsContext = createContext<{ value: string; onValueChange?: (value: string) => void }>({ value: '' })

export function TabsStub({ value, onValueChange, children }: { value?: string; onValueChange?: (value: string) => void; children?: ReactNode }) {
  return <TabsContext.Provider value={{ value: value ?? '', onValueChange }}>{children}</TabsContext.Provider>
}

export function TabsListStub({ children }: { children?: ReactNode }) {
  return <div role="tablist">{children}</div>
}

export function TabsTriggerStub({ value, children }: { value: string; children?: ReactNode }) {
  const ctx = useContext(TabsContext)
  return (
    <button type="button" role="tab" aria-selected={ctx.value === value} onClick={() => ctx.onValueChange?.(value)}>
      {children}
    </button>
  )
}

export function TabsContentStub({ value, children }: { value: string; children?: ReactNode }) {
  const ctx = useContext(TabsContext)
  return ctx.value === value ? <div role="tabpanel">{children}</div> : null
}

export function SelectStub({ value, options, onChange, disabled }: SelectProps) {
  return (
    <select value={value == null ? '' : String(value)} disabled={disabled} onChange={(event) => onChange?.(event.target.value, null)}>
      {(options as Array<{ value: unknown; label: string }>).map((option) => (
        <option key={String(option.value)} value={String(option.value ?? '')}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function ModelWhitelistSelectorStub({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  return (
    <input
      data-test="model-filter-input"
      value={value.join('\n')}
      onChange={(event) =>
        onChange(
          event.target.value
            .split(/[,\n]/)
            .map((item) => item.trim())
            .filter(Boolean)
        )
      }
    />
  )
}

export function NullStub() {
  return null
}

export function DataTableStub({ data }: DataTableProps) {
  return <div data-test="logs">{data.length}</div>
}
