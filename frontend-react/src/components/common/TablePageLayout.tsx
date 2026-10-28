/**
 * 表格页内容骨架，对应 Vue 版 components/layout/TablePageLayout.vue（页面内容容器，不是路由布局）。
 * 宽屏（≥ 1024px）时整体占满视口剩余高度：操作区、筛选区与分页固定，表格区域内部滚动；
 * 窄屏恢复自然滚动。根元素带 data-table-page-layout，useSwipeSelect 以它作为拖选激活区域。
 * 可通过 CSS 变量 --table-page-offset 调整扣除的顶栏与内边距高度。
 */
import type { ReactNode } from 'react'

import styles from './TablePageLayout.module.css'

export interface TablePageLayoutProps {
  /** 固定区域：操作按钮（Vue 版 #actions） */
  actions?: ReactNode
  /** 固定区域：搜索和过滤器（Vue 版 #filters） */
  filters?: ReactNode
  /** 滚动区域：表格（Vue 版 #table） */
  table?: ReactNode
  /** 固定区域：分页器（Vue 版 #pagination） */
  pagination?: ReactNode
  className?: string
}

export default function TablePageLayout({ actions, filters, table, pagination, className }: TablePageLayoutProps) {
  return (
    <div className={[styles.layout, className].filter(Boolean).join(' ')} data-table-page-layout="">
      {actions ? <div className={styles.fixed}>{actions}</div> : null}
      {filters ? <div className={styles.fixed}>{filters}</div> : null}
      <div className={styles.scrollable}>
        <div className={styles.container}>
          {table}
          {pagination ? <div className={styles.pagination}>{pagination}</div> : null}
        </div>
      </div>
    </div>
  )
}
