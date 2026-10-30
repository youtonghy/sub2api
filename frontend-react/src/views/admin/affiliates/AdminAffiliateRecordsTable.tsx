/**
 * 邀请返利记录表（邀请 / 返利 / 转出三种），对应 Vue 版 AdminAffiliateRecordsTable.vue：
 * 搜索与日期筛选、服务端排序（按类型记住排序）、分页、用户概览对话框，转出页额外提供线下提现登记。
 */
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  affiliatesAPI,
  type AffiliateInviteRecord,
  type AffiliateRebateRecord,
  type AffiliateTransferRecord,
  type AffiliateUserOverview,
  type ListAffiliateRecordsParams
} from '@/api/admin/affiliates'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import BaseDialog from '@/components/common/BaseDialog'
import DataTable from '@/components/common/DataTable'
import Input from '@/components/common/Input'
import Pagination from '@/components/common/Pagination'
import SearchInput from '@/components/common/SearchInput'
import TablePageLayout from '@/components/common/TablePageLayout'
import type { Column } from '@/components/common/types'
import OrderStatusBadge from '@/components/payment/OrderStatusBadge'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { PaginatedResponse } from '@/types'
import type { OrderStatus } from '@/types/payment'
import { extractI18nErrorMessage } from '@/utils/apiError'
import { formatDateTime as formatDisplayDateTime } from '@/utils/format'
import AffiliateOfflineWithdrawDialog from './AffiliateOfflineWithdrawDialog'
import styles from './Affiliates.module.css'

export type AffiliateRecordType = 'invites' | 'rebates' | 'transfers'
type AffiliateRecord = AffiliateInviteRecord | AffiliateRebateRecord | AffiliateTransferRecord

export interface AdminAffiliateRecordsTableProps {
  type: AffiliateRecordType
}

interface RecordQuery {
  search: string
  start_at: string
  end_at: string
  page: number
  page_size: number
  sort_by: string
  sort_order: 'asc' | 'desc'
}

function formatAmount(value: number | null | undefined): string {
  return Number(value || 0).toFixed(2)
}

function formatPercent(value: number | null | undefined): string {
  const rounded = Math.round(Number(value || 0) * 100) / 100
  return `${Number.isInteger(rounded) ? rounded.toString() : rounded.toString()}%`
}

function formatDateTime(value: string | null | undefined): string {
  return value ? formatDisplayDateTime(value) : '-'
}

function userTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

function Dash() {
  return <span className={styles.dash}>-</span>
}

function AmountText({ value, strong = false }: { value: number; strong?: boolean }) {
  return <span className={strong ? styles.amountStrong : styles.amount}>${formatAmount(value)}</span>
}

function NullableAmountText({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <Dash />
  return <AmountText value={value} />
}

interface UserCellProps {
  id: number
  email?: string | null
  username?: string | null
  clickable: boolean
  onOpen: (id: number) => void
}

function UserCell({ id, email, username, clickable, onOpen }: UserCellProps) {
  return (
    <div className={styles.userCell}>
      <div className={styles.monoStrong}>#{id}</div>
      {clickable ? (
        <button type="button" className={styles.userLink} onClick={() => onOpen(id)}>
          {email || '-'}
        </button>
      ) : (
        <div className={styles.userEmail}>{email || '-'}</div>
      )}
      <div className={styles.userName}>{username || '-'}</div>
    </div>
  )
}

function OverviewStat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={mono ? styles.statValueMono : styles.statValue}>{value}</div>
    </div>
  )
}

