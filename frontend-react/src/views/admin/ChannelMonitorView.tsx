/**
 * 渠道监控管理页，对应 Vue 版 ChannelMonitorView.vue。
 * 两个页签：V2 设置（MonitorSettingsPanel）与 V1 监控列表（V1 模式下为当前生效，否则为历史数据）。
 * V1 列表：筛选工具栏、监控表格（立即检测、复制、编辑、删除、启停）、表单抽屉、模板管理与检测结果对话框。
 * 页面标题由顶栏显示，这里只保留说明与页签。
 */
import { AlertTriangle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import type { ChannelMonitor, CheckResult, ListParams, Provider } from '@/api/admin/channelMonitor'
import MonitorActionsCell from '@/components/admin/monitor/MonitorActionsCell'
import MonitorFiltersBar, { type MonitorEnabledFilter } from '@/components/admin/monitor/MonitorFiltersBar'
import MonitorFormDialog from '@/components/admin/monitor/MonitorFormDialog'
import MonitorPrimaryModelCell from '@/components/admin/monitor/MonitorPrimaryModelCell'
import MonitorRunResultDialog from '@/components/admin/monitor/MonitorRunResultDialog'
import MonitorTemplateManagerDialog from '@/components/admin/monitor/MonitorTemplateManagerDialog'
import { platformTone } from '@/components/admin/channel/platformTone'
import { Badge } from '@/components/arc/badge/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import DataTable from '@/components/common/DataTable'
import EmptyState from '@/components/common/EmptyState'
import HelpTooltip from '@/components/common/HelpTooltip'
import Pagination from '@/components/common/Pagination'
import TablePageLayout from '@/components/common/TablePageLayout'
import Toggle from '@/components/common/Toggle'
import type { Column } from '@/components/common/types'
import { useChannelMonitorFormat } from '@/composables/useChannelMonitorFormat'
import { getPersistedPageSize } from '@/composables/usePersistedPageSize'
import MonitorSettingsPanel from '@/features/channel-monitor-v2/MonitorSettingsPanel'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { extractApiErrorMessage } from '@/utils/apiError'
import { isChannelMonitorV1Mode } from '@/utils/featureFlags'
import styles from './ChannelMonitorView.module.css'

type AdminMonitorTab = 'v2' | 'legacy'

const isAbortError = (error: unknown) => {
  const e = error as { name?: string; code?: string }
  return e?.name === 'AbortError' || e?.code === 'ERR_CANCELED'
}

export default function ChannelMonitorView() {
  const { t } = useI18n()
  const isV1Mode = isChannelMonitorV1Mode()
  const [adminMonitorTab, setAdminMonitorTab] = useState<AdminMonitorTab>(() => (isChannelMonitorV1Mode() ? 'legacy' : 'v2'))
  const { providerLabel, checkModeLabel, checkModeTone, formatLatency, formatAvailability } = useChannelMonitorFormat()

  const [monitors, setMonitors] = useState<ChannelMonitor[]>([])
  const [loading, setLoading] = useState(false)
  const [runningId, setRunningId] = useState<number | null>(null)
  const runningRef = useRef<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [providerFilter, setProviderFilter] = useState<Provider | ''>('')
  const [enabledFilter, setEnabledFilter] = useState<MonitorEnabledFilter>('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => getPersistedPageSize())
  const [total, setTotal] = useState(0)
  // 请求参数镜像：处理函数内同步更新后立即发请求（Vue 版 reactive 对象）
  const params = useRef({ page: 1, pageSize, search: '', provider: '' as Provider | '', enabled: '' as MonitorEnabledFilter })

  const [showDialog, setShowDialog] = useState(false)
  const [showTemplateManager, setShowTemplateManager] = useState(false)
  const [editing, setEditing] = useState<ChannelMonitor | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleting, setDeleting] = useState<ChannelMonitor | null>(null)
  const [showRunResult, setShowRunResult] = useState(false)
  const [runResults, setRunResults] = useState<CheckResult[]>([])
  const [duplicatingIds, setDuplicatingIds] = useState<ReadonlySet<number>>(() => new Set())
  const duplicatingRef = useRef(new Set<number>())

  const abortController = useRef<AbortController | null>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const columns: Column<ChannelMonitor>[] = [
    { key: 'name', label: t('admin.channelMonitor.columns.name'), sortable: false },
    { key: 'provider', label: t('admin.channelMonitor.columns.provider'), sortable: false },
    { key: 'primary_model', label: t('admin.channelMonitor.columns.primaryModel'), sortable: false },
    { key: 'availability_7d', label: t('admin.channelMonitor.columns.availability7d'), sortable: false },
    { key: 'latency', label: t('admin.channelMonitor.columns.latency'), sortable: false },
    { key: 'enabled', label: t('admin.channelMonitor.columns.enabled'), sortable: false },
    { key: 'actions', label: t('admin.channelMonitor.columns.actions'), sortable: false }
  ]

  const reload = async () => {
    if (abortController.current) abortController.current.abort()
    const ctrl = new AbortController()
    abortController.current = ctrl
    setLoading(true)
    try {
      const p = params.current
      const query: ListParams = { page: p.page, page_size: p.pageSize }
      if (p.provider) query.provider = p.provider
      if (p.enabled === 'true') query.enabled = true
      if (p.enabled === 'false') query.enabled = false
      if (p.search.trim()) query.search = p.search.trim()

      const res = await adminAPI.channelMonitor.list(query, { signal: ctrl.signal })
      if (ctrl.signal.aborted || abortController.current !== ctrl) return
      setMonitors(res.items || [])
      setTotal(res.total)
    } catch (err: unknown) {
      if (isAbortError(err)) return
      useAppStore.getState().showError(extractApiErrorMessage(err, t('admin.channelMonitor.loadError')))
    } finally {
      if (abortController.current === ctrl) {
        setLoading(false)
        abortController.current = null
      }
    }
  }

  const handleSearch = () => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      params.current.page = 1
      setPage(1)
      void reload()
    }, 300)
  }

  const onPageChange = (next: number) => {
    params.current.page = next
    setPage(next)
    void reload()
  }

  const onPageSizeChange = (size: number) => {
    params.current.pageSize = size
    params.current.page = 1
    setPageSize(size)
    setPage(1)
    void reload()
  }

  const openCreateDialog = () => {
    setEditing(null)
    setShowDialog(true)
  }

  const openEditDialog = (row: ChannelMonitor) => {
    setEditing(row)
    setShowDialog(true)
  }

  const closeDialog = () => {
    setShowDialog(false)
    setEditing(null)
  }

  const toggleEnabled = async (row: ChannelMonitor) => {
    const next = !row.enabled
    try {
      await adminAPI.channelMonitor.update(row.id, { enabled: next })
      setMonitors((prev) => prev.map((item) => (item.id === row.id ? { ...item, enabled: next } : item)))
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    }
  }

  const handleRunNow = async (row: ChannelMonitor) => {
    if (!isV1Mode) {
      useAppStore.getState().showError(t('admin.channelMonitor.runFailed'))
      return
    }
    if (runningRef.current != null) return
    runningRef.current = row.id
    setRunningId(row.id)
    try {
      const res = await adminAPI.channelMonitor.runNow(row.id)
      setRunResults(res.results || [])
      setShowRunResult(true)
      useAppStore.getState().showSuccess(t('admin.channelMonitor.runSuccess'))
      // Refresh row to get latest status from backend
      void reload()
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('admin.channelMonitor.runFailed')))
    } finally {
      runningRef.current = null
      setRunningId(null)
    }
  }

  const setDuplicating = (id: number, active: boolean) => {
    if (active) duplicatingRef.current.add(id)
    else duplicatingRef.current.delete(id)
    setDuplicatingIds(new Set(duplicatingRef.current))
  }

  const handleDuplicate = async (row: ChannelMonitor) => {
    if (row.api_key_decrypt_failed) {
      useAppStore.getState().showError(t('admin.channelMonitor.duplicateKeyUnavailable'))
      return
    }
    if (duplicatingRef.current.has(row.id)) return

    setDuplicating(row.id, true)
    try {
      const duplicate = await adminAPI.channelMonitor.duplicate(row.id)
      useAppStore.getState().showSuccess(t('admin.channelMonitor.duplicateSuccess', { name: duplicate.name }))
      await reload()
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('admin.channelMonitor.duplicateFailed')))
    } finally {
      setDuplicating(row.id, false)
    }
  }

  const handleDelete = (row: ChannelMonitor) => {
    setDeleting(row)
    setShowDeleteDialog(true)
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await adminAPI.channelMonitor.del(deleting.id)
      useAppStore.getState().showSuccess(t('admin.channelMonitor.deleteSuccess'))
      setShowDeleteDialog(false)
      setDeleting(null)
      void reload()
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    }
  }

  // 切到 V1 列表且尚无数据时加载（含首次挂载即为 legacy 的情况）
  const monitorsLoaded = useRef(false)
  useEffect(() => {
    monitorsLoaded.current = monitors.length > 0
  }, [monitors])
  useEffect(() => {
    if (adminMonitorTab === 'legacy' && !monitorsLoaded.current) void reload()
  }, [adminMonitorTab]) // eslint-disable-line react-hooks/exhaustive-deps -- 只随页签切换（Vue 版 watch + onMounted）

  useEffect(
    () => () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current)
      abortController.current?.abort()
    },
    []
  )

  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <p className={styles.description}>
          {isV1Mode ? t('channelMonitorV2.admin.descriptionV1') : t('channelMonitorV2.admin.descriptionV2')}
        </p>
        <Tabs value={adminMonitorTab} onValueChange={(value) => setAdminMonitorTab(value as AdminMonitorTab)}>
          <TabsList aria-label={t('channelMonitorV2.admin.tabAria')}>
            <TabsTrigger value="v2">{t('channelMonitorV2.admin.tabV2')}</TabsTrigger>
            <TabsTrigger value="legacy">
              {isV1Mode ? t('channelMonitorV2.admin.tabV1Active') : t('channelMonitorV2.admin.tabV1History')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {adminMonitorTab === 'v2' ? (
        <MonitorSettingsPanel />
      ) : (
        <TablePageLayout
          filters={
            <MonitorFiltersBar
              loading={loading}
              search={searchQuery}
              onSearchChange={(value) => {
                setSearchQuery(value)
                params.current.search = value
              }}
              provider={providerFilter}
              onProviderChange={(value) => {
                setProviderFilter(value)
                params.current.provider = value
              }}
              enabled={enabledFilter}
              onEnabledChange={(value) => {
                setEnabledFilter(value)
                params.current.enabled = value
              }}
              onReload={() => void reload()}
              onCreate={openCreateDialog}
              onManageTemplates={() => setShowTemplateManager(true)}
              onSearchInput={handleSearch}
            />
          }
          table={
            <div className={styles.region}>
              <DataTable<ChannelMonitor>
                columns={columns}
                data={monitors}
                loading={loading}
                cells={{
                  name: ({ row, value }) => (
                    <div className={styles.nameCell}>
                      <span className={styles.name}>{value}</span>
                      {row.api_key_decrypt_failed ? (
                        <HelpTooltip
                          content={t('admin.channelMonitor.apiKeyDecryptFailed')}
                          triggerContent={<AlertTriangle size={14} strokeWidth={1.75} className={styles.danger} aria-hidden="true" />}
                        />
                      ) : null}
                    </div>
                  ),
                  provider: ({ row }) => (
                    <div className={styles.badges}>
                      <span {...platformTone(row.provider, 'tag', styles.providerBadge)}>{providerLabel(row.provider)}</span>
                      {/* 三种检测模式并列展示，quota 系配额数据源与纯探活一眼可分 */}
                      <span data-check-mode={row.check_mode} data-tone={checkModeTone(row.check_mode)}>
                        <Badge size="sm" tone={checkModeTone(row.check_mode)}>
                          {checkModeLabel(row.check_mode)}
                        </Badge>
                      </span>
                    </div>
                  ),
                  primary_model: ({ row }) => <MonitorPrimaryModelCell row={row} />,
                  availability_7d: ({ row }) => <span className={styles.value}>{formatAvailability(row)}</span>,
                  latency: ({ row }) => <span className={styles.value}>{formatLatency(row.primary_latency_ms)}</span>,
                  enabled: ({ row }) => (
                    <Toggle
                      value={row.enabled}
                      aria-label={`${t('admin.channelMonitor.columns.enabled')} ${row.name}`}
                      onChange={() => void toggleEnabled(row)}
                    />
                  ),
                  actions: ({ row }) => (
                    <MonitorActionsCell
                      row={row}
                      running={runningId === row.id}
                      duplicating={duplicatingIds.has(row.id)}
                      onRun={(item) => void handleRunNow(item)}
                      onDuplicate={(item) => void handleDuplicate(item)}
                      onEdit={openEditDialog}
                      onDelete={handleDelete}
                    />
                  )
                }}
                empty={
                  <EmptyState
                    title={t('admin.channelMonitor.noMonitorsYet')}
                    description={t('admin.channelMonitor.createFirstMonitor')}
                    actionText={t('admin.channelMonitor.createButton')}
                    onAction={openCreateDialog}
                  />
                }
              />
            </div>
          }
          pagination={
            total > 0 ? (
              <Pagination page={page} total={total} pageSize={pageSize} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
            ) : null
          }
        />
      )}

      <MonitorFormDialog show={showDialog} monitor={editing} onClose={closeDialog} onSaved={() => void reload()} />

      <MonitorTemplateManagerDialog show={showTemplateManager} onClose={() => setShowTemplateManager(false)} onUpdated={() => void reload()} />

      <MonitorRunResultDialog show={showRunResult} results={runResults} onClose={() => setShowRunResult(false)} />

      <ConfirmDialog
        show={showDeleteDialog}
        title={t('common.delete')}
        message={t('admin.channelMonitor.deleteConfirm', { name: deleting?.name || '' })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setShowDeleteDialog(false)}
      />
    </div>
  )
}
