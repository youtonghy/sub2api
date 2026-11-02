/**
 * Common component types
 */

export interface Column<T = any> {
  key: string
  label: string
  sortable?: boolean
  /**
   * Vue 版的 class（原为 Tailwind 类）。其中的 text-center / text-right 仍用于对齐，
   * 其余类名原样加到表头与单元格上，可传入页面自己的 CSS Module 类。
   */
  class?: string
  /** 单元格与表头对齐方式，优先于 class 中的 text-center / text-right */
  align?: 'left' | 'center' | 'right'
  /** 固定列宽，例如 120 或 '12rem' */
  width?: number | string
  formatter?: (value: any, row: T) => string
}
