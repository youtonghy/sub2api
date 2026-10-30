import { Clock, Eye, Search, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { totpAPI } from '@/api'
import { adminAPI, type AuditLog } from '@/api/admin'
import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { OtpInput } from '@/components/arc/otp-input/otp-input'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import DataTable from '@/components/common/DataTable'
import EmptyState from '@/components/common/EmptyState'
import Pagination from '@/components/common/Pagination'
import Select, { type SelectValue } from '@/components/common/Select'
import TablePageLayout from '@/components/common/TablePageLayout'
import type { Column } from '@/components/common/types'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import styles from './AuditLogView.module.css'

interface AuditFilters {
  q: string
  actor_email: string
  action: string
  client_ip: string
  method: string
  auth_method: string
  success: string
}

const EMPTY_FILTERS: AuditFilters = {
  q: '',
  actor_email: '',
  action: '',
  client_ip: '',
  method: '',
  auth_method: '',
  success: ''
}

const TIME_RANGE_MINUTES: Record<string, number> = {
  '30m': 30,
  '1h': 60,
  '6h': 6 * 60,
  '24h': 24 * 60,
  '7d': 7 * 24 * 60,
  '30d': 30 * 24 * 60
}

function formatCustomTimeRangeLabel(startTime: string, endTime: string): string {
  const fmt = (raw: string) => {
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return raw
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  return `${fmt(startTime)} ~ ${fmt(endTime)}`
}

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toRFC3339(local: string): string | undefined {
  if (!local) return undefined
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString()
}

function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

// Helpers
function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

function statusTone(status: number): BadgeTone {
  if (status >= 500) return 'danger'
  if (status >= 400) return 'warning'
  return 'success'
}

const errorText = (err: unknown): string | undefined => (err as { message?: string } | null)?.message || undefined

export default function AuditLogView() {
  const { t } = useI18n()

  const [loading, setLoading] = useState(false)
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPageState] = useState(1)
  const [pageSize, setPageSizeState] = useState(20)
  const [filters, setFiltersState] = useState<AuditFilters>(EMPTY_FILTERS)

  // 时间范围：预设窗口（同 /admin/ops 时间下拉）+ 自定义起止（datetime-local，支持时分）
  const [timeRange, setTimeRangeState] = useState('')
  const [customStartTime, setCustomStartTime] = useState('')
  const [customEndTime, setCustomEndTime] = useState('')
  const [showCustomTimeRangeDialog, setShowCustomTimeRangeDialog] = useState(false)
  const [customStartTimeInput, setCustomStartTimeInput] = useState('')
  const [customEndTimeInput, setCustomEndTimeInput] = useState('')

  // 文本筛选保留原始输入，查询时再 trim（对应 Vue 版 v-model.trim）
  // 查询参数以 ref 保存最新值，保持 Vue 版"修改后立即查询"的同步语义
  const queryRef = useRef({ page: 1, pageSize: 20, filters: EMPTY_FILTERS, timeRange: '', customStartTime: '', customEndTime: '' })

  const setPage = (value: number) => {
    queryRef.current.page = value
    setPageState(value)
  }
  const setPageSize = (value: number) => {
    queryRef.current.pageSize = value
    setPageSizeState(value)
  }
  const setFilters = (next: AuditFilters) => {
    queryRef.current.filters = next
    setFiltersState(next)
  }
  const setFilter = (key: keyof AuditFilters, value: string) => setFilters({ ...queryRef.current.filters, [key]: value })
  const setTimeRange = (value: string) => {
    queryRef.current.timeRange = value
    setTimeRangeState(value)
  }
  const setCustomRange = (start: string, end: string) => {
    queryRef.current.customStartTime = start
    queryRef.current.customEndTime = end
    setCustomStartTime(start)
    setCustomEndTime(end)
  }

  const timeRangeOptions = [
    { value: '', label: t('admin.audit.filters.all') },
    { value: '30m', label: t('admin.ops.timeRange.30m') },
    { value: '1h', label: t('admin.ops.timeRange.1h') },
    { value: '6h', label: t('admin.ops.timeRange.6h') },
    { value: '24h', label: t('admin.ops.timeRange.24h') },
    { value: '7d', label: t('admin.ops.timeRange.7d') },
    { value: '30d', label: t('admin.ops.timeRange.30d') },
    {
      value: 'custom',
      label:
        timeRange === 'custom' && customStartTime && customEndTime
          ? `${t('admin.ops.timeRange.custom')} (${formatCustomTimeRangeLabel(customStartTime, customEndTime)})`
          : t('admin.ops.timeRange.custom')
    }
  ]

  const columns: Column<AuditLog>[] = [
    { key: 'created_at', label: t('admin.audit.columns.time') },
    { key: 'actor', label: t('admin.audit.columns.actor') },
    { key: 'action', label: t('admin.audit.columns.action') },
    { key: 'status_code', label: t('admin.audit.columns.result') },
    { key: 'latency_ms', label: t('admin.audit.detail.latency') },
    { key: 'client_ip', label: t('admin.audit.columns.clientIp') },
    { key: 'actions', label: t('common.actions') }
  ]

  const methodOptions = [
    { value: '', label: t('admin.audit.filters.all') },
    { value: 'POST', label: 'POST' },
    { value: 'PUT', label: 'PUT' },
    { value: 'PATCH', label: 'PATCH' },
    { value: 'DELETE', label: 'DELETE' },
    { value: 'GET', label: 'GET' }
  ]

  const authMethodOptions = [
    { value: '', label: t('admin.audit.filters.all') },
    { value: 'jwt', label: 'JWT' },
    { value: 'admin_api_key', label: 'Admin API Key' }
  ]

  const resultOptions = [
    { value: '', label: t('admin.audit.filters.all') },
    { value: 'true', label: t('admin.audit.filters.resultSuccess') },
    { value: 'false', label: t('admin.audit.filters.resultFailure') }
  ]

  function authMethodLabel(method: string): string {
    const found = authMethodOptions.find((o) => o.value === method)
    return found && found.value ? found.label : method
  }

  function buildTimeRangeQuery(): { start_time?: string; end_time?: string } {
    const current = queryRef.current
    if (current.timeRange === 'custom') {
      return {
        start_time: toRFC3339(current.customStartTime),
        end_time: toRFC3339(current.customEndTime)
      }
    }
    const minutes = TIME_RANGE_MINUTES[current.timeRange]
    if (!minutes) return {}
    return { start_time: new Date(Date.now() - minutes * 60 * 1000).toISOString() }
  }

  function buildQuery() {
    const { page: currentPage, pageSize: currentPageSize, filters: f } = queryRef.current
    return {
      page: currentPage,
      page_size: currentPageSize,
      q: f.q.trim() || undefined,
      actor_email: f.actor_email.trim() || undefined,
      action: f.action.trim() || undefined,
      client_ip: f.client_ip.trim() || undefined,
      method: f.method || undefined,
      auth_method: f.auth_method || undefined,
      success: f.success || undefined,
      ...buildTimeRangeQuery()
    }
  }

  async function fetchLogs() {
    setLoading(true)
    try {
      const res = await adminAPI.audit.list(buildQuery())
      setLogs(res.items)
      setTotal(res.total)
    } catch (err: unknown) {
      useAppStore.getState().showError(errorText(err) || t('admin.audit.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  function search() {
    setPage(1)
    void fetchLogs()
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS)
    setTimeRange('')
    setCustomRange('', '')
    search()
  }

  function onPageChange(p: number) {
    setPage(p)
    void fetchLogs()
  }

  function onPageSizeChange(ps: number) {
    setPageSize(ps)
    setPage(1)
    void fetchLogs()
  }

  function handleTimeRangeChange(val: SelectValue) {
    const value = String(val ?? '')
    if (value === 'custom') {
      // 预填：已有自定义值沿用，否则默认最近1小时（本地时区）
      const now = new Date()
      setCustomStartTimeInput(customStartTime || toDatetimeLocal(new Date(now.getTime() - 60 * 60 * 1000)))
      setCustomEndTimeInput(customEndTime || toDatetimeLocal(now))
      setShowCustomTimeRangeDialog(true)
      return
    }
    setTimeRange(value)
    search()
  }

  function handleCustomTimeRangeConfirm() {
    if (!customStartTimeInput || !customEndTimeInput) return
    setCustomRange(customStartTimeInput, customEndTimeInput)
    setTimeRange('custom')
    setShowCustomTimeRangeDialog(false)
    search()
  }

  function handleCustomTimeRangeCancel() {
    // 未确认不改变当前时间范围；Select 是受控组件，展示值保持不变。
    setShowCustomTimeRangeDialog(false)
  }

  // Detail dialog
  const [detailVisible, setDetailVisible] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detail, setDetail] = useState<AuditLog | null>(null)

  async function openDetail(id: number) {
    setDetailVisible(true)
    setDetailLoading(true)
    setDetail(null)
    try {
      setDetail(await adminAPI.audit.get(id))
    } catch (err: unknown) {
      useAppStore.getState().showError(errorText(err) || t('admin.audit.loadFailed'))
      setDetailVisible(false)
    } finally {
      setDetailLoading(false)
    }
  }

  // Clear-all flow: confirm → TOTP → clear
  const [clearConfirmVisible, setClearConfirmVisible] = useState(false)
  const [clearTotpVisible, setClearTotpVisible] = useState(false)
  const [clearTotpCode, setClearTotpCode] = useState('')
  const [clearing, setClearing] = useState(false)
  const checkingTotpStatus = useRef(false)

  // 与其他敏感操作一致：未启用 2FA 时直接提示去个人资料启用 TOTP，
  // 而不是弹出一个无法完成的验证码输入框（后端会以 TOTP_NOT_SETUP 拒绝）。
  async function openClearDialog() {
    if (checkingTotpStatus.current) return
    checkingTotpStatus.current = true
    try {
      const status = await totpAPI.getStatus()
      if (!status.enabled) {
        useAppStore.getState().showError(t('stepUp.notEnabled'))
        return
      }
    } catch (err: unknown) {
      useAppStore.getState().showError(errorText(err) || t('admin.audit.loadFailed'))
      return
    } finally {
      checkingTotpStatus.current = false
    }
    setClearConfirmVisible(true)
  }

  function onClearConfirmed() {
    setClearConfirmVisible(false)
    setClearTotpCode('')
    setClearTotpVisible(true)
  }

  function cancelClearTotp() {
    if (clearing) return
    setClearTotpVisible(false)
  }

  async function submitClear() {
    const code = clearTotpCode.trim()
    if (code.length !== 6) return
    setClearing(true)
    try {
      const res = await adminAPI.audit.clear(code)
      setClearTotpVisible(false)
      useAppStore.getState().showSuccess(t('admin.audit.clearConfirm.success', { count: res.deleted }))
      search()
    } catch (err: unknown) {
      useAppStore.getState().showError(errorText(err) || t('admin.audit.clearConfirm.failed'))
      setClearTotpCode('')
    } finally {
      setClearing(false)
    }
  }

  const fetchRef = useRef(fetchLogs)
  useLayoutEffect(() => {
    fetchRef.current = fetchLogs
  })
  useEffect(() => {
    void fetchRef.current()
  }, [])

  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') search()
  }

  const statusText = (status: number): string =>
    status < 400 ? t('admin.audit.filters.resultSuccess') : t('admin.audit.filters.resultFailure')

  const selectField = (label: string, control: ReactNode) => (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      {control}
    </div>
  )

  const filterBar = (
    <div className={styles.toolbar}>
      {/* Left: filter fields */}
      <div className={styles.fields}>
        <div className={`${styles.field} ${styles.fieldWide}`}>
          <Input
            label={t('admin.audit.filters.q')}
            type="text"
            value={filters.q}
            placeholder={t('admin.audit.filters.qPlaceholder')}
            onChange={(e) => setFilter('q', e.target.value)}
            onKeyUp={onEnter}
          />
        </div>
        <div className={`${styles.field} ${styles.fieldMedium}`}>
          <Input
            label={t('admin.audit.filters.actorEmail')}
            type="text"
            value={filters.actor_email}
            onChange={(e) => setFilter('actor_email', e.target.value)}
            onKeyUp={onEnter}
          />
        </div>
        <div className={styles.field}>
          <Input
            label={t('admin.audit.filters.action')}
            type="text"
            value={filters.action}
            onChange={(e) => setFilter('action', e.target.value)}
            onKeyUp={onEnter}
          />
        </div>
        <div className={styles.field}>
          <Input
            label={t('admin.audit.filters.clientIp')}
            type="text"
            value={filters.client_ip}
            onChange={(e) => setFilter('client_ip', e.target.value)}
            onKeyUp={onEnter}
          />
        </div>
        {selectField(
          t('admin.audit.filters.method'),
          <Select
            value={filters.method}
            options={methodOptions}
            aria-label={t('admin.audit.filters.method')}
            onChange={(value) => {
              setFilter('method', String(value ?? ''))
              search()
            }}
          />
        )}
        {selectField(
          t('admin.audit.filters.authMethod'),
          <Select
            value={filters.auth_method}
            options={authMethodOptions}
            aria-label={t('admin.audit.filters.authMethod')}
            onChange={(value) => {
              setFilter('auth_method', String(value ?? ''))
              search()
            }}
          />
        )}
        {selectField(
          t('admin.audit.filters.result'),
          <Select
            value={filters.success}
            options={resultOptions}
            aria-label={t('admin.audit.filters.result')}
            onChange={(value) => {
              setFilter('success', String(value ?? ''))
              search()
            }}
          />
        )}
        {selectField(
          t('admin.dashboard.timeRange'),
          <Select value={timeRange} options={timeRangeOptions} aria-label={t('admin.dashboard.timeRange')} onChange={handleTimeRangeChange} />
        )}
      </div>

      {/* Right: actions */}
      <div className={styles.actions}>
        <Button type="button" variant="primary" disabled={loading} onClick={search}>
          <Search size={16} strokeWidth={1.75} aria-hidden="true" />
          {t('common.search')}
        </Button>
        <Button type="button" variant="secondary" disabled={loading} onClick={resetFilters}>
          {t('common.reset')}
        </Button>
        <Button type="button" variant="danger" onClick={() => void openClearDialog()}>
          <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
          {t('admin.audit.clearAll')}
        </Button>
      </div>
    </div>
  )

  const table = (
    <DataTable
      columns={columns}
      data={logs}
      loading={loading}
      rowKey="id"
      cells={{
        created_at: ({ value }) => <span className={styles.time}>{formatTime(value)}</span>,
        actor: ({ row }) => (
          <div className={styles.stackCell}>
            <div className={`${styles.truncate} ${styles.primary}`} title={row.actor_email}>
              {row.actor_email || '—'}
            </div>
            <div className={`${styles.truncate} ${styles.sub}`}>
              {row.actor_role}
              {row.auth_method ? <span> · {authMethodLabel(row.auth_method)}</span> : null}
            </div>
          </div>
        ),
        action: ({ row }) => (
          <div className={`${styles.stackCell} ${styles.actionCell}`}>
            <div className={`${styles.truncate} ${styles.mono}`} title={row.action}>
              {row.action}
            </div>
            <div className={`${styles.truncate} ${styles.mono} ${styles.sub}`} title={`${row.method} ${row.path}`}>
              {row.method} {row.path}
            </div>
          </div>
        ),
        status_code: ({ row }) => (
          <Badge tone={statusTone(row.status_code)} size="sm">
            {String(row.status_code)}
          </Badge>
        ),
        latency_ms: ({ value }) => <span className={styles.latency}>{value} ms</span>,
        client_ip: ({ value }) => <span className={styles.ip}>{value || '—'}</span>,
        actions: ({ row }) => (
          <Button type="button" variant="ghost" size="sm" onClick={() => void openDetail(row.id)}>
            <Eye size={16} strokeWidth={1.75} aria-hidden="true" />
            {t('admin.audit.columns.detail')}
          </Button>
        )
      }}
      empty={
        <EmptyState
          className={styles.empty}
          icon={<ShieldCheck size={24} strokeWidth={1.5} aria-hidden="true" />}
          title={t('admin.audit.empty')}
        />
      }
    />
  )

  const pagination =
    total > 0 ? (
      <Pagination total={total} page={page} pageSize={pageSize} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
    ) : null

  const renderDetail = () => {
    if (detailLoading) {
      return (
        <div className={styles.detailLoading}>
          <Skeleton lines={6} label={t('common.loading')} />
        </div>
      )
    }
    if (!detail) return null
    return (
      <div className={styles.detail}>
        {/* Hero: action + result at a glance */}
        <div className={styles.hero}>
          <div className={styles.heroTitle}>
            <Badge tone={statusTone(detail.status_code)}>{`${detail.status_code} ${statusText(detail.status_code)}`}</Badge>
            <span className={styles.heroAction}>{detail.action}</span>
          </div>

          <div className={styles.requestLine}>
            <span className={styles.method}>{detail.method}</span>
            <span className={styles.path}>{detail.path}</span>
          </div>

          <div className={styles.heroMeta}>
            <span className={styles.metaItem}>
              <Clock size={12} aria-hidden="true" />
              {formatTime(detail.created_at)}
            </span>
            <span>
              {t('admin.audit.detail.latency')} {detail.latency_ms} ms
            </span>
            {detail.request_id ? (
              <span className={styles.metaItem}>
                {t('admin.audit.detail.requestId')}
                <span className={styles.mono}>{detail.request_id}</span>
              </span>
            ) : null}
          </div>
        </div>

        {/* Actor / auth / source */}
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>{t('admin.audit.columns.actor')}</dt>
            <dd className={styles.factValue}>
              {detail.actor_email || '—'}
              <div className={styles.factSub}>{detail.actor_role}</div>
            </dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>{t('admin.audit.filters.authMethod')}</dt>
            <dd className={styles.factValue}>
              {authMethodLabel(detail.auth_method) || '—'}
              {detail.credential_masked ? <div className={`${styles.factSub} ${styles.mono}`}>{detail.credential_masked}</div> : null}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>{t('admin.audit.columns.clientIp')}</dt>
            <dd className={`${styles.factValue} ${styles.mono}`}>{detail.client_ip || '—'}</dd>
          </div>
        </dl>

        {/* User-Agent */}
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>{t('admin.audit.detail.userAgent')}</h4>
          <div className={styles.codeBlock}>{detail.user_agent || '—'}</div>
        </section>

        {/* Request body (redacted) */}
        {detail.request_body ? (
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{t('admin.audit.detail.requestBody')}</h4>
            <pre className={styles.codeBlock}>{prettyBody(detail.request_body)}</pre>
          </section>
        ) : null}

        {/* Extra */}
        {detail.extra && Object.keys(detail.extra).length ? (
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{t('admin.audit.detail.extra')}</h4>
            <pre className={`${styles.codeBlock} ${styles.codeBlockShort}`}>{JSON.stringify(detail.extra, null, 2)}</pre>
          </section>
        ) : null}
      </div>
    )
  }

  return (
    <>
      <TablePageLayout filters={filterBar} table={table} pagination={pagination} />

      {/* Detail dialog */}
      <BaseDialog
        show={detailVisible}
        title={t('admin.audit.detail.title')}
        width="wide"
        closeOnClickOutside
        onClose={() => setDetailVisible(false)}
      >
        {renderDetail()}
      </BaseDialog>

      {/* Custom time range dialog (与 /admin/ops 时间下拉一致的自定义范围，支持时分) */}
      <BaseDialog
        show={showCustomTimeRangeDialog}
        title={t('admin.ops.timeRange.custom')}
        width="narrow"
        onClose={handleCustomTimeRangeCancel}
        footer={
          <div className={styles.dialogFooter}>
            <Button type="button" variant="secondary" onClick={handleCustomTimeRangeCancel}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!customStartTimeInput || !customEndTimeInput}
              onClick={handleCustomTimeRangeConfirm}
            >
              {t('common.confirm')}
            </Button>
          </div>
        }
      >
        <div className={styles.dialogBody}>
          <Input
            label={t('admin.ops.customTimeRange.startTime')}
            type="datetime-local"
            value={customStartTimeInput}
            onChange={(e) => setCustomStartTimeInput(e.target.value)}
          />
          <Input
            label={t('admin.ops.customTimeRange.endTime')}
            type="datetime-local"
            value={customEndTimeInput}
            onChange={(e) => setCustomEndTimeInput(e.target.value)}
          />
        </div>
      </BaseDialog>

      {/* Clear confirmation → step-up TOTP */}
      <ConfirmDialog
        show={clearConfirmVisible}
        title={t('admin.audit.clearConfirm.title')}
        message={t('admin.audit.clearConfirm.message')}
        confirmText={t('admin.audit.clearAll')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={onClearConfirmed}
        onCancel={() => setClearConfirmVisible(false)}
      />

      {/* TOTP prompt for the clear operation */}
      <BaseDialog
        show={clearTotpVisible}
        title={t('admin.audit.clearConfirm.totpTitle')}
        width="narrow"
        zIndex={60}
        onClose={cancelClearTotp}
        footer={
          <div className={styles.dialogFooter}>
            <Button type="button" variant="secondary" disabled={clearing} onClick={cancelClearTotp}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={clearing || clearTotpCode.trim().length !== 6}
              onClick={() => void submitClear()}
            >
              {clearing ? t('common.loading') : t('admin.audit.clearAll')}
            </Button>
          </div>
        }
      >
        <div
          className={styles.dialogBody}
          onKeyUp={(event) => {
            if (event.key === 'Enter') void submitClear()
          }}
        >
          <OtpInput
            label={t('admin.audit.clearConfirm.totpTitle')}
            description={t('admin.audit.clearConfirm.totpHint')}
            value={clearTotpCode}
            onChange={setClearTotpCode}
            autoFocus
            disabled={clearing}
          />
        </div>
      </BaseDialog>
    </>
  )
}
