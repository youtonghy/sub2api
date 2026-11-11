/**
 * 用户 API 密钥管理页，对应 Vue 版 views/user/KeysView.vue。
 * - 列表：服务端分页与排序、搜索 / 分组 / 状态筛选、列显示设置（localStorage 持久化并按版本补充默认隐藏列）
 * - 行操作：使用密钥、导入 CC Switch、启停、编辑、删除；分组单元格可直接切换分组
 * - 批量选择后可批量编辑；创建 / 编辑表单在对话框中完成
 */
import {
  Ban,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Clipboard,
  Columns3,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Terminal,
  Trash2,
  Upload
} from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover'
import { Switch } from '@/components/arc/switch/switch'
import { authAPI, keysAPI, usageAPI, userGroupsAPI } from '@/api'
import type { BatchApiKeyUsageStats } from '@/api/usage'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import DataTable from '@/components/common/DataTable'
import EmptyState from '@/components/common/EmptyState'
import GroupBadge from '@/components/common/GroupBadge'
import GroupOptionItem from '@/components/common/GroupOptionItem'
import Input from '@/components/common/Input'
import Pagination from '@/components/common/Pagination'
import SearchInput from '@/components/common/SearchInput'
import Select, { type SelectValue } from '@/components/common/Select'
import TextArea from '@/components/common/TextArea'
import TablePageLayout from '@/components/common/TablePageLayout'
import type { Column } from '@/components/common/types'
import BulkEditKeysModal from '@/components/keys/BulkEditKeysModal'
import EndpointPopover from '@/components/keys/EndpointPopover'
import UseKeyModal from '@/components/keys/UseKeyModal'
import { useClipboard } from '@/composables/useClipboard'
import { getPersistedPageSize } from '@/composables/usePersistedPageSize'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useOnboardingStore } from '@/stores/onboarding'
import type { ApiKey, Group, GroupPlatform, PublicSettings, SubscriptionType, UpdateApiKeyRequest } from '@/types'
import {
  CC_SWITCH_USAGE_SCRIPT,
  buildCcSwitchImportDeeplink,
  type CcSwitchClientType
} from '@/utils/ccswitchImport'
import { formatDateTime } from '@/utils/format'
import { maskApiKey } from '@/utils/maskApiKey'
import styles from './KeysView.module.css'

// Helper to format date for datetime-local input
const formatDateTimeLocal = (isoDate: string): string => {
  const date = new Date(isoDate)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

interface GroupOption {
  value: number
  label: string
  description: string | null
  rate: number
  userRate: number | null
  peakRateEnabled: boolean
  peakStart: string
  peakEnd: string
  peakRateMultiplier: number
  subscriptionType: SubscriptionType
  platform: GroupPlatform
}

type ExpirationPreset = '7' | '30' | '90' | 'custom'

interface KeyFormData {
  name: string
  group_id: number | null
  status: 'active' | 'inactive'
  use_custom_key: boolean
  custom_key: string
  enable_ip_restriction: boolean
  ip_whitelist: string
  ip_blacklist: string
  // Quota settings (empty = unlimited)
  enable_quota: boolean
  /** 数字输入框的原始文本，提交时按 Vue 版 v-model.number 的规则转换 */
  quota: string
  // Rate limit settings
  enable_rate_limit: boolean
  rate_limit_5h: string
  rate_limit_1d: string
  rate_limit_7d: string
  enable_expiration: boolean
  expiration_preset: ExpirationPreset
  expiration_date: string
}

const emptyForm = (): KeyFormData => ({
  name: '',
  group_id: null,
  status: 'active',
  use_custom_key: false,
  custom_key: '',
  enable_ip_restriction: false,
  ip_whitelist: '',
  ip_blacklist: '',
  enable_quota: false,
  quota: '',
  enable_rate_limit: false,
  rate_limit_5h: '',
  rate_limit_1d: '',
  rate_limit_7d: '',
  enable_expiration: false,
  expiration_preset: '30',
  expiration_date: ''
})

/** 对应 Vue 版 v-model.number：空串或无法解析时为 null */
const toNumber = (value: string): number | null => {
  if (value.trim() === '') return null
  const parsed = parseFloat(value)
  return Number.isNaN(parsed) ? null : parsed
}

const numberText = (value: number | null | undefined): string => (value ? String(value) : '')

const ALWAYS_VISIBLE_COLUMNS = new Set(['name', 'actions'])
const DEFAULT_HIDDEN_COLUMNS = ['id', 'rate_limit', 'last_used_at', 'last_used_ip']
const HIDDEN_COLUMNS_KEY = 'api-key-hidden-columns'
const COLUMN_SETTINGS_VERSION_KEY = 'api-key-column-settings-version'
const COLUMN_SETTINGS_VERSION = 3
const VERSION_NEW_HIDDEN_COLUMNS: Record<number, string[]> = {
  2: ['last_used_ip'],
  3: ['id']
}
const ALL_COLUMN_KEYS = [
  'name', 'id', 'key', 'group', 'current_concurrency', 'usage', 'rate_limit',
  'expires_at', 'status', 'last_used_at', 'last_used_ip', 'created_at', 'actions'
]

const saveColumnsToStorage = (hidden: string[]) => {
  try {
    localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(hidden))
    localStorage.setItem(COLUMN_SETTINGS_VERSION_KEY, String(COLUMN_SETTINGS_VERSION))
  } catch (error) {
    console.error('Failed to save API key table columns:', error)
  }
}

const loadSavedColumns = (): string[] => {
  const hidden = new Set<string>()
  try {
    const saved = localStorage.getItem(HIDDEN_COLUMNS_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as string[]
      const validColumnKeys = new Set(ALL_COLUMN_KEYS)
      parsed
        .filter((key) =>
          typeof key === 'string' &&
          validColumnKeys.has(key) &&
          !ALWAYS_VISIBLE_COLUMNS.has(key)
        )
        .forEach((key) => hidden.add(key))
      const storedVersion = Number(localStorage.getItem(COLUMN_SETTINGS_VERSION_KEY) ?? '1')
      if (storedVersion < COLUMN_SETTINGS_VERSION) {
        for (let v = storedVersion + 1; v <= COLUMN_SETTINGS_VERSION; v++) {
          for (const key of VERSION_NEW_HIDDEN_COLUMNS[v] ?? []) {
            if (validColumnKeys.has(key) && !ALWAYS_VISIBLE_COLUMNS.has(key)) {
              hidden.add(key)
            }
          }
        }
        saveColumnsToStorage([...hidden])
      } else {
        localStorage.setItem(COLUMN_SETTINGS_VERSION_KEY, String(COLUMN_SETTINGS_VERSION))
      }
    } else {
      DEFAULT_HIDDEN_COLUMNS.forEach((key) => hidden.add(key))
      localStorage.setItem(COLUMN_SETTINGS_VERSION_KEY, String(COLUMN_SETTINGS_VERSION))
    }
  } catch (error) {
    console.error('Failed to load API key table columns:', error)
    DEFAULT_HIDDEN_COLUMNS.forEach((key) => hidden.add(key))
  }
  return [...hidden]
}

const isAbortError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false
  const { name, code } = error as { name?: string; code?: string }
  return name === 'AbortError' || code === 'ERR_CANCELED'
}

const shouldSubmitEditStatus = (key: ApiKey, status: 'active' | 'inactive') => {
  if (key.status === 'quota_exhausted' || key.status === 'expired') {
    return status === 'active'
  }
  return true
}

type LimitTone = 'danger' | 'warning' | 'normal'
const limitTone = (used: number, limit: number): LimitTone =>
  used >= limit ? 'danger' : used >= limit * 0.8 ? 'warning' : 'normal'

