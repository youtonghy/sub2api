import { FileText } from 'lucide-react'
import type { ReactNode } from 'react'

import type { OpsErrorLog } from '@/api/admin/ops'
import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import DataTable, { type DataTableCellContext } from '@/components/common/DataTable'
import IpGeoBatchToolbar from '@/components/common/IpGeoBatchToolbar'
import IpGeoCell from '@/components/common/IpGeoCell'
import Pagination from '@/components/common/Pagination'
import type { Column } from '@/components/common/types'
import { useI18n } from '@/i18n/useI18n'
import { mapErrorSortKey } from '@/utils/errorBadges'
import { mapErrorCategory } from '@/utils/errorCategory'
import { formatDateTime } from '../utils/opsFormatters'
import { severityTone, statusCodeTone } from './opsBadgeTones'
import styles from './OpsErrorLogTable.module.css'

export interface OpsErrorLogTableProps {
  rows: OpsErrorLog[]
  total: number
  loading: boolean
  page: number
  pageSize: number
  /** 用户邮箱可点击(onUserClick),仅在有弹窗承接的使用方开启 */
  userClickable?: boolean
  /** 列设置:仅显示这些 key 的列;不传则全量 */
  visibleColumnKeys?: string[]
  /** 运维弹窗优先展示时间和响应内容 */
  summaryFirst?: boolean
  /** 嵌入统一卡片内使用：去掉自身卡片外观 */
  flat?: boolean
  className?: string
  onOpenErrorDetail?: (id: number) => void
  onPageChange?: (value: number) => void
  onPageSizeChange?: (value: number) => void
  onIpGeoBatchFailed?: () => void
  onSort?: (sortBy: string, sortOrder: 'asc' | 'desc') => void
  onUserClick?: (userId: number, email?: string) => void
}

function isUpstreamRow(log: OpsErrorLog): boolean {
  const phase = String(log.phase || '').toLowerCase()
  const owner = String(log.error_owner || '').toLowerCase()
  return phase === 'upstream' && owner === 'provider'
}

function hasModelMapping(log: OpsErrorLog): boolean {
  const requested = String(log.requested_model || '').trim()
  const upstream = String(log.upstream_model || '').trim()
  return !!requested && !!upstream && requested !== upstream
}

function displayModel(log: OpsErrorLog): string {
  const upstream = String(log.upstream_model || '').trim()
  if (upstream) return upstream
  const requested = String(log.requested_model || '').trim()
  if (requested) return requested
  return String(log.model || '').trim()
}

