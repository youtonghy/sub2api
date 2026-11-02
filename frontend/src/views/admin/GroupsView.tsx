/**
 * 分组管理页，对应 Vue 版 views/admin/GroupsView.vue。
 *
 * 与 Vue 版行为一致：服务端排序与分页、列显隐（含一次性迁移，id 列默认隐藏）、按需拉取用量与容量汇总、
 * 创建 / 编辑（共用一个右侧宽抽屉）、复制、删除、排序、全平台模型路由、专属倍率与 RPM 覆盖。
 * 简易模式下隐藏高级列、专属筛选、复制 / 路由 / 倍率 / RPM 操作，且不请求高级接口。
 *
 * 实现说明：Vue 版在异步流程中随时读取最新的响应式值；这里把列表查询条件放在 live ref 中
 * （每次渲染后同步，本地写入时立即更新），loadGroups 等异步流程始终读取最新状态。
 */
import {
  ArrowLeftRight,
  ArrowUpDown,
  Check,
  Columns3,
  Copy,
  DollarSign,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Zap
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { adminAPI } from '@/api/admin'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { useDrawerItem } from '@/components/arc/drawer/drawer'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover'
import GroupCompositeRoutesModal from '@/components/admin/group/GroupCompositeRoutesModal'
import GroupFormDrawer from '@/components/admin/group/GroupFormDrawer'
import {
  buildCreateGroupPayload,
  buildUpdateGroupPayload,
  type GroupFormState
} from '@/components/admin/group/groupForm'
import GroupRateMultipliersModal from '@/components/admin/group/GroupRateMultipliersModal'
import GroupRPMOverridesModal from '@/components/admin/group/GroupRPMOverridesModal'
import GroupSortOrderModal from '@/components/admin/group/GroupSortOrderModal'
import { useGroupForm, type GroupFormController } from '@/components/admin/group/useGroupForm'
import { validateReasoningEffortMultipliers, type PricingFormEntry } from '@/components/admin/channel/types'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import DataTable, { type DataTableCellContext } from '@/components/common/DataTable'
import EmptyState from '@/components/common/EmptyState'
import GroupCapacityBadge from '@/components/common/GroupCapacityBadge'
import Pagination from '@/components/common/Pagination'
import PlatformIcon from '@/components/common/PlatformIcon'
import SearchInput from '@/components/common/SearchInput'
import Select from '@/components/common/Select'
import TablePageLayout from '@/components/common/TablePageLayout'
import type { Column } from '@/components/common/types'
import { getPersistedPageSize } from '@/composables/usePersistedPageSize'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { useOnboardingStore } from '@/stores/onboarding'
import type { AdminGroup } from '@/types'
import { extractApiErrorMessage } from '@/utils/apiError'
import { selectedModelAllowlistCount } from './groupModelAllowlist'
import { validateProfitControlFormState } from './groupsProfitControl'
import { supportsReasoningEffortPolicyPlatform } from './groupsReasoningEffort'
import styles from './GroupsView.module.css'

const ALWAYS_VISIBLE_COLUMNS = new Set(['name', 'actions'])
// Default hidden columns (hidden on first load / after schema bumps).
const DEFAULT_HIDDEN_COLUMNS = ['id']
const HIDDEN_COLUMNS_KEY = 'group-hidden-columns'
// Bump when adding new default-hidden columns so existing admins pick them up once.
const COLUMN_SETTINGS_VERSION_KEY = 'group-column-settings-version'
const COLUMN_SETTINGS_VERSION = 2
const VERSION_NEW_HIDDEN_COLUMNS: Record<number, string[]> = {
  2: ['id']
}

const BASIC_COLUMN_KEYS = ['name', 'id', 'platform', 'account_count', 'status', 'actions']
const FULL_COLUMN_KEYS = [
  'name',
  'id',
  'platform',
  'billing_type',
  'rate_multiplier',
  'is_exclusive',
  'account_count',
  'capacity',
  'usage',
  'status',
  'actions'
]

const columnKeysFor = (isSimpleMode: boolean) => (isSimpleMode ? BASIC_COLUMN_KEYS : FULL_COLUMN_KEYS)
const toggleableKeysFor = (isSimpleMode: boolean) =>
  new Set(columnKeysFor(isSimpleMode).filter((key) => !ALWAYS_VISIBLE_COLUMNS.has(key)))

const saveColumnsToStorage = (hidden: Set<string>, validKeys: Set<string>) => {
  try {
    const keys = [...hidden].filter((key) => validKeys.has(key))
    localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(keys))
    localStorage.setItem(COLUMN_SETTINGS_VERSION_KEY, String(COLUMN_SETTINGS_VERSION))
  } catch (error) {
    console.error('Failed to save group column settings:', error)
  }
}

