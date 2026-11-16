/**
 * 隐私过滤命中记录列表。管理端看全站（多出用户、分组、端点、请求 ID 与搜索），
 * 用户端只看自己的记录（可按 API 密钥筛选）。只展示类别和次数，后端从不保存命中的原文。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react'

import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import DataTable from '@/components/common/DataTable'
import DateRangePicker, { type DateRangeValue } from '@/components/common/DateRangePicker'
import EmptyState from '@/components/common/EmptyState'
import Input from '@/components/common/Input'
import Pagination from '@/components/common/Pagination'
import Select, { type SelectOption } from '@/components/common/Select'
import type { Column } from '@/components/common/types'
import { useTableLoader } from '@/composables/useTableLoader'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { BasePaginationResponse, FetchOptions } from '@/types'
import { extractApiErrorMessage } from '@/utils/apiError'
import { formatDateTime } from '@/utils/format'
import styles from '../privacyFilter.module.css'
import {
  PRIVACY_FILTER_CATEGORIES,
  PRIVACY_FILTER_EVENT_ACTIONS,
  type PrivacyFilterCategory,
  type PrivacyFilterEvent,
  type PrivacyFilterEventAction,
  type PrivacyFilterEventQuery
} from '../types'

const ACTION_TONES: Record<PrivacyFilterEventAction, BadgeTone> = {
  observe: 'info',
  redact: 'success',
  restore: 'success',
  failed: 'danger'
}

const RECORD_RANGE_DAYS = 7

const formatLocalDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

function defaultQuery(): PrivacyFilterEventQuery {
  const end = new Date()
  const start = new Date(end.getTime() - (RECORD_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000)
  return {
    start_date: formatLocalDate(start),
    end_date: formatLocalDate(end),
    action: '',
    category: '',
    api_key_id: null,
    request_id: '',
    q: ''
  }
}

export interface PrivacyFilterEventsProps {
  variant: 'admin' | 'user'
  fetchEvents: (
    page: number,
    pageSize: number,
    query: PrivacyFilterEventQuery,
    options?: FetchOptions
  ) => Promise<BasePaginationResponse<PrivacyFilterEvent>>
  /** 用户端的 API 密钥筛选选项 */
  apiKeyOptions?: SelectOption[]
}