export default function OpsErrorLogTable({
  rows,
  total,
  loading,
  page,
  pageSize,
  userClickable = false,
  visibleColumnKeys,
  summaryFirst = false,
  flat = false,
  className,
  onOpenErrorDetail,
  onPageChange,
  onPageSizeChange,
  onIpGeoBatchFailed,
  onSort,
  onUserClick
}: OpsErrorLogTableProps) {
  const { t } = useI18n()

  // 列序对齐管理端用量明细:身份(用户→Key→账号)→ 请求形态(平台→模型→端点→分组→类型)
  // → 结果(状态→消息)→ 时间→UA→IP→操作
  const allColumns: Column<OpsErrorLog>[] = [
    { key: 'user', label: t('admin.ops.errorLog.user') },
    { key: 'api_key', label: t('admin.ops.errorLog.apiKey') },
    { key: 'account', label: t('admin.ops.errorLog.account') },
    { key: 'platform', label: t('admin.ops.errorLog.platform') },
    { key: 'model', label: t('admin.ops.errorLog.model'), sortable: true },
    { key: 'endpoint', label: t('admin.ops.errorLog.endpoint') },
    { key: 'group', label: t('admin.ops.errorLog.group') },
    { key: 'type', label: t('admin.ops.errorLog.type') },
    { key: 'category', label: t('usage.errors.category') },
    { key: 'status', label: t('admin.ops.errorLog.status'), sortable: true },
    { key: 'message', label: t('admin.ops.errorLog.message') },
    { key: 'created_at', label: t('admin.ops.errorLog.time'), sortable: true },
    { key: 'user_agent', label: t('usage.userAgent') },
    { key: 'client_ip', label: t('admin.ops.errorLog.ip') },
    { key: 'actions', label: t('admin.ops.errorLog.action') }
  ]

  // 传入 visibleColumnKeys 时按其过滤(列设置);未传则全量(Ops 弹窗等使用方)
  const visibleColumns = visibleColumnKeys
    ? allColumns.filter((c) => visibleColumnKeys.includes(c.key))
    : allColumns
  const columns = summaryFirst
    ? [
        ...visibleColumns.filter((c) => c.key === 'created_at'),
        ...visibleColumns.filter((c) => c.key === 'message'),
        ...visibleColumns.filter((c) => c.key !== 'created_at' && c.key !== 'message')
      ]
    : visibleColumns

  const formatRequestType = (type: number | null | undefined): string => {
    switch (type) {
      case 1: return t('admin.ops.errorLog.requestTypeSync')
      case 2: return t('admin.ops.errorLog.requestTypeStream')
      case 3: return t('admin.ops.errorLog.requestTypeWs')
      default: return ''
    }
  }

  // 徽章配色：Vue 版对齐用量明细的 bg-X-100/text-X-800 体系，这里换成 Arc badge 语义色调
  const getTypeBadge = (log: OpsErrorLog): { label: string; tone: BadgeTone } => {
    const phase = String(log.phase || '').toLowerCase()
    const owner = String(log.error_owner || '').toLowerCase()

    if (isUpstreamRow(log)) return { label: t('admin.ops.errorLog.typeUpstream'), tone: 'danger' }
    if (phase === 'request' && owner === 'client') return { label: t('admin.ops.errorLog.typeRequest'), tone: 'warning' }
    if (phase === 'auth' && owner === 'client') return { label: t('admin.ops.errorLog.typeAuth'), tone: 'info' }
    if (phase === 'account_auth') return { label: t('admin.ops.errorLog.typeAccountAuth'), tone: 'warning' }
    if (phase === 'routing' && owner === 'platform') return { label: t('admin.ops.errorLog.typeRouting'), tone: 'info' }
    if (phase === 'internal' && owner === 'platform') return { label: t('admin.ops.errorLog.typeInternal'), tone: 'neutral' }

    const fallback = phase || owner || t('common.unknown')
    return { label: fallback, tone: 'neutral' }
  }

  const formatSmartMessage = (msg: string): string => {
    if (!msg) return ''

    if (msg.startsWith('{') || msg.startsWith('[')) {
      try {
        const obj = JSON.parse(msg)
        if (obj?.error?.message) return String(obj.error.message)
        if (obj?.message) return String(obj.message)
        if (obj?.detail) return String(obj.detail)
        if (typeof obj === 'object') return JSON.stringify(obj).substring(0, 150)
      } catch {
        // ignore parse error
      }
    }

    if (msg.includes('context deadline exceeded')) return t('admin.ops.errorLog.commonErrors.contextDeadlineExceeded')
    if (msg.includes('connection refused')) return t('admin.ops.errorLog.commonErrors.connectionRefused')
    if (msg.toLowerCase().includes('rate limit')) return t('admin.ops.errorLog.commonErrors.rateLimit')

    return msg.length > 200 ? msg.substring(0, 200) + '...' : msg
  }

  const dash = <span className={styles.muted}>-</span>

  const cells: Record<string, (ctx: DataTableCellContext<OpsErrorLog>) => ReactNode> = {
    created_at: ({ row }) => (
      <span className={styles.secondary} title={row.request_id || row.client_request_id}>
        {formatDateTime(row.created_at)}
      </span>
    ),
    type: ({ row }) => {
      const badge = getTypeBadge(row)
      return <Badge size="sm" tone={badge.tone}>{badge.label}</Badge>
    },
    endpoint: ({ row }) => (
      <div className={styles.endpoint}>
        <div>
          <span className={styles.fieldLabel}>{t('usage.inbound')}:</span>
          <span className={styles.fieldValue}>{row.inbound_endpoint?.trim() || '-'}</span>
        </div>
        {row.upstream_endpoint && (
          <div>
            <span className={styles.fieldLabel}>{t('usage.upstream')}:</span>
            <span className={styles.fieldValue}>{row.upstream_endpoint?.trim() || '-'}</span>
          </div>
        )}
      </div>
    ),
    platform: ({ row }) => <span>{row.platform || '-'}</span>,
    model: ({ row }) => {
      if (hasModelMapping(row)) {
        return (
          <div className={styles.modelMapping}>
            <div className={styles.strong}>{row.requested_model}</div>
            <div className={styles.secondary}><span aria-hidden="true">↳ </span>{row.upstream_model}</div>
          </div>
        )
      }
      const model = displayModel(row)
      return model ? <span className={styles.strong}>{model}</span> : dash
    },
    group: ({ row }) =>
      row.group_id ? (
        <span title={t('admin.ops.errorLog.id') + ' ' + row.group_id}>
          <Badge size="sm" tone="info">{row.group_name || '#' + row.group_id}</Badge>
        </span>
      ) : (
        dash
      ),
    user: ({ row }) =>
      row.user_id ? (
        <div>
          {userClickable && row.user_email ? (
            <button
              type="button"
              className={styles.userLink}
              title={t('admin.usage.clickToViewBalance')}
              onClick={(event) => {
                event.stopPropagation()
                onUserClick?.(row.user_id as number, row.user_email)
              }}
            >
              {row.user_email}
            </button>
          ) : (
            <span className={styles.strong}>{row.user_email || '-'}</span>
          )}
          <span className={styles.idSuffix}>#{row.user_id}</span>
        </div>
      ) : (
        dash
      ),
    api_key: ({ row }) =>
      row.api_key_id || row.api_key_name ? (
        <div className={styles.inline}>
          <span>{row.api_key_name || '#' + row.api_key_id}</span>
          {row.api_key_deleted && (
            <Badge size="sm" tone="danger">{t('admin.ops.errorLog.keyDeletedBadge')}</Badge>
          )}
        </div>
      ) : (
        dash
      ),
    account: ({ row }) =>
      row.account_id ? (
        <span title={t('admin.ops.errorLog.accountId') + ' ' + row.account_id}>
          {row.account_name || '#' + row.account_id}
        </span>
      ) : (
        dash
      ),
    category: ({ row }) => <span>{t('usage.errors.categories.' + mapErrorCategory(row.phase, row.type))}</span>,
    status: ({ row }) => (
      <div className={styles.inline}>
        <Badge size="sm" tone={statusCodeTone(row.status_code)}>{row.status_code}</Badge>
        {row.severity && <Badge size="sm" tone={severityTone(row.severity)}>{row.severity}</Badge>}
        {row.request_type != null && row.request_type > 0 && (
          <Badge size="sm" tone="neutral">{formatRequestType(row.request_type)}</Badge>
        )}
      </div>
    ),
    message: ({ row }) =>
      row.message ? (
        <span className={[styles.truncate, styles.message].join(' ')} title={row.message}>
          {formatSmartMessage(row.message) || '-'}
        </span>
      ) : (
        dash
      ),
    user_agent: ({ row }) =>
      row.user_agent ? (
        <span className={[styles.truncate, styles.userAgent].join(' ')} title={row.user_agent}>
          {row.user_agent}
        </span>
      ) : (
        dash
      ),
    client_ip: ({ row }) => (
      <div onClick={(event) => event.stopPropagation()}>
        {row.client_ip ? (
          <div>
            <span className={styles.mono}>{row.client_ip}</span>
            <IpGeoCell ip={row.client_ip} />
          </div>
        ) : (
          dash
        )}
      </div>
    ),
    actions: ({ row }) => (
      <button
        type="button"
        className={styles.iconButton}
        title={t('admin.ops.errorLog.details')}
        aria-label={t('admin.ops.errorLog.details')}
        onClick={(event) => {
          event.stopPropagation()
          onOpenErrorDetail?.(row.id)
        }}
      >
        <FileText size={16} aria-hidden="true" />
      </button>
    )
  }

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      <div className={[styles.body, flat ? '' : styles.card].filter(Boolean).join(' ')}>
        <IpGeoBatchToolbar ips={rows.map((r) => r.client_ip)} onFailed={() => onIpGeoBatchFailed?.()} />

        <DataTable<OpsErrorLog>
          columns={columns}
          data={rows}
          loading={loading}
          clickableRows
          serverSideSort
          defaultSortKey="created_at"
          defaultSortOrder="desc"
          onSort={(key, order) => onSort?.(mapErrorSortKey(key), order)}
          onRowClick={(row) => onOpenErrorDetail?.(row.id)}
          cells={cells}
          empty={<div className={styles.empty}>{t('admin.ops.errorLog.noErrors')}</div>}
        />
      </div>

      {total > 0 && (
        <div className={styles.pagination}>
          <Pagination
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={(value) => onPageChange?.(value)}
            onPageSizeChange={(value) => onPageSizeChange?.(value)}
          />
        </div>
      )}
    </div>
  )
}
