import { useState, type ReactNode } from 'react'

import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import DataTable, { type DataTableCellContext } from '@/components/common/DataTable'
import IpGeoBatchToolbar from '@/components/common/IpGeoBatchToolbar'
import IpGeoCell from '@/components/common/IpGeoCell'
import Pagination from '@/components/common/Pagination'
import type { Column } from '@/components/common/types'
import { useI18n } from '@/i18n/useI18n'
import type { UserErrorRequest } from '@/types'
import { mapErrorSortKey, numericRequestTypeKind, requestTypeLabelKey, type UsageRequestKind } from '@/utils/errorBadges'
import { formatDateTime } from '@/utils/format'
import UserErrorDetailModal from './UserErrorDetailModal'
import styles from './UserErrorRequestsTable.module.css'

export interface UserErrorRequestsTableProps {
  rows: UserErrorRequest[]
  total: number
  loading: boolean
  page: number
  pageSize: number
  /** 列设置:仅显示这些 key 的列;不传则全显(key 须与 allColumns 一致) */
  visibleColumnKeys?: string[]
  /** 嵌入统一区域内使用：去掉自身边框 */
  flat?: boolean
  onPageChange?: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  onIpGeoBatchFailed?: () => void
  onSort?: (sortBy: string, sortOrder: 'asc' | 'desc') => void
}

/** 状态码徽章:≥500 红、429 紫(信息)、≥400 琥珀、其余灰(对应 statusCodeBadgeClass) */
function statusTone(code: number): BadgeTone {
  if (code >= 500) return 'danger'
  if (code === 429) return 'info'
  if (code >= 400) return 'warning'
  return 'neutral'
}

/** 请求类型徽章(cyber 红、live 绿、ws/stream 蓝紫、sync 灰、未知琥珀;对应 requestTypeBadgeClass) */
function requestTypeTone(kind: UsageRequestKind): BadgeTone {
  if (kind === 'cyber') return 'danger'
  if (kind === 'live') return 'success'
  if (kind === 'ws_v2' || kind === 'stream') return 'info'
  if (kind === 'sync') return 'neutral'
  return 'warning'
}

/** 用户端错误请求列表（点击行查看详情） */
export default function UserErrorRequestsTable({
  rows,
  total,
  loading,
  page,
  pageSize,
  visibleColumnKeys,
  flat = false,
  onPageChange,
  onPageSizeChange,
  onIpGeoBatchFailed,
  onSort
}: UserErrorRequestsTableProps) {
  const { t } = useI18n()
  const [showDetail, setShowDetail] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  // 列序对齐用户端用量明细:Key → 模型 → 端点 → IP → 分组 → 类型 → 平台 → 分类
  // → 结果(状态→消息)→ 时间 → UA(用量明细 UA 同在时间之后的尾部)
  const allColumns: Column<UserErrorRequest>[] = [
    { key: 'key_name', label: t('usage.errors.keyName') },
    { key: 'model', label: t('usage.errors.model'), sortable: true },
    { key: 'endpoint', label: t('usage.errors.endpoint') },
    { key: 'client_ip', label: 'IP' },
    { key: 'group', label: t('admin.usage.group') },
    { key: 'type', label: t('usage.type') },
    { key: 'platform', label: t('usage.errors.platform') },
    { key: 'category', label: t('usage.errors.category') },
    { key: 'status', label: t('usage.errors.status'), sortable: true },
    { key: 'message', label: t('usage.errors.message') },
    { key: 'created_at', label: t('usage.errors.time'), sortable: true },
    { key: 'user_agent', label: t('usage.userAgent') }
  ]

  const columns = visibleColumnKeys ? allColumns.filter((c) => visibleColumnKeys.includes(c.key)) : allColumns

  const openDetail = (id: number) => {
    setSelectedId(id)
    setShowDetail(true)
  }

  const dash = <span className={styles.muted}>-</span>

  const cells: Record<string, (ctx: DataTableCellContext<UserErrorRequest>) => ReactNode> = {
    model: ({ row }) => (row.model ? <span className={styles.strong}>{row.model}</span> : dash),
    key_name: ({ row }) => (
      <span className={styles.inline}>
        <span>{row.key_name || '-'}</span>
        {row.key_deleted && (
          <Badge size="sm" tone="danger">
            {t('usage.errors.keyDeleted')}
          </Badge>
        )}
      </span>
    ),
    endpoint: ({ row }) => (
      <div className={styles.endpoint}>
        <span className={styles.fieldLabel}>{t('usage.inbound')}:</span>
        <span className={styles.fieldValue}>{row.inbound_endpoint?.trim() || '-'}</span>
      </div>
    ),
    status: ({ row }) => (
      <Badge size="sm" tone={statusTone(row.status_code)}>
        {row.status_code || '-'}
      </Badge>
    ),
    category: ({ row }) => <span>{t('usage.errors.categories.' + row.category)}</span>,
    message: ({ row }) =>
      row.message ? (
        <span className={`${styles.truncate} ${styles.message}`} title={row.message}>
          {row.message}
        </span>
      ) : (
        dash
      ),
    group: ({ row }) =>
      row.group_name ? (
        <Badge size="sm" tone="info">
          {row.group_name}
        </Badge>
      ) : (
        dash
      ),
    type: ({ row }) => {
      const kind = numericRequestTypeKind(row.request_type, row.stream)
      if (!kind) return dash
      return (
        <Badge size="sm" tone={requestTypeTone(kind)}>
          {t(requestTypeLabelKey(kind))}
        </Badge>
      )
    },
    platform: ({ row }) => <span>{row.platform || '-'}</span>,
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
    created_at: ({ row }) => <span className={styles.secondary}>{formatDateTime(row.created_at)}</span>,
    user_agent: ({ row }) =>
      row.user_agent ? (
        <span className={`${styles.truncate} ${styles.userAgent}`} title={row.user_agent}>
          {row.user_agent}
        </span>
      ) : (
        dash
      )
  }

  return (
    <div className={styles.root}>
      <div className={flat ? styles.body : `${styles.body} ${styles.card}`}>
        <IpGeoBatchToolbar ips={rows.map((r) => r.client_ip)} onFailed={() => onIpGeoBatchFailed?.()} />

        <DataTable<UserErrorRequest>
          columns={columns}
          data={rows}
          loading={loading}
          clickableRows
          serverSideSort
          defaultSortKey="created_at"
          defaultSortOrder="desc"
          onSort={(key, order) => onSort?.(mapErrorSortKey(key), order)}
          onRowClick={(row) => openDetail(row.id)}
          cells={cells}
          empty={<div className={styles.empty}>{t('usage.errors.empty')}</div>}
        />
      </div>

      {total > 0 && (
        <div className={styles.pagination}>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={(value) => onPageChange?.(value)}
            onPageSizeChange={(value) => onPageSizeChange?.(value)}
          />
        </div>
      )}

      <UserErrorDetailModal show={showDetail} errorId={selectedId} onShowChange={setShowDetail} />
    </div>
  )
}
