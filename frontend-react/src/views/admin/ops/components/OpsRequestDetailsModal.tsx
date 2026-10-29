import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { opsAPI, type OpsRequestDetail, type OpsRequestDetailsParams } from '@/api/admin/ops'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import DataTable, { type DataTableCellContext } from '@/components/common/DataTable'
import Pagination from '@/components/common/Pagination'
import type { Column } from '@/components/common/types'
import { useClipboard } from '@/composables/useClipboard'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores'
import { useMediaQuery } from '../hooks/useMediaQuery'
import type { OpsRequestDetailsPreset } from '../types'
import { getAccountNameMap } from '../utils/accountNameMap'
import { formatDateTime, parseTimeRangeMinutes } from '../utils/opsFormatters'
import styles from './OpsRequestDetailsModal.module.css'

export type { OpsRequestDetailsPreset } from '../types'

export interface OpsRequestDetailsModalProps {
  /** 是否显示（Vue 版 modelValue） */
  show: boolean
  timeRange: string
  preset: OpsRequestDetailsPreset
  platform?: string
  groupId?: number | null
  resumeState?: boolean
  onShowChange?: (value: boolean) => void
  onOpenErrorDetail?: (errorId: number) => void
}

export default function OpsRequestDetailsModal(props: OpsRequestDetailsModalProps) {
  const { show, timeRange, preset, platform, groupId, onShowChange, onOpenErrorDetail } = props
  const { t } = useI18n()
  const { copyToClipboard } = useClipboard()

  // 与 DataTable 一致：< 768px 切换为卡片视图，避免宽表在移动端被截断。
  const isDesktopViewport = useMediaQuery('(min-width: 768px)')

  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<OpsRequestDetail[]>([])
  const [total, setTotal] = useState(0)
  const [pager, setPagerState] = useState({ page: 1, pageSize: 10 })
  const [accountNameById, setAccountNameById] = useState<Map<number, string>>(() => new Map())

  const pagerRef = useRef(pager)
  const propsRef = useRef(props)
  const requestSeq = useRef(0)
  useEffect(() => {
    propsRef.current = props
  })

  const updatePager = useCallback((patch: Partial<typeof pager>) => {
    pagerRef.current = { ...pagerRef.current, ...patch }
    setPagerState(pagerRef.current)
  }, [])

  const close = () => onShowChange?.(false)

  const showTTFT = preset.sort === 'ttft_desc'
  const latencyLabel = t(showTTFT ? 'admin.ops.ttftLabel' : 'admin.ops.requestDetails.table.duration')

  const formatLatency = (row: OpsRequestDetail): string => {
    const value = showTTFT ? row.first_token_ms : row.duration_ms
    return typeof value === 'number' ? `${value} ms` : '-'
  }

  const minutes = parseTimeRangeMinutes(timeRange)
  const rangeLabel = minutes >= 60
    ? t('admin.ops.requestDetails.rangeHours', { n: Math.round(minutes / 60) })
    : t('admin.ops.requestDetails.rangeMinutes', { n: minutes })

  // 明细行只带 account_id；账号名来自 lite 账号列表映射，缺项时强制刷新一次缓存（新建账号场景）。
  const refreshAccountNames = useCallback(async (rows: OpsRequestDetail[]) => {
    const ids = rows
      .map((row) => row.account_id)
      .filter((id): id is number => typeof id === 'number' && id > 0)
    if (ids.length === 0) return
    try {
      let map = await getAccountNameMap()
      if (ids.some((id) => !map.has(id))) map = await getAccountNameMap(true)
      setAccountNameById(map)
    } catch (e) {
      console.warn('[OpsRequestDetailsModal] Failed to load account names', e)
    }
  }, [])

  const fetchData = useCallback(async () => {
    const p = propsRef.current
    if (!p.show) return
    const seq = ++requestSeq.current
    setLoading(true)
    try {
      const minutesRange = parseTimeRangeMinutes(p.timeRange)
      const endTime = new Date()
      const startTime = new Date(endTime.getTime() - minutesRange * 60 * 1000)
      const params: OpsRequestDetailsParams = {
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        page: pagerRef.current.page,
        page_size: pagerRef.current.pageSize,
        kind: p.preset.kind ?? 'all',
        sort: p.preset.sort ?? 'created_at_desc'
      }

      const platformVal = (p.platform || '').trim()
      if (platformVal) params.platform = platformVal
      if (typeof p.groupId === 'number' && p.groupId > 0) params.group_id = p.groupId

      if (typeof p.preset.min_duration_ms === 'number') params.min_duration_ms = p.preset.min_duration_ms
      if (typeof p.preset.max_duration_ms === 'number') params.max_duration_ms = p.preset.max_duration_ms

      const res = await opsAPI.listRequestDetails(params)
      if (seq !== requestSeq.current) return
      const rows = res.items || []
      setItems(rows)
      setTotal(res.total || 0)
      void refreshAccountNames(rows)
    } catch (e: any) {
      if (seq !== requestSeq.current) return
      console.error('[OpsRequestDetailsModal] Failed to fetch request details', e)
      useAppStore.getState().showError(e?.message || t('admin.ops.requestDetails.failedToLoad'))
      setItems([])
      setTotal(0)
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [refreshAccountNames, t])

  // 打开时回到第一页；从单条错误详情返回（resumeState）时保留分页与数据
  const prevShow = useRef(show)
  useEffect(() => {
    const wasOpen = prevShow.current
    prevShow.current = show
    if (!show || wasOpen) return
    if (propsRef.current.resumeState) return
    updatePager({ page: 1, pageSize: 10 })
    void fetchData()
  }, [show, fetchData, updatePager])

  const scopeKey = JSON.stringify([
    timeRange,
    platform ?? null,
    groupId ?? null,
    preset.kind ?? null,
    preset.sort ?? null,
    preset.min_duration_ms ?? null,
    preset.max_duration_ms ?? null
  ])
  const prevScopeKey = useRef(scopeKey)
  useEffect(() => {
    if (prevScopeKey.current === scopeKey) return
    prevScopeKey.current = scopeKey
    if (!propsRef.current.show) return
    updatePager({ page: 1 })
    void fetchData()
  }, [scopeKey, fetchData, updatePager])

  const handlePageChange = (next: number) => {
    updatePager({ page: next })
    void fetchData()
  }

  const handlePageSizeChange = (next: number) => {
    updatePager({ pageSize: next, page: 1 })
    void fetchData()
  }

  const handleCopyRequestId = async (requestId: string) => {
    const ok = await copyToClipboard(requestId, t('admin.ops.requestDetails.requestIdCopied'))
    if (ok) return
    // `useClipboard` already shows toast on failure; this keeps UX consistent with older ops modal.
    useAppStore.getState().showWarning(t('admin.ops.requestDetails.copyFailed'))
  }

  const openErrorDetail = (errorId: number | null | undefined) => {
    if (!errorId) return
    onOpenErrorDetail?.(errorId)
  }

  const accountLabel = (row: OpsRequestDetail): string => {
    const id = row.account_id
    if (typeof id !== 'number' || id <= 0) return '-'
    return accountNameById.get(id) || `#${id}`
  }

  const kindBadge = (row: OpsRequestDetail) => (
    <Badge size="sm" tone={row.kind === 'error' ? 'danger' : 'success'}>
      {row.kind === 'error' ? t('admin.ops.requestDetails.kind.error') : t('admin.ops.requestDetails.kind.success')}
    </Badge>
  )

  const copyButton = (requestId: string) => (
    <button type="button" className={styles.copyButton} onClick={() => void handleCopyRequestId(requestId)}>
      {t('admin.ops.requestDetails.copy')}
    </button>
  )

  const viewErrorButton = (row: OpsRequestDetail, block = false) => (
    <Button
      type="button"
      variant="danger"
      size="sm"
      className={block ? styles.blockButton : undefined}
      onClick={() => openErrorDetail(row.error_id)}
    >
      {t('admin.ops.requestDetails.viewError')}
    </Button>
  )

  const columns: Column<OpsRequestDetail>[] = [
    { key: 'created_at', label: t('admin.ops.requestDetails.table.time') },
    { key: 'kind', label: t('admin.ops.requestDetails.table.kind') },
    { key: 'platform', label: t('admin.ops.requestDetails.table.platform') },
    { key: 'model', label: t('admin.ops.requestDetails.table.model') },
    { key: 'account', label: t('admin.ops.requestDetails.table.account') },
    { key: 'latency', label: latencyLabel },
    { key: 'status_code', label: t('admin.ops.requestDetails.table.status') },
    { key: 'request_id', label: t('admin.ops.requestDetails.table.requestId') },
    { key: 'actions', label: t('admin.ops.requestDetails.table.actions'), align: 'right' }
  ]

  const cells: Record<string, (ctx: DataTableCellContext<OpsRequestDetail>) => ReactNode> = {
    created_at: ({ row }) => <span className={styles.nowrap}>{formatDateTime(row.created_at)}</span>,
    kind: ({ row }) => kindBadge(row),
    platform: ({ row }) => <span className={styles.platform}>{(row.platform || 'unknown').toUpperCase()}</span>,
    model: ({ row }) => (
      <span className={[styles.truncate, styles.model].join(' ')} title={row.model || ''}>{row.model || '-'}</span>
    ),
    account: ({ row }) => (
      <span className={[styles.truncate, styles.account].join(' ')} title={accountLabel(row)}>{accountLabel(row)}</span>
    ),
    latency: ({ row }) => <span className={styles.nowrap}>{formatLatency(row)}</span>,
    status_code: ({ row }) => <span className={styles.nowrap}>{row.status_code ?? '-'}</span>,
    request_id: ({ row }) =>
      row.request_id ? (
        <div className={styles.requestId}>
          <span className={[styles.truncate, styles.mono].join(' ')} title={row.request_id}>{row.request_id}</span>
          {copyButton(row.request_id)}
        </div>
      ) : (
        <span className={styles.muted}>-</span>
      ),
    actions: ({ row }) =>
      row.kind === 'error' && row.error_id ? viewErrorButton(row) : <span className={styles.muted}>-</span>
  }

  const renderMobileCards = () => (
    <div className={styles.cards}>
      {items.map((row, idx) => (
        <div key={idx} className={styles.mobileCard}>
          <div className={styles.cardHeader}>
            {kindBadge(row)}
            <span className={styles.platform}>{(row.platform || 'unknown').toUpperCase()}</span>
            <span className={styles.cardTime}>{formatDateTime(row.created_at)}</span>
          </div>
          <div className={styles.cardLine}>{row.model || '-'}</div>
          {typeof row.account_id === 'number' && row.account_id > 0 && (
            <div className={styles.cardLine} title={accountLabel(row)}>
              {t('admin.ops.requestDetails.table.account')}: {accountLabel(row)}
            </div>
          )}
          <div className={styles.cardMeta}>
            <span>{latencyLabel}: {formatLatency(row)}</span>
            <span>{row.status_code ?? '-'}</span>
          </div>
          {row.request_id && (
            <div className={styles.requestId}>
              <span className={[styles.truncate, styles.mono, styles.grow].join(' ')} title={row.request_id}>{row.request_id}</span>
              {copyButton(row.request_id)}
            </div>
          )}
          {row.kind === 'error' && row.error_id ? viewErrorButton(row, true) : null}
        </div>
      ))}
    </div>
  )

  return (
    <BaseDialog show={show} title={preset.title || t('admin.ops.requestDetails.title')} width="full" onClose={close}>
      <div className={styles.root}>
        <div className={styles.toolbar}>
          <div className={styles.range}>{t('admin.ops.requestDetails.rangeLabel', { range: rangeLabel })}</div>
          <Button type="button" variant="secondary" size="sm" onClick={() => void fetchData()}>
            {t('common.refresh')}
          </Button>
        </div>

        {loading ? (
          <div className={styles.loading}>
            <DataTable<OpsRequestDetail> columns={columns} data={[]} loading />
          </div>
        ) : items.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>{t('admin.ops.requestDetails.empty')}</div>
            <div className={styles.emptyHint}>{t('admin.ops.requestDetails.emptyHint')}</div>
          </div>
        ) : (
          <div className={styles.tableRegion}>
            <div className={styles.tableScroll}>
              {isDesktopViewport ? (
                <DataTable<OpsRequestDetail> columns={columns} data={items} cells={cells} stickyFirstColumn={false} />
              ) : (
                renderMobileCards()
              )}
            </div>
            <Pagination
              total={total}
              page={pager.page}
              pageSize={pager.pageSize}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          </div>
        )}
      </div>
    </BaseDialog>
  )
}
