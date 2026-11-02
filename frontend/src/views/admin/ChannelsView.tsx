/**
 * 渠道管理页，对应 Vue 版 ChannelsView.vue：搜索与状态筛选、服务端排序分页的渠道表格、
 * 行内启停、删除确认，以及创建 / 编辑渠道表单（ChannelFormDrawer）。
 * 页面标题由顶栏显示，这里只渲染工具栏与表格区域。
 */
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { adminAPI } from '@/api/admin'
import type { Channel } from '@/api/admin/channels'
import ChannelFormDrawer from '@/components/admin/channel/ChannelFormDrawer'
import {
  apiToForm,
  distributeRulesToPlatforms,
  emptyChannelForm,
  type ChannelFormState
} from '@/components/admin/channel/channelFormModel'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import DataTable, { type SortOrder } from '@/components/common/DataTable'
import EmptyState from '@/components/common/EmptyState'
import Pagination from '@/components/common/Pagination'
import SearchInput from '@/components/common/SearchInput'
import Select from '@/components/common/Select'
import TablePageLayout from '@/components/common/TablePageLayout'
import Toggle from '@/components/common/Toggle'
import type { Column } from '@/components/common/types'
import { useMountOnce } from '@/composables/useMountOnce'
import { getPersistedPageSize } from '@/composables/usePersistedPageSize'
import { getPlatformCatalog, listPlatformIds, subscribePlatformCatalog } from '@/constants/platformCatalog'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminGroup, GroupPlatform } from '@/types'
import { extractApiErrorMessage } from '@/utils/apiError'
import styles from './ChannelsView.module.css'

interface ListParams {
  page: number
  pageSize: number
  status: string
  search: string
  sortBy: string
  sortOrder: SortOrder
}

// ── Helpers ──
function formatDate(value: string): string {
  if (!value) return '-'
  return new Date(value).toLocaleDateString()
}

const isAbortError = (error: unknown) => {
  const e = error as { name?: string; code?: string }
  return e?.name === 'AbortError' || e?.code === 'ERR_CANCELED'
}

