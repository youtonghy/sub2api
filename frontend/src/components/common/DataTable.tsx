/**
 * 通用数据表格，对应 Vue 版 DataTable.vue。
 * - 列定义、客户端排序（稳定排序、数字优先、空值置后）或服务端排序（onSort 回调）
 * - 排序状态可持久化到 localStorage（sortStorageKey）
 * - 受控多选（selectedKeys + onSelectedKeysChange），保留不在当前页的已选键
 * - 首列与操作列固定（sticky），表头固定
 * - 行数超过 virtualizeThreshold（默认 100）时启用 @tanstack/react-virtual 虚拟滚动
 * - 窄屏（< 768px）切换为卡片布局
 * - 单元格与表头通过 cells / headers 渲染函数自定义（Vue 版 #cell-xxx / #header-xxx 插槽）
 * 外观沿用 Arc sortable-data-table 的 token（表头高度、分隔线、悬停与选中底色）。
 */
import { observeElementRect as observeElementRectDefault, useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type Ref
} from 'react'

import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { useI18n } from '@/i18n/useI18n'
import EmptyState from './EmptyState'
import Skeleton from './Skeleton'
import type { Column } from './types'
import styles from './DataTable.module.css'

export type SortOrder = 'asc' | 'desc'
export type RowKey = string | number

export interface DataTableCellContext<T = any> {
  row: T
  value: any
  /** Vue 版操作列展开状态，保留以兼容插槽签名，始终为 false */
  expanded: boolean
  index: number
}

export interface DataTableHeaderContext {
  column: Column
  sortKey: string
  sortOrder: SortOrder
}

export interface DataTableHandle<T = any> {
  virtualizer: Virtualizer<HTMLDivElement, HTMLTableRowElement>
  shouldVirtualize: boolean
  sortedData: T[]
  resolveRowKey: (row: T, index: number) => RowKey
  tableWrapperEl: HTMLDivElement | null
}

export interface DataTableProps<T = any> {
  columns: Column<T>[]
  data: T[]
  loading?: boolean
  /** 固定首列（第一列 key 为 select 时固定前两列），默认 true */
  stickyFirstColumn?: boolean
  /** 固定 key 为 actions 的操作列，默认 true */
  stickyActionsColumn?: boolean
  /** 行键字段名或解析函数，默认 row.id，缺失时回退为下标 */
  rowKey?: string | ((row: T) => RowKey)
  /** 默认排序（仅在没有持久化排序状态时使用） */
  defaultSortKey?: string
  /** 默认 asc */
  defaultSortOrder?: SortOrder
  /** 把排序状态（key + order）持久化到 localStorage 的键 */
  sortStorageKey?: string
  /** 服务端排序：点击表头只回调 onSort，不在本地排序 */
  serverSideSort?: boolean
  onSort?: (key: string, order: SortOrder) => void
  /** 点击行或卡片时回调 onRowClick 并显示手型光标（单元格里的交互元素需自行 stopPropagation） */
  clickableRows?: boolean
  onRowClick?: (row: T) => void
  /** 虚拟滚动的预估行高（px），默认 56 */
  estimateRowHeight?: number
  /** 可视区外额外渲染的行数，默认 5 */
  overscan?: number
  /**
   * 行数超过该阈值才启用虚拟滚动（默认 100）。
   * 小列表全量渲染，避免可变行高下估算与实测差异导致的滚动抖动。
   */
  virtualizeThreshold?: number
  /** 启用受控行选择；强烈建议提供稳定的行键 */
  selectable?: boolean
  /** 已选行键；不在当前页的键会被保留 */
  selectedKeys?: RowKey[]
  /** 选择变化（合并 Vue 版 update:selectedKeys 与 selectionChange） */
  onSelectedKeysChange?: (keys: RowKey[]) => void
  /** 行勾选框的无障碍名称 */
  selectionLabel?: string | ((row: T) => string)
  /** 单元格渲染函数，键为列 key（Vue 版 #cell-xxx 插槽） */
  cells?: Record<string, (context: DataTableCellContext<T>) => ReactNode>
  /** 表头渲染函数，键为列 key（Vue 版 #header-xxx 插槽） */
  headers?: Record<string, (context: DataTableHeaderContext) => ReactNode>
  /** 自定义空状态（Vue 版 #empty 插槽） */
  empty?: ReactNode
  /** 兼容 Vue 版属性，未使用 */
  expandableActions?: boolean
  /** 兼容 Vue 版属性，未使用 */
  actionsCount?: number
  className?: string
  ref?: Ref<DataTableHandle<T>>
}