export default function PrivacyFilterEvents({ variant, fetchEvents, apiKeyOptions }: PrivacyFilterEventsProps) {
  const { t } = useI18n()
  const isAdmin = variant === 'admin'
  const loader = useTableLoader<PrivacyFilterEvent, PrivacyFilterEventQuery>({
    fetchFn: fetchEvents,
    initialParams: defaultQuery()
  })
  const { items, loading, params, setParams, pagination, reload, debouncedReload, handlePageChange, handlePageSizeChange } =
    loader
  const [searchDraft, setSearchDraft] = useState({ q: '', request_id: '' })

  const run = (task: Promise<unknown>) => {
    task.catch((err) => {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('privacyFilter.records.loadFailed')))
    })
  }

  useEffect(() => {
    run(reload())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时加载一次，之后由筛选操作触发
  }, [])

  const applyFilter = (patch: Partial<PrivacyFilterEventQuery>) => {
    setParams(patch)
    run(reload())
  }

  const resetFilters = () => {
    setSearchDraft({ q: '', request_id: '' })
    setParams(defaultQuery())
    run(reload())
  }

  const actionOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: t('privacyFilter.records.filters.all') },
      ...PRIVACY_FILTER_EVENT_ACTIONS.map((action) => ({ value: action, label: t(`privacyFilter.records.actions.${action}`) }))
    ],
    [t]
  )
  const categoryOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: t('privacyFilter.records.filters.all') },
      ...PRIVACY_FILTER_CATEGORIES.map((category) => ({
        value: category,
        label: t(`privacyFilter.categories.${category}.label`)
      }))
    ],
    [t]
  )
  const keyOptions = useMemo<SelectOption[]>(
    () => [{ value: null, label: t('privacyFilter.records.filters.all') }, ...(apiKeyOptions ?? [])],
    [apiKeyOptions, t]
  )

  const columns = useMemo<Column<PrivacyFilterEvent>[]>(() => {
    const col = (key: string, label: string, width?: string): Column<PrivacyFilterEvent> => ({ key, label, width })
    return isAdmin
      ? [
          col('created_at', t('privacyFilter.records.columns.time'), '11rem'),
          col('user', t('privacyFilter.records.columns.user')),
          col('group_name', t('privacyFilter.records.columns.group')),
          col('model', t('privacyFilter.records.columns.model')),
          col('action', t('privacyFilter.records.columns.action'), '9rem'),
          col('categories', t('privacyFilter.records.columns.categories')),
          col('request', t('privacyFilter.records.columns.requestId'))
        ]
      : [
          col('created_at', t('privacyFilter.records.columns.time'), '11rem'),
          col('api_key_name', t('privacyFilter.records.columns.apiKey')),
          col('model', t('privacyFilter.records.columns.model')),
          col('action', t('privacyFilter.records.columns.action'), '9rem'),
          col('categories', t('privacyFilter.records.columns.categories'))
        ]
  }, [isAdmin, t])

  const keyName = (row: PrivacyFilterEvent) => row.api_key_name || t('privacyFilter.records.deletedKey')
  const dash = <span className={styles.muted}>-</span>

  const cells = {
    created_at: ({ value }: { value: string }) => formatDateTime(value),
    user: ({ row }: { row: PrivacyFilterEvent }) => (
      <div className={styles.cellStack}>
        <span className={styles.cellMain}>{row.user_email || (row.user_id ? `#${row.user_id}` : '-')}</span>
        <span className={styles.cellSub}>{keyName(row)}</span>
      </div>
    ),
    api_key_name: ({ row }: { row: PrivacyFilterEvent }) => keyName(row),
    group_name: ({ value }: { value: string }) => value || dash,
    model: ({ value }: { value: string }) => (value ? <span className={styles.cellMain}>{value}</span> : dash),
    action: ({ row }: { row: PrivacyFilterEvent }) => (
      <Badge tone={ACTION_TONES[row.action] ?? 'neutral'} size="sm">
        {t(`privacyFilter.records.actions.${row.action}`)}
      </Badge>
    ),
    categories: ({ row }: { row: PrivacyFilterEvent }) => {
      const entries = Object.entries(row.categories ?? {}) as Array<[PrivacyFilterCategory, number]>
      if (entries.length === 0) return dash
      return (
        <div className={styles.chips}>
          {entries.map(([category, count]) => (
            <span key={category} className={styles.chip} title={t('privacyFilter.records.hitCount', { count })}>
              {t(`privacyFilter.categories.${category}.label`)} × {count}
            </span>
          ))}
        </div>
      )
    },
    request: ({ row }: { row: PrivacyFilterEvent }) => (
      <div className={styles.cellStack}>
        <span className={`${styles.cellMain} ${styles.mono}`} title={row.request_id}>
          {row.request_id || '-'}
        </span>
        <span className={styles.cellSub}>{row.endpoint || '-'}</span>
      </div>
    )
  }

  const field = (label: string, control: ReactNode, wide = false) => (
    <div className={wide ? `${styles.field} ${styles.fieldWide}` : styles.field}>
      <span className={styles.label} aria-hidden="true">
        {label}
      </span>
      {control}
    </div>
  )

  return (
    <section className={styles.region} data-test="privacy-filter-events">
      <div className={styles.regionHeader}>
        <p className={styles.hint}>
          {isAdmin ? t('privacyFilter.records.adminHint') : t('privacyFilter.records.userHint')}
        </p>
      </div>
      <div className={styles.subRegionBody}>
        <div className={styles.filters}>
          {field(
            t('privacyFilter.records.filters.dateRange'),
            <DateRangePicker
              startDate={params.start_date ?? ''}
              endDate={params.end_date ?? ''}
              onChange={(range: DateRangeValue) => applyFilter({ start_date: range.startDate, end_date: range.endDate })}
            />,
            true
          )}
          {field(
            t('privacyFilter.records.filters.action'),
            <Select
              value={params.action ?? ''}
              options={actionOptions}
              aria-label={t('privacyFilter.records.filters.action')}
              onChange={(value) => applyFilter({ action: (value ?? '') as PrivacyFilterEventAction | '' })}
            />
          )}
          {field(
            t('privacyFilter.records.filters.category'),
            <Select
              value={params.category ?? ''}
              options={categoryOptions}
              aria-label={t('privacyFilter.records.filters.category')}
              onChange={(value) => applyFilter({ category: (value ?? '') as PrivacyFilterCategory | '' })}
            />
          )}
          {!isAdmin
            ? field(
                t('privacyFilter.records.filters.apiKey'),
                <Select
                  value={params.api_key_id ?? null}
                  options={keyOptions}
                  searchable="auto"
                  aria-label={t('privacyFilter.records.filters.apiKey')}
                  onChange={(value) => applyFilter({ api_key_id: (value as number | null) ?? null })}
                />
              )
            : null}
          {isAdmin
            ? field(
                t('privacyFilter.records.filters.search'),
                <Input
                  value={searchDraft.q}
                  placeholder={t('privacyFilter.records.filters.searchPlaceholder')}
                  aria-label={t('privacyFilter.records.filters.search')}
                  onChange={(value) => {
                    setSearchDraft((prev) => ({ ...prev, q: value }))
                    setParams({ q: value })
                    debouncedReload()
                  }}
                />,
                true
              )
            : null}
          {isAdmin
            ? field(
                t('privacyFilter.records.filters.requestId'),
                <Input
                  value={searchDraft.request_id}
                  aria-label={t('privacyFilter.records.filters.requestId')}
                  onChange={(value) => {
                    setSearchDraft((prev) => ({ ...prev, request_id: value }))
                    setParams({ request_id: value })
                    debouncedReload()
                  }}
                />,
                true
              )
            : null}
          <div className={styles.filterActions}>
            <Button type="button" variant="secondary" onClick={resetFilters}>
              <RotateCcw size={16} aria-hidden="true" />
              {t('privacyFilter.records.filters.reset')}
            </Button>
            <Button type="button" variant="secondary" disabled={loading} onClick={() => run(loader.load())}>
              <RefreshCw size={16} aria-hidden="true" />
              {t('privacyFilter.records.filters.refresh')}
            </Button>
          </div>
        </div>

        <DataTable<PrivacyFilterEvent>
          columns={columns}
          data={items}
          loading={loading}
          rowKey="id"
          cells={cells}
          empty={<EmptyState icon={ShieldCheck} title={t('privacyFilter.records.empty')} />}
        />
        {pagination.total > 0 ? (
          <Pagination
            page={pagination.page}
            total={pagination.total}
            pageSize={pagination.page_size}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        ) : null}
      </div>
    </section>
  )
}
