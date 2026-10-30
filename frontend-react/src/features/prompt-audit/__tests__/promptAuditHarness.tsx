// Prompt Audit 测试桩：Arc 标签页换成同步实现（Radix 标签页在 jsdom 中依赖 mousedown 与退场动画）
import { createContext, useContext, type ReactNode } from 'react'

import type { BaseDialogProps } from '@/components/common/BaseDialog'

const TabsContext = createContext<{ value: string; onValueChange?: (value: string) => void }>({ value: '' })

export function TabsStub({ value, onValueChange, children }: { value?: string; onValueChange?: (value: string) => void; children?: ReactNode }) {
  return <TabsContext.Provider value={{ value: value ?? '', onValueChange }}>{children}</TabsContext.Provider>
}

export function TabsListStub({ children }: { children?: ReactNode }) {
  return <div role="tablist">{children}</div>
}

export function TabsTriggerStub({ value, children, ...rest }: { value: string; children?: ReactNode; 'data-test'?: string }) {
  const ctx = useContext(TabsContext)
  return (
    <button
      type="button"
      role="tab"
      data-test={rest['data-test']}
      aria-selected={ctx.value === value}
      onClick={() => ctx.onValueChange?.(value)}
    >
      {children}
    </button>
  )
}

export function TabsContentStub({ value, children, ...rest }: { value: string; children?: ReactNode; 'data-test'?: string }) {
  const ctx = useContext(TabsContext)
  return ctx.value === value ? (
    <div role="tabpanel" data-test={rest['data-test']}>
      {children}
    </div>
  ) : null
}

export function DialogStub({ show, children, footer }: BaseDialogProps) {
  if (!show) return null
  return (
    <div data-test="dialog">
      {children}
      {footer}
    </div>
  )
}