type PersistedSortState = { key: string; order: SortOrder }

const desktopViewportQuery = '(min-width: 768px)'

const subscribeDesktop = (notify: () => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(desktopViewportQuery)
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', notify)
    return () => query.removeEventListener('change', notify)
  }
  query.addListener(notify)
  return () => query.removeListener(notify)
}
const readDesktop = () =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? true
    : window.matchMedia(desktopViewportQuery).matches

// --- 虚拟滚动「整表空白」根治 ---
// 根因:表格容器高度由父级 flex 链决定。@tanstack 虚拟化器仅在 observeElementRect 回调里写 scrollRect;
// 一旦该回调读到 0 高度(加载瞬间 flex 未结算,或滚动中动态行高校正触发的 reflow),scrollRect 被钉死为 0
// → calculateRange 返回 null → 整表空白。
// 对策:1) 覆写 observeElementRect,丢弃 height<=0 的读数;2) initialRect 给一屏兜底高度。
// 兜底高度:表格区域大致 = 视口高度 - 顶栏/外边距/筛选/分页 ≈ 320px
const estimatedViewportHeight = () => {
  if (typeof window === 'undefined') return 600
  return Math.max(window.innerHeight - 320, 400)
}

const observeElementRectNonZero = (
  instance: Virtualizer<HTMLDivElement, HTMLTableRowElement>,
  cb: (rect: { width: number; height: number }) => void
) =>
  observeElementRectDefault(instance, (rect) => {
    if (rect.height > 0) cb(rect)
  })

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

const isNullishOrEmpty = (value: any) => value === null || value === undefined || value === ''

const toFiniteNumberOrNull = (value: any): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  return null
}

const toSortableString = (value: any): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const compareSortValues = (a: any, b: any): number => {
  const aEmpty = isNullishOrEmpty(a)
  const bEmpty = isNullishOrEmpty(b)
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1

  const aNum = toFiniteNumberOrNull(a)
  const bNum = toFiniteNumberOrNull(b)
  if (aNum !== null && bNum !== null) {
    if (aNum === bNum) return 0
    return aNum < bNum ? -1 : 1
  }

  const res = collator.compare(toSortableString(a), toSortableString(b))
  if (res === 0) return 0
  return res < 0 ? -1 : 1
}

const normalizeSortOrder = (candidate: unknown): SortOrder => (candidate === 'desc' ? 'desc' : 'asc')

const columnAlign = (column: Column): 'left' | 'center' | 'right' => {
  if (column.align) return column.align
  const className = column.class || ''
  if (className.includes('text-center')) return 'center'
  if (className.includes('text-right')) return 'right'
  return 'left'
}

// 根据列数自适应调整内边距：列数越多，内边距越小
const densityOf = (columnCount: number) =>
  columnCount >= 10 ? 'compact' : columnCount >= 7 ? 'snug' : columnCount >= 5 ? 'normal' : 'relaxed'

type RowIdentityToken = string | number | object | symbol

const hasSameRowIdentitySet = (current: RowIdentityToken[], previous: RowIdentityToken[]) => {
  if (current.length !== previous.length) return false
  const currentKeys = new Set(current)
  const previousKeys = new Set(previous)
  // Duplicate keys make row-to-cache ownership ambiguous, even when the unique
  // key set looks unchanged (for example [1, 1, 2] -> [1, 2, 2]).
  if (currentKeys.size !== current.length || previousKeys.size !== previous.length) return false
  return [...currentKeys].every((key) => previousKeys.has(key))
}

function SortArrows({ active }: { active: SortOrder | null }) {
  return (
    <span className={styles.sortIcon} aria-hidden="true">
      <svg className={styles.sortArrow} data-active={active === 'asc' ? '' : undefined} viewBox="0 0 10 10" fill="currentColor">
        <path d="M5 2L1.5 6.5h7L5 2z" />
      </svg>
      <svg className={styles.sortArrow} data-active={active === 'desc' ? '' : undefined} viewBox="0 0 10 10" fill="currentColor">
        <path d="M5 8L1.5 3.5h7L5 8z" />
      </svg>
    </span>
  )
}

