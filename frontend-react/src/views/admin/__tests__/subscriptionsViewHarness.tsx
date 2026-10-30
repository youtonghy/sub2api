/**
 * SubscriptionsView 测试替身（Vue 版用 global.stubs 替换子组件；React 版在各 spec 中 vi.mock 对应模块，
 * 工厂从这里取替身）。替身把最近一次收到的 props 记在 captured 中，测试通过调用其中的回调模拟 vm.$emit。
 */
import { vi } from 'vitest'
import type { ReactNode } from 'react'

import type { DataTableCellContext } from '@/components/common/DataTable'

/** 每个替身最近一次渲染时的 props；Select 按 placeholder 区分 */
export const captured: Record<string, any> = {}

export function resetCaptured() {
  for (const key of Object.keys(captured)) delete captured[key]
}

export const app = {
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showInfo: vi.fn()
}

export const appStoreModule = () => {
  const useAppStore = Object.assign((selector?: (state: typeof app) => unknown) => (selector ? selector(app) : app), {
    getState: () => app
  })
  return { useAppStore }
}

export const i18nModule = (t: (key: string, params?: any) => string = (key) => key) => ({
  useI18n: () => ({ t, te: () => true, locale: 'en', setLocale: () => {} })
})

/** 渲染 user 单元格的 DataTable 替身（Vue 版 DataTableStub） */
export const dataTableModule = () => ({
  default: (props: {
    data: any[]
    cells?: Record<string, (context: DataTableCellContext) => ReactNode>
  }) => {
    captured.DataTable = props
    return (
      <div data-test="data-table">
        {props.data.map((row, index) => (
          <div key={row.id}>{props.cells?.user?.({ row, value: row.user, expanded: false, index })}</div>
        ))}
      </div>
    )
  }
})

export const selectModule = () => ({
  default: (props: { placeholder?: string }) => {
    captured[`Select:${props.placeholder ?? ''}`] = props
    return null
  }
})

export const baseDialogModule = () => ({
  default: (props: { show: boolean; children?: ReactNode; footer?: ReactNode }) =>
    props.show ? (
      <div>
        {props.children}
        {props.footer}
      </div>
    ) : null
})

export const capturingModule = (name: string) => ({
  default: (props: any) => {
    captured[name] = props
    return null
  }
})