function buildColumns(type: AffiliateRecordType, t: (key: string) => string): Column[] {
  if (type === 'invites') {
    return [
      { key: 'inviter', label: t('admin.affiliates.records.inviter'), sortable: true },
      { key: 'invitee', label: t('admin.affiliates.records.invitee'), sortable: true },
      { key: 'aff_code', label: t('admin.affiliates.records.affCode'), sortable: true },
      { key: 'total_rebate', label: t('admin.affiliates.records.totalRebate'), sortable: true },
      { key: 'created_at', label: t('admin.affiliates.records.invitedAt'), sortable: true }
    ]
  }
  if (type === 'rebates') {
    return [
      { key: 'order', label: t('admin.affiliates.records.order'), sortable: true },
      { key: 'inviter', label: t('admin.affiliates.records.inviter'), sortable: true },
      { key: 'invitee', label: t('admin.affiliates.records.invitee'), sortable: true },
      { key: 'order_amount', label: t('admin.affiliates.records.orderAmount'), sortable: true },
      { key: 'pay_amount', label: t('admin.affiliates.records.payAmount'), sortable: true },
      { key: 'rebate_amount', label: t('admin.affiliates.records.rebateAmount') },
      { key: 'payment_type', label: t('admin.affiliates.records.paymentType'), sortable: true },
      { key: 'order_status', label: t('admin.affiliates.records.orderStatus'), sortable: true },
      { key: 'created_at', label: t('admin.affiliates.records.rebatedAt'), sortable: true }
    ]
  }
  return [
    { key: 'user', label: t('admin.affiliates.records.user'), sortable: true },
    { key: 'action', label: t('admin.affiliates.records.outflowType'), sortable: true },
    { key: 'amount', label: t('admin.affiliates.records.transferAmount'), sortable: true },
    { key: 'balance_after', label: t('admin.affiliates.records.balanceAfter'), sortable: true },
    { key: 'available_quota_after', label: t('admin.affiliates.records.availableQuotaAfter'), sortable: true },
    { key: 'frozen_quota_after', label: t('admin.affiliates.records.frozenQuotaAfter'), sortable: true },
    { key: 'history_quota_after', label: t('admin.affiliates.records.historyQuotaAfter'), sortable: true },
    { key: 'created_at', label: t('admin.affiliates.records.transferredAt'), sortable: true }
  ]
}

function loadInitialSortState(storageKey: string, columns: Column[]): { sort_by: string; sort_order: 'asc' | 'desc' } {
  const fallback = { sort_by: 'created_at', sort_order: 'desc' as 'asc' | 'desc' }
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as { key?: string; order?: string }
    const key = typeof parsed.key === 'string' ? parsed.key : ''
    if (!columns.some((column) => column.key === key && column.sortable)) return fallback
    return {
      sort_by: key,
      sort_order: parsed.order === 'asc' ? 'asc' : 'desc'
    }
  } catch {
    return fallback
  }
}

