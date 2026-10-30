/**
 * 订阅管理页，对应 Vue 版 views/admin/SubscriptionsView.vue。
 * 工具栏（用户筛选、状态、分组、列设置、使用指南、分配订阅）+ 表格区域（批量操作栏、订阅表格）+ 分页；
 * 分配、调整、撤销、恢复、重置额度与批量操作沿用 Vue 版的接口调用与校验。
 */
import {
  ArrowRight,
  Ban,
  CalendarDays,
  Check,
  CircleHelp,
  Clock,
  Columns3,
  Plus,
  RefreshCw,
  RotateCcw,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'

import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover'
import { adminAPI } from '@/api/admin'
import type { SimpleUser } from '@/api/admin/usage'
import type {
  BulkAssignSubscriptionResult,
  SubscriptionBulkAction,
  SubscriptionBulkActionResult
} from '@/api/admin/subscriptions'
import BulkSubscriptionActionDialog from '@/components/admin/subscription/BulkSubscriptionActionDialog'
import UserSearchPicker from '@/components/admin/subscription/UserSearchPicker'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import DataTable, { type DataTableCellContext, type RowKey } from '@/components/common/DataTable'
import EmptyState from '@/components/common/EmptyState'
import GroupBadge from '@/components/common/GroupBadge'
import GroupOptionItem from '@/components/common/GroupOptionItem'
import Input from '@/components/common/Input'
import Pagination from '@/components/common/Pagination'
import Select, { type SelectOption, type SelectValue } from '@/components/common/Select'
import TablePageLayout from '@/components/common/TablePageLayout'
import type { Column } from '@/components/common/types'
import { getPersistedPageSize } from '@/composables/usePersistedPageSize'
import { useTableSelection } from '@/composables/useTableSelection'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminUser, Group, GroupPlatform, SubscriptionType, UserSubscription } from '@/types'
import { formatDateTimeToMinute } from '@/utils/format'
import {
  getRemainingDurationParts,
  getRemainingExpiryDuration,
  isOneTimeDailyQuota,
  type RemainingDurationParts
} from '@/utils/subscriptionQuota'
import styles from './SubscriptionsView.module.css'

interface GroupOption {
  value: number
  label: string
  description: string | null
  platform: GroupPlatform
  subscriptionType: SubscriptionType
  rate: number
}

interface Filters {
  status: string
  group_id: string
  platform: string
  user_id: number | null
}

interface SortState {
  sort_by: string
  sort_order: 'asc' | 'desc'
}

interface PaginationState {
  page: number
  page_size: number
  total: number
  pages: number
}

type UserColumnMode = 'email' | 'username'
type QuotaPeriod = 'daily' | 'weekly' | 'monthly'

const USER_COLUMN_MODE_KEY = 'subscription-user-column-mode'
// localStorage key
const HIDDEN_COLUMNS_KEY = 'subscription-hidden-columns'
// Default hidden columns
const DEFAULT_HIDDEN_COLUMNS: string[] = []
const bulkActions: SubscriptionBulkAction[] = ['extend', 'reset_quota', 'revoke', 'restore']
const iconProps = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

const loadUserColumnMode = (): UserColumnMode => {
  try {
    const saved = localStorage.getItem(USER_COLUMN_MODE_KEY)
    if (saved === 'email' || saved === 'username') return saved
  } catch (e) {
    console.error('Failed to load user column mode:', e)
  }
  return 'email'
}

const saveUserColumnMode = (mode: UserColumnMode) => {
  try {
    localStorage.setItem(USER_COLUMN_MODE_KEY, mode)
  } catch (e) {
    console.error('Failed to save user column mode:', e)
  }
}

// Load saved column settings
const loadSavedColumns = (): Set<string> => {
  const hidden = new Set<string>()
  try {
    const saved = localStorage.getItem(HIDDEN_COLUMNS_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as string[]
      parsed.forEach((key) => hidden.add(key))
    } else {
      DEFAULT_HIDDEN_COLUMNS.forEach((key) => hidden.add(key))
    }
  } catch (e) {
    console.error('Failed to load saved columns:', e)
    DEFAULT_HIDDEN_COLUMNS.forEach((key) => hidden.add(key))
  }
  return hidden
}

// Save column settings to localStorage
const saveColumnsToStorage = (hidden: Set<string>) => {
  try {
    localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify([...hidden]))
  } catch (e) {
    console.error('Failed to save columns:', e)
  }
}