/** 用量条：达到上限为危险色，达到 80% 为警告色，其余为 okColor（与 Vue 版阈值一致） */
function LimitBar({ used, limit, ok, thin = false }: { used: number; limit: number; ok: 'accent' | 'success'; thin?: boolean }) {
  const tone = limitTone(used, limit)
  return (
    <div className={thin ? styles.barTrackThin : styles.barTrack}>
      <div
        className={styles.barFill}
        data-tone={tone === 'normal' ? ok : tone}
        style={{ width: Math.min((used / limit) * 100, 100) + '%' }}
      />
    </div>
  )
}

/** 表单里的开关行（Vue 版手写的 toggle 按钮） */
function ToggleField({ label, checked, onChange, children }: { label: string; checked: boolean; onChange: (value: boolean) => void; children?: ReactNode }) {
  return (
    <div className={styles.formSection}>
      <div className={styles.toggleRow}>
        <span className={styles.label}>{label}</span>
        <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
      </div>
      {children}
    </div>
  )
}

export default function KeysView() {
  const { t } = useI18n()
  const { copyToClipboard: clipboardCopy } = useClipboard()

  const allColumns: Column<ApiKey>[] = [
    { key: 'name', label: t('common.name'), sortable: true },
    { key: 'id', label: t('keys.id'), sortable: true },
    { key: 'key', label: t('keys.apiKey'), sortable: false },
    { key: 'group', label: t('keys.group'), sortable: true },
    { key: 'current_concurrency', label: t('keys.currentConcurrency'), sortable: true },
    { key: 'usage', label: t('keys.usage'), sortable: false },
    { key: 'rate_limit', label: t('keys.rateLimitColumn'), sortable: false },
    { key: 'expires_at', label: t('keys.expiresAt'), sortable: true },
    { key: 'status', label: t('common.status'), sortable: true },
    { key: 'last_used_at', label: t('keys.lastUsedAt'), sortable: true },
    { key: 'last_used_ip', label: t('keys.lastUsedIP'), sortable: false },
    { key: 'created_at', label: t('keys.created'), sortable: true },
    { key: 'actions', label: t('common.actions'), sortable: false }
  ]

  const [hiddenColumns, setHiddenColumns] = useState<string[]>(loadSavedColumns)
  const toggleableColumns = allColumns.filter((col) => !ALWAYS_VISIBLE_COLUMNS.has(col.key))
  const isColumnVisible = (key: string) => !hiddenColumns.includes(key)
  const columns = allColumns.filter((col) => ALWAYS_VISIBLE_COLUMNS.has(col.key) || !hiddenColumns.includes(col.key))

  const toggleColumn = (key: string) => {
    if (ALWAYS_VISIBLE_COLUMNS.has(key)) return
    const next = hiddenColumns.includes(key)
      ? hiddenColumns.filter((item) => item !== key)
      : [...hiddenColumns, key]
    setHiddenColumns(next)
    saveColumnsToStorage(next)
  }

  const [apiKeys, setApiKeysState] = useState<ApiKey[]>([])
  const [selectedIds, setSelectedIdsState] = useState<number[]>([])
  const [showBulkEditModal, setShowBulkEditModal] = useState(false)
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [usageStats, setUsageStats] = useState<Record<string, BatchApiKeyUsageStats>>({})
  const [usageLoading, setUsageLoading] = useState(false)
  const [userGroupRates, setUserGroupRates] = useState<Record<number, number>>({})
  const [pagination, setPaginationState] = useState(() => ({
    page: 1,
    page_size: getPersistedPageSize(),
    total: 0,
    pages: 0
  }))

  // Filter state
  const [filterSearch, setFilterSearchState] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterGroupId, setFilterGroupId] = useState<string | number>('')

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showResetQuotaDialog, setShowResetQuotaDialog] = useState(false)
  const [showResetRateLimitDialog, setShowResetRateLimitDialog] = useState(false)
  const [showUseKeyModal, setShowUseKeyModal] = useState(false)
  const [showCcsClientSelect, setShowCcsClientSelect] = useState(false)
  const [showColumnDropdown, setShowColumnDropdown] = useState(false)
  const [pendingCcsRow, setPendingCcsRow] = useState<ApiKey | null>(null)
  const [selectedKey, setSelectedKeyState] = useState<ApiKey | null>(null)
  const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null)
  const [groupSelectorKeyId, setGroupSelectorKeyId] = useState<number | null>(null)
  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(null)
  const [dropdownPosition, setDropdownPosition] = useState<{ top?: number; bottom?: number; left: number } | null>(null)
  const [groupSearchQuery, setGroupSearchQuery] = useState('')
  const [formData, setFormData] = useState<KeyFormData>(emptyForm)

  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const groupButtonRefs = useRef(new Map<number, HTMLElement>())
  const abortController = useRef<AbortController | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 加载函数与回调读取的最新值（对应 Vue 版 ref 的同步读写，避免闭包拿到旧状态）
  const live = useRef({
    apiKeys: [] as ApiKey[],
    selectedIds: [] as number[],
    selectedKey: null as ApiKey | null,
    page: pagination.page,
    page_size: pagination.page_size,
    sort_by: 'created_at',
    sort_order: 'desc' as 'asc' | 'desc',
    search: '',
    status: '',
    groupId: '' as string | number
  })

  const setApiKeys = (keys: ApiKey[]) => {
    live.current.apiKeys = keys
    setApiKeysState(keys)
  }
  const setSelectedIds = (ids: number[]) => {
    live.current.selectedIds = ids
    setSelectedIdsState(ids)
  }
  const setSelectedKey = (key: ApiKey | null) => {
    live.current.selectedKey = key
    setSelectedKeyState(key)
  }
  const setPage = (page: number) => {
    live.current.page = page
    setPaginationState((current) => ({ ...current, page }))
  }

  const selectedApiKeys = apiKeys.filter((key) => selectedIds.includes(key.id))

  const handleSelectionChange = (ids: Array<string | number>) => {
    const visibleIds = new Set(live.current.apiKeys.map((key) => key.id))
    setSelectedIds([...new Set(ids.map(Number))].filter((id) => visibleIds.has(id)))
  }

  // 自定义Key验证
  const customKeyError = (() => {
    if (!formData.use_custom_key || !formData.custom_key) {
      return ''
    }
    const key = formData.custom_key
    if (key.length < 16) {
      return t('keys.customKeyTooShort')
    }
    // 检查字符：只允许字母、数字、下划线、连字符
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
      return t('keys.customKeyInvalidChars')
    }
    return ''
  })()

  const statusOptions = [
    { value: 'active', label: t('common.active') },
    { value: 'inactive', label: t('common.inactive') }
  ]

  // Filter dropdown options
  const groupFilterOptions = [
    { value: '', label: t('keys.allGroups') },
    { value: 0, label: t('keys.noGroup') },
    ...groups.map((g) => ({ value: g.id, label: g.name }))
  ]

  const statusFilterOptions = [
    { value: '', label: t('keys.allStatus') },
    { value: 'active', label: t('keys.status.active') },
    { value: 'inactive', label: t('keys.status.inactive') },
    { value: 'quota_exhausted', label: t('keys.status.quota_exhausted') },
    { value: 'expired', label: t('keys.status.expired') }
  ]

  // Convert groups to Select options format with rate multiplier and subscription type
  const groupOptions: GroupOption[] = groups.map((group) => ({
    value: group.id,
    label: group.name,
    description: group.description,
    rate: group.rate_multiplier,
    userRate: userGroupRates[group.id] ?? null,
    peakRateEnabled: group.peak_rate_enabled,
    peakStart: group.peak_start,
    peakEnd: group.peak_end,
    peakRateMultiplier: group.peak_rate_multiplier,
    subscriptionType: group.subscription_type,
    platform: group.platform
  }))

  // 分组不再归属单一平台，创建 Key 时直接列出全部可选分组。
  const formGroupOptions = groupOptions

  // Group dropdown search
  const filteredGroupOptions = (() => {
    const query = groupSearchQuery.trim().toLowerCase()
    if (!query) return groupOptions
    return groupOptions.filter((opt) => {
      return opt.label.toLowerCase().includes(query) ||
        (opt.description && opt.description.toLowerCase().includes(query))
    })
  })()

  // Get the currently selected key for group change
  const selectedKeyForGroup = groupSelectorKeyId === null
    ? null
    : apiKeys.find((k) => k.id === groupSelectorKeyId) || null

  const copyToClipboard = async (text: string, keyId: number) => {
    const success = await clipboardCopy(text, t('keys.copied'))
    if (success) {
      setCopiedKeyId(keyId)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => {
        setCopiedKeyId(null)
      }, 800)
    }
  }

  const loadApiKeys = async () => {
    abortController.current?.abort()
    const controller = new AbortController()
    abortController.current = controller
    const { signal } = controller
    const q = live.current
    setLoading(true)
    setUsageLoading(false)
    try {
      // Build filters
      const filters: {
        search?: string
        status?: string
        group_id?: number | string
        sort_by?: string
        sort_order?: 'asc' | 'desc'
      } = {}
      if (q.search) filters.search = q.search
      if (q.status) filters.status = q.status
      if (q.groupId !== '') filters.group_id = q.groupId
      filters.sort_by = q.sort_by
      filters.sort_order = q.sort_order

      const response = await keysAPI.list(q.page, q.page_size, filters, {
        signal
      })
      if (signal.aborted) return
      setApiKeys(response.items)
      handleSelectionChange(live.current.selectedIds)
      setPaginationState((current) => ({ ...current, total: response.total, pages: response.pages }))

      // 用量统计要聚合 30 天的 usage_logs，可能比列表慢很多：不阻塞表格渲染，单独加载
      setUsageLoading(response.items.length > 0)
      if (response.items.length > 0) {
        void loadUsageStats(
          response.items.map((k) => k.id),
          signal
        )
      }
    } catch (error) {
      if (isAbortError(error)) {
        return
      }
      useAppStore.getState().showError(t('keys.failedToLoad'))
    } finally {
      if (abortController.current === controller) {
        setLoading(false)
      }
    }
  }

  const loadUsageStats = async (keyIds: number[], signal: AbortSignal) => {
    try {
      const usageResponse = await usageAPI.getDashboardApiKeysUsage(keyIds, { signal })
      if (signal.aborted) return
      setUsageStats(usageResponse.stats)
    } catch (e) {
      if (!isAbortError(e)) {
        console.error('Failed to load usage stats:', e)
      }
    } finally {
      if (!signal.aborted) {
        setUsageLoading(false)
      }
    }
  }

  const loadGroups = async () => {
    try {
      setGroups(await userGroupsAPI.getAvailable())
    } catch (error) {
      console.error('Failed to load groups:', error)
    }
  }

  const loadUserGroupRates = async () => {
    try {
      setUserGroupRates(await userGroupsAPI.getUserGroupRates())
    } catch (error) {
      console.error('Failed to load user group rates:', error)
    }
  }

  const loadPublicSettings = async () => {
    try {
      setPublicSettings(await authAPI.getPublicSettings())
    } catch (error) {
      console.error('Failed to load public settings:', error)
    }
  }

  const onFilterChange = () => {
    setSelectedIds([])
    setPage(1)
    void loadApiKeys()
  }

  const onGroupFilterChange = (value: SelectValue) => {
    live.current.groupId = value as string | number
    setFilterGroupId(value as string | number)
    onFilterChange()
  }

  const onStatusFilterChange = (value: SelectValue) => {
    live.current.status = value as string
    setFilterStatus(value as string)
    onFilterChange()
  }

  const openUseKeyModal = (key: ApiKey) => {
    setSelectedKey(key)
    setShowUseKeyModal(true)
  }

  const closeUseKeyModal = () => {
    setShowUseKeyModal(false)
    setSelectedKey(null)
  }

  const handlePageChange = (page: number) => {
    setSelectedIds([])
    setPage(page)
    void loadApiKeys()
  }

  const handlePageSizeChange = (pageSize: number) => {
    setSelectedIds([])
    live.current.page_size = pageSize
    live.current.page = 1
    setPaginationState((current) => ({ ...current, page_size: pageSize, page: 1 }))
    void loadApiKeys()
  }

  const handleSort = (key: string, order: 'asc' | 'desc') => {
    setSelectedIds([])
    live.current.sort_by = key
    live.current.sort_order = order
    setPage(1)
    void loadApiKeys()
  }

  const handleBulkUpdated = (succeededIds: number[]) => {
    const succeeded = new Set(succeededIds)
    setSelectedIds(live.current.selectedIds.filter((id) => !succeeded.has(id)))
    void loadApiKeys()
  }

  const openCreateModal = () => {
    // 打开创建表单时，已选分组不在可选列表中则清空（Vue 版 watch(showCreateModal)）
    setFormData((current) =>
      formGroupOptions.some((group) => group.value === current.group_id) ? current : { ...current, group_id: null }
    )
    setShowCreateModal(true)
  }

  const editKey = (key: ApiKey) => {
    setSelectedKey(key)
    const hasIPRestriction = (key.ip_whitelist?.length > 0) || (key.ip_blacklist?.length > 0)
    const hasExpiration = !!key.expires_at
    setFormData({
      name: key.name,
      group_id: key.group_id,
      status: key.status === 'quota_exhausted' || key.status === 'expired' ? 'inactive' : key.status,
      use_custom_key: false,
      custom_key: '',
      enable_ip_restriction: hasIPRestriction,
      ip_whitelist: (key.ip_whitelist || []).join('\n'),
      ip_blacklist: (key.ip_blacklist || []).join('\n'),
      enable_quota: key.quota > 0,
      quota: key.quota > 0 ? String(key.quota) : '',
      enable_rate_limit: (key.rate_limit_5h > 0) || (key.rate_limit_1d > 0) || (key.rate_limit_7d > 0),
      rate_limit_5h: numberText(key.rate_limit_5h),
      rate_limit_1d: numberText(key.rate_limit_1d),
      rate_limit_7d: numberText(key.rate_limit_7d),
      enable_expiration: hasExpiration,
      expiration_preset: 'custom',
      expiration_date: key.expires_at ? formatDateTimeLocal(key.expires_at) : ''
    })
    setShowEditModal(true)
  }

  const toggleKeyStatus = async (key: ApiKey) => {
    const newStatus = key.status === 'active' ? 'inactive' : 'active'
    const appStore = useAppStore.getState()
    try {
      await keysAPI.toggleStatus(key.id, newStatus)
      appStore.showSuccess(
        newStatus === 'active' ? t('keys.keyEnabledSuccess') : t('keys.keyDisabledSuccess')
      )
      void loadApiKeys()
    } catch {
      appStore.showError(t('keys.failedToUpdateStatus'))
    }
  }

  const closeGroupDropdown = () => {
    setGroupSelectorKeyId(null)
    setDropdownPosition(null)
  }

  const openGroupSelector = (key: ApiKey) => {
    if (groupSelectorKeyId === key.id) {
      closeGroupDropdown()
    } else {
      const buttonEl = groupButtonRefs.current.get(key.id)
      if (buttonEl) {
        const rect = buttonEl.getBoundingClientRect()
        const dropdownEstHeight = 400 // estimated max dropdown height
        const dropdownEstWidth = Math.min(380, window.innerWidth - 16)
        const spaceBelow = window.innerHeight - rect.bottom
        const spaceAbove = rect.top
        // 夹取 left，避免窄屏下浮层超出视口右缘
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - dropdownEstWidth - 8))

        if (spaceBelow < dropdownEstHeight && spaceAbove > spaceBelow) {
          // Not enough space below, pop upward
          setDropdownPosition({ bottom: window.innerHeight - rect.top + 4, left })
        } else {
          // Default: pop downward
          setDropdownPosition({ top: rect.bottom + 4, left })
        }
      }
      setGroupSelectorKeyId(key.id)
      setGroupSearchQuery('')
    }
  }

  const changeGroup = async (key: ApiKey, newGroupId: number | null) => {
    closeGroupDropdown()
    if (key.group_id === newGroupId) return

    const appStore = useAppStore.getState()
    try {
      await keysAPI.update(key.id, { group_id: newGroupId })
      appStore.showSuccess(t('keys.groupChangedSuccess'))
      void loadApiKeys()
    } catch {
      appStore.showError(t('keys.failedToChangeGroup'))
    }
  }

  const confirmDelete = (key: ApiKey) => {
    setSelectedKey(key)
    setShowDeleteDialog(true)
  }

  const closeModals = () => {
    setShowCreateModal(false)
    setShowEditModal(false)
    setSelectedKey(null)
    setFormData(emptyForm())
  }

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault()
    const appStore = useAppStore.getState()
    // Validate group_id is required
    if (formData.group_id === null) {
      appStore.showError(t('keys.groupRequired'))
      return
    }

    // Validate custom key if enabled
    if (!showEditModal && formData.use_custom_key) {
      if (!formData.custom_key) {
        appStore.showError(t('keys.customKeyRequired'))
        return
      }
      if (customKeyError) {
        appStore.showError(customKeyError)
        return
      }
    }

    // Parse IP lists only if IP restriction is enabled
    const parseIPList = (text: string): string[] =>
      text.split('\n').map((ip) => ip.trim()).filter((ip) => ip.length > 0)
    const ipWhitelist = formData.enable_ip_restriction ? parseIPList(formData.ip_whitelist) : []
    const ipBlacklist = formData.enable_ip_restriction ? parseIPList(formData.ip_blacklist) : []

    // Calculate quota value (null/empty/0 = unlimited, stored as 0)
    const quotaValue = toNumber(formData.quota)
    const quota = quotaValue && quotaValue > 0 ? quotaValue : 0

    // Calculate expiration
    let expiresInDays: number | undefined
    let expiresAt: string | null | undefined
    if (formData.enable_expiration && formData.expiration_date) {
      if (!showEditModal) {
        // Create mode: calculate days from date
        const expDate = new Date(formData.expiration_date)
        const current = new Date()
        const diffDays = Math.ceil((expDate.getTime() - current.getTime()) / (1000 * 60 * 60 * 24))
        expiresInDays = diffDays > 0 ? diffDays : 1
      } else {
        // Edit mode: use custom date directly
        expiresAt = new Date(formData.expiration_date).toISOString()
      }
    } else if (showEditModal) {
      // Edit mode: if expiration disabled or date cleared, send empty string to clear
      expiresAt = ''
    }

    // Calculate rate limit values (send 0 when toggle is off)
    const positive = (value: string) => {
      const parsed = toNumber(value)
      return parsed && parsed > 0 ? parsed : 0
    }
    const rateLimitData = formData.enable_rate_limit ? {
      rate_limit_5h: positive(formData.rate_limit_5h),
      rate_limit_1d: positive(formData.rate_limit_1d),
      rate_limit_7d: positive(formData.rate_limit_7d),
    } : { rate_limit_5h: 0, rate_limit_1d: 0, rate_limit_7d: 0 }

    setSubmitting(true)
    try {
      if (showEditModal && selectedKey) {
        const updates: UpdateApiKeyRequest = {
          name: formData.name,
          group_id: formData.group_id,
          ip_whitelist: ipWhitelist,
          ip_blacklist: ipBlacklist,
          quota: quota,
          expires_at: expiresAt,
          rate_limit_5h: rateLimitData.rate_limit_5h,
          rate_limit_1d: rateLimitData.rate_limit_1d,
          rate_limit_7d: rateLimitData.rate_limit_7d,
        }
        if (shouldSubmitEditStatus(selectedKey, formData.status)) {
          updates.status = formData.status
        }
        await keysAPI.update(selectedKey.id, updates)
        appStore.showSuccess(t('keys.keyUpdatedSuccess'))
      } else {
        const customKey = formData.use_custom_key ? formData.custom_key : undefined
        await keysAPI.create(
          formData.name,
          formData.group_id,
          customKey,
          ipWhitelist,
          ipBlacklist,
          quota,
          expiresInDays,
          rateLimitData
        )
        appStore.showSuccess(t('keys.keyCreatedSuccess'))
        // Only advance tour if active, on submit step, and creation succeeded
        const onboarding = useOnboardingStore.getState()
        if (onboarding.isCurrentStep('[data-tour="key-form-submit"]')) {
          void onboarding.nextStep(500)
        }
      }
      closeModals()
      void loadApiKeys()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || t('keys.failedToSave')
      appStore.showError(errorMsg)
      // Don't advance tour on error
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * 处理删除 API Key 的操作
   * 优化：错误处理改进，优先显示后端返回的具体错误消息（如权限不足等），
   * 若后端未返回消息则显示默认的国际化文本
   */
  const handleDelete = async () => {
    if (!selectedKey) return
    const appStore = useAppStore.getState()
    try {
      await keysAPI.delete(selectedKey.id)
      appStore.showSuccess(t('keys.keyDeletedSuccess'))
      setShowDeleteDialog(false)
      void loadApiKeys()
    } catch (error: any) {
      // 优先使用后端返回的错误消息，提供更具体的错误信息给用户
      const errorMsg = error?.message || t('keys.failedToDelete')
      appStore.showError(errorMsg)
    }
  }

  // Set expiration date based on quick select days
  const setExpirationDays = (days: number) => {
    const expDate = new Date()
    expDate.setDate(expDate.getDate() + days)
    setFormData((current) => ({
      ...current,
      expiration_preset: days.toString() as '7' | '30' | '90',
      expiration_date: formatDateTimeLocal(expDate.toISOString())
    }))
  }

  // Reset quota used for an API key
  const resetQuotaUsed = async () => {
    const key = live.current.selectedKey
    if (!key) return
    setShowResetQuotaDialog(false)
    const appStore = useAppStore.getState()
    try {
      const updatedKey = await keysAPI.update(key.id, { reset_quota: true })
      appStore.showSuccess(t('keys.quotaResetSuccess'))
      // Vue 版直接修改行对象；这里替换列表与当前编辑中的同一条记录
      const statusChanged = key.status !== updatedKey.status
      const nextKey: ApiKey = {
        ...key,
        quota_used: updatedKey.quota_used,
        ...(statusChanged ? { status: updatedKey.status } : {})
      }
      setApiKeys(live.current.apiKeys.map((item) => (item.id === key.id ? { ...item, ...nextKey } : item)))
      if (live.current.selectedKey?.id === key.id) {
        setSelectedKey(nextKey)
        if (statusChanged) {
          setFormData((current) => ({ ...current, status: updatedKey.status === 'active' ? 'active' : 'inactive' }))
        }
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || t('keys.failedToResetQuota')
      appStore.showError(errorMsg)
    }
  }

  // Show reset rate limit confirmation dialog (from table row)
  const confirmResetRateLimitFromTable = (row: ApiKey) => {
    setSelectedKey(row)
    setShowResetRateLimitDialog(true)
  }

  // Reset rate limit usage for an API key
  const resetRateLimitUsage = async () => {
    const key = live.current.selectedKey
    if (!key) return
    setShowResetRateLimitDialog(false)
    const appStore = useAppStore.getState()
    try {
      await keysAPI.update(key.id, { reset_rate_limit_usage: true })
      appStore.showSuccess(t('keys.rateLimitResetSuccess'))
      // Refresh key data
      await loadApiKeys()
      // Update the editing key with fresh data
      const refreshedKey = live.current.apiKeys.find((k) => k.id === key.id)
      if (refreshedKey) {
        setSelectedKey(refreshedKey)
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || t('keys.failedToResetRateLimit')
      appStore.showError(errorMsg)
    }
  }

  const executeCcsImport = (row: ApiKey, clientType: CcSwitchClientType) => {
    const baseUrl = publicSettings?.api_base_url || window.location.origin
    const platform = row.group?.platform || 'anthropic'

    const usageScript = CC_SWITCH_USAGE_SCRIPT
    const providerName = (publicSettings?.site_name || 'RetooAi').trim() || 'RetooAi'
    const deeplink = buildCcSwitchImportDeeplink({
      baseUrl,
      platform,
      clientType,
      providerName,
      apiKey: row.key,
      usageScript
    })

    const appStore = useAppStore.getState()
    try {
      window.open(deeplink, '_self')

      // Check if the protocol handler worked by detecting if we're still focused
      setTimeout(() => {
        if (document.hasFocus()) {
          // Still focused means the protocol handler likely failed
          appStore.showError(t('keys.ccSwitchNotInstalled'))
        }
      }, 100)
    } catch {
      appStore.showError(t('keys.ccSwitchNotInstalled'))
    }
  }

  const importToCcswitch = (row: ApiKey) => {
    const platform = row.group?.platform || 'anthropic'

    // For antigravity platform, show client selection dialog
    if (platform === 'antigravity') {
      setPendingCcsRow(row)
      setShowCcsClientSelect(true)
      return
    }

    // For other platforms, execute directly
    executeCcsImport(row, platform === 'gemini' ? 'gemini' : 'claude')
  }

  const handleCcsClientSelect = (clientType: CcSwitchClientType) => {
    if (pendingCcsRow) {
      executeCcsImport(pendingCcsRow, clientType)
    }
    setShowCcsClientSelect(false)
    setPendingCcsRow(null)
  }

  const closeCcsClientSelect = () => {
    setShowCcsClientSelect(false)
    setPendingCcsRow(null)
  }

  function formatResetTime(resetAt: string | null): string {
    if (!resetAt) return ''
    const diff = new Date(resetAt).getTime() - now.getTime()
    if (diff <= 0) return t('keys.resetNow')
    const days = Math.floor(diff / 86400000)
    const hours = Math.floor((diff % 86400000) / 3600000)
    const mins = Math.floor((diff % 3600000) / 60000)
    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${mins}m`
    return `${mins}m`
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时加载列表（Vue 版 onMounted）
    void loadApiKeys()
    void loadGroups()
    void loadUserGroupRates()
    void loadPublicSettings()
    const resetTimer = setInterval(() => { setNow(new Date()) }, 60000)
    return () => {
      clearInterval(resetTimer)
      abortController.current?.abort()
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 与 Vue 版 onMounted 一致，只在挂载时加载
  }, [])

  // 分组切换浮层：点击触发按钮与浮层以外的区域时关闭
  useEffect(() => {
    if (groupSelectorKeyId === null) return
    const closeGroupSelector = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      // Check if click is inside the dropdown or the trigger button
      if (!target.closest('[data-group-dropdown-trigger]') && !dropdownRef.current?.contains(target)) {
        closeGroupDropdown()
      }
    }
    document.addEventListener('click', closeGroupSelector)
    return () => document.removeEventListener('click', closeGroupSelector)
  }, [groupSelectorKeyId])

  const updateForm = <K extends keyof KeyFormData>(field: K, value: KeyFormData[K]) =>
    setFormData((current) => ({ ...current, [field]: value }))

  const isGroupOptionSelected = (value: number | null) =>
    selectedKeyForGroup?.group_id === value || (!selectedKeyForGroup?.group_id && value === null)

  const renderRateWindow = (label: string, used: number, limit: number, resetAt: string | null) => (
    <div>
      <div className={styles.rateHeader}>
        <span className={styles.muted}>{label}</span>
        <span className={styles.rateValue} data-tone={limitTone(used, limit)}>
          ${used?.toFixed(2) || '0.00'}/${limit?.toFixed(2)}
        </span>
      </div>
      <LimitBar used={used} limit={limit} ok="success" thin />
      {resetAt && formatResetTime(resetAt) && (
        <div className={styles.resetAt}>⟳ {formatResetTime(resetAt)}</div>
      )}
    </div>
  )

  const renderEditUsage = (used: number, limit: number) => (
    <div className={styles.usageBox}>
      <div className={styles.usageValue}>
        <span className={styles.usageUsed} data-tone={limitTone(used, limit)}>${used?.toFixed(4) || '0.0000'}</span>
        <span className={styles.usageSlash}>/</span>
        <span className={styles.muted}>${limit?.toFixed(2) || '0.00'}</span>
      </div>
      <LimitBar used={used} limit={limit} ok="success" />
    </div>
  )

  const statusTone = (value: string): BadgeTone =>
    value === 'active' ? 'success'
      : value === 'quota_exhausted' ? 'warning'
        : value === 'expired' ? 'danger'
          : 'neutral'

  const cells: Record<string, (ctx: { row: ApiKey; value: any }) => ReactNode> = {
    id: ({ value }) => <span className={styles.mono}>#{value}</span>,
    key: ({ value, row }) => (
      <div className={styles.inline}>
        <code className={styles.code}>{maskApiKey(value)}</code>
        <button
          type="button"
          className={styles.iconButton}
          data-copied={copiedKeyId === row.id}
          title={copiedKeyId === row.id ? t('keys.copied') : t('keys.copyToClipboard')}
          aria-label={copiedKeyId === row.id ? t('keys.copied') : t('keys.copyToClipboard')}
          onClick={() => void copyToClipboard(value, row.id)}
        >
          {copiedKeyId === row.id ? <Check size={14} aria-hidden="true" /> : <Clipboard size={14} aria-hidden="true" />}
        </button>
      </div>
    ),
    name: ({ value, row }) => (
      <div className={styles.inline}>
        <span className={styles.name}>{value}</span>
        {(row.ip_whitelist?.length > 0 || row.ip_blacklist?.length > 0) && (
          <span className={styles.shield} title={t('keys.ipRestrictionEnabled')}>
            <Shield size={14} aria-label={t('keys.ipRestrictionEnabled')} />
          </span>
        )}
      </div>
    ),
    group: ({ row }) => (
      <button
        type="button"
        ref={(el) => {
          if (el) groupButtonRefs.current.set(row.id, el)
          else groupButtonRefs.current.delete(row.id)
        }}
        data-group-dropdown-trigger=""
        className={styles.groupTrigger}
        title={t('keys.clickToChangeGroup')}
        onClick={() => openGroupSelector(row)}
      >
        {row.group ? (
          <GroupBadge
            name={row.group.name}
            platform={row.group.platform}
            subscriptionType={row.group.subscription_type}
            rateMultiplier={row.group.rate_multiplier}
            userRateMultiplier={userGroupRates[row.group.id]}
            peakRateEnabled={row.group.peak_rate_enabled}
            peakStart={row.group.peak_start}
            peakEnd={row.group.peak_end}
            peakRateMultiplier={row.group.peak_rate_multiplier}
          />
        ) : (
          <span className={styles.placeholder}>{t('keys.noGroup')}</span>
        )}
        <span className={styles.groupHint}>{t('keys.selectGroup')}</span>
        <ChevronsUpDown size={14} className={styles.groupChevron} aria-hidden="true" />
      </button>
    ),
    current_concurrency: ({ value }) => (
      <span className={styles.concurrency} data-active={(value ?? 0) > 0}>{value ?? 0}</span>
    ),
    usage: ({ row }) => (
      <div className={styles.usageCell}>
        <div className={styles.inline}>
          <span className={styles.muted}>{t('keys.today')}:</span>
          {usageLoading && !usageStats[row.id] ? (
            <span className={styles.usagePending} data-test="usage-pending" aria-hidden="true" />
          ) : (
            <span className={styles.strong}>${(usageStats[row.id]?.today_actual_cost ?? 0).toFixed(4)}</span>
          )}
        </div>
        <div className={styles.inline}>
          <span className={styles.muted}>{t('keys.total')}:</span>
          {usageLoading && !usageStats[row.id] ? (
            <span className={styles.usagePending} aria-hidden="true" />
          ) : (
            <span className={styles.strong}>${(usageStats[row.id]?.total_actual_cost ?? 0).toFixed(4)}</span>
          )}
        </div>
        {/* Quota progress (if quota is set) */}
        {row.quota > 0 && (
          <div className={styles.quota}>
            <div className={styles.inline}>
              <span className={styles.muted}>{t('keys.quota')}:</span>
              <span className={styles.rateValue} data-tone={limitTone(row.quota_used, row.quota)}>
                ${row.quota_used?.toFixed(2) || '0.00'} / ${row.quota?.toFixed(2)}
              </span>
            </div>
            <LimitBar used={row.quota_used} limit={row.quota} ok="accent" />
          </div>
        )}
      </div>
    ),
    rate_limit: ({ row }) =>
      row.rate_limit_5h > 0 || row.rate_limit_1d > 0 || row.rate_limit_7d > 0 ? (
        <div className={styles.rateCell}>
          {/* 5h window */}
          {row.rate_limit_5h > 0 && renderRateWindow('5h', row.usage_5h, row.rate_limit_5h, row.reset_5h_at)}
          {/* 1d window */}
          {row.rate_limit_1d > 0 && renderRateWindow('1d', row.usage_1d, row.rate_limit_1d, row.reset_1d_at)}
          {/* 7d window */}
          {row.rate_limit_7d > 0 && renderRateWindow('7d', row.usage_7d, row.rate_limit_7d, row.reset_7d_at)}
          {/* Reset button */}
          {(row.usage_5h > 0 || row.usage_1d > 0 || row.usage_7d > 0) && (
            <button
              type="button"
              className={styles.resetButton}
              title={t('keys.resetRateLimitUsage')}
              onClick={(event) => {
                event.stopPropagation()
                confirmResetRateLimitFromTable(row)
              }}
            >
              <RefreshCw size={12} aria-hidden="true" />
              {t('keys.resetUsage')}
            </button>
          )}
        </div>
      ) : (
        <span className={styles.placeholder}>-</span>
      ),
    expires_at: ({ value }) =>
      value ? (
        <span className={styles.secondary} data-expired={new Date(value) < new Date()}>{formatDateTime(value)}</span>
      ) : (
        <span className={styles.placeholder}>{t('keys.noExpiration')}</span>
      ),
    status: ({ value }) => <Badge tone={statusTone(value)} size="sm">{t('keys.status.' + value)}</Badge>,
    last_used_at: ({ value }) =>
      value ? <span className={styles.secondary}>{formatDateTime(value)}</span> : <span className={styles.placeholder}>-</span>,
    last_used_ip: ({ value }) =>
      value ? <span className={styles.secondary}>{value}</span> : <span className={styles.placeholder}>-</span>,
    created_at: ({ value }) => <span className={styles.secondary}>{formatDateTime(value)}</span>,
    actions: ({ row }) => (
      <div className={styles.actions}>
        {/* Use Key Button */}
        <button type="button" className={styles.actionButton} onClick={() => openUseKeyModal(row)}>
          <Terminal size={16} aria-hidden="true" />
          <span>{t('keys.useKey')}</span>
        </button>
        {/* Import to CC Switch Button */}
        {!publicSettings?.hide_ccs_import_button && (
          <button type="button" className={styles.actionButton} onClick={() => importToCcswitch(row)}>
            <Upload size={16} aria-hidden="true" />
            <span>{t('keys.importToCcSwitch')}</span>
          </button>
        )}
        {/* Toggle Status Button */}
        <button type="button" className={styles.actionButton} onClick={() => void toggleKeyStatus(row)}>
          {row.status === 'active' ? <Ban size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
          <span>{row.status === 'active' ? t('keys.disable') : t('keys.enable')}</span>
        </button>
        {/* Edit Button */}
        <button type="button" className={styles.actionButton} onClick={() => editKey(row)}>
          <Pencil size={16} aria-hidden="true" />
          <span>{t('common.edit')}</span>
        </button>
        {/* Delete Button */}
        <button type="button" className={styles.actionButton} data-tone="danger" onClick={() => confirmDelete(row)}>
          <Trash2 size={16} aria-hidden="true" />
          <span>{t('common.delete')}</span>
        </button>
      </div>
    )
  }

  const renderGroupOptionItem = (option: GroupOption, selected: boolean) => (
    <GroupOptionItem
      name={option.label}
      platform={option.platform}
      subscriptionType={option.subscriptionType}
      rateMultiplier={option.rate}
      userRateMultiplier={option.userRate}
      peakRateEnabled={option.peakRateEnabled}
      peakStart={option.peakStart}
      peakEnd={option.peakEnd}
      peakRateMultiplier={option.peakRateMultiplier}
      description={option.description}
      selected={selected}
    />
  )

  const limitInput = (field: 'rate_limit_5h' | 'rate_limit_1d' | 'rate_limit_7d', label: string, used: number, limit: number) => (
    <div className={styles.field}>
      <Input
        label={label}
        value={formData[field]}
        onChange={(value) => updateForm(field, value)}
        type="number"
        step="0.01"
        min="0"
        placeholder="0"
        prefix={<span className={styles.currency}>$</span>}
      />
      {/* Usage info (edit mode only) */}
      {showEditModal && selectedKey && limit > 0 && renderEditUsage(used, limit)}
    </div>
  )

  return (
    <>
      <TablePageLayout
        filters={
          <div className={styles.filters}>
            <div className={styles.toolbar}>
              <div className={styles.filterGroup}>
                <SearchInput
                  className={styles.search}
                  value={filterSearch}
                  placeholder={t('keys.searchPlaceholder')}
                  onChange={(value) => {
                    live.current.search = value
                    setFilterSearchState(value)
                  }}
                  onSearch={onFilterChange}
                />
                <div className={styles.filterSelect}>
                  <Select
                    value={filterGroupId}
                    options={groupFilterOptions}
                    aria-label={t('keys.group')}
                    onChange={onGroupFilterChange}
                  />
                </div>
                <div className={styles.filterSelect}>
                  <Select
                    value={filterStatus}
                    options={statusFilterOptions}
                    aria-label={t('common.status')}
                    onChange={onStatusFilterChange}
                  />
                </div>
              </div>
              <div className={styles.actionGroup}>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={loading}
                  title={t('common.refresh')}
                  aria-label={t('common.refresh')}
                  onClick={() => void loadApiKeys()}
                >
                  <RefreshCw size={16} aria-hidden="true" className={loading ? styles.spinning : undefined} />
                </Button>
                <Popover open={showColumnDropdown} onOpenChange={setShowColumnDropdown}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="secondary" title={t('keys.columnSettings')}>
                      <Columns3 size={16} aria-hidden="true" />
                      <span className={styles.desktopOnly}>{t('keys.columnSettings')}</span>
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
                          {isColumnVisible(col.key) ? <Check size={16} className={styles.check} aria-hidden="true" /> : null}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <Button type="button" data-tour="keys-create-btn" onClick={openCreateModal}>
                  <Plus size={16} aria-hidden="true" />
                  {t('keys.createKey')}
                </Button>
              </div>
            </div>
            {(publicSettings?.api_base_url || (publicSettings?.custom_endpoints?.length ?? 0) > 0) && (
              <EndpointPopover
                apiBaseUrl={publicSettings?.api_base_url || ''}
                customEndpoints={publicSettings?.custom_endpoints || []}
              />
            )}
            {selectedIds.length > 0 && (
              <div className={styles.selectionBar}>
                <span className={styles.secondary}>{t('keys.bulkEdit.selectedCount', { count: selectedIds.length })}</span>
                <Button
                  type="button"
                  size="sm"
                  disabled={loading}
                  data-test="bulk-edit-keys"
                  onClick={() => setShowBulkEditModal(true)}
                >
                  {t('keys.bulkEdit.title')}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setSelectedIds([])}>
                  {t('keys.bulkEdit.clearSelection')}
                </Button>
              </div>
            )}
          </div>
        }
        table={
          <DataTable<ApiKey>
            columns={columns}
            data={apiKeys}
            loading={loading}
            selectable
            rowKey="id"
            selectedKeys={selectedIds}
            selectionLabel={(key) => t('keys.bulkEdit.selectKey', { name: key.name })}
            onSelectedKeysChange={handleSelectionChange}
            serverSideSort
            defaultSortKey="created_at"
            defaultSortOrder="desc"
            onSort={handleSort}
            cells={cells}
            empty={
              <EmptyState
                title={t('keys.noKeysYet')}
                description={t('keys.createFirstKey')}
                actionText={t('keys.createKey')}
                onAction={openCreateModal}
              />
            }
          />
        }
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

      {/* Create/Edit Modal */}
      <BaseDialog
        show={showCreateModal || showEditModal}
        title={showEditModal ? t('keys.editKey') : t('keys.createKey')}
        width="normal"
        onClose={closeModals}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeModals}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="key-form" loading={submitting} disabled={submitting} data-tour="key-form-submit">
              {submitting
                ? t('keys.saving')
                : showEditModal
                  ? t('common.update')
                  : t('common.create')}
            </Button>
          </>
        }
      >
        <form id="key-form" className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
          <Input
            label={t('keys.nameLabel')}
            value={formData.name}
            onChange={(value) => updateForm('name', value)}
            required
            placeholder={t('keys.namePlaceholder')}
            data-tour="key-form-name"
          />

          <div className={styles.field} data-tour="key-form-group">
            <label className={styles.label} htmlFor="key-form-group">{t('keys.groupLabel')}</label>
            <Select
              key={showEditModal ? 'edit' : 'create'}
              id="key-form-group"
              aria-label={t('keys.groupLabel')}
              value={formData.group_id}
              onChange={(value) => updateForm('group_id', value as number | null)}
              options={formGroupOptions as unknown as Array<Record<string, unknown>>}
              placeholder={t('keys.selectGroup')}
              emptyText={t('common.noGroupsAvailable')}
              searchable
              searchPlaceholder={t('keys.searchGroup')}
              renderSelected={(option) => {
                const group = option as unknown as GroupOption | null
                return group ? (
                  <GroupBadge
                    name={group.label}
                    platform={group.platform}
                    subscriptionType={group.subscriptionType}
                    rateMultiplier={group.rate}
                    userRateMultiplier={group.userRate}
                    peakRateEnabled={group.peakRateEnabled}
                    peakStart={group.peakStart}
                    peakEnd={group.peakEnd}
                    peakRateMultiplier={group.peakRateMultiplier}
                  />
                ) : (
                  <span className={styles.placeholder}>{t('keys.selectGroup')}</span>
                )
              }}
              renderOption={(option, selected) => renderGroupOptionItem(option as unknown as GroupOption, selected)}
            />
          </div>

          {/* Custom Key Section (only for create) */}
          {!showEditModal && (
            <ToggleField
              label={t('keys.customKeyLabel')}
              checked={formData.use_custom_key}
              onChange={(value) => updateForm('use_custom_key', value)}
            >
              {formData.use_custom_key && (
                <Input
                  value={formData.custom_key}
                  onChange={(value) => updateForm('custom_key', value)}
                  className={styles.monoInput}
                  placeholder={t('keys.customKeyPlaceholder')}
                  aria-label={t('keys.customKeyLabel')}
                  error={customKeyError || undefined}
                  hint={t('keys.customKeyHint')}
                />
              )}
            </ToggleField>
          )}

          {showEditModal && (
            <div className={styles.field}>
              <span className={styles.label}>{t('keys.statusLabel')}</span>
              <Select
                value={formData.status}
                onChange={(value) => updateForm('status', value as 'active' | 'inactive')}
                options={statusOptions}
                placeholder={t('keys.selectStatus')}
                aria-label={t('keys.statusLabel')}
              />
            </div>
          )}

          {/* IP Restriction Section */}
          <ToggleField
            label={t('keys.ipRestriction')}
            checked={formData.enable_ip_restriction}
            onChange={(value) => updateForm('enable_ip_restriction', value)}
          >
            {formData.enable_ip_restriction && (
              <div className={styles.subFields}>
                <TextArea
                  label={t('keys.ipWhitelist')}
                  value={formData.ip_whitelist}
                  onChange={(value) => updateForm('ip_whitelist', value)}
                  rows={3}
                  className={styles.monoInput}
                  placeholder={t('keys.ipWhitelistPlaceholder')}
                  hint={t('keys.ipWhitelistHint')}
                />
                <TextArea
                  label={t('keys.ipBlacklist')}
                  value={formData.ip_blacklist}
                  onChange={(value) => updateForm('ip_blacklist', value)}
                  rows={3}
                  className={styles.monoInput}
                  placeholder={t('keys.ipBlacklistPlaceholder')}
                  hint={t('keys.ipBlacklistHint')}
                />
              </div>
            )}
          </ToggleField>

          {/* Quota Limit Section：开关已移除，始终显示输入框，0 = 不限 */}
          <div className={styles.formSection}>
            <Input
              label={t('keys.quotaLimit')}
              value={formData.quota}
              onChange={(value) => updateForm('quota', value)}
              type="number"
              step="0.01"
              min="0"
              placeholder={t('keys.quotaAmountPlaceholder')}
              prefix={<span className={styles.currency}>$</span>}
              hint={t('keys.quotaAmountHint')}
            />

            {/* Quota used display (only in edit mode) */}
            {showEditModal && selectedKey && selectedKey.quota > 0 && (
              <div className={styles.field}>
                <span className={styles.label}>{t('keys.quotaUsed')}</span>
                <div className={styles.quotaUsedRow}>
                  <div className={styles.usageValue}>
                    <span className={styles.strong}>${selectedKey.quota_used?.toFixed(4) || '0.0000'}</span>
                    <span className={styles.usageSlash}>/</span>
                    <span className={styles.muted}>${selectedKey.quota?.toFixed(2) || '0.00'}</span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    title={t('keys.resetQuotaUsed')}
                    onClick={() => setShowResetQuotaDialog(true)}
                  >
                    {t('keys.reset')}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Rate Limit Section */}
          <ToggleField
            label={t('keys.rateLimitSection')}
            checked={formData.enable_rate_limit}
            onChange={(value) => updateForm('enable_rate_limit', value)}
          >
            {formData.enable_rate_limit && (
              <div className={styles.subFields}>
                <p className={styles.hint}>{t('keys.rateLimitHint')}</p>
                {/* 5-Hour Limit */}
                {limitInput('rate_limit_5h', t('keys.rateLimit5h'), selectedKey?.usage_5h ?? 0, selectedKey?.rate_limit_5h ?? 0)}
                {/* Daily Limit */}
                {limitInput('rate_limit_1d', t('keys.rateLimit1d'), selectedKey?.usage_1d ?? 0, selectedKey?.rate_limit_1d ?? 0)}
                {/* 7-Day Limit */}
                {limitInput('rate_limit_7d', t('keys.rateLimit7d'), selectedKey?.usage_7d ?? 0, selectedKey?.rate_limit_7d ?? 0)}

                {/* Reset Rate Limit button (edit mode only) */}
                {showEditModal && selectedKey &&
                  (selectedKey.rate_limit_5h > 0 || selectedKey.rate_limit_1d > 0 || selectedKey.rate_limit_7d > 0) && (
                  <div>
                    <Button type="button" size="sm" variant="secondary" onClick={() => setShowResetRateLimitDialog(true)}>
                      {t('keys.resetRateLimitUsage')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </ToggleField>

          {/* Expiration Section */}
          <ToggleField
            label={t('keys.expiration')}
            checked={formData.enable_expiration}
            onChange={(value) => updateForm('enable_expiration', value)}
          >
            {formData.enable_expiration && (
              <div className={styles.subFields}>
                {/* Quick select buttons (for both create and edit mode) */}
                <div className={styles.presets}>
                  {(['7', '30', '90'] as const).map((days) => (
                    <button
                      key={days}
                      type="button"
                      className={styles.preset}
                      aria-pressed={formData.expiration_preset === days}
                      onClick={() => setExpirationDays(parseInt(days))}
                    >
                      {showEditModal ? t('keys.extendDays', { days }) : t('keys.expiresInDays', { days })}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={styles.preset}
                    aria-pressed={formData.expiration_preset === 'custom'}
                    onClick={() => updateForm('expiration_preset', 'custom')}
                  >
                    {t('keys.customDate')}
                  </button>
                </div>

                {/* Date picker (always show for precise adjustment) */}
                <Input
                  label={t('keys.expirationDate')}
                  value={formData.expiration_date}
                  onChange={(value) => updateForm('expiration_date', value)}
                  type="datetime-local"
                  hint={t('keys.expirationDateHint')}
                />

                {/* Current expiration display (only in edit mode) */}
                {showEditModal && selectedKey?.expires_at && (
                  <div className={styles.currentExpiration}>
                    <span className={styles.muted}>{t('keys.currentExpiration')}: </span>
                    <span className={styles.strong}>{formatDateTime(selectedKey.expires_at)}</span>
                  </div>
                )}
              </div>
            )}
          </ToggleField>
        </form>
      </BaseDialog>

      <BulkEditKeysModal
        show={showBulkEditModal}
        selectedKeys={selectedApiKeys}
        groups={groups}
        onClose={() => setShowBulkEditModal(false)}
        onUpdated={handleBulkUpdated}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        show={showDeleteDialog}
        title={t('keys.deleteKey')}
        message={t('keys.deleteConfirmMessage', { name: selectedKey?.name })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setShowDeleteDialog(false)}
      />

      {/* Reset Quota Confirmation Dialog */}
      <ConfirmDialog
        show={showResetQuotaDialog}
        title={t('keys.resetQuotaTitle')}
        message={t('keys.resetQuotaConfirmMessage', { name: selectedKey?.name, used: selectedKey?.quota_used?.toFixed(4) })}
        confirmText={t('keys.reset')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void resetQuotaUsed()}
        onCancel={() => setShowResetQuotaDialog(false)}
      />

      {/* Reset Rate Limit Confirmation Dialog */}
      <ConfirmDialog
        show={showResetRateLimitDialog}
        title={t('keys.resetRateLimitTitle')}
        message={t('keys.resetRateLimitConfirmMessage', { name: selectedKey?.name })}
        confirmText={t('keys.reset')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void resetRateLimitUsage()}
        onCancel={() => setShowResetRateLimitDialog(false)}
      />

      {/* Use Key Modal */}
      <UseKeyModal
        show={showUseKeyModal}
        apiKey={selectedKey?.key || ''}
        baseUrl={publicSettings?.api_base_url || ''}
        platform={selectedKey?.group?.platform || null}
        claudeCodeOnly={selectedKey?.group?.claude_code_only || false}
        allowMessagesDispatch={selectedKey?.group?.allow_messages_dispatch || false}
        onClose={closeUseKeyModal}
      />

      {/* CCS Client Selection Dialog for Antigravity */}
      <BaseDialog
        show={showCcsClientSelect}
        title={t('keys.ccsClientSelect.title')}
        width="narrow"
        onClose={closeCcsClientSelect}
        footer={
          <Button type="button" variant="secondary" onClick={closeCcsClientSelect}>
            {t('common.cancel')}
          </Button>
        }
      >
        <div className={styles.ccsBody}>
          <p className={styles.secondary}>{t('keys.ccsClientSelect.description')}</p>
          <div className={styles.ccsGrid}>
            <button type="button" className={styles.ccsOption} onClick={() => handleCcsClientSelect('claude')}>
              <Terminal size={28} aria-hidden="true" />
              <span className={styles.strong}>{t('keys.ccsClientSelect.claudeCode')}</span>
              <span className={styles.ccsDesc}>{t('keys.ccsClientSelect.claudeCodeDesc')}</span>
            </button>
            <button type="button" className={styles.ccsOption} onClick={() => handleCcsClientSelect('gemini')}>
              <Sparkles size={28} aria-hidden="true" />
              <span className={styles.strong}>{t('keys.ccsClientSelect.geminiCli')}</span>
              <span className={styles.ccsDesc}>{t('keys.ccsClientSelect.geminiCliDesc')}</span>
            </button>
          </div>
        </div>
      </BaseDialog>

      {/* Group Selector Dropdown (Teleported to body to avoid overflow clipping) */}
      {groupSelectorKeyId !== null && dropdownPosition && createPortal(
        <div
          ref={dropdownRef}
          className={styles.groupDropdown}
          style={{
            top: dropdownPosition.top !== undefined ? dropdownPosition.top + 'px' : undefined,
            bottom: dropdownPosition.bottom !== undefined ? dropdownPosition.bottom + 'px' : undefined,
            left: dropdownPosition.left + 'px'
          } as CSSProperties}
        >
          {/* Search box */}
          <div className={styles.groupSearch}>
            <Search size={16} className={styles.groupSearchIcon} aria-hidden="true" />
            <input
              type="text"
              value={groupSearchQuery}
              className={styles.groupSearchInput}
              placeholder={t('keys.searchGroup')}
              aria-label={t('keys.searchGroup')}
              autoFocus
              onChange={(event) => setGroupSearchQuery(event.target.value)}
              onClick={(event) => event.stopPropagation()}
            />
          </div>
          {/* Group list */}
          <div className={styles.groupList}>
            {filteredGroupOptions.map((option) => (
              <button
                key={option.value ?? 'null'}
                type="button"
                className={styles.groupOption}
                data-selected={isGroupOptionSelected(option.value)}
                title={option.description || undefined}
                onClick={() => void changeGroup(selectedKeyForGroup!, option.value)}
              >
                {renderGroupOptionItem(option, isGroupOptionSelected(option.value))}
              </button>
            ))}
            {/* Empty state when search has no results */}
            {filteredGroupOptions.length === 0 && (
              <div className={styles.groupEmpty}>{t('keys.noGroupFound')}</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
