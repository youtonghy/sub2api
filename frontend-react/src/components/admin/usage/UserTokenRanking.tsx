import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react'

import { getUserBreakdown, type UserBreakdownParams } from '@/api/admin/dashboard'
import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import DataTable from '@/components/common/DataTable'
import Select from '@/components/common/Select'
import type { Column } from '@/components/common/types'
import { useI18n } from '@/i18n/useI18n'
import type { UserBreakdownItem } from '@/types'
import { formatCompactNumber, formatCostFixed } from '@/utils/format'
import styles from './UserTokenRanking.module.css'

export interface UserTokenRankingHandle {
  reload: () => Promise<void>
}

export interface UserTokenRankingProps {
  startDate: string
  endDate: string
  filters: Record<string, unknown>
  model?: string
  onSelectUser?: (userId: number, email: string) => void
  ref?: Ref<UserTokenRankingHandle>
}

type SortKey = NonNullable<UserBreakdownParams['sort_by']>
const sortableColumns: { key: SortKey; label: string }[] = [
  { key: 'requests', label: 'admin.usage.tokenRanking.columns.requests' },
  { key: 'input_tokens', label: 'admin.usage.tokenRanking.columns.inputTokens' },
  { key: 'output_tokens', label: 'admin.usage.tokenRanking.columns.outputTokens' },
  { key: 'cache_tokens', label: 'admin.usage.tokenRanking.columns.cacheTokens' },
  { key: 'total_tokens', label: 'admin.usage.tokenRanking.columns.totalTokens' },
  { key: 'actual_cost', label: 'admin.usage.tokenRanking.columns.cost' }
]

const limitOptions = [
  { value: 20, label: 'Top 20' },
  { value: 50, label: 'Top 50' },
  { value: 100, label: 'Top 100' },
  { value: 200, label: 'Top 200' }
]

// 前三名金/银/铜徽章
const RANK_BADGE_TONES: BadgeTone[] = ['warning', 'neutral', 'warning']

const fmtTokens = (v: number) => formatCompactNumber(v)
const fmtCost = (v: number) => formatCostFixed(v, 4)

/** 用量页"用户排行"tab 内容：无卡片外观，依赖父级统一卡片；筛选/时间范围复用页面级筛选栏 */
export default function UserTokenRanking({ startDate, endDate, filters, model, onSelectUser, ref }: UserTokenRankingProps) {
  const { t } = useI18n()
  const [items, setItems] = useState<UserBreakdownItem[]>([])
  const [loading, setLoading] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>('total_tokens')
  const [limit, setLimit] = useState(50)
  const reqSeq = useRef(0)
  const stateRef = useRef({ startDate, endDate, filters, model, sortBy, limit })
  useLayoutEffect(() => {
    stateRef.current = { ...stateRef.current, startDate, endDate, filters, model }
  })

  const load = async () => {
    const seq = ++reqSeq.current
    setLoading(true)
    try {
      const current = stateRef.current
      const params: UserBreakdownParams = {
        ...current.filters,
        start_date: current.startDate,
        end_date: current.endDate,
        sort_by: current.sortBy,
        limit: current.limit
      }
      if (current.model) params.model = current.model
      const res = await getUserBreakdown(params)
      if (seq !== reqSeq.current) return
      setItems(res.users || [])
    } catch {
      if (seq !== reqSeq.current) return
      setItems([])
    } finally {
      if (seq === reqSeq.current) setLoading(false)
    }
  }
  const loadRef = useRef(load)
  useLayoutEffect(() => {
    loadRef.current = load
  })

  const setSort = (key: SortKey) => {
    if (stateRef.current.sortBy === key) return
    stateRef.current.sortBy = key
    setSortBy(key)
    void load()
  }

  // Reload when the shared filters / date range / model change.
  const filtersKey = JSON.stringify(filters)
  useEffect(() => {
    void loadRef.current()
  }, [startDate, endDate, model, filtersKey])

  useImperativeHandle(ref, () => ({ reload: () => loadRef.current() }))

  const columns: Column<UserBreakdownItem>[] = [
    { key: 'rank', label: '#', width: 64 },
    { key: 'user', label: t('admin.usage.tokenRanking.columns.user') },
    ...sortableColumns.map((col) => ({ key: col.key, label: t(col.label), align: 'right' as const }))
  ]

  const headers = Object.fromEntries(
    sortableColumns.map((col) => [
      col.key,
      () => (
        <button
          type="button"
          className={`${styles.sortButton} ${sortBy === col.key ? styles.sortActive : ''}`}
          aria-pressed={sortBy === col.key}
          onClick={() => setSort(col.key)}
        >
          {t(col.label)}
          {sortBy === col.key ? <span aria-hidden="true">↓</span> : null}
        </button>
      )
    ])
  )

  const cells = {
    rank: ({ index }: { index: number }) =>
      index < 3 ? (
        <Badge tone={RANK_BADGE_TONES[index]} size="sm">
          {index + 1}
        </Badge>
      ) : (
        <span className={styles.rank}>{index + 1}</span>
      ),
    user: ({ row }: { row: UserBreakdownItem }) => (
      <span className={styles.user} title={`${row.email}\n${t('admin.usage.tokenRanking.rowHint')}`}>
        {row.email || `User #${row.user_id}`}
        <span className={styles.userId}>#{row.user_id}</span>
      </span>
    ),
    requests: ({ row }: { row: UserBreakdownItem }) => <span className={styles.num}>{row.requests.toLocaleString()}</span>,
    input_tokens: ({ row }: { row: UserBreakdownItem }) => <span className={styles.num}>{fmtTokens(row.input_tokens)}</span>,
    output_tokens: ({ row }: { row: UserBreakdownItem }) => <span className={styles.num}>{fmtTokens(row.output_tokens)}</span>,
    cache_tokens: ({ row }: { row: UserBreakdownItem }) => <span className={styles.num}>{fmtTokens(row.cache_tokens)}</span>,
    total_tokens: ({ row }: { row: UserBreakdownItem }) => <span className={styles.numStrong}>{fmtTokens(row.total_tokens)}</span>,
    actual_cost: ({ row }: { row: UserBreakdownItem }) => <span className={styles.cost}>${fmtCost(row.actual_cost)}</span>
  }

  return (
    <div>
      <div className={styles.toolbar}>
        <p className={styles.subtitle}>{t('admin.usage.tokenRanking.subtitle')}</p>
        <div className={styles.controls}>
          {!loading && items.length > 0 ? (
            <span className={styles.count}>{t('admin.usage.tokenRanking.userCount', { count: items.length })}</span>
          ) : null}
          <Select
            className={styles.limit}
            value={limit}
            options={limitOptions}
            aria-label={t('admin.usage.tokenRanking.subtitle')}
            onChange={(value) => {
              const next = Number(value)
              stateRef.current.limit = next
              setLimit(next)
              void load()
            }}
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={items}
        loading={loading}
        rowKey="user_id"
        stickyFirstColumn={false}
        clickableRows
        onRowClick={(item) => onSelectUser?.(item.user_id, item.email)}
        headers={headers}
        cells={cells}
        empty={<p className={styles.empty}>{t('admin.dashboard.noDataAvailable')}</p>}
      />
    </div>
  )
}