// Helper functions
const getDaysRemaining = (expiresAt: string): number | null => {
  const now = new Date()
  const expires = new Date(expiresAt)
  const diff = expires.getTime() - now.getTime()
  if (diff < 0) return null
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

const isExpiringSoon = (expiresAt: string): boolean => {
  const days = getDaysRemaining(expiresAt)
  return days !== null && days <= 7
}

const getProgressWidth = (used: number | null | undefined, limit: number | null | undefined): string => {
  if (!limit || limit === 0) return '0%'
  const usedValue = used ?? 0
  const percentage = Math.min((usedValue / limit) * 100, 100)
  return `${percentage}%`
}

const getProgressTone = (used: number | null | undefined, limit: number | null | undefined): string => {
  if (!limit || limit === 0) return 'muted'
  const usedValue = used ?? 0
  const percentage = (usedValue / limit) * 100
  if (percentage >= 90) return 'danger'
  if (percentage >= 70) return 'warning'
  return 'success'
}

const isAbortError = (error: unknown) => {
  const failure = error as { name?: string; code?: string } | null
  return failure?.name === 'AbortError' || failure?.code === 'ERR_CANCELED'
}

const errorDetail = (error: unknown): string | undefined =>
  (error as { response?: { data?: { detail?: string } } } | null)?.response?.data?.detail

export default function SubscriptionsView() {
  const { t } = useI18n()

  // Guide modal state
  const [showGuideModal, setShowGuideModal] = useState(false)

  // User column display mode: 'email' or 'username'
  const [userColumnMode, setUserColumnModeState] = useState<UserColumnMode>(loadUserColumnMode)
  // Hidden columns set
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(loadSavedColumns)
  // Column dropdown state
  const [showColumnDropdown, setShowColumnDropdown] = useState(false)

  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([])
  const subscriptionsRef = useRef(subscriptions)
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const {
    selectedIds,
    selectedCount,
    setSelectedIds,
    clear: clearSelection,
    removeMany: removeSelectedIds,
    batchUpdate: updateSelection
  } = useTableSelection<UserSubscription>({ rows: subscriptions, getId: (subscription) => subscription.id })
  const [bulkAction, setBulkAction] = useState<SubscriptionBulkAction | null>(null)
  const [bulkSubscriptions, setBulkSubscriptions] = useState<UserSubscription[]>([])

  // Toolbar user filter (fuzzy search -> select user_id)
  const [filterUserKeyword, setFilterUserKeyword] = useState('')
  const filterUserKeywordRef = useRef('')
  const [filterUserResults, setFilterUserResults] = useState<SimpleUser[]>([])
  const [filterUserLoading, setFilterUserLoading] = useState(false)
  const [showFilterUserDropdown, setShowFilterUserDropdown] = useState(false)
  const [selectedFilterUser, setSelectedFilterUserState] = useState<SimpleUser | null>(null)
  const selectedFilterUserRef = useRef<SimpleUser | null>(null)
  const filterUserSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // User search state
  const [userSearchKeyword, setUserSearchKeyword] = useState('')
  const userSearchKeywordRef = useRef('')
  const [userSearchResults, setUserSearchResults] = useState<AdminUser[]>([])
  const [userSearchLoading, setUserSearchLoading] = useState(false)
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [batchAssignEnabled, setBatchAssignEnabled] = useState(false)
  const [assignUsers, setAssignUsers] = useState<AdminUser[]>([])
  const [batchAssignResult, setBatchAssignResult] = useState<BulkAssignSubscriptionResult | null>(null)
  const userSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [filters, setFiltersState] = useState<Filters>({ status: 'active', group_id: '', platform: '', user_id: null })
  const filtersRef = useRef(filters)
  // Sorting state
  const sortRef = useRef<SortState>({ sort_by: 'created_at', sort_order: 'desc' })
  const [pagination, setPaginationState] = useState<PaginationState>(() => ({
    page: 1,
    page_size: getPersistedPageSize(),
    total: 0,
    pages: 0
  }))
  const paginationRef = useRef(pagination)

  const [showAssignModal, setShowAssignModal] = useState(false)
  const [showExtendModal, setShowExtendModal] = useState(false)
  const [showRevokeDialog, setShowRevokeDialog] = useState(false)
  const [showRestoreDialog, setShowRestoreDialog] = useState(false)
  const [showResetQuotaConfirm, setShowResetQuotaConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [resettingSubscription, setResettingSubscription] = useState<UserSubscription | null>(null)
  const [resettingQuota, setResettingQuota] = useState(false)
  const resettingQuotaRef = useRef(false)
  const [extendingSubscription, setExtendingSubscription] = useState<UserSubscription | null>(null)
  const [revokingSubscription, setRevokingSubscription] = useState<UserSubscription | null>(null)
  const [restoringSubscription, setRestoringSubscription] = useState<UserSubscription | null>(null)

  const [assignForm, setAssignForm] = useState<{ user_id: number | null; group_id: number | null; validity_days: number | string }>({
    user_id: null,
    group_id: null,
    validity_days: 30
  })
  const [extendDays, setExtendDays] = useState<number | string>(30)

  const setSubmittingState = (value: boolean) => {
    submittingRef.current = value
    setSubmitting(value)
  }

  const updateFilters = (patch: Partial<Filters>) => {
    filtersRef.current = { ...filtersRef.current, ...patch }
    setFiltersState(filtersRef.current)
  }

  const updatePagination = (patch: Partial<PaginationState>) => {
    paginationRef.current = { ...paginationRef.current, ...patch }
    setPaginationState(paginationRef.current)
  }

  const setSelectedFilterUser = (user: SimpleUser | null) => {
    selectedFilterUserRef.current = user
    setSelectedFilterUserState(user)
  }

  const setUserColumnMode = (mode: UserColumnMode) => {
    setUserColumnModeState(mode)
    saveUserColumnMode(mode)
  }

  // All available columns
  const allColumns = useMemo<Column<UserSubscription>[]>(
    () => [
      {
        key: 'user',
        label: userColumnMode === 'email' ? t('admin.subscriptions.columns.user') : t('admin.users.columns.username'),
        sortable: false
      },
      { key: 'group', label: t('admin.subscriptions.columns.group'), sortable: false },
      { key: 'usage', label: t('admin.subscriptions.columns.usage'), sortable: false },
      { key: 'expires_at', label: t('admin.subscriptions.columns.expires'), sortable: true },
      { key: 'status', label: t('admin.subscriptions.columns.status'), sortable: true },
      { key: 'actions', label: t('admin.subscriptions.columns.actions'), sortable: false }
    ],
    [t, userColumnMode]
  )

  // Columns that can be toggled (exclude user and actions which are always visible)
  const toggleableColumns = allColumns.filter((col) => col.key !== 'user' && col.key !== 'actions')

  // Toggle column visibility
  const toggleColumn = (key: string) => {
    const next = new Set(hiddenColumns)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setHiddenColumns(next)
    saveColumnsToStorage(next)
  }

  // Check if column is visible
  const isColumnVisible = (key: string) => !hiddenColumns.has(key)

  // Filtered columns for display
  const columns = allColumns.filter((col) => col.key === 'user' || col.key === 'actions' || !hiddenColumns.has(col.key))

  // Filter options
  const statusOptions = [
    { value: '', label: t('admin.subscriptions.allStatus') },
    { value: 'active', label: t('admin.subscriptions.status.active') },
    { value: 'expired', label: t('admin.subscriptions.status.expired') },
    { value: 'revoked', label: t('admin.subscriptions.status.revoked') }
  ]

  // Group options for filter (all groups)
  const groupOptions = [
    { value: '', label: t('admin.subscriptions.allGroups') },
    ...groups.map((g) => ({ value: g.id.toString(), label: g.name }))
  ]

  // Group options for assign (only subscription type groups)
  const subscriptionGroupOptions: GroupOption[] = groups
    .filter((g) => g.subscription_type === 'subscription' && g.status === 'active')
    .map((g) => ({
      value: g.id,
      label: g.name,
      description: g.description,
      platform: g.platform,
      subscriptionType: g.subscription_type,
      rate: g.rate_multiplier
    }))

  const bulkTargets = useMemo(() => {
    const selected = subscriptions.filter((subscription) => selectedIds.includes(subscription.id))
    return {
      extend: selected.filter((subscription) => ['active', 'expired'].includes(subscription.status)),
      reset_quota: selected.filter((subscription) => subscription.status === 'active'),
      revoke: selected.filter((subscription) => subscription.status === 'active'),
      restore: selected.filter((subscription) => subscription.status === 'revoked')
    }
  }, [subscriptions, selectedIds])

  const getSubscriptionSelectionLabel = (subscription: UserSubscription) =>
    t('admin.subscriptions.bulk.selectSubscription', { id: subscription.id })

  const handleSelectedKeysUpdate = (keys: RowKey[]) => {
    const visibleIds = new Set(subscriptionsRef.current.map((subscription) => subscription.id))
    setSelectedIds(keys.filter((key): key is number => typeof key === 'number' && visibleIds.has(key)))
  }

  const loadSubscriptions = async () => {
    abortControllerRef.current?.abort()
    const requestController = new AbortController()
    abortControllerRef.current = requestController
    const { signal } = requestController

    setLoading(true)
    try {
      const currentFilters = filtersRef.current
      const response = await adminAPI.subscriptions.list(
        paginationRef.current.page,
        paginationRef.current.page_size,
        {
          status: (currentFilters.status as 'active' | 'expired' | 'revoked') || undefined,
          group_id: currentFilters.group_id ? parseInt(currentFilters.group_id) : undefined,
          user_id: currentFilters.user_id || undefined,
          sort_by: sortRef.current.sort_by,
          sort_order: sortRef.current.sort_order
        },
        {
          signal
        }
      )
      if (signal.aborted || abortControllerRef.current !== requestController) return
      subscriptionsRef.current = response.items
      setSubscriptions(response.items)
      const visibleIds = new Set(response.items.map((subscription) => subscription.id))
      updateSelection((draft) => {
        for (const id of [...draft]) {
          if (!visibleIds.has(id)) draft.delete(id)
        }
      })
      updatePagination({ total: response.total, pages: response.pages })
    } catch (error: unknown) {
      if (signal.aborted || isAbortError(error)) {
        return
      }
      useAppStore.getState().showError(t('admin.subscriptions.failedToLoad'))
      console.error('Error loading subscriptions:', error)
    } finally {
      if (abortControllerRef.current === requestController) {
        setLoading(false)
        abortControllerRef.current = null
      }
    }
  }

  const loadGroups = async () => {
    try {
      setGroups(await adminAPI.groups.getAll())
    } catch (error) {
      console.error('Error loading groups:', error)
    }
  }

  const applyFilters = () => {
    clearSelection()
    updatePagination({ page: 1 })
    void loadSubscriptions()
  }

  const openBulkAction = (action: SubscriptionBulkAction) => {
    if (loading || bulkTargets[action].length === 0) return
    setBulkSubscriptions([...bulkTargets[action]])
    setBulkAction(action)
  }

  const handleBulkCompleted = async (result: SubscriptionBulkActionResult) => {
    removeSelectedIds(result.results.filter((item) => item.success).map((item) => item.subscription_id))
    await loadSubscriptions()
  }

  // Toolbar user filter search with debounce
  const searchFilterUsers = async () => {
    const keyword = filterUserKeywordRef.current.trim()

    // Clear active user filter if user modified the search keyword
    const selected = selectedFilterUserRef.current
    if (selected && keyword !== selected.email) {
      setSelectedFilterUser(null)
      updateFilters({ user_id: null })
      applyFilters()
    }

    if (!keyword) {
      setFilterUserResults([])
      return
    }

    setFilterUserLoading(true)
    try {
      setFilterUserResults(await adminAPI.usage.searchUsers(keyword))
    } catch (error) {
      console.error('Failed to search users:', error)
      setFilterUserResults([])
    } finally {
      setFilterUserLoading(false)
    }
  }

  const debounceSearchFilterUsers = (value: string) => {
    filterUserKeywordRef.current = value
    setFilterUserKeyword(value)
    if (filterUserSearchTimeout.current) {
      clearTimeout(filterUserSearchTimeout.current)
    }
    filterUserSearchTimeout.current = setTimeout(() => void searchFilterUsers(), 300)
  }

  const selectFilterUser = (user: SimpleUser) => {
    setSelectedFilterUser(user)
    filterUserKeywordRef.current = user.email
    setFilterUserKeyword(user.email)
    setShowFilterUserDropdown(false)
    updateFilters({ user_id: user.id })
    applyFilters()
  }

  const clearFilterUser = () => {
    setSelectedFilterUser(null)
    filterUserKeywordRef.current = ''
    setFilterUserKeyword('')
    setFilterUserResults([])
    setShowFilterUserDropdown(false)
    updateFilters({ user_id: null })
    applyFilters()
  }

  const searchUsers = async () => {
    const keyword = userSearchKeywordRef.current.trim()

    if (!keyword) {
      setUserSearchResults([])
      return
    }

    setUserSearchLoading(true)
    try {
      const result = await adminAPI.users.list(1, 30, {
        search: keyword,
        sort_by: 'email',
        sort_order: 'asc'
      })
      setUserSearchResults(result.items)
    } catch (error) {
      console.error('Failed to search users:', error)
      setUserSearchResults([])
    } finally {
      setUserSearchLoading(false)
    }
  }

  // User search with debounce
  const debounceSearchUsers = (value: string) => {
    userSearchKeywordRef.current = value
    setUserSearchKeyword(value)
    // Invalidate the assignment target before the debounced search runs.
    if (selectedUser && value.trim() !== selectedUser.email) {
      setSelectedUser(null)
      setAssignForm((prev) => ({ ...prev, user_id: null }))
    }
    if (userSearchTimeout.current) {
      clearTimeout(userSearchTimeout.current)
    }
    userSearchTimeout.current = setTimeout(() => void searchUsers(), 300)
  }

  const setUserKeyword = (value: string) => {
    userSearchKeywordRef.current = value
    setUserSearchKeyword(value)
  }

  const selectUser = (user: AdminUser) => {
    if (submittingRef.current) return
    if (batchAssignEnabled) {
      if (assignUsers.length < 100 && !assignUsers.some((selected) => selected.id === user.id)) {
        setAssignUsers([...assignUsers, user])
      }
      setUserKeyword('')
      setUserSearchResults([])
      setShowUserDropdown(false)
      return
    }
    setSelectedUser(user)
    setUserKeyword(user.email)
    setShowUserDropdown(false)
    setAssignForm((prev) => ({ ...prev, user_id: user.id }))
  }

  const clearUserSelection = () => {
    setSelectedUser(null)
    setUserKeyword('')
    setUserSearchResults([])
    setAssignForm((prev) => ({ ...prev, user_id: null }))
  }

  const resetAssignUsers = () => {
    clearUserSelection()
    setAssignUsers([])
    setBatchAssignResult(null)
  }

  const handlePageChange = (page: number) => {
    clearSelection()
    updatePagination({ page })
    void loadSubscriptions()
  }

  const handlePageSizeChange = (pageSize: number) => {
    clearSelection()
    updatePagination({ page_size: pageSize, page: 1 })
    void loadSubscriptions()
  }

  const handleSort = (key: string, order: 'asc' | 'desc') => {
    clearSelection()
    sortRef.current = { sort_by: key, sort_order: order }
    updatePagination({ page: 1 })
    void loadSubscriptions()
  }

  const closeAssignModal = () => {
    if (submittingRef.current) return
    setShowAssignModal(false)
    setBatchAssignEnabled(false)
    setAssignUsers([])
    setBatchAssignResult(null)
    setAssignForm({ user_id: null, group_id: null, validity_days: 30 })
    // Clear user search state
    setSelectedUser(null)
    setUserKeyword('')
    setUserSearchResults([])
    setShowUserDropdown(false)
  }

  const handleAssignSubscription = async (event?: FormEvent) => {
    event?.preventDefault()
    if (submittingRef.current) return
    if (batchAssignEnabled ? assignUsers.length === 0 : !assignForm.user_id) {
      useAppStore.getState().showError(t('admin.subscriptions.pleaseSelectUser'))
      return
    }
    if (!assignForm.group_id) {
      useAppStore.getState().showError(t('admin.subscriptions.pleaseSelectGroup'))
      return
    }
    const validityDays = assignForm.validity_days
    if (typeof validityDays !== 'number' || !Number.isInteger(validityDays) || validityDays < 1 || validityDays > 36500) {
      useAppStore.getState().showError(t('admin.subscriptions.validityDaysRequired'))
      return
    }

    setSubmittingState(true)
    try {
      if (batchAssignEnabled) {
        const result = await adminAPI.subscriptions.bulkAssign({
          user_ids: assignUsers.map((user) => user.id),
          group_id: assignForm.group_id,
          validity_days: validityDays
        })
        setBatchAssignResult(result)
        const successIds = new Set(result.subscriptions.map((subscription) => subscription.user_id))
        setAssignUsers((prev) => prev.filter((user) => !successIds.has(user.id)))
        if (result.success_count > 0) {
          useAppStore
            .getState()
            .showSuccess(t('admin.subscriptions.batchAssign.result', { success: result.success_count, failed: result.failed_count }))
          await loadSubscriptions()
        }
        return
      }
      await adminAPI.subscriptions.assign({
        user_id: assignForm.user_id!,
        group_id: assignForm.group_id,
        validity_days: validityDays
      })
      useAppStore.getState().showSuccess(t('admin.subscriptions.subscriptionAssigned'))
      setSubmittingState(false)
      closeAssignModal()
      void loadSubscriptions()
    } catch (error: unknown) {
      useAppStore.getState().showError(errorDetail(error) || t('admin.subscriptions.failedToAssign'))
      console.error('Error assigning subscription:', error)
    } finally {
      setSubmittingState(false)
    }
  }

  const handleExtend = (subscription: UserSubscription) => {
    setExtendingSubscription(subscription)
    setExtendDays(30)
    setShowExtendModal(true)
  }

  const closeExtendModal = () => {
    setShowExtendModal(false)
    setExtendingSubscription(null)
  }

  const handleExtendSubscription = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!extendingSubscription) return
    const days = Number(extendDays)

    // 前端验证：调整后的过期时间必须在未来
    if (extendingSubscription.expires_at) {
      const expiresAt = new Date(extendingSubscription.expires_at)
      const newExpiresAt = new Date(expiresAt.getTime() + days * 24 * 60 * 60 * 1000)
      if (newExpiresAt <= new Date()) {
        useAppStore.getState().showError(t('admin.subscriptions.adjustWouldExpire'))
        return
      }
    }

    setSubmittingState(true)
    try {
      await adminAPI.subscriptions.extend(extendingSubscription.id, {
        days
      })
      useAppStore.getState().showSuccess(t('admin.subscriptions.subscriptionAdjusted'))
      closeExtendModal()
      void loadSubscriptions()
    } catch (error: unknown) {
      useAppStore.getState().showError(errorDetail(error) || t('admin.subscriptions.failedToAdjust'))
      console.error('Error adjusting subscription:', error)
    } finally {
      setSubmittingState(false)
    }
  }

  const handleRevoke = (subscription: UserSubscription) => {
    setRevokingSubscription(subscription)
    setShowRevokeDialog(true)
  }

  const confirmRevoke = async () => {
    if (!revokingSubscription) return

    try {
      await adminAPI.subscriptions.revoke(revokingSubscription.id)
      useAppStore.getState().showSuccess(t('admin.subscriptions.subscriptionRevoked'))
      setShowRevokeDialog(false)
      setRevokingSubscription(null)
      void loadSubscriptions()
    } catch (error: unknown) {
      useAppStore.getState().showError(errorDetail(error) || t('admin.subscriptions.failedToRevoke'))
      console.error('Error revoking subscription:', error)
    }
  }

  const handleRestore = (subscription: UserSubscription) => {
    setRestoringSubscription(subscription)
    setShowRestoreDialog(true)
  }

  const confirmRestore = async () => {
    if (!restoringSubscription) return

    try {
      await adminAPI.subscriptions.restore(restoringSubscription.id)
      useAppStore.getState().showSuccess(t('admin.subscriptions.subscriptionRestored'))
      setShowRestoreDialog(false)
      setRestoringSubscription(null)
      void loadSubscriptions()
    } catch (error: unknown) {
      useAppStore.getState().showError(errorDetail(error) || t('admin.subscriptions.failedToRestore'))
      console.error('Error restoring subscription:', error)
    }
  }

  const handleResetQuota = (subscription: UserSubscription) => {
    setResettingSubscription(subscription)
    setShowResetQuotaConfirm(true)
  }

  const confirmResetQuota = async () => {
    if (!resettingSubscription) return
    if (resettingQuotaRef.current) return
    resettingQuotaRef.current = true
    setResettingQuota(true)
    try {
      await adminAPI.subscriptions.resetQuota(resettingSubscription.id, { daily: true, weekly: true, monthly: true })
      useAppStore.getState().showSuccess(t('admin.subscriptions.quotaResetSuccess'))
      setShowResetQuotaConfirm(false)
      setResettingSubscription(null)
      await loadSubscriptions()
    } catch (error: unknown) {
      useAppStore.getState().showError(errorDetail(error) || t('admin.subscriptions.failedToResetQuota'))
      console.error('Error resetting quota:', error)
    } finally {
      resettingQuotaRef.current = false
      setResettingQuota(false)
    }
  }

  const formatRemainingExpiry = (expiresAt: string): string | null => {
    const duration = getRemainingExpiryDuration(expiresAt)
    if (!duration) return null
    if (duration.unit === 'days') {
      return t('admin.subscriptions.daysRemaining', { days: duration.days })
    }
    if (duration.hours) {
      return t('admin.subscriptions.hoursMinutesRemaining', {
        hours: duration.hours,
        minutes: duration.minutes
      })
    }
    return t('admin.subscriptions.minutesRemaining', { minutes: duration.minutes })
  }

  const formatResetDuration = (parts: RemainingDurationParts): string => {
    if (parts.days > 0) {
      return t('admin.subscriptions.resetInDaysHours', { days: parts.days, hours: parts.hours })
    }

    if (parts.hours > 0) {
      return t('admin.subscriptions.resetInHoursMinutes', { hours: parts.hours, minutes: parts.minutes })
    }

    return t('admin.subscriptions.resetInMinutes', { minutes: parts.minutes })
  }

  const formatQuotaEndDuration = (parts: RemainingDurationParts): string => {
    if (parts.days > 0) {
      return t('admin.subscriptions.quotaEndsInDaysHours', { days: parts.days, hours: parts.hours })
    }

    if (parts.hours > 0) {
      return t('admin.subscriptions.quotaEndsInHoursMinutes', { hours: parts.hours, minutes: parts.minutes })
    }

    return t('admin.subscriptions.quotaEndsInMinutes', { minutes: parts.minutes })
  }

  // Format reset time based on window start and period type
  const formatResetTime = (windowStart: string | null, period: QuotaPeriod): string => {
    if (!windowStart) return t('admin.subscriptions.windowNotActive')

    const start = new Date(windowStart)
    const now = new Date()

    // Calculate reset time based on period
    let resetTime: Date
    switch (period) {
      case 'daily':
        resetTime = new Date(start.getTime() + 24 * 60 * 60 * 1000)
        break
      case 'weekly':
        resetTime = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
        break
      case 'monthly':
        resetTime = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000)
        break
    }

    const parts = getRemainingDurationParts(resetTime, now)

    return parts ? formatResetDuration(parts) : t('admin.subscriptions.windowNotActive')
  }

  const formatDailyUsageWindow = (subscription: UserSubscription): string => {
    if (isOneTimeDailyQuota(subscription) && subscription.expires_at) {
      const parts = getRemainingDurationParts(subscription.expires_at)
      return parts ? formatQuotaEndDuration(parts) : t('admin.subscriptions.windowNotActive')
    }

    return formatResetTime(subscription.daily_window_start, 'daily')
  }

  const closeFilterUserDropdown = useCallback((open: boolean) => setShowFilterUserDropdown(open), [])
  const closeUserDropdown = useCallback((open: boolean) => setShowUserDropdown(open), [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时拉取列表，属于与后端同步的副作用
    void loadSubscriptions()
    void loadGroups()
    return () => {
      if (filterUserSearchTimeout.current) {
        clearTimeout(filterUserSearchTimeout.current)
      }
      if (userSearchTimeout.current) {
        clearTimeout(userSearchTimeout.current)
      }
    }
    // 仅在挂载时加载（Vue 版 onMounted）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const renderUsageRow = (
    row: UserSubscription,
    period: QuotaPeriod,
    used: number | null | undefined,
    limit: number | null | undefined,
    windowStart: string | null
  ) => (
    <div className={styles.usageRow}>
      <div className={styles.usageLine}>
        <span className={styles.usageLabel}>{t(`admin.subscriptions.${period}`)}</span>
        <div className={styles.usageTrack}>
          <div
            className={styles.usageFill}
            data-tone={getProgressTone(used, limit)}
            style={{ width: getProgressWidth(used, limit) }}
          />
        </div>
        <span className={styles.usageAmount}>
          ${used?.toFixed(2) || '0.00'}
          <span className={styles.usageSlash}> / </span>${limit?.toFixed(2)}
        </span>
      </div>
      {windowStart && (
        <div className={styles.resetInfo}>
          <Clock size={12} strokeWidth={2} aria-hidden="true" />
          <span>{period === 'daily' ? formatDailyUsageWindow(row) : formatResetTime(windowStart, period)}</span>
        </div>
      )}
    </div>
  )

  const cells: Record<string, (context: DataTableCellContext<UserSubscription>) => ReactNode> = {
    user: ({ row }) => (
      <div className={styles.userCell}>
        <span className={styles.avatar} aria-hidden="true">
          {userColumnMode === 'email'
            ? row.user?.email?.charAt(0).toUpperCase() || '?'
            : row.user?.username?.charAt(0).toUpperCase() || '?'}
        </span>
        <Link to={{ pathname: '/admin/usage', search: `?user_id=${row.user_id}` }} className={styles.userLink}>
          {userColumnMode === 'email'
            ? row.user?.email || t('admin.redeem.userPrefix', { id: row.user_id })
            : row.user?.username || t('admin.redeem.userPrefix', { id: row.user_id })}
        </Link>
      </div>
    ),
    group: ({ row }) =>
      row.group ? (
        <GroupBadge
          name={row.group.name}
          platform={row.group.platform}
          subscriptionType={row.group.subscription_type}
          rateMultiplier={row.group.rate_multiplier}
          showRate={false}
        />
      ) : (
        <span className={styles.muted}>-</span>
      ),
    usage: ({ row }) => (
      <div className={styles.usage}>
        {/* Daily Usage */}
        {!!row.group?.daily_limit_usd &&
          renderUsageRow(row, 'daily', row.daily_usage_usd, row.group.daily_limit_usd, row.daily_window_start)}
        {/* Weekly Usage */}
        {!!row.group?.weekly_limit_usd &&
          renderUsageRow(row, 'weekly', row.weekly_usage_usd, row.group.weekly_limit_usd, row.weekly_window_start)}
        {/* Monthly Usage */}
        {!!row.group?.monthly_limit_usd &&
          renderUsageRow(row, 'monthly', row.monthly_usage_usd, row.group.monthly_limit_usd, row.monthly_window_start)}
        {/* No Limits - Unlimited badge */}
        {!row.group?.daily_limit_usd && !row.group?.weekly_limit_usd && !row.group?.monthly_limit_usd && (
          <div className={styles.unlimited}>
            <span className={styles.infinity}>∞</span>
            <span>{t('admin.subscriptions.unlimited')}</span>
          </div>
        )}
      </div>
    ),
    expires_at: ({ value }) => {
      if (!value) return <span className={styles.secondary}>{t('admin.subscriptions.noExpiration')}</span>
      const remainingExpiry = formatRemainingExpiry(value)
      return (
        <div>
          <span className={styles.expires} data-expiring={isExpiringSoon(value) ? '' : undefined}>
            {formatDateTimeToMinute(value)}
          </span>
          {remainingExpiry && <div className={styles.remaining}>{remainingExpiry}</div>}
        </div>
      )
    },
    status: ({ value }) => (
      <Badge tone={value === 'active' ? 'success' : value === 'expired' ? 'warning' : 'danger'}>
        {t(`admin.subscriptions.status.${value}`)}
      </Badge>
    ),
    actions: ({ row }) => (
      <div className={styles.actions}>
        {(row.status === 'active' || row.status === 'expired') && (
          <button type="button" className={styles.actionButton} onClick={() => handleExtend(row)}>
            <CalendarDays {...iconProps} />
            <span>{t('admin.subscriptions.adjust')}</span>
          </button>
        )}
        {row.status === 'active' && (
          <button
            type="button"
            className={styles.actionButton}
            disabled={resettingQuota && resettingSubscription?.id === row.id}
            onClick={() => handleResetQuota(row)}
          >
            <RefreshCw {...iconProps} />
            <span>{t('admin.subscriptions.resetQuota')}</span>
          </button>
        )}
        {row.status === 'active' && (
          <button type="button" className={styles.actionButton} data-tone="danger" onClick={() => handleRevoke(row)}>
            <Ban {...iconProps} />
            <span>{t('admin.subscriptions.revoke')}</span>
          </button>
        )}
        {row.status === 'revoked' && (
          <button type="button" className={styles.actionButton} data-tone="success" onClick={() => handleRestore(row)}>
            <RotateCcw {...iconProps} />
            <span>{t('admin.subscriptions.restore')}</span>
          </button>
        )}
      </div>
    )
  }

  const guideActionRows = [
    { action: t('admin.subscriptions.guide.actions.adjust'), desc: t('admin.subscriptions.guide.actions.adjustDesc') },
    { action: t('admin.subscriptions.guide.actions.resetQuota'), desc: t('admin.subscriptions.guide.actions.resetQuotaDesc') },
    { action: t('admin.subscriptions.guide.actions.revoke'), desc: t('admin.subscriptions.guide.actions.revokeDesc') }
  ]

  const columnMenu = (
    <Popover open={showColumnDropdown} onOpenChange={setShowColumnDropdown}>
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" title={t('admin.users.columnSettings')} aria-label={t('admin.users.columnSettings')}>
          <Columns3 {...iconProps} />
          <span className={styles.desktopOnly}>{t('admin.users.columnSettings')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className={styles.menuPanel}>
        <div className={styles.menuList}>
          {/* User column mode selection */}
          <div className={styles.menuHeading}>{t('admin.subscriptions.columns.user')}</div>
          {(['email', 'username'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="menuitemradio"
              aria-checked={userColumnMode === mode}
              className={styles.menuItem}
              onClick={() => setUserColumnMode(mode)}
            >
              <span>{t(`admin.users.columns.${mode}`)}</span>
              {userColumnMode === mode && <Check {...iconProps} className={styles.check} />}
            </button>
          ))}
          <div className={styles.menuSeparator} role="separator" />
          {/* Other columns toggle */}
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
              {isColumnVisible(col.key) && <Check {...iconProps} className={styles.check} />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )

  const filtersBar = (
    <div className={styles.toolbar}>
      {/* Left: Fuzzy user search + filters (wrap to multiple lines) */}
      <div className={styles.filterGroup}>
        <UserSearchPicker<SimpleUser>
          pickerAttribute="data-filter-user-search"
          className={styles.userFilter}
          keyword={filterUserKeyword}
          onKeywordChange={debounceSearchFilterUsers}
          results={filterUserResults}
          loading={filterUserLoading}
          open={showFilterUserDropdown}
          onOpenChange={closeFilterUserDropdown}
          onSelect={selectFilterUser}
          showClear={!!selectedFilterUser}
          onClear={clearFilterUser}
          placeholder={t('admin.users.searchUsers')}
          searchIcon
        />
        <div className={styles.statusFilter}>
          <Select
            value={filters.status}
            options={statusOptions}
            placeholder={t('admin.subscriptions.allStatus')}
            onChange={(value) => {
              updateFilters({ status: String(value ?? '') })
              applyFilters()
            }}
          />
        </div>
        <div className={styles.groupFilter}>
          <Select
            value={filters.group_id}
            options={groupOptions}
            placeholder={t('admin.subscriptions.allGroups')}
            onChange={(value) => {
              updateFilters({ group_id: String(value ?? '') })
              applyFilters()
            }}
          />
        </div>
      </div>

      {/* Right: Actions */}
      <div className={styles.toolbarActions}>
        <Button
          type="button"
          variant="secondary"
          disabled={loading}
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
          onClick={() => void loadSubscriptions()}
        >
          <RefreshCw {...iconProps} className={loading ? styles.spinning : undefined} />
        </Button>
        {columnMenu}
        <Button
          type="button"
          variant="secondary"
          title={t('admin.subscriptions.guide.showGuide')}
          aria-label={t('admin.subscriptions.guide.showGuide')}
          onClick={() => setShowGuideModal(true)}
        >
          <CircleHelp {...iconProps} />
        </Button>
        <Button type="button" variant="primary" onClick={() => setShowAssignModal(true)}>
          <Plus {...iconProps} />
          {t('admin.subscriptions.assignSubscription')}
        </Button>
      </div>
    </div>
  )

  const table = (
    <div className={styles.region}>
      {selectedCount > 0 && (
        <div className={styles.bulkBar} role="toolbar" aria-label={t('admin.subscriptions.bulk.selected', { count: selectedCount })} data-test="subscription-bulk-actions">
          <div className={styles.bulkSummary}>
            <span className={styles.bulkCount} aria-live="polite">
              {t('admin.subscriptions.bulk.selected', { count: selectedCount })}
            </span>
            <button type="button" className={styles.bulkLink} onClick={clearSelection}>
              {t('admin.subscriptions.bulk.clearSelection')}
            </button>
            <span className={styles.bulkHint}>{t('admin.subscriptions.bulk.selectionHint')}</span>
          </div>
          <div className={styles.bulkActions}>
            {bulkActions.map((action) => (
              <button
                key={action}
                type="button"
                data-tone={action === 'revoke' ? 'danger' : undefined}
                data-test={`bulk-${action}`}
                disabled={loading || bulkTargets[action].length === 0}
                onClick={() => openBulkAction(action)}
              >
                {t(`admin.subscriptions.bulk.${action}`)} ({bulkTargets[action].length})
              </button>
            ))}
          </div>
        </div>
      )}
      <DataTable<UserSubscription>
        columns={columns}
        data={subscriptions}
        loading={loading}
        rowKey="id"
        selectable
        selectedKeys={selectedIds}
        onSelectedKeysChange={handleSelectedKeysUpdate}
        selectionLabel={getSubscriptionSelectionLabel}
        serverSideSort
        defaultSortKey="created_at"
        defaultSortOrder="desc"
        onSort={handleSort}
        cells={cells}
        className={styles.dataTable}
        empty={
          <EmptyState
            title={t('admin.subscriptions.noSubscriptionsYet')}
            description={t('admin.subscriptions.assignFirstSubscription')}
            actionText={t('admin.subscriptions.assignSubscription')}
            onAction={() => setShowAssignModal(true)}
          />
        }
      />
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

      {bulkAction !== null && (
        <BulkSubscriptionActionDialog
          show
          action={bulkAction}
          subscriptions={bulkSubscriptions}
          onClose={() => setBulkAction(null)}
          onCompleted={(result) => void handleBulkCompleted(result)}
        />
      )}

      {/* Assign Subscription Modal */}
      <BaseDialog
        show={showAssignModal}
        title={t('admin.subscriptions.assignSubscription')}
        width="normal"
        showCloseButton={!submitting}
        closeOnEscape={!submitting}
        onClose={closeAssignModal}
        footer={
          <>
            <Button type="button" variant="secondary" disabled={submitting} onClick={closeAssignModal}>
              {batchAssignResult ? t('common.close') : t('common.cancel')}
            </Button>
            <Button
              type="submit"
              form="assign-subscription-form"
              variant="primary"
              loading={submitting}
              disabled={submitting || (batchAssignEnabled && assignUsers.length === 0)}
            >
              {submitting ? t('admin.subscriptions.assigning') : t('admin.subscriptions.assign')}
            </Button>
          </>
        }
      >
        <form id="assign-subscription-form" className={styles.form} onSubmit={(event) => void handleAssignSubscription(event)}>
          <Checkbox
            label={t('admin.subscriptions.batchAssign.enable')}
            checked={batchAssignEnabled}
            disabled={submitting}
            onCheckedChange={(checked) => {
              setBatchAssignEnabled(checked === true)
              resetAssignUsers()
            }}
          />
          {batchAssignEnabled && <p className={styles.hint}>{t('admin.subscriptions.batchAssign.hint')}</p>}
          <div className={styles.field}>
            <label className={styles.label}>{t('admin.subscriptions.form.user')}</label>
            <UserSearchPicker<AdminUser>
              pickerAttribute="data-assign-user-search"
              keyword={userSearchKeyword}
              onKeywordChange={debounceSearchUsers}
              results={userSearchResults}
              loading={userSearchLoading}
              open={showUserDropdown}
              onOpenChange={closeUserDropdown}
              onSelect={selectUser}
              showClear={!!selectedUser}
              onClear={clearUserSelection}
              placeholder={t('admin.usage.searchUserPlaceholder')}
              ariaLabel={t('admin.subscriptions.form.user')}
              disabled={submitting || (batchAssignEnabled && assignUsers.length >= 100)}
              isOptionDisabled={(user) => submitting || (batchAssignEnabled && assignUsers.some((selected) => selected.id === user.id))}
            />
            {batchAssignEnabled && assignUsers.length > 0 && (
              <div className={styles.assignUsers} data-test="assign-users">
                <p className={styles.secondary}>{t('admin.subscriptions.batchAssign.selected', { count: assignUsers.length })}</p>
                <ul className={styles.assignUserList}>
                  {assignUsers.map((user) => (
                    <li key={user.id} className={styles.assignUser}>
                      <span className={styles.truncate}>
                        {user.email} <span className={styles.muted}>#{user.id}</span>
                      </span>
                      <button
                        type="button"
                        className={styles.removeUser}
                        disabled={submitting}
                        aria-label={t('admin.subscriptions.batchAssign.removeUser', { email: user.email })}
                        onClick={() => setAssignUsers((prev) => prev.filter((selected) => selected.id !== user.id))}
                      >
                        <X size={14} strokeWidth={1.75} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('admin.subscriptions.form.group')}</label>
            <Select
              value={assignForm.group_id}
              disabled={submitting}
              options={subscriptionGroupOptions as unknown as SelectOption[]}
              placeholder={t('admin.subscriptions.selectGroup')}
              onChange={(value: SelectValue) => setAssignForm((prev) => ({ ...prev, group_id: value as number | null }))}
              renderSelected={(option) => {
                const group = option as unknown as GroupOption | null
                return group ? (
                  <GroupBadge
                    name={group.label}
                    platform={group.platform}
                    subscriptionType={group.subscriptionType}
                    rateMultiplier={group.rate}
                  />
                ) : (
                  <span className={styles.muted}>{t('admin.subscriptions.selectGroup')}</span>
                )
              }}
              renderOption={(option, selected) => {
                const group = option as unknown as GroupOption
                return (
                  <GroupOptionItem
                    name={group.label}
                    platform={group.platform}
                    subscriptionType={group.subscriptionType}
                    rateMultiplier={group.rate}
                    description={group.description}
                    selected={selected}
                  />
                )
              }}
            />
            <p className={styles.hint}>{t('admin.subscriptions.groupHint')}</p>
          </div>
          <Input
            type="number"
            min={1}
            max={36500}
            step={1}
            label={t('admin.subscriptions.form.validityDays')}
            value={assignForm.validity_days}
            disabled={submitting}
            hint={t('admin.subscriptions.validityHint')}
            onChange={(value) => setAssignForm((prev) => ({ ...prev, validity_days: value === '' ? '' : Number(value) }))}
          />
          {batchAssignResult && (
            <div className={styles.batchResult} role="status" data-test="batch-assign-result">
              <p>
                {t('admin.subscriptions.batchAssign.result', {
                  success: batchAssignResult.success_count,
                  failed: batchAssignResult.failed_count
                })}
              </p>
              {batchAssignResult.errors.length > 0 && (
                <ul className={styles.batchErrors}>
                  {batchAssignResult.errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              )}
              {batchAssignResult.failed_count > 0 && <p className={styles.hint}>{t('admin.subscriptions.batchAssign.retryHint')}</p>}
            </div>
          )}
        </form>
      </BaseDialog>

      {/* Adjust Subscription Modal */}
      <BaseDialog
        show={showExtendModal}
        title={t('admin.subscriptions.adjustSubscription')}
        width="narrow"
        onClose={closeExtendModal}
        footer={
          extendingSubscription ? (
            <>
              <Button type="button" variant="secondary" onClick={closeExtendModal}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" form="extend-subscription-form" variant="primary" disabled={submitting}>
                {submitting ? t('admin.subscriptions.adjusting') : t('admin.subscriptions.adjust')}
              </Button>
            </>
          ) : undefined
        }
      >
        {extendingSubscription && (
          <form id="extend-subscription-form" className={styles.form} onSubmit={(event) => void handleExtendSubscription(event)}>
            <dl className={styles.summary}>
              <div>
                <dt>{t('admin.subscriptions.adjustingFor')}</dt>
                <dd>{extendingSubscription.user?.email}</dd>
              </div>
              <div>
                <dt>{t('admin.subscriptions.currentExpiration')}</dt>
                <dd>
                  {extendingSubscription.expires_at
                    ? formatDateTimeToMinute(extendingSubscription.expires_at)
                    : t('admin.subscriptions.noExpiration')}
                </dd>
              </div>
              {extendingSubscription.expires_at && (
                <div>
                  <dt>{t('admin.subscriptions.remainingDays')}</dt>
                  <dd>{getDaysRemaining(extendingSubscription.expires_at) ?? 0}</dd>
                </div>
              )}
            </dl>
            <Input
              type="number"
              required
              label={t('admin.subscriptions.form.adjustDays')}
              value={extendDays}
              placeholder={t('admin.subscriptions.adjustDaysPlaceholder')}
              hint={t('admin.subscriptions.adjustHint')}
              onChange={(value) => setExtendDays(value === '' ? '' : Number(value))}
            />
          </form>
        )}
      </BaseDialog>

      {/* Revoke Confirmation Dialog */}
      <ConfirmDialog
        show={showRevokeDialog}
        title={t('admin.subscriptions.revokeSubscription')}
        message={t('admin.subscriptions.revokeConfirm', { user: revokingSubscription?.user?.email })}
        confirmText={t('admin.subscriptions.revoke')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void confirmRevoke()}
        onCancel={() => setShowRevokeDialog(false)}
      />

      {/* Restore Confirmation Dialog */}
      <ConfirmDialog
        show={showRestoreDialog}
        title={t('admin.subscriptions.restoreSubscription')}
        message={t('admin.subscriptions.restoreConfirm', { user: restoringSubscription?.user?.email })}
        confirmText={t('admin.subscriptions.restore')}
        cancelText={t('common.cancel')}
        onConfirm={() => void confirmRestore()}
        onCancel={() => setShowRestoreDialog(false)}
      />

      {/* Reset Quota Confirmation Dialog */}
      <ConfirmDialog
        show={showResetQuotaConfirm}
        title={t('admin.subscriptions.resetQuotaTitle')}
        message={t('admin.subscriptions.resetQuotaConfirm', { user: resettingSubscription?.user?.email })}
        confirmText={t('admin.subscriptions.resetQuota')}
        cancelText={t('common.cancel')}
        onConfirm={() => void confirmResetQuota()}
        onCancel={() => setShowResetQuotaConfirm(false)}
      />

      {/* Subscription Guide Modal */}
      <BaseDialog
        show={showGuideModal}
        title={t('admin.subscriptions.guide.title')}
        description={t('admin.subscriptions.guide.subtitle')}
        width="wide"
        closeOnClickOutside
        onClose={() => setShowGuideModal(false)}
        footer={
          <Button type="button" variant="primary" size="sm" onClick={() => setShowGuideModal(false)}>
            {t('common.close')}
          </Button>
        }
      >
        <div className={styles.guide}>
          {/* Step 1 */}
          <section className={styles.guideStep}>
            <h3 className={styles.guideTitle}>
              <span className={styles.guideNumber}>1</span>
              {t('admin.subscriptions.guide.step1.title')}
            </h3>
            <ol className={styles.guideList}>
              <li>{t('admin.subscriptions.guide.step1.line1')}</li>
              <li>{t('admin.subscriptions.guide.step1.line2')}</li>
              <li>{t('admin.subscriptions.guide.step1.line3')}</li>
            </ol>
            <Link to="/admin/groups" className={styles.guideLink} onClick={() => setShowGuideModal(false)}>
              {t('admin.subscriptions.guide.step1.link')}
              <ArrowRight size={12} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </section>

          {/* Step 2 */}
          <section className={styles.guideStep}>
            <h3 className={styles.guideTitle}>
              <span className={styles.guideNumber}>2</span>
              {t('admin.subscriptions.guide.step2.title')}
            </h3>
            <ol className={styles.guideList}>
              <li>{t('admin.subscriptions.guide.step2.line1')}</li>
              <li>{t('admin.subscriptions.guide.step2.line2')}</li>
              <li>{t('admin.subscriptions.guide.step2.line3')}</li>
            </ol>
          </section>

          {/* Step 3 */}
          <section className={styles.guideStep}>
            <h3 className={styles.guideTitle}>
              <span className={styles.guideNumber}>3</span>
              {t('admin.subscriptions.guide.step3.title')}
            </h3>
            <table className={styles.guideTable}>
              <tbody>
                {guideActionRows.map((row, i) => (
                  <tr key={i}>
                    <th scope="row">{row.action}</th>
                    <td>{row.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Tip */}
          <p className={styles.guideTip}>{t('admin.subscriptions.guide.tip')}</p>
        </div>
      </BaseDialog>
    </>
  )
}