export default function AdminAffiliateRecordsTable({ type }: AdminAffiliateRecordsTableProps) {
  const { t } = useI18n()
  const columns = buildColumns(type, t)
  const sortStorageKey = `admin-affiliate-${type}-table-sort`

  const [loading, setLoading] = useState(false)
  const [records, setRecords] = useState<AffiliateRecord[]>([])
  const [total, setTotal] = useState(0)
  // 查询条件同时保存在 ref 里，防抖与异步回调总是读到最新值
  const [initialQuery] = useState<RecordQuery>(() => ({
    search: '',
    start_at: '',
    end_at: '',
    page: 1,
    page_size: 20,
    ...loadInitialSortState(sortStorageKey, columns)
  }))
  const queryRef = useRef<RecordQuery>(initialQuery)
  const [query, setQuery] = useState<RecordQuery>(initialQuery)
  const loadSeq = useRef(0)

  const [overviewDialog, setOverviewDialog] = useState(false)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [selectedOverview, setSelectedOverview] = useState<AffiliateUserOverview | null>(null)
  const [withdrawDialog, setWithdrawDialog] = useState(false)

  const showError = (error: unknown) =>
    useAppStore.getState().showError(extractI18nErrorMessage(error, t, 'admin.affiliates.errors', t('common.error')))

  const updateQuery = (patch: Partial<RecordQuery>) => {
    queryRef.current = { ...queryRef.current, ...patch }
    setQuery(queryRef.current)
  }

  function buildParams(q: RecordQuery): ListAffiliateRecordsParams {
    return {
      page: q.page,
      page_size: q.page_size,
      search: q.search.trim() || undefined,
      start_at: q.start_at || undefined,
      end_at: q.end_at || undefined,
      sort_by: q.sort_by,
      sort_order: q.sort_order,
      timezone: userTimezone()
    }
  }

  async function fetchRecords(params: ListAffiliateRecordsParams): Promise<PaginatedResponse<AffiliateRecord>> {
    if (type === 'invites') return affiliatesAPI.listInviteRecords(params)
    if (type === 'rebates') return affiliatesAPI.listRebateRecords(params)
    return affiliatesAPI.listTransferRecords(params)
  }

  async function loadRecords() {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      const res = await fetchRecords(buildParams(queryRef.current))
      if (seq !== loadSeq.current) return
      setRecords(res.items || [])
      setTotal(res.total || 0)
    } catch (error) {
      if (seq !== loadSeq.current) return
      showError(error)
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }

  const reloadFromFirstPage = () => {
    updateQuery({ page: 1 })
    void loadRecords()
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 进入页面时加载记录（Vue 版 onMounted）
    void loadRecords()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePageChange = (page: number) => {
    updateQuery({ page })
    void loadRecords()
  }

  const handlePageSizeChange = (size: number) => {
    updateQuery({ page_size: size, page: 1 })
    void loadRecords()
  }

  const handleSort = (key: string, order: 'asc' | 'desc') => {
    updateQuery({ sort_by: key, sort_order: order, page: 1 })
    void loadRecords()
  }

  const handleWithdrawSuccess = () => {
    setWithdrawDialog(false)
    reloadFromFirstPage()
  }

  const outflowTypeLabel = (action: string | null | undefined): string =>
    action === 'withdraw' ? t('admin.affiliates.outflowTypes.withdraw') : t('admin.affiliates.outflowTypes.transfer')

  async function openUserOverview(userId: number) {
    if (!userId) return
    setOverviewDialog(true)
    setOverviewLoading(true)
    setSelectedOverview(null)
    try {
      setSelectedOverview(await affiliatesAPI.getUserOverview(userId))
    } catch (error) {
      setOverviewDialog(false)
      showError(error)
    } finally {
      setOverviewLoading(false)
    }
  }

  const openOverview = (id: number) => void openUserOverview(id)
  const clickable = type !== 'transfers'

  const cells: Record<string, (ctx: { row: any; value: any }) => ReactNode> = {
    inviter: ({ row }) => (
      <UserCell
        id={row.inviter_id}
        email={row.inviter_email}
        username={row.inviter_username}
        clickable={clickable}
        onOpen={openOverview}
      />
    ),
    invitee: ({ row }) =>
      row.invitee_id == null ? (
        <Dash />
      ) : (
        <UserCell
          id={row.invitee_id}
          email={row.invitee_email}
          username={row.invitee_username}
          clickable={clickable}
          onOpen={openOverview}
        />
      ),
    user: ({ row }) => (
      <UserCell id={row.user_id} email={row.user_email} username={row.username} clickable onOpen={openOverview} />
    ),
    aff_code: ({ row }) => <span className={styles.mono}>{row.aff_code || '-'}</span>,
    order: ({ row }) =>
      row.order_id == null ? (
        <Dash />
      ) : (
        <div className={styles.userCell}>
          <div className={styles.monoStrong}>#{row.order_id}</div>
          <div className={styles.userName}>{row.out_trade_no}</div>
        </div>
      ),
    payment_type: ({ row }) =>
      row.payment_type ? <>{t('payment.methods.' + row.payment_type, row.payment_type)}</> : <Dash />,
    order_status: ({ row }) =>
      row.order_status ? <OrderStatusBadge status={row.order_status as OrderStatus} /> : <Dash />,
    total_rebate: ({ row }) => <AmountText value={row.total_rebate} />,
    order_amount: ({ row }) => <NullableAmountText value={row.order_amount} />,
    pay_amount: ({ row }) =>
      row.pay_amount == null ? <Dash /> : <span className={styles.amount}>¥{formatAmount(row.pay_amount)}</span>,
    rebate_amount: ({ row }) => <AmountText value={row.rebate_amount} strong />,
    action: ({ row }) => (
      <Badge tone={row.action === 'withdraw' ? 'warning' : 'info'} size="sm">
        {outflowTypeLabel(row.action)}
      </Badge>
    ),
    amount: ({ row }) => <AmountText value={row.amount} strong />,
    balance_after: ({ row }) => <NullableAmountText value={row.balance_after} />,
    available_quota_after: ({ row }) => <NullableAmountText value={row.available_quota_after} />,
    frozen_quota_after: ({ row }) => <NullableAmountText value={row.frozen_quota_after} />,
    history_quota_after: ({ row }) => <NullableAmountText value={row.history_quota_after} />,
    created_at: ({ row }) => <span className={styles.text}>{formatDateTime(row.created_at)}</span>
  }

  return (
    <>
      <TablePageLayout
        filters={
          <div className={styles.toolbar}>
            <SearchInput
              className={styles.search}
              value={query.search}
              placeholder={t('admin.affiliates.records.searchPlaceholder')}
              onChange={(search) => updateQuery({ search })}
              onSearch={reloadFromFirstPage}
            />
            <div className={styles.dateField}>
              <Input
                type="date"
                value={query.start_at}
                title={t('admin.affiliates.records.startAt')}
                aria-label={t('admin.affiliates.records.startAt')}
                onChange={(start_at) => {
                  updateQuery({ start_at })
                  reloadFromFirstPage()
                }}
              />
            </div>
            <div className={styles.dateField}>
              <Input
                type="date"
                value={query.end_at}
                title={t('admin.affiliates.records.endAt')}
                aria-label={t('admin.affiliates.records.endAt')}
                onChange={(end_at) => {
                  updateQuery({ end_at })
                  reloadFromFirstPage()
                }}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              title={t('common.refresh')}
              aria-label={t('common.refresh')}
              onClick={() => void loadRecords()}
            >
              <RefreshCw size={16} className={loading ? styles.spin : undefined} aria-hidden="true" />
            </Button>
            {type === 'transfers' && (
              <Button
                type="button"
                variant="primary"
                className={styles.pushEnd}
                data-test="affiliate-withdraw-open"
                onClick={() => setWithdrawDialog(true)}
              >
                {t('admin.affiliates.withdraw.button')}
              </Button>
            )}
          </div>
        }
        table={
          <DataTable
            columns={columns}
            data={records}
            loading={loading}
            serverSideSort
            defaultSortKey="created_at"
            defaultSortOrder="desc"
            sortStorageKey={sortStorageKey}
            onSort={handleSort}
            cells={cells}
          />
        }
        pagination={
          total > 0 ? (
            <Pagination
              page={query.page}
              total={total}
              pageSize={query.page_size}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          ) : undefined
        }
      />

      {type === 'transfers' && (
        <AffiliateOfflineWithdrawDialog
          show={withdrawDialog}
          onClose={() => setWithdrawDialog(false)}
          onSuccess={handleWithdrawSuccess}
        />
      )}

      <BaseDialog
        show={overviewDialog}
        title={t('admin.affiliates.overview.title')}
        width="normal"
        onClose={() => setOverviewDialog(false)}
      >
        {overviewLoading ? (
          <Skeleton lines={4} label={t('common.loading')} />
        ) : selectedOverview ? (
          <div className={styles.overview}>
            <div className={styles.overviewUser}>
              <div className={styles.monoStrong}>#{selectedOverview.user_id}</div>
              <div className={styles.overviewEmail}>{selectedOverview.email || '-'}</div>
              <div className={styles.userName}>{selectedOverview.username || '-'}</div>
            </div>
            <div className={styles.stats}>
              <OverviewStat
                label={t('admin.affiliates.overview.affCode')}
                value={selectedOverview.aff_code || '-'}
                mono
              />
              <OverviewStat
                label={t('admin.affiliates.overview.rebateRate')}
                value={formatPercent(selectedOverview.rebate_rate_percent)}
              />
              <OverviewStat
                label={t('admin.affiliates.overview.invitedCount')}
                value={String(selectedOverview.invited_count)}
              />
              <OverviewStat
                label={t('admin.affiliates.overview.rebatedInviteeCount')}
                value={String(selectedOverview.rebated_invitee_count)}
              />
              <OverviewStat
                label={t('admin.affiliates.overview.availableQuota')}
                value={'$' + formatAmount(selectedOverview.available_quota)}
              />
              <OverviewStat
                label={t('admin.affiliates.overview.historyQuota')}
                value={'$' + formatAmount(selectedOverview.history_quota)}
              />
            </div>
          </div>
        ) : null}
      </BaseDialog>
    </>
  )
}
