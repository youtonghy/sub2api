import { Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { opsAPI, type OpsErrorLog } from '@/api/admin/ops'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import Input from '@/components/common/Input'
import Select, { type SelectValue } from '@/components/common/Select'
import { useI18n } from '@/i18n/useI18n'
import { buildOpsErrorTimeParams } from '../utils/opsErrorParams'
import OpsErrorLogTable from './OpsErrorLogTable'
import styles from './OpsErrorDetailsModal.module.css'

export interface OpsErrorDetailsModalProps {
  show: boolean
  timeRange: string
  customStartTime?: string | null
  customEndTime?: string | null
  platform?: string
  groupId?: number | null
  errorType: 'request' | 'upstream'
  resumeState?: boolean
  onShowChange?: (value: boolean) => void
  onOpenErrorDetail?: (errorId: number) => void
}

type ViewMode = 'errors' | 'excluded' | 'all'

interface QueryState {
  page: number
  pageSize: number
  q: string
  statusCode: number | 'other' | null
  phase: string
  errorOwner: string
  viewMode: ViewMode
  sortBy: string
  sortOrder: 'asc' | 'desc'
}

const initialQuery: QueryState = {
  page: 1,
  pageSize: 10,
  q: '',
  statusCode: null,
  phase: '',
  errorOwner: '',
  viewMode: 'errors',
  sortBy: 'created_at',
  sortOrder: 'desc'
}

export default function OpsErrorDetailsModal(props: OpsErrorDetailsModalProps) {
  const { show, timeRange, customStartTime, customEndTime, platform, groupId, errorType, onShowChange, onOpenErrorDetail } = props
  const { t } = useI18n()

  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<OpsErrorLog[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQueryState] = useState<QueryState>(initialQuery)

  // 请求参数读取最新值（Vue 版直接读 ref）；props 与查询状态都镜像到 ref 中
  const queryRef = useRef(query)
  const propsRef = useRef(props)
  const requestSeq = useRef(0)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    propsRef.current = props
  })

  const updateQuery = useCallback((patch: Partial<QueryState>) => {
    queryRef.current = { ...queryRef.current, ...patch }
    setQueryState(queryRef.current)
  }, [])

  const fetchErrorLogs = useCallback(async () => {
    const p = propsRef.current
    if (!p.show) return

    const q = queryRef.current
    const seq = ++requestSeq.current
    setLoading(true)
    try {
      const params: Record<string, any> = {
        page: q.page,
        page_size: q.pageSize,
        view: q.viewMode,
        sort_by: q.sortBy,
        sort_order: q.sortOrder
      }
      Object.assign(params, buildOpsErrorTimeParams(p.timeRange, p.customStartTime, p.customEndTime))

      if (p.timeRange === 'custom') {
        if (p.customStartTime && p.customEndTime) {
          params.start_time = p.customStartTime
          params.end_time = p.customEndTime
          delete params.time_range
        } else {
          // Safety fallback: avoid sending time_range=custom (backend doesn't support it)
          params.time_range = '1h'
        }
      }

      const platformVal = String(p.platform || '').trim()
      if (platformVal) params.platform = platformVal
      if (typeof p.groupId === 'number' && p.groupId > 0) params.group_id = p.groupId

      if (q.q.trim()) params.q = q.q.trim()
      if (q.statusCode === 'other') params.status_codes_other = '1'
      else if (typeof q.statusCode === 'number') params.status_codes = String(q.statusCode)

      const phaseVal = String(q.phase || '').trim()
      if (phaseVal) params.phase = phaseVal

      const ownerVal = String(q.errorOwner || '').trim()
      if (ownerVal) params.error_owner = ownerVal

      const res = p.errorType === 'upstream'
        ? await opsAPI.listUpstreamErrors(params)
        : await opsAPI.listRequestErrors(params)
      if (seq !== requestSeq.current) return
      setRows(res.items || [])
      setTotal(res.total || 0)
    } catch (err) {
      if (seq !== requestSeq.current) return
      console.error('[OpsErrorDetailsModal] Failed to fetch error logs', err)
      setRows([])
      setTotal(0)
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [])

  const resetFilters = useCallback(() => {
    updateQuery({
      q: '',
      statusCode: null,
      phase: propsRef.current.errorType === 'upstream' ? 'upstream' : '',
      errorOwner: '',
      viewMode: 'errors',
      page: 1
    })
    void fetchErrorLogs()
  }, [fetchErrorLogs, updateQuery])

  // 打开时重置筛选与分页；从单条详情返回（resumeState）时保留上一次的状态
  const prevShow = useRef(show)
  useEffect(() => {
    const wasOpen = prevShow.current
    prevShow.current = show
    if (!show || wasOpen) return
    if (propsRef.current.resumeState) return
    updateQuery({ page: 1, pageSize: 10 })
    resetFilters()
  }, [show, resetFilters, updateQuery])

  // 时间范围、平台、分组变化时回到第一页重新查询
  const scopeKey = JSON.stringify([timeRange, customStartTime ?? null, customEndTime ?? null, platform ?? null, groupId ?? null])
  const prevScopeKey = useRef(scopeKey)
  useEffect(() => {
    if (prevScopeKey.current === scopeKey) return
    prevScopeKey.current = scopeKey
    if (!propsRef.current.show) return
    updateQuery({ page: 1 })
    void fetchErrorLogs()
  }, [scopeKey, fetchErrorLogs, updateQuery])

  useEffect(() => () => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
  }, [])

  const close = () => onShowChange?.(false)

  const onSearchChange = (value: string) => {
    updateQuery({ q: value })
    if (!propsRef.current.show) return
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      updateQuery({ page: 1 })
      void fetchErrorLogs()
    }, 350)
  }

  const onFilterChange = (patch: Partial<QueryState>) => {
    updateQuery({ ...patch, page: 1 })
    void fetchErrorLogs()
  }

  const onSort = (nextSortBy: string, nextSortOrder: 'asc' | 'desc') => {
    updateQuery({ sortBy: nextSortBy, sortOrder: nextSortOrder, page: 1 })
    void fetchErrorLogs()
  }

  const modalTitle = errorType === 'upstream' ? t('admin.ops.errorDetails.upstreamErrors') : t('admin.ops.errorDetails.requestErrors')

  const codes = [400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504, 529]
  const statusCodeSelectOptions = [
    { value: null, label: t('common.all') },
    ...codes.map((c) => ({ value: c, label: String(c) })),
    { value: 'other', label: t('admin.ops.errorDetails.statusCodeOther') || 'Other' }
  ]
  const ownerSelectOptions = [
    { value: '', label: t('common.all') },
    { value: 'provider', label: t('admin.ops.errorDetails.owner.provider') || 'provider' },
    { value: 'client', label: t('admin.ops.errorDetails.owner.client') || 'client' },
    { value: 'platform', label: t('admin.ops.errorDetails.owner.platform') || 'platform' }
  ]
  const viewModeSelectOptions = [
    { value: 'errors', label: t('admin.ops.errorDetails.viewErrors') || 'errors' },
    { value: 'excluded', label: t('admin.ops.errorDetails.viewExcluded') || 'excluded' },
    { value: 'all', label: t('common.all') }
  ]
  const phaseSelectOptions = [
    { value: '', label: t('common.all') },
    { value: 'request', label: t('admin.ops.errorDetails.phase.request') || 'request' },
    { value: 'auth', label: t('admin.ops.errorDetails.phase.auth') || 'auth' },
    { value: 'account_auth', label: t('admin.ops.errorDetails.phase.account_auth') || 'account_auth' },
    { value: 'routing', label: t('admin.ops.errorDetails.phase.routing') || 'routing' },
    { value: 'upstream', label: t('admin.ops.errorDetails.phase.upstream') || 'upstream' },
    { value: 'network', label: t('admin.ops.errorDetails.phase.network') || 'network' },
    { value: 'internal', label: t('admin.ops.errorDetails.phase.internal') || 'internal' }
  ]

  return (
    <BaseDialog show={show} title={modalTitle} width="full" onClose={close}>
      <div className={styles.root}>
        {/* Filters */}
        <div className={styles.toolbar}>
          <div className={styles.search}>
            <Input
              value={query.q}
              onChange={onSearchChange}
              placeholder={t('admin.ops.errorDetails.searchPlaceholder')}
              aria-label={t('admin.ops.errorDetails.searchPlaceholder')}
              prefix={<Search size={14} aria-hidden="true" />}
            />
          </div>
          <div className={styles.filter}>
            <Select
              value={query.statusCode}
              options={statusCodeSelectOptions}
              onChange={(value: SelectValue) => onFilterChange({ statusCode: value as QueryState['statusCode'] })}
            />
          </div>
          <div className={styles.filter}>
            <Select
              value={query.phase}
              options={phaseSelectOptions}
              onChange={(value: SelectValue) => onFilterChange({ phase: String(value ?? '') })}
            />
          </div>
          <div className={styles.filter}>
            <Select
              value={query.errorOwner}
              options={ownerSelectOptions}
              onChange={(value: SelectValue) => onFilterChange({ errorOwner: String(value ?? '') })}
            />
          </div>
          <div className={styles.filter}>
            <Select
              value={query.viewMode}
              options={viewModeSelectOptions}
              onChange={(value: SelectValue) => onFilterChange({ viewMode: value as ViewMode })}
            />
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={resetFilters}>
            {t('common.reset')}
          </Button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          <div className={styles.total}>
            {t('admin.ops.errorDetails.total')} {total}
          </div>

          <OpsErrorLogTable
            className={styles.table}
            summaryFirst
            rows={rows}
            total={total}
            loading={loading}
            page={query.page}
            pageSize={query.pageSize}
            onOpenErrorDetail={(id) => onOpenErrorDetail?.(id)}
            onSort={onSort}
            onPageChange={(value) => {
              updateQuery({ page: value })
              void fetchErrorLogs()
            }}
            onPageSizeChange={(value) => {
              updateQuery({ pageSize: value })
              void fetchErrorLogs()
            }}
          />
        </div>
      </div>
    </BaseDialog>
  )
}
