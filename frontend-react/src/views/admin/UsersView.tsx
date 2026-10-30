/**
 * 用户管理页，对应 Vue 版 views/admin/UsersView.vue。
 * - 工具栏：搜索、可显隐的内置筛选（角色 / 状态 / 授权分组 / API Key 分组）与自定义属性筛选、
 *   刷新、筛选设置、列设置、属性配置、新建用户；选中用户后在表格区域上方显示批量操作栏
 * - 表格：服务端排序（持久化），用量列另有仅作用于当前页的本地排序（今日 / 累计，三态循环）
 * - 用量、属性值、平台配额等次要数据在列表渲染后延迟 50ms 拉取，切页 / 重新加载时作废旧结果
 * - 筛选值、可见筛选、隐藏列、用量排序都持久化到 localStorage（键名与 Vue 版一致）
 *
 * 与 Vue 版的差异：异步回调读取的查询条件放在 ref 中同步更新（Vue 的 reactive 在同一事件内即时生效），
 * 下拉菜单改用 Arc popover（点击外部、Escape 关闭由 Radix 处理）。
 */
import {
  Ban,
  CheckCircle2,
  Columns3,
  DollarSign,
  Filter,
  Globe,
  Key,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Shield,
  ArrowLeftRight,
  BarChart3,
  Trash2,
  Users,
  Check,
  ChevronUp,
  ChevronsUpDown
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { adminAPI } from '@/api/admin'
import type { BatchUserUsageStats } from '@/api/admin/dashboard'
import type { PlatformQuotaItem } from '@/api/admin/users'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover'
import { Tooltip } from '@/components/arc/tooltip/tooltip'
import BulkEditUserModal from '@/components/admin/user/BulkEditUserModal'
import GroupReplaceModal from '@/components/admin/user/GroupReplaceModal'
import UserAllowedGroupsModal from '@/components/admin/user/UserAllowedGroupsModal'
import UserApiKeysModal from '@/components/admin/user/UserApiKeysModal'
import UserBalanceHistoryModal from '@/components/admin/user/UserBalanceHistoryModal'
import UserBalanceModal from '@/components/admin/user/UserBalanceModal'
import UserCreateModal from '@/components/admin/user/UserCreateModal'
import UserEditModal from '@/components/admin/user/UserEditModal'
import UserPlatformQuotaModal from '@/components/admin/user/UserPlatformQuotaModal'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import DataTable, { type DataTableCellContext, type DataTableHeaderContext, type RowKey } from '@/components/common/DataTable'
import EmptyState from '@/components/common/EmptyState'
import GroupBadge from '@/components/common/GroupBadge'
import Input from '@/components/common/Input'
import Pagination from '@/components/common/Pagination'
import SearchInput from '@/components/common/SearchInput'
import Select, { type SelectOption, type SelectValue } from '@/components/common/Select'
import TablePageLayout from '@/components/common/TablePageLayout'
import type { Column } from '@/components/common/types'
import PlatformCostCell from '@/components/user/PlatformCostCell'
import PlatformUsageBreakdown from '@/components/user/PlatformUsageBreakdown'
import UserAttributesConfigModal from '@/components/user/UserAttributesConfigModal'
import UserConcurrencyCell from '@/components/user/UserConcurrencyCell'
import UserPlatformQuotaCell from '@/components/user/UserPlatformQuotaCell'
import { getPersistedPageSize } from '@/composables/usePersistedPageSize'
import { useTableSelection } from '@/composables/useTableSelection'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminGroup, AdminUser, UserAttributeDefinition } from '@/types'
import { formatDateTime } from '@/utils/format'
import { buildApiKeyGroupFilterOptions } from './apiKeyGroupFilterOptions'
import styles from './UsersView.module.css'

// ===== 常量（键名与 Vue 版一致） =====

// Default hidden columns (columns hidden by default on first load)
const DEFAULT_HIDDEN_COLUMNS = [
  'notes', 'groups', 'subscriptions', 'usage', 'concurrency',
  'usage_anthropic', 'usage_openai', 'usage_gemini', 'usage_antigravity',
  'balance_platform_quota'
]
const REMOVED_COLUMNS = new Set(['last_login_at'])
// 强制可见列：加载时会被强制移出 hiddenColumns，并在列设置 UI 上 disabled。
// 当前没有列需要强制可见 —— last_active_at 已改为可被用户隐藏。
const FORCED_VISIBLE_COLUMNS = new Set<string>()

// localStorage keys for column settings
const HIDDEN_COLUMNS_KEY = 'user-hidden-columns'
// 列设置 schema 版本号。每次给 DEFAULT_HIDDEN_COLUMNS 新增列时 bump 一次，
// 并在 VERSION_NEW_HIDDEN_COLUMNS 中登记该版本新增的 key。
// 这样老用户升级后这些新列会被自动隐藏一次，而不会影响他们对其它老列的偏好。
const COLUMN_SETTINGS_VERSION_KEY = 'user-column-settings-version'
const COLUMN_SETTINGS_VERSION = 3
const VERSION_NEW_HIDDEN_COLUMNS: Record<number, string[]> = {
  2: ['usage_anthropic', 'usage_openai', 'usage_gemini', 'usage_antigravity'],
  3: ['balance_platform_quota']
}

const USER_SORT_STORAGE_KEY = 'admin-users-table-sort'
const FILTER_VALUES_KEY = 'user-filter-values'
const VISIBLE_FILTERS_KEY = 'user-visible-filters'
const USAGE_SORT_STORAGE_KEY = 'admin-users-usage-sort'

// usage 主列或任意 usage_<platform> 子列可见时都需要批量拉取用量数据
// 列 key → 平台名（'usage' 主列汇总所有平台时为 null）
// 显式数组取代 Object.keys()：保证迭代顺序（决定列头排序按钮渲染顺序）
// 不会因 JS 引擎差异或 USAGE_COLUMN_PLATFORMS 属性顺序调整而静默变化。
const USAGE_COLUMN_KEYS: readonly string[] = ['usage', 'usage_anthropic', 'usage_openai', 'usage_gemini', 'usage_antigravity']
const USAGE_COLUMN_PLATFORMS: Record<string, string | null> = {
  usage: null,
  usage_anthropic: 'anthropic',
  usage_openai: 'openai',
  usage_gemini: 'gemini',
  usage_antigravity: 'antigravity'
}
const PLATFORM_USAGE_COLUMNS = USAGE_COLUMN_KEYS.filter((k) => k !== 'usage')

// ===== 类型 =====

type SortOrder = 'asc' | 'desc'
interface SortState {
  sort_by: string
  sort_order: SortOrder
}

interface FilterValues {
  role: string
  status: string
  /** group name for fuzzy match, '' = all */
  group: string
  /** group id bound to the user's API keys, null = all */
  apiKeyGroup: number | null
}

interface PaginationState {
  page: number
  page_size: number
  total: number
  pages: number
}

// 用量列前端排序：DataTable 工作在 server-side-sort 模式，所有 sortable
// 字段都会触发后端查询，而用量列数据是异步批量拉取后再合并到当前页，
// 因此采用独立的前端排序状态对当前页 users 做本地排序。
// 排序状态独立于后端 sortState 持久化；缺失数据按 0 处理（desc 沉底、asc 置顶）。
type UsageMetric = 'today' | 'total'
type UsageSortState = { key: string; metric: UsageMetric; order: SortOrder } | null

// ===== localStorage 读取（纯读取；写入在挂载后进行） =====