export default function ChannelsView() {
  const { t } = useI18n()
  // 平台清单变化（新平台登记 / 获得定价目录）时重新渲染
  const catalog = useSyncExternalStore(subscribePlatformCatalog, getPlatformCatalog, getPlatformCatalog)
  // 平台清单中的全部具体平台（展示顺序）。
  // eslint-disable-next-line react-hooks/exhaustive-deps -- catalog 是 listPlatformIds 的数据来源
  const platformOrder = useMemo(() => listPlatformIds() as GroupPlatform[], [catalog])
  // Composite pricing/mapping may target every concrete schedulable provider.
  const compositePlatforms = platformOrder

  // ── State ──
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => getPersistedPageSize())
  const [total, setTotal] = useState(0)
  const params = useRef<ListParams>({
    page: 1,
    pageSize,
    status: '',
    search: '',
    sortBy: 'created_at',
    sortOrder: 'desc'
  })
  const abortController = useRef<AbortController | null>(null)

  // Dialog state
  const [showDialog, setShowDialog] = useState(false)
  const [dialogSession, setDialogSession] = useState(0)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [initialForm, setInitialForm] = useState<ChannelFormState>(emptyChannelForm)
  const [initialAccountNames, setInitialAccountNames] = useState<Record<number, string>>({})
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deletingChannel, setDeletingChannel] = useState<Channel | null>(null)

  // Groups
  const [allGroups, setAllGroups] = useState<AdminGroup[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  // All channels for group-conflict detection (independent of current page)
  const [allChannelsForConflict, setAllChannelsForConflict] = useState<Channel[]>([])
  // Web Search global enabled state (loaded once on mount)
  const [webSearchGlobalEnabled, setWebSearchGlobalEnabled] = useState(false)

  const channelsRef = useRef(channels)
  useEffect(() => {
    channelsRef.current = channels
  }, [channels])

  // ── Table columns ──
  const columns: Column<Channel>[] = [
    { key: 'name', label: t('admin.channels.columns.name'), sortable: true },
    { key: 'description', label: t('admin.channels.columns.description'), sortable: false },
    { key: 'status', label: t('admin.channels.columns.status'), sortable: true },
    { key: 'group_count', label: t('admin.channels.columns.groups'), sortable: false },
    { key: 'pricing_count', label: t('admin.channels.columns.pricing'), sortable: false },
    { key: 'created_at', label: t('admin.channels.columns.createdAt'), sortable: true },
    { key: 'actions', label: t('admin.channels.columns.actions'), sortable: false }
  ]

  const statusFilterOptions = [
    { value: '', label: t('admin.channels.allStatus') },
    { value: 'active', label: t('admin.channels.statusActive') },
    { value: 'disabled', label: t('admin.channels.statusDisabled') }
  ]

  // ── Load data ──
  const loadChannels = async () => {
    if (abortController.current) abortController.current.abort()
    const ctrl = new AbortController()
    abortController.current = ctrl
    setLoading(true)
    const p = params.current

    try {
      const response = await adminAPI.channels.list(
        p.page,
        p.pageSize,
        {
          status: p.status || undefined,
          search: p.search || undefined,
          sort_by: p.sortBy,
          sort_order: p.sortOrder
        },
        { signal: ctrl.signal }
      )

      if (ctrl.signal.aborted || abortController.current !== ctrl) return
      setChannels(response.items || [])
      setTotal(response.total)
    } catch (error: unknown) {
      if (isAbortError(error)) return
      useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.channels.loadError')))
    } finally {
      if (abortController.current === ctrl) {
        setLoading(false)
        abortController.current = null
      }
    }
  }

  const loadGroups = async (): Promise<AdminGroup[]> => {
    setGroupsLoading(true)
    try {
      const groups = await adminAPI.groups.getAll()
      setAllGroups(groups)
      return groups
    } catch (error) {
      console.error('Error loading groups:', error)
      return allGroups
    } finally {
      setGroupsLoading(false)
    }
  }

  const loadAllChannelsForConflict = async () => {
    try {
      const response = await adminAPI.channels.list(1, 1000)
      setAllChannelsForConflict(response.items || [])
    } catch {
      // Fallback to current page data
      setAllChannelsForConflict(channelsRef.current)
    }
  }

  const loadWebSearchGlobalState = async () => {
    try {
      const cfg = await adminAPI.settings.getWebSearchEmulationConfig()
      setWebSearchGlobalEnabled(cfg?.enabled === true && (cfg?.providers?.length ?? 0) > 0)
    } catch (err: unknown) {
      console.warn('Failed to load web search global state:', err)
      setWebSearchGlobalEnabled(false)
    }
  }

  // ── Lifecycle ──
  useMountOnce(() => {
    void loadChannels()
    void loadGroups()
    void loadWebSearchGlobalState()
  })
  useEffect(() => () => abortController.current?.abort(), [])

  const handleSearch = (value: string) => {
    params.current.search = value
    params.current.page = 1
    setPage(1)
    void loadChannels()
  }

  const handleStatusChange = (value: string) => {
    setStatusFilter(value)
    params.current.status = value
    void loadChannels()
  }

  const handlePageChange = (next: number) => {
    params.current.page = next
    setPage(next)
    void loadChannels()
  }

  const handlePageSizeChange = (size: number) => {
    params.current.pageSize = size
    params.current.page = 1
    setPageSize(size)
    setPage(1)
    void loadChannels()
  }

  const handleSort = (key: string, order: SortOrder) => {
    params.current.sortBy = key
    params.current.sortOrder = order
    params.current.page = 1
    setPage(1)
    void loadChannels()
  }

  // ── Dialog ──
  const openCreateDialog = async () => {
    setEditingChannel(null)
    setInitialForm(emptyChannelForm())
    setInitialAccountNames({})
    await Promise.all([loadGroups(), loadAllChannelsForConflict()])
    setDialogSession((value) => value + 1)
    setShowDialog(true)
  }

  const openEditDialog = async (channel: Channel) => {
    setEditingChannel(channel)
    // Must load groups first so apiToForm can map groupID → platform
    const [groups] = await Promise.all([loadGroups(), loadAllChannelsForConflict()])
    const sections = apiToForm(channel, groups, platformOrder, compositePlatforms)
    // Distribute channel-level rules into per-platform sections
    const platforms = distributeRulesToPlatforms(sections, channel.account_stats_pricing_rules || [], groups)
    setInitialForm({
      name: channel.name,
      description: channel.description || '',
      status: channel.status,
      restrict_models: channel.restrict_models || false,
      billing_model_source: channel.billing_model_source || 'channel_mapped',
      platforms,
      apply_pricing_to_account_stats: channel.apply_pricing_to_account_stats || false
    })

    // Populate ruleAccountNameCache for existing rule accounts
    setInitialAccountNames(await populateRuleAccountNameCache(platforms))

    setDialogSession((value) => value + 1)
    setShowDialog(true)
  }

  /** Populate ruleAccountNameCache by fetching account details for all account_ids in rules */
  const populateRuleAccountNameCache = async (platforms: ChannelFormState['platforms']) => {
    const cache: Record<number, string> = {}
    const allAccountIds = new Set<number>()
    for (const section of platforms) {
      for (const rule of section.account_stats_pricing_rules) {
        for (const id of rule.account_ids) allAccountIds.add(id)
      }
    }
    if (allAccountIds.size === 0) return cache

    // Fetch account details in parallel (batch of individual getById calls)
    const ids = [...allAccountIds]
    const results = await Promise.allSettled(ids.map((id) => adminAPI.accounts.getById(id)))
    for (let i = 0; i < ids.length; i++) {
      const result = results[i]
      if (result.status === 'fulfilled') {
        cache[ids[i]] = result.value.name
      }
      // If rejected, the cache won't have the name, so it'll show "#ID" which is acceptable
    }
    return cache
  }

  const closeDialog = () => {
    setShowDialog(false)
    setEditingChannel(null)
  }

  // ── Toggle status ──
  const toggleChannelStatus = async (channel: Channel) => {
    const newStatus = channel.status === 'active' ? 'disabled' : 'active'
    try {
      await adminAPI.channels.update(channel.id, { status: newStatus })
      if (params.current.status && params.current.status !== newStatus) {
        // Item no longer matches the active filter — reload list
        await loadChannels()
      } else {
        setChannels((prev) => prev.map((item) => (item.id === channel.id ? { ...item, status: newStatus } : item)))
      }
    } catch (error) {
      useAppStore.getState().showError(t('admin.channels.updateError'))
      console.error('Error toggling channel status:', error)
    }
  }

  // ── Delete ──
  const handleDelete = (channel: Channel) => {
    setDeletingChannel(channel)
    setShowDeleteDialog(true)
  }

  const confirmDelete = async () => {
    if (!deletingChannel) return
    try {
      await adminAPI.channels.remove(deletingChannel.id)
      useAppStore.getState().showSuccess(t('admin.channels.deleteSuccess'))
      setShowDeleteDialog(false)
      setDeletingChannel(null)
      void loadChannels()
    } catch (error: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.channels.deleteError')))
    }
  }

  const createLabel = t('admin.channels.createChannel')

  return (
    <>
      <TablePageLayout
        filters={
          <div className={styles.toolbar}>
            {/* Left: Search + Filters */}
            <div className={styles.filters}>
              <SearchInput
                className={styles.search}
                value={searchQuery}
                placeholder={t('admin.channels.searchChannels')}
                onChange={setSearchQuery}
                onSearch={handleSearch}
              />
              <div className={styles.statusFilter}>
                <Select
                  value={statusFilter}
                  options={statusFilterOptions}
                  placeholder={t('admin.channels.allStatus')}
                  aria-label={t('admin.channels.allStatus')}
                  onChange={(value) => handleStatusChange(String(value ?? ''))}
                />
              </div>
            </div>

            {/* Right: Actions */}
            <div className={styles.actions}>
              <Button
                type="button"
                variant="secondary"
                disabled={loading}
                title={t('common.refresh')}
                aria-label={t('common.refresh')}
                onClick={() => void loadChannels()}
              >
                <RefreshCw size={16} strokeWidth={1.75} className={loading ? styles.spinning : undefined} aria-hidden="true" />
              </Button>
              <Button type="button" variant="primary" onClick={() => void openCreateDialog()}>
                <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
                {createLabel}
              </Button>
            </div>
          </div>
        }
        table={
          <div className={styles.region}>
            <DataTable<Channel>
              columns={columns}
              data={channels}
              loading={loading}
              serverSideSort
              defaultSortKey="created_at"
              defaultSortOrder="desc"
              onSort={handleSort}
              cells={{
                name: ({ value }) => <span className={styles.name}>{value}</span>,
                description: ({ value }) => <span className={styles.muted}>{value || '-'}</span>,
                status: ({ row }) => (
                  <Toggle
                    value={row.status === 'active'}
                    aria-label={`${t('admin.channels.columns.status')} ${row.name}`}
                    onChange={() => void toggleChannelStatus(row)}
                  />
                ),
                group_count: ({ row }) => (
                  <Badge size="sm">{`${(row.group_ids || []).length} ${t('admin.channels.groupsUnit')}`}</Badge>
                ),
                pricing_count: ({ row }) => (
                  <Badge size="sm">{`${(row.model_pricing || []).length} ${t('admin.channels.pricingUnit')}`}</Badge>
                ),
                created_at: ({ value }) => <span className={styles.muted}>{formatDate(value)}</span>,
                actions: ({ row }) => (
                  <div className={styles.rowActions}>
                    <button type="button" className={styles.rowAction} onClick={() => void openEditDialog(row)}>
                      <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                      <span>{t('common.edit')}</span>
                    </button>
                    <button
                      type="button"
                      className={[styles.rowAction, styles.rowActionDanger].join(' ')}
                      onClick={() => handleDelete(row)}
                    >
                      <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                      <span>{t('common.delete')}</span>
                    </button>
                  </div>
                )
              }}
              empty={
                <EmptyState
                  title={t('admin.channels.noChannelsYet')}
                  description={t('admin.channels.createFirstChannel')}
                  actionText={createLabel}
                  onAction={() => void openCreateDialog()}
                />
              }
            />
          </div>
        }
        pagination={
          total > 0 ? (
            <Pagination
              page={page}
              total={total}
              pageSize={pageSize}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          ) : null
        }
      />

      {/* Create/Edit Drawer */}
      <ChannelFormDrawer
        key={dialogSession}
        show={showDialog}
        editingChannel={editingChannel}
        initialForm={initialForm}
        initialAccountNames={initialAccountNames}
        platformOrder={platformOrder}
        allGroups={allGroups}
        groupsLoading={groupsLoading}
        allChannelsForConflict={allChannelsForConflict}
        webSearchGlobalEnabled={webSearchGlobalEnabled}
        onClose={closeDialog}
        onSaved={() => {
          closeDialog()
          void loadChannels()
        }}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        show={showDeleteDialog}
        title={t('admin.channels.deleteChannel')}
        message={t('admin.channels.deleteConfirm', { name: deletingChannel?.name || '' })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setShowDeleteDialog(false)}
      />
    </>
  )
}