const loadSavedColumns = (isSimpleMode: boolean): Set<string> => {
  const hidden = new Set<string>()
  try {
    const saved = localStorage.getItem(HIDDEN_COLUMNS_KEY)
    const validKeys = toggleableKeysFor(isSimpleMode)

    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) {
        parsed
          .filter((key): key is string => typeof key === 'string' && validKeys.has(key))
          .forEach((key) => hidden.add(key))
      }

      // Existing admins: auto-hide columns newly added as default-hidden.
      const storedVersion = Number(localStorage.getItem(COLUMN_SETTINGS_VERSION_KEY) ?? '1')
      if (storedVersion < COLUMN_SETTINGS_VERSION) {
        let mutated = false
        for (let v = storedVersion + 1; v <= COLUMN_SETTINGS_VERSION; v++) {
          for (const key of VERSION_NEW_HIDDEN_COLUMNS[v] ?? []) {
            if (validKeys.has(key) && !hidden.has(key)) {
              hidden.add(key)
              mutated = true
            }
          }
        }
        if (mutated) {
          saveColumnsToStorage(hidden, validKeys)
        } else {
          localStorage.setItem(COLUMN_SETTINGS_VERSION_KEY, String(COLUMN_SETTINGS_VERSION))
        }
      }
    } else {
      DEFAULT_HIDDEN_COLUMNS.forEach((key) => {
        if (validKeys.has(key)) hidden.add(key)
      })
      saveColumnsToStorage(hidden, validKeys)
    }
  } catch (error) {
    console.error('Failed to load group column settings:', error)
    DEFAULT_HIDDEN_COLUMNS.forEach((key) => hidden.add(key))
  }
  return hidden
}

type GroupUsageSummary = {
  today_cost: number
  yesterday_cost: number
  total_cost: number
}

type GroupCapacitySummary = {
  concurrencyUsed: number
  concurrencyMax: number
  sessionsUsed: number
  sessionsMax: number
  rpmUsed: number
  rpmMax: number
}

const formatCost = (cost: number): string => {
  if (cost >= 1000) return cost.toFixed(0)
  if (cost >= 100) return cost.toFixed(1)
  return cost.toFixed(2)
}

const formatUsd = (cost: number | null | undefined): string => `$${formatCost(cost ?? 0)}`

const quotaUsageTone = (used: number, limit: number | null | undefined): 'normal' | 'warning' | 'danger' => {
  if (!limit || limit <= 0) return 'normal'
  const ratio = used / limit
  if (ratio >= 1) return 'danger'
  if (ratio >= 0.8) return 'warning'
  return 'normal'
}

const iconProps = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