const loadInitialSortState = (): SortState => {
  const fallback: SortState = { sort_by: 'created_at', sort_order: 'desc' }
  const sortable = new Set(['email', 'id', 'username', 'role', 'balance', 'concurrency', 'status', 'last_used_at', 'last_active_at', 'created_at'])
  try {
    const raw = localStorage.getItem(USER_SORT_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as { key?: string; order?: string }
    const key = typeof parsed.key === 'string' ? parsed.key : ''
    if (!sortable.has(key)) return fallback
    return { sort_by: key, sort_order: parsed.order === 'asc' ? 'asc' : 'desc' }
  } catch {
    return fallback
  }
}

const loadInitialUsageSort = (): UsageSortState => {
  try {
    const raw = localStorage.getItem(USAGE_SORT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<{ key: string; metric: string; order: string }>
    if (!parsed.key || !USAGE_COLUMN_KEYS.includes(parsed.key)) return null
    const metric: UsageMetric = parsed.metric === 'total' ? 'total' : 'today'
    const order: SortOrder = parsed.order === 'asc' ? 'asc' : 'desc'
    return { key: parsed.key, metric, order }
  } catch {
    return null
  }
}

interface SavedFilters {
  visible: Set<string>
  values: FilterValues
  attributes: Record<number, string>
}

// Load saved filters from localStorage
const loadSavedFilters = (): SavedFilters => {
  const result: SavedFilters = {
    visible: new Set(),
    values: { role: '', status: '', group: '', apiKeyGroup: null },
    attributes: {}
  }
  try {
    // Load visible filters
    const savedVisible = localStorage.getItem(VISIBLE_FILTERS_KEY)
    if (savedVisible) {
      const parsed = JSON.parse(savedVisible) as string[]
      parsed.forEach((key) => result.visible.add(key))
    }
    // Load filter values
    const savedValues = localStorage.getItem(FILTER_VALUES_KEY)
    if (savedValues) {
      const parsed = JSON.parse(savedValues)
      if (parsed.role) result.values.role = parsed.role
      if (parsed.status) result.values.status = parsed.status
      if (parsed.group) result.values.group = parsed.group
      if (typeof parsed.apiKeyGroup === 'number') result.values.apiKeyGroup = parsed.apiKeyGroup
      if (parsed.attributes) Object.assign(result.attributes, parsed.attributes)
    }
  } catch (e) {
    console.error('Failed to load saved filters:', e)
  }
  return result
}

interface SavedColumns {
  hidden: Set<string>
  /** 挂载后需要写回的内容：全部列设置 / 仅版本号 / 不写 */
  persist: 'columns' | 'version' | null
}

// Load saved column settings
const loadSavedColumns = (): SavedColumns => {
  const hidden = new Set<string>()
  try {
    const saved = localStorage.getItem(HIDDEN_COLUMNS_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as string[]
      parsed.filter((key) => !REMOVED_COLUMNS.has(key) && !FORCED_VISIBLE_COLUMNS.has(key)).forEach((key) => hidden.add(key))

      // 老用户升级：把每个未应用过的版本里新增的默认隐藏列自动追加到 hiddenColumns。
      const storedVersion = Number(localStorage.getItem(COLUMN_SETTINGS_VERSION_KEY) ?? '1')
      if (storedVersion < COLUMN_SETTINGS_VERSION) {
        let mutated = false
        for (let v = storedVersion + 1; v <= COLUMN_SETTINGS_VERSION; v++) {
          for (const key of VERSION_NEW_HIDDEN_COLUMNS[v] ?? []) {
            if (REMOVED_COLUMNS.has(key) || FORCED_VISIBLE_COLUMNS.has(key)) continue
            if (!hidden.has(key)) {
              hidden.add(key)
              mutated = true
            }
          }
        }
        return { hidden, persist: mutated ? 'columns' : 'version' }
      }
      return { hidden, persist: null }
    }
    // Use default hidden columns on first load
    DEFAULT_HIDDEN_COLUMNS.forEach((key) => hidden.add(key))
    return { hidden, persist: 'version' }
  } catch (e) {
    console.error('Failed to load saved columns:', e)
    DEFAULT_HIDDEN_COLUMNS.forEach((key) => hidden.add(key))
    return { hidden, persist: null }
  }
}

// Save column settings to localStorage
const saveColumnsToStorage = (hidden: Set<string>) => {
  try {
    localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify([...hidden]))
    localStorage.setItem(COLUMN_SETTINGS_VERSION_KEY, String(COLUMN_SETTINGS_VERSION))
  } catch (e) {
    console.error('Failed to save columns:', e)
  }
}

// 计算剩余天数
const getDaysRemaining = (expiresAt: string): number => {
  const now = new Date()
  const expires = new Date(expiresAt)
  const diffMs = expires.getTime() - now.getTime()
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}

/**
 * useState + 同步更新的 ref：事件处理里先 set 再调用依赖它的异步函数时，
 * 函数通过 ref 读到最新值（对应 Vue reactive 的即时生效）。
 */
function useStateRef<T>(initial: T | (() => T)) {
  const [state, setState] = useState(initial)
  const ref = useRef(state)
  const set = useCallback((next: T | ((prev: T) => T)) => {
    const value = typeof next === 'function' ? (next as (prev: T) => T)(ref.current) : next
    ref.current = value
    setState(value)
  }, [])
  return [state, set, ref] as const
}

const iconProps = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

export default function UsersView() {
  const { t } = useI18n()

  // ===== 状态 =====
  const [savedFilters] = useState(loadSavedFilters)
  const [savedColumns] = useState(loadSavedColumns)

  const [users, setUsers, usersRef] = useStateRef<AdminUser[]>([])
  const [loading, setLoading, loadingRef] = useStateRef(false)
  const [searchQuery, setSearchQuery, searchQueryRef] = useStateRef('')
  const [, setSortState, sortStateRef] = useStateRef<SortState>(loadInitialSortState)
  const [pagination, setPagination, paginationRef] = useStateRef<PaginationState>(() => ({
    page: 1,
    page_size: getPersistedPageSize(),
    total: 0,
    pages: 0
  }))
  const [filters, setFilters, filtersRef] = useStateRef<FilterValues>(savedFilters.values)
  const [activeAttributeFilters, setActiveAttributeFilters, activeAttributeFiltersRef] = useStateRef<Record<number, string>>(
    savedFilters.attributes
  )
  // Visible filters tracking (which filters are shown in the UI)
  // Keys: 'role', 'status', 'group', 'apiKeyGroup', 'attr_${id}'
  const [visibleFilters, setVisibleFilters, visibleFiltersRef] = useStateRef<Set<string>>(savedFilters.visible)
  // Hidden columns (stored in Set - columns NOT in this set are visible)
  // This way, new columns are visible by default
  const [hiddenColumns, setHiddenColumns, hiddenColumnsRef] = useStateRef<Set<string>>(savedColumns.hidden)

  const [allGroups, setAllGroups, allGroupsRef] = useStateRef<AdminGroup[]>([])
  const [allGroupsForApiKeyFilter, setAllGroupsForApiKeyFilter, allGroupsForApiKeyFilterRef] = useStateRef<AdminGroup[]>([])

  const [attributeDefinitions, setAttributeDefinitions, attributeDefinitionsRef] = useStateRef<UserAttributeDefinition[]>([])
  const [userAttributeValues, setUserAttributeValues] = useState<Record<number, Record<number, string>>>({})
  const [usageStats, setUsageStats] = useState<Record<string, BatchUserUsageStats>>({})
  const [platformQuotaStats, setPlatformQuotaStats] = useState<Record<number, PlatformQuotaItem[]>>({})

  const [usageSort, setUsageSort] = useState<UsageSortState>(loadInitialUsageSort)
  // 列头排序按钮点击后弹出的"今日/近30天"选择菜单，同时只允许一个列展开。
  const [openUsageSortMenu, setOpenUsageSortMenu] = useState<string | null>(null)

  // Dropdown states
  const [showFilterDropdown, setShowFilterDropdown] = useState(false)
  const [showColumnDropdown, setShowColumnDropdown] = useState(false)
  // Action menu / expanded group menu（行内弹出菜单）
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null)
  const [expandedGroupUserId, setExpandedGroupUserId] = useState<number | null>(null)

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showBulkEditModal, setShowBulkEditModal] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [bulkDeleteIds, setBulkDeleteIds] = useState<number[]>([])
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [showApiKeysModal, setShowApiKeysModal] = useState(false)
  const [showAttributesModal, setShowAttributesModal] = useState(false)
  const [showPlatformQuotaModal, setShowPlatformQuotaModal] = useState(false)
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null)
  const [viewingUser, setViewingUser] = useState<AdminUser | null>(null)
  const [platformQuotaUser, setPlatformQuotaUser] = useState<AdminUser | null>(null)
  const [showAllowedGroupsModal, setShowAllowedGroupsModal] = useState(false)
  const [allowedGroupsUser, setAllowedGroupsUser] = useState<AdminUser | null>(null)
  const [showGroupReplaceModal, setShowGroupReplaceModal] = useState(false)
  const [groupReplaceUser, setGroupReplaceUser] = useState<AdminUser | null>(null)
  const [groupReplaceOldGroup, setGroupReplaceOldGroup] = useState<{ id: number; name: string } | null>(null)
  const [showBalanceModal, setShowBalanceModal] = useState(false)
  const [balanceUser, setBalanceUser] = useState<AdminUser | null>(null)
  const [balanceOperation, setBalanceOperation] = useState<'add' | 'subtract'>('add')
  const [showBalanceHistoryModal, setShowBalanceHistoryModal] = useState(false)
  const [balanceHistoryUser, setBalanceHistoryUser] = useState<AdminUser | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const secondaryDataSeq = useRef(0)
  const secondaryTimer = useRef<number | null>(null)

  // ===== 派生 =====

  // Generate dynamic attribute columns from enabled definitions
  const enabledAttributes = useMemo(() => attributeDefinitions.filter((def) => def.enabled), [attributeDefinitions])

  // All possible columns (for column settings)
  const allColumns = useMemo<Column[]>(
    () => [
      { key: 'email', label: t('admin.users.columns.user'), sortable: true },
      { key: 'id', label: t('admin.users.columns.id'), sortable: true },
      { key: 'username', label: t('admin.users.columns.username'), sortable: true },
      { key: 'notes', label: t('admin.users.columns.notes'), sortable: false },
      // Dynamic attribute columns
      ...enabledAttributes.map((def) => ({ key: `attr_${def.id}`, label: def.name, sortable: false })),
      { key: 'role', label: t('admin.users.columns.role'), sortable: true },
      { key: 'groups', label: t('admin.users.columns.groups'), sortable: false },
      { key: 'subscriptions', label: t('admin.users.columns.subscriptions'), sortable: false },
      { key: 'balance', label: t('admin.users.columns.balance'), sortable: true },
      { key: 'balance_platform_quota', label: t('admin.users.columns.balancePlatformQuota'), sortable: false },
      { key: 'usage', label: t('admin.users.columns.usage'), sortable: false },
      { key: 'usage_anthropic', label: t('admin.users.columns.usageAnthropic'), sortable: false },
      { key: 'usage_openai', label: t('admin.users.columns.usageOpenAI'), sortable: false },
      { key: 'usage_gemini', label: t('admin.users.columns.usageGemini'), sortable: false },
      { key: 'usage_antigravity', label: t('admin.users.columns.usageAntigravity'), sortable: false },
      { key: 'concurrency', label: t('admin.users.columns.concurrency'), sortable: true },
      { key: 'status', label: t('admin.users.columns.status'), sortable: true },
      { key: 'last_active_at', label: t('admin.users.columns.lastActive'), sortable: true },
      { key: 'last_used_at', label: t('admin.users.columns.lastUsed'), sortable: true },
      { key: 'created_at', label: t('admin.users.columns.created'), sortable: true },
      { key: 'actions', label: t('admin.users.columns.actions'), sortable: false }
    ],
    [t, enabledAttributes]
  )

  // Columns that can be toggled (exclude email and actions which are always visible)
  const toggleableColumns = allColumns.filter((col) => col.key !== 'email' && col.key !== 'actions')

  // Filtered columns based on visibility
  const columns = useMemo(
    () => allColumns.filter((col) => col.key === 'email' || col.key === 'actions' || !hiddenColumns.has(col.key)),
    [allColumns, hiddenColumns]
  )

  const isColumnVisible = (key: string) => !hiddenColumns.has(key)
  const isForcedVisibleColumn = (key: string) => FORCED_VISIBLE_COLUMNS.has(key)

  const getUsageValue = useCallback(
    (userId: number, key: string, metric: UsageMetric): number => {
      const stats = usageStats[userId]
      if (!stats) return 0
      const platform = USAGE_COLUMN_PLATFORMS[key]
      if (platform === null) {
        return metric === 'today' ? stats.today_actual_cost ?? 0 : stats.total_actual_cost ?? 0
      }
      const p = stats.by_platform?.find((x) => x.platform === platform)
      if (!p) return 0
      return metric === 'today' ? p.today_actual_cost ?? 0 : p.total_actual_cost ?? 0
    },
    [usageStats]
  )

  // 在 server-side 排序结果之上叠加用量列的本地排序；无 usageSort 时直接透传原数组。
  // 稳定排序：等值按原 index 保序，避免拉取新用量数据时表行抖动。
  const sortedUsers = useMemo(() => {
    const s = usageSort
    if (!s) return users
    return [...users]
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const av = getUsageValue(a.row.id, s.key, s.metric)
        const bv = getUsageValue(b.row.id, s.key, s.metric)
        if (av !== bv) return s.order === 'asc' ? av - bv : bv - av
        return a.index - b.index
      })
      .map((x) => x.row)
  }, [users, usageSort, getUsageValue])

  const {
    selectedIds,
    selectedCount,
    setSelectedIds,
    clear: clearSelection,
    removeMany: removeSelectedIds
  } = useTableSelection<AdminUser>({ rows: sortedUsers, getId: (user) => user.id })

  // Group filter options: "All Groups" + active exclusive groups (value = group name for fuzzy match)
  const groupFilterOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [{ value: '', label: t('admin.users.allAuthorizedGroups') }]
    for (const g of allGroups) {
      if (g.status !== 'active' || !g.is_exclusive || g.subscription_type !== 'standard') continue
      options.push({ value: g.name, label: g.name })
    }
    return options
  }, [allGroups, t])

  // API Key group filter options: "All" + groups partitioned by type (value = group id).
  // Uses allGroupsForApiKeyFilter which includes disabled groups.
  const apiKeyGroupFilterOptions = useMemo(
    () =>
      buildApiKeyGroupFilterOptions(allGroupsForApiKeyFilter, {
        all: t('admin.users.allApiKeyGroups'),
        exclusive: t('admin.users.apiKeyGroupExclusive'),
        public: t('admin.users.apiKeyGroupPublic'),
        subscription: t('admin.users.apiKeyGroupSubscription'),
        disabled: t('admin.users.apiKeyGroupDisabled')
      }) as unknown as SelectOption[],
    [allGroupsForApiKeyFilter, t]
  )

  // Built-in filter definitions
  const builtInFilters = [
    { key: 'role', name: t('admin.users.columns.role') },
    { key: 'status', name: t('admin.users.columns.status') },
    { key: 'group', name: t('admin.users.authorizedGroupFilter') },
    { key: 'apiKeyGroup', name: t('admin.users.apiKeyGroupFilter') }
  ]

  // ===== 数据加载 =====

  // Groups data for the groups column and the existing "authorised group" filter (active only)
  const loadAllGroups = async () => {
    if (allGroupsRef.current.length > 0) return
    try {
      setAllGroups(await adminAPI.groups.getAll())
    } catch (e) {
      console.error('Failed to load groups:', e)
    }
  }

  // Groups for the API Key group filter — includes disabled groups so admins can
  // filter users whose keys are still bound to a now-disabled group.
  const loadAllGroupsForApiKeyFilter = async () => {
    if (allGroupsForApiKeyFilterRef.current.length > 0) return
    try {
      setAllGroupsForApiKeyFilter(await adminAPI.groups.getAllIncludingInactive())
    } catch (e) {
      console.error('Failed to load groups for API key filter:', e)
    }
  }

  const loadAttributeDefinitions = async () => {
    try {
      setAttributeDefinitions(await adminAPI.userAttributes.listEnabledDefinitions())
    } catch (e) {
      console.error('Failed to load attribute definitions:', e)
    }
  }

  const loadUsersSecondaryData = async (userIds: number[], signal?: AbortSignal, expectedSeq?: number) => {
    if (userIds.length === 0) return
    const hidden = hiddenColumnsRef.current
    const definitions = attributeDefinitionsRef.current
    const stale = () => !!signal?.aborted || (typeof expectedSeq === 'number' && expectedSeq !== secondaryDataSeq.current)

    const tasks: Promise<void>[] = []

    const hasVisibleUsageColumn = !hidden.has('usage') || PLATFORM_USAGE_COLUMNS.some((k) => !hidden.has(k))
    if (hasVisibleUsageColumn) {
      tasks.push(
        (async () => {
          try {
            const usageResponse = await adminAPI.dashboard.getBatchUsersUsage(userIds)
            if (stale()) return
            setUsageStats(usageResponse.stats)
          } catch (e) {
            if (signal?.aborted) return
            console.error('Failed to load usage stats:', e)
          }
        })()
      )
    }

    const hasVisibleAttributeColumns = definitions.some((def) => def.enabled && !hidden.has(`attr_${def.id}`))
    if (definitions.length > 0 && hasVisibleAttributeColumns) {
      tasks.push(
        (async () => {
          try {
            const attrResponse = await adminAPI.userAttributes.getBatchUserAttributes(userIds)
            if (stale()) return
            setUserAttributeValues(attrResponse.attributes)
          } catch (e) {
            if (signal?.aborted) return
            console.error('Failed to load user attribute values:', e)
          }
        })()
      )
    }

    if (!hidden.has('balance_platform_quota')) {
      tasks.push(
        (async () => {
          try {
            // 无批量端点：对当前页用户逐个拉取，分块并发（每批 6），批间检查中止条件，避免大 pageSize 时请求洪峰
            const CHUNK = 6
            for (let i = 0; i < userIds.length; i += CHUNK) {
              if (stale()) return
              const chunk = userIds.slice(i, i + CHUNK)
              const results = await Promise.allSettled(chunk.map((id) => adminAPI.users.getPlatformQuotas(id)))
              if (stale()) return
              const merged: Record<number, PlatformQuotaItem[]> = {}
              results.forEach((r, idx) => {
                if (r.status === 'fulfilled') merged[chunk[idx]] = r.value.platform_quotas || []
              })
              setPlatformQuotaStats((prev) => ({ ...prev, ...merged }))
            }
          } catch (e) {
            if (signal?.aborted) return
            console.error('Failed to load platform quotas:', e)
          }
        })()
      )
    }

    if (tasks.length > 0) await Promise.allSettled(tasks)
  }

  const refreshCurrentPageSecondaryData = () => {
    const userIds = usersRef.current.map((u) => u.id)
    if (userIds.length === 0) return
    const seq = ++secondaryDataSeq.current
    void loadUsersSecondaryData(userIds, undefined, seq)
  }

  const loadUsers = async () => {
    abortControllerRef.current?.abort()
    const currentAbortController = new AbortController()
    abortControllerRef.current = currentAbortController
    const { signal } = currentAbortController
    setLoading(true)
    try {
      // Build attribute filters from active filters
      const attrFilters: Record<number, string> = {}
      for (const [attrId, value] of Object.entries(activeAttributeFiltersRef.current)) {
        if (value) attrFilters[Number(attrId)] = value
      }
      const page = paginationRef.current
      const currentFilters = filtersRef.current
      const sort = sortStateRef.current

      const response = await adminAPI.users.list(
        page.page,
        page.page_size,
        {
          role: currentFilters.role as any,
          status: currentFilters.status as any,
          search: searchQueryRef.current || undefined,
          group_name: currentFilters.group || undefined,
          api_key_group_id: currentFilters.apiKeyGroup ?? undefined,
          attributes: Object.keys(attrFilters).length > 0 ? attrFilters : undefined,
          // 始终请求 subscriptions：列隐藏时仍需用于 UserPlatformQuotaModal 的 active-subscription 警示 banner
          include_subscriptions: true,
          sort_by: sort.sort_by,
          sort_order: sort.sort_order
        },
        { signal }
      )
      if (signal.aborted) return
      setUsers(response.items)
      setPagination((prev) => ({ ...prev, total: response.total, pages: response.pages }))
      setUsageStats({})
      setUserAttributeValues({})
      setPlatformQuotaStats({})

      // Defer heavy secondary data so table can render first.
      if (response.items.length > 0) {
        const userIds = response.items.map((u) => u.id)
        const seq = ++secondaryDataSeq.current
        secondaryTimer.current = window.setTimeout(() => {
          if (signal.aborted || seq !== secondaryDataSeq.current) return
          void loadUsersSecondaryData(userIds, signal, seq)
        }, 50)
      }
    } catch (error: any) {
      const errorInfo = error as { name?: string; code?: string }
      if (errorInfo?.name === 'AbortError' || errorInfo?.name === 'CanceledError' || errorInfo?.code === 'ERR_CANCELED') {
        return
      }
      const message = error.response?.data?.detail || error.message || t('admin.users.failedToLoad')
      useAppStore.getState().showError(message)
      console.error('Error loading users:', error)
    } finally {
      if (abortControllerRef.current === currentAbortController) setLoading(false)
    }
  }

  // 挂载：写回列设置版本、加载属性定义后加载列表（Vue 版 onMounted）
  const mountedRef = useRef(false)
  useEffect(() => {
    if (savedColumns.persist === 'columns') saveColumnsToStorage(savedColumns.hidden)
    else if (savedColumns.persist === 'version') localStorage.setItem(COLUMN_SETTINGS_VERSION_KEY, String(COLUMN_SETTINGS_VERSION))

    mountedRef.current = true
    void (async () => {
      await loadAttributeDefinitions()
      if (!mountedRef.current) return
      void loadUsers()
      if (!hiddenColumnsRef.current.has('groups') || visibleFiltersRef.current.has('group')) void loadAllGroups()
      if (visibleFiltersRef.current.has('apiKeyGroup')) void loadAllGroupsForApiKeyFilter()
    })()

    // 滚动时关闭菜单
    const handleScroll = () => setActiveMenuId(null)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      mountedRef.current = false
      window.removeEventListener('scroll', handleScroll, true)
      if (secondaryTimer.current) window.clearTimeout(secondaryTimer.current)
      abortControllerRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时执行一次（Vue 版 onMounted / onUnmounted）
  }, [])

  // ===== 列设置 =====

  const toggleColumn = (key: string) => {
    // 强制可见列(如 last_active_at)在加载时会被恢复成可见，
    // 这里阻止用户在当前会话隐藏它，避免"取消勾选 → 刷新又恢复"的反直觉行为。
    if (FORCED_VISIBLE_COLUMNS.has(key)) return
    const next = new Set(hiddenColumnsRef.current)
    const wasHidden = next.has(key)
    if (wasHidden) next.delete(key)
    else next.add(key)
    setHiddenColumns(next)
    saveColumnsToStorage(next)
    if (wasHidden && (key === 'usage' || key.startsWith('usage_') || key.startsWith('attr_') || key === 'balance_platform_quota')) {
      refreshCurrentPageSecondaryData()
    }
    if (key === 'subscriptions') void loadUsers()
    if (wasHidden && key === 'groups') void loadAllGroups()
  }

  // ===== 用量列本地排序 =====

  const persistUsageSort = (value: UsageSortState) => {
    try {
      if (value) localStorage.setItem(USAGE_SORT_STORAGE_KEY, JSON.stringify(value))
      else localStorage.removeItem(USAGE_SORT_STORAGE_KEY)
    } catch (e) {
      console.error('Failed to persist usage sort:', e)
    }
  }

  const clearUsageSort = () => {
    if (!usageSort) return
    setUsageSort(null)
    setOpenUsageSortMenu(null)
    persistUsageSort(null)
  }

  const isUsageSortActive = (key: string, metric: UsageMetric) => !!usageSort && usageSort.key === key && usageSort.metric === metric
  const getUsageSortOrder = (key: string, metric: UsageMetric): SortOrder | null =>
    isUsageSortActive(key, metric) ? usageSort!.order : null

  // 三态循环：desc → asc → off。选完即关闭菜单（用户大多希望"选中即应用"，
  // 想再切换 order 时重新打开菜单点同一项即可）。
  const toggleUsageSort = (key: string, metric: UsageMetric) => {
    const cur = usageSort
    let next: UsageSortState
    if (cur && cur.key === key && cur.metric === metric) {
      next = cur.order === 'desc' ? { key, metric, order: 'asc' } : null
    } else {
      next = { key, metric, order: 'desc' }
    }
    setUsageSort(next)
    persistUsageSort(next)
    setOpenUsageSortMenu(null)
  }

  // ===== 列表交互 =====

  const handleSelectedKeysUpdate = (keys: RowKey[]) => {
    setSelectedIds(keys.filter((key): key is number => typeof key === 'number'))
  }

  const getUserSelectionLabel = (user: AdminUser) => t('admin.users.bulkLimits.selectUser', { email: user.email })

  const handleBulkLimitsSuccess = async () => {
    clearSelection()
    await loadUsers()
  }

  const handleSearch = () => {
    setPagination((prev) => ({ ...prev, page: 1 }))
    void loadUsers()
  }

  const handlePageChange = (page: number) => {
    // 确保页码在有效范围内
    const validPage = Math.max(1, Math.min(page, paginationRef.current.pages || 1))
    setPagination((prev) => ({ ...prev, page: validPage }))
    void loadUsers()
  }

  const handlePageSizeChange = (pageSize: number) => {
    setPagination((prev) => ({ ...prev, page_size: pageSize, page: 1 }))
    void loadUsers()
  }

  const handleSort = (key: string, order: SortOrder) => {
    clearUsageSort()
    setSortState({ sort_by: key, sort_order: order })
    setPagination((prev) => ({ ...prev, page: 1 }))
    void loadUsers()
  }

  // ===== 筛选 =====

  // Save filters to localStorage
  const saveFiltersToStorage = () => {
    try {
      localStorage.setItem(VISIBLE_FILTERS_KEY, JSON.stringify([...visibleFiltersRef.current]))
      const current = filtersRef.current
      const values = {
        role: current.role,
        status: current.status,
        group: current.group,
        apiKeyGroup: current.apiKeyGroup,
        attributes: activeAttributeFiltersRef.current
      }
      localStorage.setItem(FILTER_VALUES_KEY, JSON.stringify(values))
    } catch (e) {
      console.error('Failed to save filters:', e)
    }
  }

  const getAttributeDefinition = (attrId: number) => attributeDefinitions.find((d) => d.id === attrId)
  const getAttributeDefinitionName = (attrId: number): string => getAttributeDefinition(attrId)?.name || String(attrId)

  // Toggle a built-in filter (role/status/group/apiKeyGroup)
  const toggleBuiltInFilter = (key: string) => {
    const nextVisible = new Set(visibleFiltersRef.current)
    if (nextVisible.has(key)) {
      nextVisible.delete(key)
      const reset: Partial<FilterValues> = {}
      if (key === 'role') reset.role = ''
      if (key === 'status') reset.status = ''
      if (key === 'group') reset.group = ''
      if (key === 'apiKeyGroup') reset.apiKeyGroup = null
      setFilters((prev) => ({ ...prev, ...reset }))
    } else {
      nextVisible.add(key)
      if (key === 'group') void loadAllGroups()
      if (key === 'apiKeyGroup') void loadAllGroupsForApiKeyFilter()
    }
    setVisibleFilters(nextVisible)
    saveFiltersToStorage()
    setPagination((prev) => ({ ...prev, page: 1 }))
    void loadUsers()
  }

  // Toggle a custom attribute filter
  const toggleAttributeFilter = (attr: UserAttributeDefinition) => {
    const key = `attr_${attr.id}`
    const nextVisible = new Set(visibleFiltersRef.current)
    if (nextVisible.has(key)) {
      nextVisible.delete(key)
      setActiveAttributeFilters((prev) => {
        const next = { ...prev }
        delete next[attr.id]
        return next
      })
    } else {
      nextVisible.add(key)
      setActiveAttributeFilters((prev) => ({ ...prev, [attr.id]: '' }))
    }
    setVisibleFilters(nextVisible)
    saveFiltersToStorage()
    setPagination((prev) => ({ ...prev, page: 1 }))
    void loadUsers()
  }

  const updateAttributeFilter = (attrId: number, value: string) => setActiveAttributeFilters((prev) => ({ ...prev, [attrId]: value }))

  // Apply filter and save to localStorage
  const applyFilter = () => {
    saveFiltersToStorage()
    void loadUsers()
  }

  const updateFilter = (patch: Partial<FilterValues>) => {
    setFilters((prev) => ({ ...prev, ...patch }))
    applyFilter()
  }

  // ===== 行操作 =====

  const handleEdit = (user: AdminUser) => {
    setEditingUser(user)
    setShowEditModal(true)
  }

  const closeEditModal = () => {
    setShowEditModal(false)
    setEditingUser(null)
  }

  const handleToggleStatus = async (user: AdminUser) => {
    const newStatus = user.status === 'active' ? 'disabled' : 'active'
    const appStore = useAppStore.getState()
    try {
      const updated = await adminAPI.users.toggleStatus(user.id, newStatus)
      appStore.showSuccess(newStatus === 'active' ? t('admin.users.userEnabled') : t('admin.users.userDisabled'))
      if (loadingRef.current) {
        // 与本次更新并发的列表请求可能读到更新前的状态，重新拉取保证一致。
        void loadUsers()
        return
      }
      // 更新接口的响应不含 current_concurrency、subscriptions 等列表专属字段，只回写状态相关字段。
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: updated.status, updated_at: updated.updated_at } : u)))
    } catch (error: any) {
      appStore.showError(error.response?.data?.detail || t('admin.users.failedToToggle'))
      console.error('Error toggling user status:', error)
    }
  }

  const handleViewApiKeys = (user: AdminUser) => {
    setViewingUser(user)
    setShowApiKeysModal(true)
  }

  const closeApiKeysModal = () => {
    setShowApiKeysModal(false)
    setViewingUser(null)
  }

  const handleAllowedGroups = (user: AdminUser) => {
    setAllowedGroupsUser(user)
    setShowAllowedGroupsModal(true)
  }

  const closeAllowedGroupsModal = () => {
    setShowAllowedGroupsModal(false)
    setAllowedGroupsUser(null)
  }

  const openGroupReplace = (user: AdminUser, group: { id: number; name: string }) => {
    setExpandedGroupUserId(null)
    setGroupReplaceUser(user)
    setGroupReplaceOldGroup(group)
    setShowGroupReplaceModal(true)
  }

  const closeGroupReplaceModal = () => {
    setShowGroupReplaceModal(false)
    setGroupReplaceUser(null)
    setGroupReplaceOldGroup(null)
  }

  const handleDelete = (user: AdminUser) => {
    setDeletingUser(user)
    setShowDeleteDialog(true)
  }

  const confirmDelete = async () => {
    if (!deletingUser) return
    const appStore = useAppStore.getState()
    try {
      await adminAPI.users.delete(deletingUser.id)
      appStore.showSuccess(t('common.success'))
      setShowDeleteDialog(false)
      setDeletingUser(null)
      void loadUsers()
    } catch (error: any) {
      appStore.showError(error.response?.data?.detail || t('admin.users.failedToDelete'))
      console.error('Error deleting user:', error)
    }
  }

  const confirmBulkDelete = async () => {
    const ids = bulkDeleteIds
    setBulkDeleteIds([])
    setBulkDeleting(true)
    const appStore = useAppStore.getState()
    const deletedIds: number[] = []
    for (const id of ids) {
      try {
        await adminAPI.users.delete(id)
        deletedIds.push(id)
      } catch (error) {
        console.error('Error deleting user:', error)
      }
    }
    removeSelectedIds(deletedIds)
    if (deletedIds.length > 0) {
      appStore.showSuccess(t('admin.users.bulkDelete.success', { count: deletedIds.length }))
      setPagination((prev) => ({ ...prev, page: 1 }))
    }
    const failed = ids.length - deletedIds.length
    if (failed > 0) appStore.showError(t('admin.users.bulkDelete.failed', { count: failed }))
    await loadUsers()
    setBulkDeleting(false)
  }

  const handlePlatformQuota = (user: AdminUser) => {
    setPlatformQuotaUser(user)
    setShowPlatformQuotaModal(true)
  }

  const closePlatformQuotaModal = () => {
    setShowPlatformQuotaModal(false)
    setPlatformQuotaUser(null)
  }

  const handleDeposit = (user: AdminUser) => {
    setBalanceUser(user)
    setBalanceOperation('add')
    setShowBalanceModal(true)
  }

  const handleWithdraw = (user: AdminUser) => {
    setBalanceUser(user)
    setBalanceOperation('subtract')
    setShowBalanceModal(true)
  }

  const closeBalanceModal = () => {
    setShowBalanceModal(false)
    setBalanceUser(null)
  }

  const handleBalanceHistory = (user: AdminUser) => {
    setBalanceHistoryUser(user)
    setShowBalanceHistoryModal(true)
  }

  const closeBalanceHistoryModal = () => {
    setShowBalanceHistoryModal(false)
    setBalanceHistoryUser(null)
  }

  // Handle attributes modal close - reload definitions and users
  const handleAttributesModalClose = async () => {
    setShowAttributesModal(false)
    await loadAttributeDefinitions()
    void loadUsers()
  }

  // ===== 单元格辅助 =====

  // Get formatted attribute value for display in table
  const getAttributeValue = (userId: number, attrId: number): string => {
    const userAttrs = userAttributeValues[userId]
    if (!userAttrs) return '-'
    const value = userAttrs[attrId]
    if (!value) return '-'

    // Find definition for this attribute
    const def = attributeDefinitions.find((d) => d.id === attrId)
    if (!def) return value

    // Format based on type
    if (def.type === 'multi_select' && value) {
      try {
        const arr = JSON.parse(value)
        if (Array.isArray(arr)) {
          // Map values to labels
          return arr.map((v) => def.options?.find((o) => o.value === v)?.label || v).join(', ')
        }
      } catch {
        return value
      }
    }

    if (def.type === 'select' && value && def.options) {
      return def.options.find((o) => o.value === value)?.label || value
    }

    return value
  }

  // Resolve user's accessible groups: exclusive groups first, then public groups
  const getUserGroups = (user: AdminUser) => {
    const exclusive: AdminGroup[] = []
    const publicGroups: AdminGroup[] = []
    for (const g of allGroups) {
      if (g.status !== 'active' || g.subscription_type !== 'standard') continue
      if (g.is_exclusive) {
        if (user.allowed_groups?.includes(g.id)) exclusive.push(g)
      } else {
        publicGroups.push(g)
      }
    }
    return { exclusive, publicGroups }
  }

  const getPlatformUsage = (userId: number, platform: string) => usageStats[userId]?.by_platform?.find((p) => p.platform === platform)

  const groupNames = (list: AdminGroup[]) => (
    <div className={styles.tooltipList}>
      {list.map((g) => (
        <span key={g.id}>{g.name}</span>
      ))}
    </div>
  )

  const renderGroupsCell = (row: AdminUser) => {
    if (allGroups.length === 0) return <span className={styles.mutedXs}>-</span>
    const { exclusive, publicGroups } = getUserGroups(row)
    return (
      <div className={styles.groups}>
        {/* 专属分组行 */}
        {exclusive.length > 0 && (
          <Popover
            open={expandedGroupUserId === row.id}
            onOpenChange={(open) => setExpandedGroupUserId(open ? row.id : null)}
          >
            <Tooltip side="bottom" content={groupNames(exclusive)}>
              <PopoverTrigger asChild>
                <button type="button" className={styles.groupTrigger} onClick={(event) => event.stopPropagation()}>
                  <Shield size={14} strokeWidth={1.75} className={styles.exclusiveIcon} aria-hidden="true" />
                  <span className={styles.groupCount}>{exclusive.length}</span>
                  <span className={styles.groupLabel}>{t('admin.users.exclusiveLabel')}</span>
                </button>
              </PopoverTrigger>
            </Tooltip>
            {/* 点击展开分组操作菜单 */}
            <PopoverContent align="start" className={styles.menuPanel}>
              <div className={styles.menuList}>
                <div className={styles.menuHeading}>{t('admin.users.clickToReplace')}</div>
                {exclusive.map((g) => (
                  <button key={g.id} type="button" className={styles.menuItem} onClick={() => openGroupReplace(row, g)}>
                    <span className={styles.menuItemLabel}>
                      <ArrowLeftRight {...iconProps} size={14} className={styles.menuIcon} />
                      {g.name}
                    </span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
        {/* 公开分组行 */}
        {publicGroups.length > 0 && (
          <Tooltip side="bottom" content={groupNames(publicGroups)}>
            <span className={styles.groupStatic} tabIndex={0}>
              <Globe size={14} strokeWidth={1.75} className={styles.publicIcon} aria-hidden="true" />
              <span className={styles.groupCount}>{publicGroups.length}</span>
              <span className={styles.groupLabelMuted}>{t('admin.users.publicLabel')}</span>
            </span>
          </Tooltip>
        )}
        {/* 都没有 */}
        {exclusive.length === 0 && publicGroups.length === 0 && <span className={styles.mutedXs}>-</span>}
      </div>
    )
  }

  const renderActionMenu = (user: AdminUser) => (
    <Popover open={activeMenuId === user.id} onOpenChange={(open) => setActiveMenuId(open ? user.id : null)}>
      <PopoverTrigger asChild>
        <button type="button" className={styles.actionButton} data-active={activeMenuId === user.id || undefined}>
          <MoreHorizontal {...iconProps} />
          <span>{t('common.more')}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className={styles.menuPanel}>
        <div className={styles.menuList} role="menu">
          {(
            [
              { label: t('admin.users.apiKeys'), icon: <Key {...iconProps} />, onSelect: () => handleViewApiKeys(user) },
              { label: t('admin.users.groups'), icon: <Users {...iconProps} />, onSelect: () => handleAllowedGroups(user) },
              'separator',
              { label: t('admin.users.deposit'), icon: <Plus {...iconProps} />, onSelect: () => handleDeposit(user), tone: 'success' },
              { label: t('admin.users.withdraw'), icon: <Minus {...iconProps} />, onSelect: () => handleWithdraw(user), tone: 'warning' },
              { label: t('admin.users.platformQuota.menuItem'), icon: <BarChart3 {...iconProps} />, onSelect: () => handlePlatformQuota(user) },
              { label: t('admin.users.balanceHistory'), icon: <DollarSign {...iconProps} />, onSelect: () => handleBalanceHistory(user) },
              ...(user.role !== 'admin'
                ? [
                    'separator' as const,
                    { label: t('common.delete'), icon: <Trash2 {...iconProps} />, onSelect: () => handleDelete(user), tone: 'danger' }
                  ]
                : [])
            ] as Array<'separator' | { label: string; icon: ReactNode; onSelect: () => void; tone?: string }>
          ).map((item, index) =>
            item === 'separator' ? (
              <div key={`separator-${index}`} className={styles.menuSeparator} role="separator" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={styles.menuItem}
                data-tone={item.tone}
                onClick={() => {
                  item.onSelect()
                  setActiveMenuId(null)
                }}
              >
                <span className={styles.menuItemLabel}>
                  <span className={styles.menuIcon}>{item.icon}</span>
                  {item.label}
                </span>
              </button>
            )
          )}
        </div>
      </PopoverContent>
    </Popover>
  )

  // ===== 单元格与表头渲染 =====

  const cells: Record<string, (context: DataTableCellContext<AdminUser>) => ReactNode> = {
    email: ({ value }) => (
      <div className={styles.userCell}>
        <span className={styles.avatar} aria-hidden="true">
          {String(value).charAt(0).toUpperCase()}
        </span>
        <span className={styles.email}>{value}</span>
      </div>
    ),
    username: ({ value }) => <span className={styles.textSm}>{value || '-'}</span>,
    notes: ({ value }) =>
      value ? (
        <span className={styles.notes} title={value.length > 30 ? value : undefined}>
          {value.length > 30 ? value.substring(0, 25) + '...' : value}
        </span>
      ) : (
        <span className={styles.muted}>-</span>
      ),
    role: ({ value }) => (
      <Badge size="sm" tone={value === 'admin' ? 'info' : 'neutral'}>
        {t('admin.users.roles.' + value)}
      </Badge>
    ),
    groups: ({ row }) => renderGroupsCell(row),
    subscriptions: ({ row }) =>
      row.subscriptions && row.subscriptions.length > 0 ? (
        <div className={styles.subscriptions}>
          {row.subscriptions.map((sub) => (
            <GroupBadge
              key={sub.id}
              name={sub.group?.name || ''}
              platform={sub.group?.platform}
              subscriptionType={sub.group?.subscription_type}
              rateMultiplier={sub.group?.rate_multiplier}
              daysRemaining={sub.expires_at ? getDaysRemaining(sub.expires_at) : null}
              title={sub.expires_at ? formatDateTime(sub.expires_at) : ''}
            />
          ))}
        </div>
      ) : (
        <span className={styles.noSubscription}>
          <Ban size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>{t('admin.users.noSubscription')}</span>
        </span>
      ),
    balance: ({ value, row }) => (
      <div className={styles.balanceCell}>
        <Tooltip content={t('admin.users.balanceHistoryTip')}>
          <button type="button" className={styles.balanceButton} onClick={() => handleBalanceHistory(row)}>
            ${value.toFixed(2)}
          </button>
        </Tooltip>
        <button
          type="button"
          className={styles.depositButton}
          title={t('admin.users.deposit')}
          onClick={(event) => {
            event.stopPropagation()
            handleDeposit(row)
          }}
        >
          {t('admin.users.deposit')}
        </button>
      </div>
    ),
    balance_platform_quota: ({ row }) => (
      <button
        type="button"
        className={styles.quotaButton}
        title={t('admin.users.platformQuota.cellColumnTooltip')}
        onClick={() => handlePlatformQuota(row)}
      >
        <UserPlatformQuotaCell quotas={platformQuotaStats[row.id]} />
      </button>
    ),
    usage: ({ row }) => (
      <PlatformUsageBreakdown
        today={usageStats[row.id]?.today_actual_cost ?? 0}
        total={usageStats[row.id]?.total_actual_cost ?? 0}
        byPlatform={usageStats[row.id]?.by_platform}
      />
    ),
    usage_anthropic: ({ row }) => <PlatformCostCell usage={getPlatformUsage(row.id, 'anthropic')} />,
    usage_openai: ({ row }) => <PlatformCostCell usage={getPlatformUsage(row.id, 'openai')} />,
    usage_gemini: ({ row }) => <PlatformCostCell usage={getPlatformUsage(row.id, 'gemini')} />,
    usage_antigravity: ({ row }) => <PlatformCostCell usage={getPlatformUsage(row.id, 'antigravity')} />,
    concurrency: ({ row }) => <UserConcurrencyCell current={row.current_concurrency ?? 0} max={row.concurrency} />,
    status: ({ value }) => (
      <Badge size="sm" tone={value === 'active' ? 'success' : 'danger'}>
        {value === 'active' ? t('common.active') : t('admin.users.disabled')}
      </Badge>
    ),
    created_at: ({ value }) => <span className={styles.date}>{formatDateTime(value)}</span>,
    last_used_at: ({ value }) => <span className={styles.date}>{value ? formatDateTime(value) : '-'}</span>,
    last_active_at: ({ value }) => <span className={styles.date}>{value ? formatDateTime(value) : '-'}</span>,
    actions: ({ row }) => (
      <div className={styles.actions}>
        {/* Edit Button */}
        <button type="button" className={styles.actionButton} onClick={() => handleEdit(row)}>
          <Pencil {...iconProps} />
          <span>{t('common.edit')}</span>
        </button>

        {/* Toggle Status Button (not for admin) */}
        {row.role !== 'admin' && (
          <button
            type="button"
            className={styles.actionButton}
            data-tone={row.status === 'active' ? 'warning' : 'success'}
            onClick={() => void handleToggleStatus(row)}
          >
            {row.status === 'active' ? <Ban {...iconProps} /> : <CheckCircle2 {...iconProps} />}
            <span>{row.status === 'active' ? t('admin.users.disable') : t('admin.users.enable')}</span>
          </button>
        )}

        {/* More Actions Menu Trigger */}
        {renderActionMenu(row)}
      </div>
    )
  }

  // Dynamic attribute columns
  for (const def of enabledAttributes) {
    cells[`attr_${def.id}`] = ({ row }) => {
      const text = getAttributeValue(row.id, def.id)
      return (
        <span className={styles.attrValue} title={text}>
          {text}
        </span>
      )
    }
  }

  // 用量列自定义表头：列名 + 单个排序图标按钮，点击展开"今日/近30天"菜单。
  // column.sortable=false，DataTable 内置点击逻辑不会触发；菜单项三态循环：desc → asc → off。
  const headers: Record<string, (context: DataTableHeaderContext) => ReactNode> = {}
  for (const usageKey of USAGE_COLUMN_KEYS) {
    headers[usageKey] = ({ column }) => {
      const active = !!usageSort && usageSort.key === usageKey
      return (
        <div className={styles.usageHeader}>
          <span>{column.label}</span>
          <Popover
            open={openUsageSortMenu === usageKey}
            onOpenChange={(open) => setOpenUsageSortMenu(open ? usageKey : null)}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className={styles.usageSortTrigger}
                data-active={active || undefined}
                title={t('admin.users.sortBy')}
                aria-label={t('admin.users.sortBy')}
                data-test={`usage-sort-trigger-${usageKey}`}
                onClick={(event) => event.stopPropagation()}
              >
                {active ? (
                  <>
                    <span className={styles.usageSortMetric}>
                      {usageSort!.metric === 'today' ? t('admin.users.today') : t('admin.users.total')}
                    </span>
                    <ChevronUp size={14} strokeWidth={2} className={usageSort!.order === 'desc' ? styles.rotated : undefined} aria-hidden="true" />
                  </>
                ) : (
                  <ChevronsUpDown size={14} strokeWidth={2} aria-hidden="true" />
                )}
              </button>
            </PopoverTrigger>
            {/* 弹出菜单：今日 / 近30天，点击进行三态循环切换。 */}
            <PopoverContent align="end" className={styles.sortMenu}>
              <div className={styles.menuList}>
                {(['today', 'total'] as const).map((metric) => {
                  const order = getUsageSortOrder(usageKey, metric)
                  return (
                    <button
                      key={metric}
                      type="button"
                      className={styles.menuItem}
                      data-selected={isUsageSortActive(usageKey, metric) || undefined}
                      data-test={`usage-sort-${usageKey}-${metric}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleUsageSort(usageKey, metric)
                      }}
                    >
                      <span>{metric === 'today' ? t('admin.users.today') : t('admin.users.total')}</span>
                      {order && (
                        <ChevronUp size={12} strokeWidth={2} className={order === 'desc' ? styles.rotated : undefined} aria-hidden="true" />
                      )}
                    </button>
                  )
                })}
                <div className={styles.menuFootnote}>{t('admin.users.sortCurrentPageOnly')}</div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )
    }
  }

  // ===== 工具栏 =====

  const filterSettingsMenu = (
    <Popover open={showFilterDropdown} onOpenChange={setShowFilterDropdown}>
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" title={t('admin.users.filterSettings')} aria-label={t('admin.users.filterSettings')}>
          <Filter {...iconProps} />
          <span className={styles.desktopOnly}>{t('admin.users.filterSettings')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className={styles.menuPanel}>
        <div className={styles.menuList}>
          {/* Built-in filters */}
          {builtInFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              role="menuitemcheckbox"
              aria-checked={visibleFilters.has(filter.key)}
              className={styles.menuItem}
              onClick={() => toggleBuiltInFilter(filter.key)}
            >
              <span>{filter.name}</span>
              {visibleFilters.has(filter.key) && <Check {...iconProps} className={styles.check} />}
            </button>
          ))}
          {/* Divider if custom attributes exist */}
          {enabledAttributes.length > 0 && <div className={styles.menuSeparator} role="separator" />}
          {/* Custom attribute filters */}
          {enabledAttributes.map((attr) => (
            <button
              key={attr.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={visibleFilters.has(`attr_${attr.id}`)}
              className={styles.menuItem}
              onClick={() => toggleAttributeFilter(attr)}
            >
              <span>{attr.name}</span>
              {visibleFilters.has(`attr_${attr.id}`) && <Check {...iconProps} className={styles.check} />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )

  const columnSettingsMenu = (
    <Popover open={showColumnDropdown} onOpenChange={setShowColumnDropdown}>
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" title={t('admin.users.columnSettings')} aria-label={t('admin.users.columnSettings')}>
          <Columns3 {...iconProps} />
          <span className={styles.desktopOnly}>{t('admin.users.columnSettings')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className={`${styles.menuPanel} ${styles.columnsPanel}`}>
        <div className={styles.menuList}>
          {toggleableColumns.map((col) => (
            <button
              key={col.key}
              type="button"
              role="menuitemcheckbox"
              aria-checked={isColumnVisible(col.key)}
              disabled={isForcedVisibleColumn(col.key)}
              title={isForcedVisibleColumn(col.key) ? t('admin.users.columnAlwaysVisible') : ''}
              className={styles.menuItem}
              onClick={() => toggleColumn(col.key)}
            >
              <span className={styles.truncate}>{col.label}</span>
              {isColumnVisible(col.key) && <Check {...iconProps} className={styles.check} />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )

  const renderAttributeFilter = (attrId: number, value: string) => {
    if (!visibleFilters.has(`attr_${attrId}`)) return null
    const def = getAttributeDefinition(attrId)
    const type = def?.type || 'text'
    const name = getAttributeDefinitionName(attrId)
    // Select/Multi-select type
    if (def && (def.type === 'select' || def.type === 'multi_select')) {
      return (
        <div key={attrId} className={styles.filterMedium}>
          <Select
            value={value}
            options={[{ value: '', label: name }, ...(def.options || [])]}
            aria-label={name}
            onChange={(val) => {
              updateAttributeFilter(attrId, String(val ?? ''))
              applyFilter()
            }}
          />
        </div>
      )
    }
    // Text/Email/URL/Textarea/Date type: styled input；Number type: number input；Fallback
    return (
      <div key={attrId} className={styles.filterMedium}>
        <Input
          type={type === 'number' ? 'number' : 'text'}
          value={value}
          placeholder={name}
          aria-label={name}
          onChange={(next) => updateAttributeFilter(attrId, next)}
          onEnter={applyFilter}
        />
      </div>
    )
  }

  const toSelectString = (value: SelectValue) => (value == null ? '' : String(value))

  const filtersBar = (
    <div className={styles.toolbar}>
      {/* Left: Search + Active Filters */}
      <div className={styles.filterGroup}>
        <div className={styles.search}>
          <SearchInput
            value={searchQuery}
            placeholder={t('admin.users.searchUsers')}
            aria-label={t('admin.users.searchUsers')}
            onChange={setSearchQuery}
            onSearch={handleSearch}
          />
        </div>

        {/* Role Filter (visible when enabled) */}
        {visibleFilters.has('role') && (
          <div className={styles.filterSmall}>
            <Select
              value={filters.role}
              aria-label={t('admin.users.columns.role')}
              options={[
                { value: '', label: t('admin.users.allRoles') },
                { value: 'admin', label: t('admin.users.admin') },
                { value: 'user', label: t('admin.users.user') }
              ]}
              onChange={(value) => updateFilter({ role: toSelectString(value) })}
            />
          </div>
        )}

        {/* Status Filter (visible when enabled) */}
        {visibleFilters.has('status') && (
          <div className={styles.filterSmall}>
            <Select
              value={filters.status}
              aria-label={t('admin.users.columns.status')}
              options={[
                { value: '', label: t('admin.users.allStatus') },
                { value: 'active', label: t('common.active') },
                { value: 'disabled', label: t('admin.users.disabled') }
              ]}
              onChange={(value) => updateFilter({ status: toSelectString(value) })}
            />
          </div>
        )}

        {/* Group Filter (visible when enabled) */}
        {visibleFilters.has('group') && (
          <div className={styles.filterLarge}>
            <Select
              value={filters.group}
              aria-label={t('admin.users.authorizedGroupFilter')}
              options={groupFilterOptions}
              searchable
              creatable
              creatablePrefix={t('admin.users.fuzzySearch')}
              searchPlaceholder={t('admin.users.searchAuthorizedGroups')}
              onChange={(value) => updateFilter({ group: toSelectString(value) })}
            />
          </div>
        )}

        {/* API Key Group Filter (visible when enabled) */}
        {visibleFilters.has('apiKeyGroup') && (
          <div className={styles.filterLarge}>
            <Select
              value={filters.apiKeyGroup}
              aria-label={t('admin.users.apiKeyGroupFilter')}
              options={apiKeyGroupFilterOptions}
              searchable
              searchPlaceholder={t('admin.users.searchApiKeyGroups')}
              onChange={(value) => updateFilter({ apiKeyGroup: typeof value === 'number' ? value : null })}
            />
          </div>
        )}

        {/* Dynamic Attribute Filters */}
        {Object.entries(activeAttributeFilters).map(([attrId, value]) => renderAttributeFilter(Number(attrId), value))}
      </div>

      {/* Right: Actions and Settings */}
      <div className={styles.actionGroup}>
        {/* Refresh Button */}
        <Button
          type="button"
          variant="secondary"
          disabled={loading}
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
          onClick={() => void loadUsers()}
        >
          <RefreshCw {...iconProps} className={loading ? styles.spinning : undefined} />
        </Button>
        {/* Filter Settings Dropdown */}
        {filterSettingsMenu}
        {/* Column Settings Dropdown */}
        {columnSettingsMenu}
        {/* Attributes Config Button */}
        <Button
          type="button"
          variant="secondary"
          title={t('admin.users.attributes.configButton')}
          aria-label={t('admin.users.attributes.configButton')}
          onClick={() => setShowAttributesModal(true)}
        >
          <Settings {...iconProps} />
          <span className={styles.desktopOnly}>{t('admin.users.attributes.configButton')}</span>
        </Button>
        {/* Create User Button */}
        <Button type="button" variant="primary" onClick={() => setShowCreateModal(true)}>
          <Plus {...iconProps} />
          {t('admin.users.createUser')}
        </Button>
      </div>
    </div>
  )

  const table = (
    <div className={styles.region}>
      {/* 选中用户后的批量操作栏 */}
      {selectedCount > 0 && (
        <div className={styles.selectionBar} role="toolbar" aria-label={t('admin.users.bulkLimits.selectedCount', { count: selectedCount })}>
          <span className={styles.selectionCount}>{t('admin.users.bulkLimits.selectedCount', { count: selectedCount })}</span>
          <div className={styles.selectionActions}>
            <Button type="button" variant="secondary" size="sm" data-test="bulk-edit-limits" onClick={() => setShowBulkEditModal(true)}>
              <Users {...iconProps} />
              {t('admin.users.bulkLimits.action', { count: selectedCount })}
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              data-test="bulk-delete-users"
              disabled={bulkDeleting}
              onClick={() => setBulkDeleteIds([...selectedIds])}
            >
              <Trash2 {...iconProps} />
              {t('admin.users.bulkDelete.action', { count: selectedCount })}
            </Button>
          </div>
        </div>
      )}
      <div className={styles.tableArea}>
        <DataTable<AdminUser>
          columns={columns}
          data={sortedUsers}
          loading={loading}
          rowKey="id"
          selectable
          selectedKeys={selectedIds}
          onSelectedKeysChange={handleSelectedKeysUpdate}
          selectionLabel={getUserSelectionLabel}
          actionsCount={7}
          serverSideSort
          defaultSortKey="created_at"
          defaultSortOrder="desc"
          sortStorageKey={USER_SORT_STORAGE_KEY}
          onSort={handleSort}
          cells={cells}
          headers={headers}
          className={styles.dataTable}
          empty={
            <EmptyState
              title={t('admin.users.noUsersYet')}
              description={t('admin.users.createFirstUser')}
              actionText={t('admin.users.createUser')}
              onAction={() => setShowCreateModal(true)}
            />
          }
        />
      </div>
    </div>
  )

  return (
    <>
      <TablePageLayout
        filters={filtersBar}
        table={table}
        pagination={
          pagination.total > 0 ? (
            <Pagination
              page={pagination.page}
              total={pagination.total}
              pageSize={pagination.page_size}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          ) : null
        }
      />

      <ConfirmDialog
        show={showDeleteDialog}
        title={t('admin.users.deleteUser')}
        message={t('admin.users.deleteConfirm', { email: deletingUser?.email })}
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setShowDeleteDialog(false)}
      />
      <ConfirmDialog
        show={bulkDeleteIds.length > 0}
        title={t('admin.users.bulkDelete.title')}
        message={t('admin.users.bulkDelete.confirm', { count: bulkDeleteIds.length })}
        confirmText={t('common.delete')}
        danger
        onConfirm={() => void confirmBulkDelete()}
        onCancel={() => setBulkDeleteIds([])}
      />
      <UserCreateModal show={showCreateModal} onClose={() => setShowCreateModal(false)} onSuccess={() => void loadUsers()} />
      <UserEditModal show={showEditModal} user={editingUser} onClose={closeEditModal} onSuccess={() => void loadUsers()} />
      <BulkEditUserModal
        show={showBulkEditModal}
        selectedIds={selectedIds}
        onClose={() => setShowBulkEditModal(false)}
        onSuccess={() => void handleBulkLimitsSuccess()}
      />
      <UserPlatformQuotaModal
        show={showPlatformQuotaModal}
        user={platformQuotaUser}
        onClose={closePlatformQuotaModal}
        onSuccess={() => void loadUsers()}
      />
      <UserApiKeysModal show={showApiKeysModal} user={viewingUser} onClose={closeApiKeysModal} />
      <UserAllowedGroupsModal
        show={showAllowedGroupsModal}
        user={allowedGroupsUser}
        onClose={closeAllowedGroupsModal}
        onSuccess={() => void loadUsers()}
      />
      <UserBalanceModal
        show={showBalanceModal}
        user={balanceUser}
        operation={balanceOperation}
        onClose={closeBalanceModal}
        onSuccess={() => void loadUsers()}
      />
      <UserBalanceHistoryModal
        show={showBalanceHistoryModal}
        user={balanceHistoryUser}
        onClose={closeBalanceHistoryModal}
        onDeposit={() => {
          // Handle deposit from balance history modal
          if (balanceHistoryUser) handleDeposit(balanceHistoryUser)
        }}
        onWithdraw={() => {
          // Handle withdraw from balance history modal
          if (balanceHistoryUser) handleWithdraw(balanceHistoryUser)
        }}
      />
      <GroupReplaceModal
        show={showGroupReplaceModal}
        user={groupReplaceUser}
        oldGroup={groupReplaceOldGroup}
        allGroups={allGroups}
        onClose={closeGroupReplaceModal}
        onSuccess={() => void loadUsers()}
      />
      <UserAttributesConfigModal show={showAttributesModal} onClose={() => void handleAttributesModalClose()} />
    </>
  )
}