export default function DataTable<T = any>({
  columns,
  data,
  loading = false,
  stickyFirstColumn = true,
  stickyActionsColumn = true,
  rowKey,
  defaultSortKey,
  defaultSortOrder = 'asc',
  sortStorageKey,
  serverSideSort = false,
  onSort,
  clickableRows = false,
  onRowClick,
  estimateRowHeight = 56,
  overscan = 5,
  virtualizeThreshold = 100,
  selectable = false,
  selectedKeys = [],
  onSelectedKeysChange,
  selectionLabel,
  cells = {},
  headers = {},
  empty,
  className,
  ref
}: DataTableProps<T>) {
  const { t } = useI18n()
  const isDesktopViewport = useSyncExternalStore(subscribeDesktop, readDesktop, () => true)
  const tableWrapperRef = useRef<HTMLDivElement>(null)
  const [isScrollable, setIsScrollable] = useState(false)

  const sortableKeys = useMemo(() => new Set(columns.filter((c) => c.sortable).map((c) => c.key)), [columns])
  const columnsSignature = columns.map((column) => `${column.key}:${column.sortable ? '1' : '0'}`).join('|')

  const normalizeSortKey = (candidate: string) => (candidate && sortableKeys.has(candidate) ? candidate : '')

  const resolveInitialSortState = (): PersistedSortState | null => {
    if (sortStorageKey) {
      try {
        const raw = localStorage.getItem(sortStorageKey)
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<PersistedSortState>
          const key = normalizeSortKey(typeof parsed.key === 'string' ? parsed.key : '')
          if (key) return { key, order: normalizeSortOrder(parsed.order) }
        }
      } catch (e) {
        console.error('[DataTable] Failed to read persisted sort state:', e)
      }
    }
    const key = normalizeSortKey(defaultSortKey || '')
    if (!key) return null
    return { key, order: normalizeSortOrder(defaultSortOrder) }
  }

  const [sort, setSort] = useState<{ key: string; order: SortOrder }>(() => {
    const initial = resolveInitialSortState()
    return initial ?? { key: '', order: 'asc' }
  })
  const sortKey = sort.key
  const sortOrder = sort.order

  // 列变化后，若当前排序列已不可排序则回退到持久化/默认排序
  const [lastColumnsSignature, setLastColumnsSignature] = useState(columnsSignature)
  if (lastColumnsSignature !== columnsSignature) {
    setLastColumnsSignature(columnsSignature)
    if (!sortKey || !normalizeSortKey(sortKey)) {
      const fallback = resolveInitialSortState()
      setSort(fallback ?? { key: '', order: 'asc' })
    }
  }

  const writePersistedSortState = (state: PersistedSortState) => {
    if (!sortStorageKey) return
    try {
      localStorage.setItem(sortStorageKey, JSON.stringify(state))
    } catch (e) {
      console.error('[DataTable] Failed to persist sort state:', e)
    }
  }

  const handleSort = (key: string) => {
    const newOrder: SortOrder = sortKey === key && sortOrder === 'asc' ? 'desc' : 'asc'
    setSort({ key, order: newOrder })
    const normalized = normalizeSortKey(key)
    if (normalized) writePersistedSortState({ key: normalized, order: newOrder })
    // Server-side sort mode: emit event; internal state only drives the header indicator
    if (serverSideSort) onSort?.(key, newOrder)
  }

  const resolveStableRowKey = (row: any): RowKey | undefined => {
    if (typeof rowKey === 'function') return rowKey(row) ?? undefined
    if (typeof rowKey === 'string' && rowKey) return row?.[rowKey] ?? undefined
    return row?.id ?? undefined
  }
  const resolveRowKey = (row: T, index: number): RowKey => resolveStableRowKey(row) ?? index

  const sortedData = useMemo(() => {
    // Server-side sort mode: return data as-is (server handles sorting)
    if (serverSideSort || !sortKey || !data) return data ?? []
    // Stable sort (tie-break with original index) to avoid jitter when values are equal.
    return data
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const cmp = compareSortValues((a.row as any)?.[sortKey], (b.row as any)?.[sortKey])
        if (cmp !== 0) return sortOrder === 'asc' ? cmp : -cmp
        return a.index - b.index
      })
      .map((item) => item.row)
  }, [data, serverSideSort, sortKey, sortOrder])

  const dataColumns = columns.filter((column) => column.key !== 'actions')
  const hasActionsColumn = columns.some((column) => column.key === 'actions')
  const hasSelectColumn = columns.length > 0 && columns[0].key === 'select'
  const tableColumnCount = columns.length + (selectable ? 1 : 0)

  // --- Selection ---
  const selectedKeySet = new Set(selectedKeys)
  const visibleRowKeys = sortedData.map((row, index) => resolveRowKey(row, index))
  const allVisibleSelected = visibleRowKeys.length > 0 && visibleRowKeys.every((key) => selectedKeySet.has(key))
  const someVisibleSelected = !allVisibleSelected && visibleRowKeys.some((key) => selectedKeySet.has(key))

  const emitSelection = (next: Set<RowKey>) => onSelectedKeysChange?.(Array.from(next))

  const isRowSelected = (row: T, index: number) => selectedKeySet.has(resolveRowKey(row, index))

  const getRowSelectionLabel = (row: T, index: number) => {
    if (typeof selectionLabel === 'function') return selectionLabel(row)
    if (selectionLabel) return selectionLabel
    return `${t('common.selectOption')} ${resolveRowKey(row, index)}`
  }

  const toggleRowSelection = (row: T, index: number, checked: boolean) => {
    const next = new Set(selectedKeys)
    const key = resolveRowKey(row, index)
    if (checked) next.add(key)
    else next.delete(key)
    emitSelection(next)
  }

  const toggleAllVisible = (checked: boolean) => {
    const next = new Set(selectedKeys)
    for (const key of visibleRowKeys) {
      if (checked) next.add(key)
      else next.delete(key)
    }
    emitSelection(next)
  }

  // --- Virtual scrolling ---
  // 是否启用虚拟化:仅桌面端且行数超过阈值时开启
  const shouldVirtualize = isDesktopViewport && sortedData.length > virtualizeThreshold

  // 虚拟化器实例在组件内稳定；本组件不依赖 React Compiler 的自动记忆化
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: shouldVirtualize ? sortedData.length : 0,
    getScrollElement: () => tableWrapperRef.current,
    // 用行主键而非默认的 index 作为 itemSizeCache 键，排序/筛选后复用正确的已测行高
    getItemKey: (index: number) => {
      const row = sortedData[index]
      return row != null ? resolveRowKey(row, index) : index
    },
    estimateSize: () => estimateRowHeight,
    overscan,
    // 兜底高度:首个有效高度读数到来前,先按一屏渲染,避免空白帧
    initialRect: { width: 0, height: estimatedViewportHeight() },
    // 关键:过滤 0 高度读数
    observeElementRect: observeElementRectNonZero,
    // 把测量类 ResizeObserver 回调批到 rAF,避免滚动中同步 reflow 风暴导致的校正抖动
    useAnimationFrameWithResizeObserver: true
  })

  // 新的一页/筛选结果需要释放旧行的尺寸缓存；纯重排保留缓存（仅在排序后的数据变化时比较）
  const previousIdentityKeys = useRef<RowIdentityToken[] | null>(null)
  useEffect(() => {
    const current: RowIdentityToken[] = sortedData.map((row) => {
      const stableKey = resolveStableRowKey(row)
      if (stableKey !== undefined) return stableKey
      // Object references survive pure reordering but change across page/filter results.
      // Primitive rows have no stable identity, so force conservative invalidation.
      return row !== null && typeof row === 'object' ? (row as object) : Symbol('unstable-row')
    })
    const previous = previousIdentityKeys.current
    previousIdentityKeys.current = current
    if (previous === null || hasSameRowIdentitySet(current, previous)) return
    // The virtualizer owns caches across option updates. A new page/filter result
    // must release detached rows and sizes, while pure reordering keeps them.
    rowVirtualizer.measureElement(null)
    rowVirtualizer.measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedData, rowVirtualizer])

  const virtualItems = shouldVirtualize ? rowVirtualizer.getVirtualItems() : []
  const virtualPaddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
  const virtualPaddingBottom =
    virtualItems.length > 0 ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end : 0

  // 统一的渲染行列表:虚拟化开启时只取窗口内的行,关闭时取全部行
  const renderRows = shouldVirtualize
    ? virtualItems.map((item) => ({ index: item.index, row: sortedData[item.index], measure: true }))
    : sortedData.map((row, index) => ({ index, row, measure: false }))

  useImperativeHandle(
    ref,
    () => ({
      virtualizer: rowVirtualizer,
      shouldVirtualize,
      sortedData,
      resolveRowKey,
      tableWrapperEl: tableWrapperRef.current
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowVirtualizer, shouldVirtualize, sortedData, rowKey]
  )

  // 横向可滚动时才显示固定列阴影
  useEffect(() => {
    const wrapper = tableWrapperRef.current
    if (!isDesktopViewport || !wrapper) return
    const check = () => setIsScrollable(wrapper.scrollWidth > wrapper.clientWidth)
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(check)
      observer.observe(wrapper)
      return () => observer.disconnect()
    }
    // 降级方案：不支持 ResizeObserver 时使用 window resize
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [isDesktopViewport, data.length, columnsSignature])

  // 生成固定列标记
  const stickyOf = (column: Column, index: number): string | undefined => {
    if (stickyActionsColumn && column.key === 'actions') return 'right'
    if (!stickyFirstColumn) return undefined
    // 如果第一列是勾选列，固定前两列（勾选+名称）
    if (hasSelectColumn) return index === 0 ? 'first' : index === 1 ? 'second' : undefined
    if (index === 0) return selectable ? 'second' : 'left'
    return undefined
  }

  const widthStyle = (column: Column): CSSProperties | undefined =>
    column.width !== undefined
      ? { width: typeof column.width === 'number' ? `${column.width}px` : column.width }
      : undefined

  const renderCellContent = (column: Column<T>, row: T, index: number) => {
    const value = (row as any)?.[column.key]
    const renderer = cells[column.key]
    if (renderer) return renderer({ row, value, expanded: false, index })
    return column.formatter ? column.formatter(value, row) : (value as ReactNode)
  }

  const defaultEmpty = <EmptyState title={t('empty.noData')} />

  // ===== Mobile card layout =====
  if (!isDesktopViewport) {
    return (
      <div className={[styles.cards, className].filter(Boolean).join(' ')}>
        {loading ? (
          Array.from({ length: 5 }, (_, i) => (
            <div key={i} className={styles.card}>
              {dataColumns.map((column) => (
                <div key={column.key} className={styles.cardField}>
                  <Skeleton width={80} height={16} />
                  <Skeleton width={128} height={16} />
                </div>
              ))}
              {hasActionsColumn && (
                <div className={styles.cardActions}>
                  <Skeleton height={32} />
                </div>
              )}
            </div>
          ))
        ) : !data || data.length === 0 ? (
          <div className={styles.card}>{empty ?? defaultEmpty}</div>
        ) : (
          <>
            {selectable && (
              <div className={styles.cardSelectAll}>
                <Checkbox
                  checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                  onCheckedChange={(checked) => toggleAllVisible(checked === true)}
                  label={t('common.selectAll')}
                  data-test="select-all-mobile"
                />
              </div>
            )}
            {sortedData.map((row, index) => {
              const selected = selectable && isRowSelected(row, index)
              return (
                <div
                  key={resolveRowKey(row, index)}
                  className={styles.card}
                  data-clickable={clickableRows ? '' : undefined}
                  data-selected={selected ? '' : undefined}
                  onClick={() => {
                    if (clickableRows) onRowClick?.(row)
                  }}
                >
                  {selectable && (
                    <div className={styles.cardCheck}>
                      <Checkbox
                        checked={isRowSelected(row, index)}
                        aria-label={getRowSelectionLabel(row, index)}
                        data-test="select-row"
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={(checked) => toggleRowSelection(row, index, checked === true)}
                      />
                    </div>
                  )}
                  {dataColumns.map((column) => (
                    <div key={column.key} data-field={column.key} className={styles.cardField}>
                      <span className={styles.cardLabel}>{column.label}</span>
                      <div className={styles.cardValue}>{renderCellContent(column, row, index)}</div>
                    </div>
                  ))}
                  {hasActionsColumn && (
                    <div className={styles.cardActions}>
                      {cells.actions?.({ row, value: (row as any)?.actions, expanded: false, index })}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>
    )
  }

  // ===== Desktop table =====
  return (
    <div
      ref={tableWrapperRef}
      className={[styles.wrapper, className].filter(Boolean).join(' ')}
      data-scrollable={isScrollable ? '' : undefined}
      data-density={densityOf(columns.length)}
      data-table-wrapper=""
    >
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr>
            {selectable && (
              <th scope="col" className={styles.selectCell} data-sticky={stickyFirstColumn ? 'first' : undefined}>
                <Checkbox
                  checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                  aria-label={t('common.selectAll')}
                  data-test="select-all"
                  onCheckedChange={(checked) => toggleAllVisible(checked === true)}
                />
              </th>
            )}
            {columns.map((column, index) => {
              const active = sortKey === column.key ? sortOrder : null
              const header = headers[column.key]
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={column.sortable ? (active ? (active === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                  className={column.class}
                  style={widthStyle(column)}
                  data-align={columnAlign(column)}
                  data-sortable={column.sortable ? '' : undefined}
                  data-sorted={active ? '' : undefined}
                  data-sticky={stickyOf(column, index)}
                  onClick={() => {
                    if (column.sortable) handleSort(column.key)
                  }}
                >
                  <div className={styles.headerContent}>
                    {header ? header({ column, sortKey, sortOrder }) : <span>{column.label}</span>}
                    {column.sortable && <SortArrows active={active} />}
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            // Loading skeleton
            Array.from({ length: 5 }, (_, i) => (
              <tr key={i} data-skeleton="">
                {selectable && (
                  <td className={styles.selectCell}>
                    <Skeleton width={16} height={16} />
                  </td>
                )}
                {columns.map((column) => (
                  <td key={column.key}>
                    <Skeleton width="75%" height={16} />
                  </td>
                ))}
              </tr>
            ))
          ) : !data || data.length === 0 ? (
            // Empty state
            <tr>
              <td colSpan={tableColumnCount} className={styles.emptyCell}>
                {empty ?? defaultEmpty}
              </td>
            </tr>
          ) : (
            // Data rows: windowed when large, fully rendered when small (shared row/cell template)
            <>
              {virtualPaddingTop > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={tableColumnCount} className={styles.spacer} style={{ height: virtualPaddingTop }} />
                </tr>
              )}
              {renderRows.map(({ row, index, measure }) => {
                const key = resolveRowKey(row, index)
                const selected = selectable && isRowSelected(row, index)
                return (
                  <tr
                    key={key}
                    ref={measure ? rowVirtualizer.measureElement : undefined}
                    data-row-id={key}
                    data-index={index}
                    data-clickable={clickableRows ? '' : undefined}
                    data-selected={selected ? '' : undefined}
                    onClick={() => {
                      if (clickableRows) onRowClick?.(row)
                    }}
                  >
                    {selectable && (
                      <td className={styles.selectCell} data-sticky={stickyFirstColumn ? 'first' : undefined}>
                        <Checkbox
                          checked={selected}
                          aria-label={getRowSelectionLabel(row, index)}
                          data-test="select-row"
                          onClick={(event) => event.stopPropagation()}
                          onCheckedChange={(checked) => toggleRowSelection(row, index, checked === true)}
                        />
                      </td>
                    )}
                    {columns.map((column, colIndex) => (
                      <td
                        key={column.key}
                        className={column.class}
                        style={widthStyle(column)}
                        data-align={columnAlign(column)}
                        data-sorted={sortKey === column.key ? '' : undefined}
                        data-sticky={stickyOf(column, colIndex)}
                      >
                        {renderCellContent(column, row, index)}
                      </td>
                    ))}
                  </tr>
                )
              })}
              {virtualPaddingBottom > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={tableColumnCount} className={styles.spacer} style={{ height: virtualPaddingBottom }} />
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>
    </div>
  )
}