export default function GroupsView() {
  const { t } = useI18n()
  const isSimpleMode = useAuthStore((s) => s.isSimpleMode)

  const [groups, setGroups] = useState<AdminGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [usageMap, setUsageMap] = useState<Map<number, GroupUsageSummary>>(() => new Map())
  const [usageLoading, setUsageLoading] = useState(false)
  const [capacityMap, setCapacityMap] = useState<Map<number, GroupCapacitySummary>>(() => new Map())
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [exclusiveFilter, setExclusiveFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => getPersistedPageSize())
  const [total, setTotal] = useState(0)
  const [sortState, setSortState] = useState<{ sort_by: string; sort_order: 'asc' | 'desc' }>({
    sort_by: 'sort_order',
    sort_order: 'asc'
  })
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => loadSavedColumns(isSimpleMode))
  const [showColumnDropdown, setShowColumnDropdown] = useState(false)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<AdminGroup | null>(null)
  // 抽屉展示用：关闭后保留最后一个分组，表单在滑出动画结束前不消失（提交仍以 editingGroup 为准）
  const drawerEditingGroup = useDrawerItem(editingGroup) ?? null
  const [submitting, setSubmitting] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deletingGroup, setDeletingGroup] = useState<AdminGroup | null>(null)
  const [pendingLiveForm, setPendingLiveForm] = useState<'create' | 'edit' | null>(null)
  const [duplicatingGroupIds, setDuplicatingGroupIds] = useState<Set<number>>(() => new Set())
  const duplicatingRef = useRef(new Set<number>())
  const [showSortModal, setShowSortModal] = useState(false)
  const [sortableGroups, setSortableGroups] = useState<AdminGroup[]>([])
  const [compositeRoutesGroup, setCompositeRoutesGroup] = useState<AdminGroup | null>(null)
  const [showCompositeRoutesModal, setShowCompositeRoutesModal] = useState(false)
  const [rateMultipliersGroup, setRateMultipliersGroup] = useState<AdminGroup | null>(null)
  const [showRateMultipliersModal, setShowRateMultipliersModal] = useState(false)
  const [rpmOverridesGroup, setRpmOverridesGroup] = useState<AdminGroup | null>(null)
  const [showRPMOverridesModal, setShowRPMOverridesModal] = useState(false)

  const createCtl = useGroupForm({ mode: 'create', isSimpleMode })
  const editCtl = useGroupForm({ mode: 'edit', isSimpleMode })

  const liveCapability = useRef<{ supported: boolean; reason?: string } | null>(null)
  const liveCapabilityRequest = useRef<Promise<{ supported: boolean; reason?: string }> | null>(null)
  const abortController = useRef<AbortController | null>(null)

  // 异步流程读取的最新查询条件
  const live = useRef({
    page,
    pageSize,
    searchQuery,
    statusFilter,
    exclusiveFilter,
    sortState,
    hiddenColumns,
    isSimpleMode,
    editingGroup
  })
  useEffect(() => {
    live.current = {
      page,
      pageSize,
      searchQuery,
      statusFilter,
      exclusiveFilter,
      sortState,
      hiddenColumns,
      isSimpleMode,
      editingGroup
    }
  })

  const columnLabels: Record<string, string> = {
    name: t('admin.groups.columns.name'),
    id: t('admin.groups.columns.id'),
    platform: t('admin.groups.columns.platform'),
    billing_type: t('admin.groups.columns.billingType'),
    rate_multiplier: t('admin.groups.columns.rateMultiplier'),
    is_exclusive: t('admin.groups.columns.type'),
    account_count: t('admin.groups.columns.accounts'),
    capacity: t('admin.groups.columns.capacity'),
    usage: t('admin.groups.columns.usage'),
    status: t('admin.groups.columns.status'),
    actions: t('admin.groups.columns.actions')
  }
  const unsortableColumns = new Set(['capacity', 'usage', 'actions'])
  const allColumns: Column[] = columnKeysFor(isSimpleMode).map((key) => ({
    key,
    label: columnLabels[key],
    sortable: !unsortableColumns.has(key)
  }))
  const toggleableColumns = allColumns.filter((col) => !ALWAYS_VISIBLE_COLUMNS.has(col.key))
  const columns = allColumns.filter((col) => ALWAYS_VISIBLE_COLUMNS.has(col.key) || !hiddenColumns.has(col.key))
  const isColumnVisible = (key: string) => !hiddenColumns.has(key)

  const hasVisibleUsageSummaryConsumer = () => {
    const s = live.current
    return !s.isSimpleMode && (!s.hiddenColumns.has('usage') || !s.hiddenColumns.has('billing_type'))
  }
  const hasVisibleCapacityColumn = () => !live.current.isSimpleMode && !live.current.hiddenColumns.has('capacity')

  const loadUsageSummary = async () => {
    if (!hasVisibleUsageSummaryConsumer()) {
      setUsageLoading(false)
      return
    }
    setUsageLoading(true)
    try {
      const data = await adminAPI.groups.getUsageSummary()
      const map = new Map<number, GroupUsageSummary>()
      for (const item of data) {
        map.set(item.group_id, {
          today_cost: item.today_cost,
          yesterday_cost: item.yesterday_cost,
          total_cost: item.total_cost
        })
      }
      setUsageMap(map)
    } catch (error) {
      console.error('Error loading group usage summary:', error)
    } finally {
      setUsageLoading(false)
    }
  }

  const loadCapacitySummary = async () => {
    if (!hasVisibleCapacityColumn()) return
    try {
      const data = await adminAPI.groups.getCapacitySummary()
      const map = new Map<number, GroupCapacitySummary>()
      for (const item of data) {
        map.set(item.group_id, {
          concurrencyUsed: item.concurrency_used,
          concurrencyMax: item.concurrency_max,
          sessionsUsed: item.sessions_used,
          sessionsMax: item.sessions_max,
          rpmUsed: item.rpm_used,
          rpmMax: item.rpm_max
        })
      }
      setCapacityMap(map)
    } catch (error) {
      console.error('Error loading group capacity summary:', error)
    }
  }

  const loadGroups = async () => {
    abortController.current?.abort()
    const currentController = new AbortController()
    abortController.current = currentController
    const { signal } = currentController
    const s = live.current
    setLoading(true)
    try {
      const response = await adminAPI.groups.list(
        s.page,
        s.pageSize,
        {
          platform: undefined,
          status: (s.statusFilter || undefined) as 'active' | 'inactive' | undefined,
          is_exclusive: !s.isSimpleMode && s.exclusiveFilter ? s.exclusiveFilter === 'true' : undefined,
          search: s.searchQuery.trim() || undefined,
          sort_by: s.sortState.sort_by,
          sort_order: s.sortState.sort_order
        },
        { signal }
      )
      if (signal.aborted) return
      setGroups(response.items)
      setTotal(response.total)
      if (hasVisibleUsageSummaryConsumer()) {
        void loadUsageSummary()
      } else {
        setUsageLoading(false)
      }
      if (hasVisibleCapacityColumn()) {
        void loadCapacitySummary()
      }
    } catch (error: any) {
      if (signal.aborted || error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') {
        return
      }
      useAppStore.getState().showError(t('admin.groups.failedToLoad'))
      console.error('Error loading groups:', error)
    } finally {
      if (abortController.current === currentController && !signal.aborted) {
        setLoading(false)
      }
    }
  }

  const loadLiveCapability = async () => {
    if (liveCapability.current) return liveCapability.current
    if (!liveCapabilityRequest.current) {
      liveCapabilityRequest.current = adminAPI.groups
        .getLiveCapability()
        .catch(() => ({ supported: false }))
        .finally(() => {
          liveCapabilityRequest.current = null
        })
    }
    liveCapability.current = await liveCapabilityRequest.current
    return liveCapability.current ?? { supported: false }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时加载列表（Vue 版 onMounted）
    void loadGroups()
    if (!isSimpleMode) {
      void loadLiveCapability()
      void createCtl.loadAllowlistCandidates(0, createCtl.getLatest().form.platform)
    }
    return () => abortController.current?.abort()
    // 仅挂载时执行（Vue 版 onMounted）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ===== 列显隐 =====
  const toggleColumn = (key: string) => {
    const validKeys = toggleableKeysFor(isSimpleMode)
    if (!validKeys.has(key)) return

    const wasHidden = hiddenColumns.has(key)
    const next = new Set(hiddenColumns)
    if (wasHidden) next.delete(key)
    else next.add(key)
    live.current.hiddenColumns = next
    setHiddenColumns(next)
    saveColumnsToStorage(next, validKeys)

    if (wasHidden && (key === 'usage' || key === 'billing_type')) {
      void loadUsageSummary()
    }
    if (wasHidden && key === 'capacity') {
      void loadCapacitySummary()
    }
  }

  // ===== 筛选、分页、排序 =====
  const handleSearch = () => {
    live.current.page = 1
    setPage(1)
    void loadGroups()
  }

  const handlePageChange = (next: number) => {
    live.current.page = next
    setPage(next)
    void loadGroups()
  }

  const handlePageSizeChange = (size: number) => {
    live.current.pageSize = size
    live.current.page = 1
    setPageSize(size)
    setPage(1)
    void loadGroups()
  }

  const handleSort = (key: string, order: 'asc' | 'desc') => {
    const next = { sort_by: key, sort_order: order }
    live.current.sortState = next
    live.current.page = 1
    setSortState(next)
    setPage(1)
    void loadGroups()
  }

  // ===== 选项 =====
  const statusOptions = [
    { value: '', label: t('admin.groups.allStatus') },
    { value: 'active', label: t('admin.accounts.status.active') },
    { value: 'inactive', label: t('admin.accounts.status.inactive') }
  ]
  const exclusiveOptions = [
    { value: '', label: t('admin.groups.allGroups') },
    { value: 'true', label: t('admin.groups.exclusive') },
    { value: 'false', label: t('admin.groups.nonExclusive') }
  ]
  const editStatusOptions = [
    { value: 'active', label: t('admin.accounts.status.active') },
    { value: 'inactive', label: t('admin.accounts.status.inactive') }
  ]
  const subscriptionTypeOptions = [
    { value: 'standard', label: t('admin.groups.subscription.standard') },
    { value: 'subscription', label: t('admin.groups.subscription.subscription') }
  ]

  // 降级分组选项 - 全平台分组：兜底不再限制平台，只受 claude_code_only 与状态约束；编辑时排除自身
  const fallbackGroupOptionsFor = (excludeId?: number) => [
    { value: null, label: t('admin.groups.claudeCode.noFallback') },
    ...groups
      .filter((g) => !g.claude_code_only && g.status === 'active' && g.id !== excludeId)
      .map((g) => ({ value: g.id, label: g.name }))
  ]

  // 无效请求兜底分组选项 - 非订阅且未配置兜底的分组；编辑时排除自身
  const invalidRequestFallbackOptionsFor = (excludeId?: number) => [
    { value: null, label: t('admin.groups.invalidRequestFallback.noFallback') },
    ...groups
      .filter(
        (g) =>
          g.status === 'active' &&
          g.subscription_type !== 'subscription' &&
          g.fallback_group_id_on_invalid_request === null &&
          g.id !== excludeId
      )
      .map((g) => ({ value: g.id, label: g.name }))
  ]

  // 全平台分组：任意分组都可作为复制来源，不再比较平台；编辑时排除自身
  const copyAccountsGroupOptionsFor = (excludeId?: number) =>
    groups
      .filter((g) => (g.account_count || 0) > 0 && g.id !== excludeId)
      .map((g) => ({
        value: g.id,
        label: `${g.name} (${t('admin.groups.accountsCount', { count: g.account_count || 0 })})`
      }))

  // ===== Live 开关 =====
  const toggleLive = async (target: 'create' | 'edit') => {
    const ctl = target === 'create' ? createCtl : editCtl
    if (ctl.getLatest().form.allow_live) {
      ctl.update({ allow_live: false })
      return
    }
    const capability = await loadLiveCapability()
    if (capability.supported) {
      ctl.update({ allow_live: true })
      return
    }
    setPendingLiveForm(target)
  }

  const confirmUnsupportedLive = () => {
    if (pendingLiveForm === 'create') createCtl.update({ allow_live: true })
    if (pendingLiveForm === 'edit') editCtl.update({ allow_live: true })
    setPendingLiveForm(null)
  }

  // ===== 提交前校验 =====
  const validateProfitControlForm = (form: GroupFormState): boolean => {
    const errorKey = validateProfitControlFormState(form)
    if (errorKey) {
      useAppStore.getState().showError(t(`admin.groups.profitControl.${errorKey}`))
      return false
    }
    return true
  }

  const validateGroupReasoningMultipliers = (pricing: PricingFormEntry[]): boolean => {
    for (const entry of pricing) {
      const error = validateReasoningEffortMultipliers(entry.reasoning_effort_multipliers, t)
      if (error) {
        useAppStore.getState().showError(`${entry.models.join(', ') || t('admin.channels.form.unnamed')}: ${error}`)
        return false
      }
    }
    return true
  }

  const validateCommon = (ctl: GroupFormController): boolean => {
    const { form, allowlist } = ctl.getLatest()
    if (!form.name.trim()) {
      useAppStore.getState().showError(t('admin.groups.nameRequired'))
      return false
    }
    if (
      supportsReasoningEffortPolicyPlatform(form.platform) &&
      ctl.getReasoning() &&
      !ctl.getReasoning()!.validate()
    ) {
      return false
    }
    if (!validateProfitControlForm(form)) return false
    if (!validateGroupReasoningMultipliers(form.model_pricing)) return false
    // 模型白名单：开启且没有任何条目时阻止提交，与后端 400 对齐。
    if (allowlist.enabled && selectedModelAllowlistCount(allowlist) === 0) {
      useAppStore.getState().showError(t('admin.groups.modelAllowlist.emptySelectionError'))
      return false
    }
    return true
  }

  // ===== 创建 =====
  const openCreateModal = () => {
    setShowCreateModal(true)
    void createCtl.loadAllowlistCandidates(0, createCtl.getLatest().form.platform)
  }

  const closeCreateModal = () => {
    setShowCreateModal(false)
    createCtl.resetCreate()
  }

  const handleCreateGroup = async () => {
    if (!validateCommon(createCtl)) return
    setSubmitting(true)
    try {
      const { form, allowlist, routingRules } = createCtl.getLatest()
      const payload = buildCreateGroupPayload(form, { routingRules, allowlist, isSimpleMode })
      await adminAPI.groups.create(payload as Parameters<typeof adminAPI.groups.create>[0])
      useAppStore.getState().showSuccess(t('admin.groups.groupCreated'))
      closeCreateModal()
      void loadGroups()
      // Only advance tour if active, on submit step, and creation succeeded
      const onboarding = useOnboardingStore.getState()
      if (onboarding.isCurrentStep('[data-tour="group-form-submit"]')) {
        void onboarding.nextStep(500)
      }
    } catch (error: any) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.groups.failedToCreate')))
      console.error('Error creating group:', error)
      // Don't advance tour on error
    } finally {
      setSubmitting(false)
    }
  }

  // ===== 编辑 =====
  const handleEdit = async (group: AdminGroup) => {
    live.current.editingGroup = group
    setEditingGroup(group)
    // 关闭时不立即清空编辑表单（否则抽屉滑出时内容会跳变），改为在下次打开、回填之前清空，回填仍基于清空后的表单
    editCtl.clearEdit()
    await editCtl.hydrate(group)
    setShowEditModal(true)
  }

  const closeEditModal = () => {
    setShowEditModal(false)
    live.current.editingGroup = null
    setEditingGroup(null)
  }

  const handleUpdateGroup = async () => {
    const group = live.current.editingGroup
    if (!group) return
    if (!validateCommon(editCtl)) return
    const { form, allowlist, routingRules, codexManifest } = editCtl.getLatest()
    // 固定账号 manifest：开启后至少一个账号，前端阻止提交并提示。
    if (form.platform === 'openai' && codexManifest.enabled && codexManifest.account_ids.length === 0) {
      useAppStore.getState().showError(t('admin.groups.codexModelsManifest.selectAtLeastOne'))
      editCtl.getCodex()?.validate()
      return
    }

    setSubmitting(true)
    try {
      const payload = buildUpdateGroupPayload(form, { routingRules, allowlist, isSimpleMode, codexManifest })
      await adminAPI.groups.update(group.id, payload as Parameters<typeof adminAPI.groups.update>[1])
      useAppStore.getState().showSuccess(t('admin.groups.groupUpdated'))
      closeEditModal()
      void loadGroups()
    } catch (error: any) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.groups.failedToUpdate')))
      console.error('Error updating group:', error)
    } finally {
      setSubmitting(false)
    }
  }

  // ===== 行操作 =====
  const handleDuplicate = async (group: AdminGroup) => {
    if (duplicatingRef.current.has(group.id)) return

    duplicatingRef.current.add(group.id)
    setDuplicatingGroupIds(new Set(duplicatingRef.current))
    try {
      const duplicate = await adminAPI.groups.duplicate(group.id)
      useAppStore.getState().showSuccess(t('admin.groups.duplicateSuccess', { name: duplicate.name }))
      await loadGroups()
    } catch (error: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.groups.duplicateFailed')))
    } finally {
      duplicatingRef.current.delete(group.id)
      setDuplicatingGroupIds(new Set(duplicatingRef.current))
    }
  }

  const handleCompositeRoutes = (group: AdminGroup) => {
    setCompositeRoutesGroup(group)
    setShowCompositeRoutesModal(true)
  }

  const closeCompositeRoutesModal = () => {
    setShowCompositeRoutesModal(false)
    setCompositeRoutesGroup(null)
  }

  const handleRateMultipliers = (group: AdminGroup) => {
    setRateMultipliersGroup(group)
    setShowRateMultipliersModal(true)
  }

  const handleRPMOverrides = (group: AdminGroup) => {
    setRpmOverridesGroup(group)
    setShowRPMOverridesModal(true)
  }

  const handleDelete = (group: AdminGroup) => {
    setDeletingGroup(group)
    setShowDeleteDialog(true)
  }

  const confirmDelete = async () => {
    if (!deletingGroup) return
    try {
      await adminAPI.groups.delete(deletingGroup.id)
      useAppStore.getState().showSuccess(t('admin.groups.groupDeleted'))
      setShowDeleteDialog(false)
      setDeletingGroup(null)
      void loadGroups()
    } catch (error: any) {
      useAppStore.getState().showError(error?.response?.data?.detail || t('admin.groups.failedToDelete'))
      console.error('Error deleting group:', error)
    }
  }

  // 根据分组类型返回不同的删除确认消息
  const deleteConfirmMessage = !deletingGroup
    ? ''
    : deletingGroup.subscription_type === 'subscription'
      ? t('admin.groups.deleteConfirmSubscription', { name: deletingGroup.name })
      : t('admin.groups.deleteConfirm', { name: deletingGroup.name })

  // 打开排序弹窗：获取所有分组（不分页）并按 sort_order 排序
  const openSortModal = async () => {
    try {
      const allGroups = await adminAPI.groups.getAll()
      setSortableGroups([...allGroups].sort((a, b) => a.sort_order - b.sort_order))
      setShowSortModal(true)
    } catch (error) {
      useAppStore.getState().showError(t('admin.groups.failedToLoad'))
      console.error('Error loading groups for sorting:', error)
    }
  }

  const closeSortModal = () => {
    setShowSortModal(false)
    setSortableGroups([])
  }

  // ===== 单元格 =====
  const usageOf = (id: number) => usageMap.get(id)
  const unitChip = <span className={styles.unit}>{t('admin.groups.accountsUnit')}</span>

  const cells: Record<string, (context: DataTableCellContext<AdminGroup>) => ReactNode> = {
    name: ({ value }) => <span className={styles.name}>{value}</span>,
    id: ({ value }) => <span className={styles.mono}>#{value}</span>,
    // 分组不再归属单一平台：平台列固定展示「全平台」
    platform: () => (
      <Badge size="sm" tone="info" icon={<PlatformIcon platform="composite" size="xs" />}>
        {t('admin.groups.platforms.composite', 'All platforms')}
      </Badge>
    ),
    billing_type: ({ row }) => (
      <div className={styles.stack}>
        <Badge size="sm" tone={row.subscription_type === 'subscription' ? 'info' : 'neutral'}>
          {row.subscription_type === 'subscription'
            ? t('admin.groups.subscription.subscription')
            : t('admin.groups.subscription.standard')}
        </Badge>
        {row.subscription_type === 'subscription' ? (
          <div className={styles.small}>
            {row.daily_limit_usd || row.weekly_limit_usd || row.monthly_limit_usd ? (
              <div className={styles.limits}>
                {row.daily_limit_usd ? (
                  <span className={styles.nowrap}>
                    {usageLoading ? (
                      <span className={styles.muted}>—</span>
                    ) : (
                      <span
                        className={styles.quota}
                        data-tone={quotaUsageTone(usageOf(row.id)?.today_cost ?? 0, row.daily_limit_usd)}
                      >
                        {formatUsd(usageOf(row.id)?.today_cost ?? 0)}
                      </span>
                    )}
                    <span className={styles.muted}>
                      {' '}
                      / {formatUsd(row.daily_limit_usd)}/{t('admin.groups.limitDay')}
                    </span>
                  </span>
                ) : null}
                {row.daily_limit_usd && (row.weekly_limit_usd || row.monthly_limit_usd) ? (
                  <span className={styles.dot}>·</span>
                ) : null}
                {row.weekly_limit_usd ? (
                  <span className={styles.nowrap}>
                    {formatUsd(row.weekly_limit_usd)}/{t('admin.groups.limitWeek')}
                  </span>
                ) : null}
                {row.weekly_limit_usd && row.monthly_limit_usd ? <span className={styles.dot}>·</span> : null}
                {row.monthly_limit_usd ? (
                  <span className={styles.nowrap}>
                    {formatUsd(row.monthly_limit_usd)}/{t('admin.groups.limitMonth')}
                  </span>
                ) : null}
              </div>
            ) : (
              <span className={styles.muted}>{t('admin.groups.subscription.noLimit')}</span>
            )}
            <div className={styles.muted}>
              {t('admin.groups.usageTotal')}
              <span className={styles.value}>{usageLoading ? '—' : formatUsd(usageOf(row.id)?.total_cost ?? 0)}</span>
            </div>
          </div>
        ) : null}
      </div>
    ),
    rate_multiplier: ({ value }) => <span className={styles.secondaryText}>{value}x</span>,
    is_exclusive: ({ value }) => (
      <Badge size="sm" tone={value ? 'info' : 'neutral'}>
        {value ? t('admin.groups.exclusive') : t('admin.groups.public')}
      </Badge>
    ),
    account_count: ({ row }) => (
      <div className={styles.small}>
        <div>
          <span className={styles.muted}>{t('admin.groups.accountsAvailable')}</span>
          <span className={styles.value} data-tone="success">
            {row.active_account_count || 0}
          </span>
          {unitChip}
        </div>
        {row.rate_limited_account_count ? (
          <div>
            <span className={styles.muted}>{t('admin.groups.accountsRateLimited')}</span>
            <span className={styles.value} data-tone="warning">
              {row.rate_limited_account_count}
            </span>
            {unitChip}
          </div>
        ) : null}
        <div>
          <span className={styles.muted}>{t('admin.groups.accountsTotal')}</span>
          <span className={styles.value}>{row.account_count || 0}</span>
          {unitChip}
        </div>
      </div>
    ),
    capacity: ({ row }) => {
      const capacity = capacityMap.get(row.id)
      return capacity ? (
        <GroupCapacityBadge
          concurrencyUsed={capacity.concurrencyUsed}
          concurrencyMax={capacity.concurrencyMax}
          sessionsUsed={capacity.sessionsUsed}
          sessionsMax={capacity.sessionsMax}
          rpmUsed={capacity.rpmUsed}
          rpmMax={capacity.rpmMax}
        />
      ) : (
        <span className={styles.muted}>—</span>
      )
    },
    usage: ({ row }) =>
      usageLoading ? (
        <div className={styles.muted}>—</div>
      ) : (
        <div className={styles.small}>
          <div>
            <span className={styles.muted}>{t('admin.groups.usageToday')}</span>
            <span className={styles.value}>${formatCost(usageOf(row.id)?.today_cost ?? 0)}</span>
          </div>
          <div>
            <span className={styles.muted}>{t('admin.groups.usageYesterday')}</span>
            <span className={styles.value}>${formatCost(usageOf(row.id)?.yesterday_cost ?? 0)}</span>
          </div>
          <div>
            <span className={styles.muted}>{t('admin.groups.usageTotal')}</span>
            <span className={styles.value}>${formatCost(usageOf(row.id)?.total_cost ?? 0)}</span>
          </div>
        </div>
      ),
    status: ({ value }) => (
      <Badge size="sm" tone={value === 'active' ? 'success' : 'danger'}>
        {t('admin.accounts.status.' + value)}
      </Badge>
    ),
    actions: ({ row }) => {
      const duplicating = duplicatingGroupIds.has(row.id)
      return (
        <div className={styles.actions}>
          <button type="button" className={styles.actionButton} onClick={() => void handleEdit(row)}>
            <Pencil {...iconProps} />
            <span>{t('common.edit')}</span>
          </button>
          {!isSimpleMode ? (
            <>
              <button
                type="button"
                className={styles.actionButton}
                data-testid="group-duplicate"
                title={duplicating ? t('admin.groups.duplicating') : t('admin.groups.duplicate')}
                disabled={duplicating}
                onClick={() => void handleDuplicate(row)}
              >
                <Copy {...iconProps} />
                <span>{duplicating ? t('admin.groups.duplicating') : t('admin.groups.duplicate')}</span>
              </button>
              <button
                type="button"
                className={styles.actionButton}
                data-testid="group-composite-routes"
                onClick={() => handleCompositeRoutes(row)}
              >
                <ArrowLeftRight {...iconProps} />
                <span>{t('admin.groups.compositeRoutes.action')}</span>
              </button>
              <button
                type="button"
                className={styles.actionButton}
                data-testid="group-rate-multipliers"
                onClick={() => handleRateMultipliers(row)}
              >
                <DollarSign {...iconProps} />
                <span>{t('admin.groups.rateMultipliers')}</span>
              </button>
              <button
                type="button"
                className={styles.actionButton}
                data-testid="group-rpm-overrides"
                onClick={() => handleRPMOverrides(row)}
              >
                <Zap {...iconProps} />
                <span>{t('admin.groups.rpmOverrides')}</span>
              </button>
            </>
          ) : null}
          <button type="button" className={styles.actionButton} data-tone="danger" onClick={() => handleDelete(row)}>
            <Trash2 {...iconProps} />
            <span>{t('common.delete')}</span>
          </button>
        </div>
      )
    }
  }

  // ===== 工具栏 =====
  const filters = (
    <div className={styles.toolbar}>
      {/* Left: fuzzy search + filters (can wrap to multiple lines) */}
      <div className={styles.filterGroup}>
        <SearchInput
          className={styles.search}
          value={searchQuery}
          placeholder={t('admin.groups.searchGroups')}
          onChange={(value) => {
            live.current.searchQuery = value
            setSearchQuery(value)
          }}
          onSearch={handleSearch}
        />
        <div className={styles.statusFilter}>
          <Select
            value={statusFilter}
            options={statusOptions}
            placeholder={t('admin.groups.allStatus')}
            aria-label={t('admin.groups.columns.status')}
            onChange={(value) => {
              live.current.statusFilter = String(value ?? '')
              setStatusFilter(String(value ?? ''))
              void loadGroups()
            }}
          />
        </div>
        {!isSimpleMode ? (
          <div className={styles.exclusiveFilter}>
            <Select
              value={exclusiveFilter}
              options={exclusiveOptions}
              placeholder={t('admin.groups.allGroups')}
              aria-label={t('admin.groups.columns.type')}
              onChange={(value) => {
                live.current.exclusiveFilter = String(value ?? '')
                setExclusiveFilter(String(value ?? ''))
                void loadGroups()
              }}
            />
          </div>
        ) : null}
      </div>

      {/* Right: actions */}
      <div className={styles.actionGroup}>
        <Button
          type="button"
          variant="secondary"
          disabled={loading}
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
          onClick={() => void loadGroups()}
        >
          <RefreshCw {...iconProps} className={loading ? styles.spinning : undefined} />
        </Button>
        <Popover open={showColumnDropdown} onOpenChange={setShowColumnDropdown}>
          <PopoverTrigger asChild>
            <Button type="button" variant="secondary" title={t('admin.groups.columnSettings')}>
              <Columns3 {...iconProps} />
              <span className={styles.desktopOnly}>{t('admin.groups.columnSettings')}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className={styles.menuPanel}>
            <div className={styles.menuList} role="menu">
              {toggleableColumns.map((col) => (
                <button
                  key={col.key}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={isColumnVisible(col.key)}
                  className={styles.menuItem}
                  onClick={() => toggleColumn(col.key)}
                >
                  <span>{col.label}</span>
                  {isColumnVisible(col.key) ? <Check {...iconProps} className={styles.check} /> : null}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        {!isSimpleMode ? (
          <Button type="button" variant="secondary" title={t('admin.groups.sortOrder')} onClick={() => void openSortModal()}>
            <ArrowUpDown {...iconProps} />
            {t('admin.groups.sortOrder')}
          </Button>
        ) : null}
        <Button type="button" variant="primary" data-tour="groups-create-btn" onClick={openCreateModal}>
          <Plus {...iconProps} />
          {t('admin.groups.createGroup')}
        </Button>
      </div>
    </div>
  )

  const platformForms = (ctl: GroupFormController, group: AdminGroup | null) => {
    const excludeId = group?.id
    return {
      copyAccountsOptions: copyAccountsGroupOptionsFor(excludeId),
      fallbackGroupOptions: fallbackGroupOptionsFor(excludeId),
      invalidRequestFallbackOptions: invalidRequestFallbackOptionsFor(excludeId),
      ctl
    }
  }

  return (
    <>
      <TablePageLayout
        filters={filters}
        table={
          <DataTable
            columns={columns}
            data={groups}
            loading={loading}
            serverSideSort
            defaultSortKey="sort_order"
            defaultSortOrder="asc"
            onSort={handleSort}
            cells={cells}
            empty={
              <EmptyState
                title={t('admin.groups.noGroupsYet')}
                description={t('admin.groups.createFirstGroup')}
                actionText={t('admin.groups.createGroup')}
                onAction={openCreateModal}
              />
            }
          />
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

      {/* Create Group */}
      <GroupFormDrawer
        show={showCreateModal}
        {...platformForms(createCtl, null)}
        isSimpleMode={isSimpleMode}
        submitting={submitting}
        subscriptionTypeOptions={subscriptionTypeOptions}
        statusOptions={editStatusOptions}
        onToggleLive={() => void toggleLive('create')}
        onSubmit={() => void handleCreateGroup()}
        onClose={closeCreateModal}
      />

      {/* Edit Group */}
      <GroupFormDrawer
        show={showEditModal}
        {...platformForms(editCtl, drawerEditingGroup)}
        editingGroup={drawerEditingGroup}
        isSimpleMode={isSimpleMode}
        submitting={submitting}
        subscriptionTypeOptions={subscriptionTypeOptions}
        statusOptions={editStatusOptions}
        onToggleLive={() => void toggleLive('edit')}
        onSubmit={() => void handleUpdateGroup()}
        onClose={closeEditModal}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        show={showDeleteDialog}
        title={t('admin.groups.deleteGroup')}
        message={deleteConfirmMessage}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setShowDeleteDialog(false)}
      />

      <ConfirmDialog
        show={pendingLiveForm !== null}
        title={t('admin.groups.openaiLive.unsupportedTitle')}
        message={t('admin.groups.openaiLive.unsupportedMessage')}
        confirmText={t('admin.groups.openaiLive.enableAnyway')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={confirmUnsupportedLive}
        onCancel={() => setPendingLiveForm(null)}
      />

      <GroupSortOrderModal
        show={showSortModal}
        groups={sortableGroups}
        onClose={closeSortModal}
        onSaved={() => void loadGroups()}
      />

      <GroupCompositeRoutesModal
        show={showCompositeRoutesModal}
        group={compositeRoutesGroup}
        onClose={closeCompositeRoutesModal}
      />

      <GroupRateMultipliersModal
        show={showRateMultipliersModal}
        group={rateMultipliersGroup}
        onClose={() => setShowRateMultipliersModal(false)}
        onSuccess={() => void loadGroups()}
      />

      <GroupRPMOverridesModal
        show={showRPMOverridesModal}
        group={rpmOverridesGroup}
        onClose={() => setShowRPMOverridesModal(false)}
        onSuccess={() => void loadGroups()}
      />
    </>
  )
}

