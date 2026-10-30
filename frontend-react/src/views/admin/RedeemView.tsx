/**
 * 兑换码管理页，对应 Vue 版 views/admin/RedeemView.vue。
 * 工具栏（搜索、类型、状态、导出、批量修改、生成）+ 表格区域（选择栏、兑换码表格）+ 分页与"删除全部未使用"；
 * 生成、批量修改、删除与导出沿用 Vue 版的接口调用与校验。
 */
import { Check, Copy, Download, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { Alert } from '@/components/arc/alert/alert'
import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { adminAPI } from '@/api/admin'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import DataTable, { type DataTableCellContext } from '@/components/common/DataTable'
import GroupBadge from '@/components/common/GroupBadge'
import GroupOptionItem from '@/components/common/GroupOptionItem'
import Input from '@/components/common/Input'
import Pagination from '@/components/common/Pagination'
import SearchInput from '@/components/common/SearchInput'
import Select, { type SelectOption } from '@/components/common/Select'
import TablePageLayout from '@/components/common/TablePageLayout'
import TextArea from '@/components/common/TextArea'
import type { Column } from '@/components/common/types'
import { useClipboard } from '@/composables/useClipboard'
import { getPersistedPageSize } from '@/composables/usePersistedPageSize'
import { useTableSelection } from '@/composables/useTableSelection'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type {
  BatchUpdateRedeemCodeFields,
  Group,
  GroupPlatform,
  RedeemCode,
  RedeemCodeType,
  SubscriptionType
} from '@/types'
import { formatDateTime, getBrowserTimeZone, parseDateTimeLocalInput } from '@/utils/format'
import styles from './RedeemView.module.css'

interface GroupOption {
  value: number
  label: string
  description: string | null
  platform: GroupPlatform
  subscriptionType: SubscriptionType
  rate: number
}

type RedeemCodeExpiryOption = 'never' | '1' | '3' | '7' | 'custom'
type RedeemStatusFilter = 'used' | 'expired' | 'unused' | 'disabled'

interface Filters {
  type: string
  status: string
}

interface PaginationState {
  page: number
  page_size: number
  total: number
  pages: number
}

interface BatchUpdateForm {
  update_status: boolean
  status: 'unused' | 'disabled'
  update_expires_at: boolean
  expires_mode: 'clear' | 'custom'
  expires_at_local: string
  update_notes: boolean
  notes: string
  update_group_id: boolean
  group_id: number | null
}

interface GenerateForm {
  type: RedeemCodeType
  value: number | string
  count: number | string
  group_id: number | null
  validity_days: number | string
  expiry_option: RedeemCodeExpiryOption
  custom_expiry_days: number | string
}

const iconProps = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

const toDatetimeLocalInputValue = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

const createBatchUpdateForm = (): BatchUpdateForm => ({
  update_status: false,
  status: 'disabled',
  update_expires_at: false,
  expires_mode: 'clear',
  expires_at_local: toDatetimeLocalInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
  update_notes: false,
  notes: '',
  update_group_id: false,
  group_id: null
})

const toNumberInput = (value: string): number | string => (value === '' ? '' : Number(value))

const isAbortError = (error: unknown) => {
  const failure = error as { name?: string; code?: string } | null
  return failure?.name === 'AbortError' || failure?.code === 'ERR_CANCELED'
}

const errorDetail = (error: unknown): string | undefined =>
  (error as { response?: { data?: { detail?: string } } } | null)?.response?.data?.detail

const downloadBlob = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

export default function RedeemView() {
  const { t } = useI18n()
  const { copyToClipboard: clipboardCopy } = useClipboard()
  const browserTimeZone = getBrowserTimeZone()

  const [showGenerateDialog, setShowGenerateDialog] = useState(false)
  const [showResultDialog, setShowResultDialog] = useState(false)
  const [generatedCodes, setGeneratedCodes] = useState<RedeemCode[]>([])
  const [subscriptionGroups, setSubscriptionGroups] = useState<Group[]>([])
  const [copiedAll, setCopiedAll] = useState(false)

  const [codes, setCodes] = useState<RedeemCode[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [batchUpdating, setBatchUpdating] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchQueryRef = useRef('')
  const [filters, setFiltersState] = useState<Filters>({ type: '', status: '' })
  const filtersRef = useRef(filters)
  const [pagination, setPaginationState] = useState<PaginationState>(() => ({
    page: 1,
    page_size: getPersistedPageSize(),
    total: 0,
    pages: 0
  }))
  const paginationRef = useRef(pagination)
  const sortRef = useRef<{ sort_by: string; sort_order: 'asc' | 'desc' }>({ sort_by: 'id', sort_order: 'desc' })
  const abortControllerRef = useRef<AbortController | null>(null)
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>())

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showDeleteUnusedDialog, setShowDeleteUnusedDialog] = useState(false)
  const [showBatchUpdateDialog, setShowBatchUpdateDialog] = useState(false)
  const [deletingCode, setDeletingCode] = useState<RedeemCode | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const {
    selectedSet: selectedCodeIds,
    selectedCount,
    allVisibleSelected,
    select,
    deselect,
    clear: clearSelectedCodes,
    toggleVisible
  } = useTableSelection<RedeemCode>({
    rows: codes,
    getId: (code) => code.id
  })

  const [batchUpdateForm, setBatchUpdateForm] = useState<BatchUpdateForm>(createBatchUpdateForm)
  const [generateForm, setGenerateForm] = useState<GenerateForm>({
    type: 'balance',
    value: 10,
    count: 1,
    group_id: null,
    validity_days: 30,
    expiry_option: 'never',
    custom_expiry_days: 7
  })

  const updateBatchForm = (patch: Partial<BatchUpdateForm>) => setBatchUpdateForm((prev) => ({ ...prev, ...patch }))
  const updateGenerateForm = (patch: Partial<GenerateForm>) => setGenerateForm((prev) => ({ ...prev, ...patch }))

  const updateFilters = (patch: Partial<Filters>) => {
    filtersRef.current = { ...filtersRef.current, ...patch }
    setFiltersState(filtersRef.current)
  }

  const updatePagination = (patch: Partial<PaginationState>) => {
    paginationRef.current = { ...paginationRef.current, ...patch }
    setPaginationState(paginationRef.current)
  }

  const later = (callback: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer)
      callback()
    }, ms)
    timersRef.current.add(timer)
  }

  // 订阅类型分组选项
  const subscriptionGroupOptions: GroupOption[] = subscriptionGroups
    .filter((g) => g.subscription_type === 'subscription')
    .map((g) => ({
      value: g.id,
      label: g.name,
      description: g.description,
      platform: g.platform,
      subscriptionType: g.subscription_type,
      rate: g.rate_multiplier
    }))

  const batchGroupOptions = [{ value: null, label: t('admin.redeem.clearGroup') }, ...subscriptionGroupOptions]

  const generatedCodesText = generatedCodes.map((code) => code.code).join('\n')

  const textareaHeight = (() => {
    const lineCount = generatedCodes.length
    const lineHeight = 24 // approximate line height in px
    const padding = 24 // top + bottom padding
    const minHeight = 60
    const maxHeight = 240
    const calculatedHeight = Math.min(Math.max(lineCount * lineHeight + padding, minHeight), maxHeight)
    return `${calculatedHeight}px`
  })()

  const columns: Column<RedeemCode>[] = [
    { key: 'select', label: '' },
    { key: 'code', label: t('admin.redeem.columns.code') },
    { key: 'type', label: t('admin.redeem.columns.type'), sortable: true },
    { key: 'value', label: t('admin.redeem.columns.value'), sortable: true },
    { key: 'status', label: t('admin.redeem.columns.status'), sortable: true },
    { key: 'used_by', label: t('admin.redeem.columns.usedBy') },
    { key: 'used_at', label: t('admin.redeem.columns.usedAt'), sortable: true },
    { key: 'expires_at', label: t('admin.redeem.columns.expiresAt'), sortable: true },
    { key: 'actions', label: t('admin.redeem.columns.actions') }
  ]

  const typeOptions = [
    { value: 'balance', label: t('admin.redeem.balance') },
    { value: 'concurrency', label: t('admin.redeem.concurrency') },
    { value: 'subscription', label: t('admin.redeem.subscription') },
    { value: 'invitation', label: t('admin.redeem.invitation') }
  ]

  const filterTypeOptions = [{ value: '', label: t('admin.redeem.allTypes') }, ...typeOptions]

  const filterStatusOptions = [
    { value: '', label: t('admin.redeem.allStatus') },
    { value: 'unused', label: t('admin.redeem.unused') },
    { value: 'used', label: t('admin.redeem.used') },
    { value: 'expired', label: t('admin.redeem.status.expired') },
    { value: 'disabled', label: t('admin.redeem.status.disabled') }
  ]

  const batchStatusOptions = [
    { value: 'unused', label: t('admin.redeem.status.unused') },
    { value: 'disabled', label: t('admin.redeem.status.disabled') }
  ]

  const batchExpiryModeOptions = [
    { value: 'clear', label: t('admin.redeem.neverExpires') },
    { value: 'custom', label: t('admin.redeem.customExpiry') }
  ]

  const redeemCodeExpiryOptions: { value: RedeemCodeExpiryOption; label: string }[] = [
    { value: 'never', label: t('admin.redeem.neverExpires') },
    { value: '1', label: t('admin.redeem.expiryPresetDays', { days: 1 }) },
    { value: '3', label: t('admin.redeem.expiryPresetDays', { days: 3 }) },
    { value: '7', label: t('admin.redeem.expiryPresetDays', { days: 7 }) },
    { value: 'custom', label: t('admin.redeem.customExpiry') }
  ]

  // 类型变化时：邀请码类型自动设置 value 为 0（Vue 版 watch generateForm.type）
  const changeGenerateType = (newType: RedeemCodeType) => {
    setGenerateForm((prev) => {
      if (prev.type === newType) return prev
      let value = prev.value
      if (newType === 'invitation') {
        value = 0
      } else if (value === 0) {
        value = 10
      }
      return { ...prev, type: newType, value }
    })
  }

  const buildRedeemQueryFilters = () => ({
    type: (filtersRef.current.type || undefined) as RedeemCodeType | undefined,
    status: (filtersRef.current.status || undefined) as RedeemStatusFilter | undefined,
    search: searchQueryRef.current || undefined,
    sort_by: sortRef.current.sort_by,
    sort_order: sortRef.current.sort_order
  })

  const loadCodes = async () => {
    abortControllerRef.current?.abort()
    const currentController = new AbortController()
    abortControllerRef.current = currentController
    setLoading(true)
    try {
      const response = await adminAPI.redeem.list(
        paginationRef.current.page,
        paginationRef.current.page_size,
        buildRedeemQueryFilters(),
        {
          signal: currentController.signal
        }
      )
      if (currentController.signal.aborted) {
        return
      }
      setCodes(response.items)
      updatePagination({ total: response.total, pages: response.pages })
    } catch (error: unknown) {
      if (currentController.signal.aborted || isAbortError(error)) {
        return
      }
      useAppStore.getState().showError(t('admin.redeem.failedToLoad'))
      console.error('Error loading redeem codes:', error)
    } finally {
      if (abortControllerRef.current === currentController && !currentController.signal.aborted) {
        setLoading(false)
        abortControllerRef.current = null
      }
    }
  }

  const handleSearch = () => {
    updatePagination({ page: 1 })
    void loadCodes()
  }

  const handlePageChange = (page: number) => {
    updatePagination({ page })
    void loadCodes()
  }

  const handlePageSizeChange = (pageSize: number) => {
    updatePagination({ page_size: pageSize, page: 1 })
    void loadCodes()
  }

  const handleSort = (key: string, order: 'asc' | 'desc') => {
    sortRef.current = { sort_by: key, sort_order: order }
    updatePagination({ page: 1 })
    void loadCodes()
  }

  const closeResultDialog = () => {
    setShowResultDialog(false)
    setGeneratedCodes([])
    setCopiedAll(false)
  }

  const copyGeneratedCodes = async () => {
    const success = await clipboardCopy(generatedCodesText, t('admin.redeem.copied'))
    if (success) {
      setCopiedAll(true)
      later(() => setCopiedAll(false), 2000)
    }
  }

  const downloadGeneratedCodes = () => {
    const blob = new Blob([generatedCodesText], { type: 'text/plain' })
    downloadBlob(blob, `redeem-codes-${new Date().toISOString().split('T')[0]}.txt`)
  }

  const getRedeemCodeExpiresInDays = () => {
    if (generateForm.expiry_option === 'never') {
      return undefined
    }
    if (generateForm.expiry_option === 'custom') {
      const customDays = Number(generateForm.custom_expiry_days)
      if (generateForm.custom_expiry_days === '' || !Number.isFinite(customDays) || customDays < 1) {
        return null
      }
      return Math.floor(customDays)
    }
    return Number(generateForm.expiry_option)
  }

  const openBatchUpdateDialog = () => {
    if (selectedCount === 0) {
      useAppStore.getState().showInfo(t('admin.redeem.selectCodesFirst'))
      return
    }
    setBatchUpdateForm(createBatchUpdateForm())
    setShowBatchUpdateDialog(true)
  }

  const closeBatchUpdateDialog = () => {
    setShowBatchUpdateDialog(false)
  }

  const buildBatchUpdateFields = (): BatchUpdateRedeemCodeFields | null => {
    const fields: BatchUpdateRedeemCodeFields = {}

    if (batchUpdateForm.update_status) {
      fields.status = batchUpdateForm.status
    }
    if (batchUpdateForm.update_expires_at) {
      if (batchUpdateForm.expires_mode === 'clear') {
        fields.expires_at = null
      } else {
        const expiresAt = parseDateTimeLocalInput(batchUpdateForm.expires_at_local)
        if (expiresAt === null) {
          useAppStore.getState().showError(t('admin.redeem.expiryDateRequired'))
          return null
        }
        fields.expires_at = new Date(expiresAt * 1000).toISOString()
      }
    }
    if (batchUpdateForm.update_notes) {
      fields.notes = batchUpdateForm.notes
    }
    if (batchUpdateForm.update_group_id) {
      fields.group_id = batchUpdateForm.group_id == null ? null : Number(batchUpdateForm.group_id)
    }

    return Object.keys(fields).length > 0 ? fields : null
  }

  const handleGenerateCodes = async (event?: FormEvent) => {
    event?.preventDefault()
    // 订阅类型必须选择分组
    if (generateForm.type === 'subscription' && !generateForm.group_id) {
      useAppStore.getState().showError(t('admin.redeem.groupRequired'))
      return
    }

    const expiresInDays = getRedeemCodeExpiresInDays()
    if (expiresInDays === null) {
      useAppStore.getState().showError(t('admin.redeem.expiryDaysRequired'))
      return
    }

    setGenerating(true)
    try {
      const result = await adminAPI.redeem.generate(
        Number(generateForm.count),
        generateForm.type,
        Number(generateForm.value),
        generateForm.type === 'subscription' ? generateForm.group_id : undefined,
        generateForm.type === 'subscription' ? Number(generateForm.validity_days) : undefined,
        expiresInDays
      )
      setShowGenerateDialog(false)
      setGeneratedCodes(result)
      setShowResultDialog(true)
      // 重置表单
      updateGenerateForm({ group_id: null, validity_days: 30, expiry_option: 'never', custom_expiry_days: 7 })
      void loadCodes()
    } catch (error: unknown) {
      useAppStore.getState().showError(errorDetail(error) || t('admin.redeem.failedToGenerate'))
      console.error('Error generating codes:', error)
    } finally {
      setGenerating(false)
    }
  }

  const copyToClipboard = async (text: string) => {
    const success = await clipboardCopy(text, t('admin.redeem.copied'))
    if (success) {
      setCopiedCode(text)
      later(() => setCopiedCode(null), 2000)
    }
  }

  const handleExportCodes = async () => {
    try {
      const blob = await adminAPI.redeem.exportCodes(buildRedeemQueryFilters())

      // Create download link
      downloadBlob(blob, `redeem-codes-${new Date().toISOString().split('T')[0]}.csv`)

      useAppStore.getState().showSuccess(t('admin.redeem.codesExported'))
    } catch (error: unknown) {
      useAppStore.getState().showError(errorDetail(error) || t('admin.redeem.failedToExport'))
      console.error('Error exporting codes:', error)
    }
  }

  const handleDelete = (code: RedeemCode) => {
    setDeletingCode(code)
    setShowDeleteDialog(true)
  }

  const confirmDelete = async () => {
    if (!deletingCode) return

    try {
      await adminAPI.redeem.delete(deletingCode.id)
      useAppStore.getState().showSuccess(t('admin.redeem.codeDeleted'))
      setShowDeleteDialog(false)
      setDeletingCode(null)
      void loadCodes()
    } catch (error: unknown) {
      useAppStore.getState().showError(errorDetail(error) || t('admin.redeem.failedToDelete'))
      console.error('Error deleting code:', error)
    }
  }

  const confirmDeleteUnused = async () => {
    try {
      // Get all unused codes and delete them
      const unusedCodesResponse = await adminAPI.redeem.list(1, 1000, { status: 'unused' })
      const unusedCodeIds = unusedCodesResponse.items.map((code) => code.id)

      if (unusedCodeIds.length === 0) {
        useAppStore.getState().showInfo(t('admin.redeem.noUnusedCodes'))
        setShowDeleteUnusedDialog(false)
        return
      }

      const result = await adminAPI.redeem.batchDelete(unusedCodeIds)
      useAppStore.getState().showSuccess(t('admin.redeem.codesDeleted', { count: result.deleted }))
      setShowDeleteUnusedDialog(false)
      void loadCodes()
    } catch (error: unknown) {
      useAppStore.getState().showError(errorDetail(error) || t('admin.redeem.failedToDeleteUnused'))
      console.error('Error deleting unused codes:', error)
    }
  }

  const handleBatchUpdate = async (event?: FormEvent) => {
    event?.preventDefault()
    const ids = Array.from(selectedCodeIds)
    if (ids.length === 0) {
      useAppStore.getState().showInfo(t('admin.redeem.selectCodesFirst'))
      return
    }

    const hasSelectedFields =
      batchUpdateForm.update_status ||
      batchUpdateForm.update_expires_at ||
      batchUpdateForm.update_notes ||
      batchUpdateForm.update_group_id
    if (!hasSelectedFields) {
      useAppStore.getState().showError(t('admin.redeem.noBatchFieldsSelected'))
      return
    }

    const fields = buildBatchUpdateFields()
    if (!fields) {
      return
    }

    setBatchUpdating(true)
    try {
      const result = await adminAPI.redeem.batchUpdate(ids, fields)
      useAppStore.getState().showSuccess(t('admin.redeem.batchUpdateSuccess', { count: result.updated }))
      setShowBatchUpdateDialog(false)
      clearSelectedCodes()
      void loadCodes()
    } catch (error: unknown) {
      useAppStore.getState().showError(errorDetail(error) || t('admin.redeem.failedToBatchUpdate'))
      console.error('Error batch updating codes:', error)
    } finally {
      setBatchUpdating(false)
    }
  }

  // 加载订阅类型分组
  const loadSubscriptionGroups = async () => {
    try {
      setSubscriptionGroups(await adminAPI.groups.getAll())
    } catch (error) {
      console.error('Error loading subscription groups:', error)
    }
  }

  useEffect(() => {
    const timers = timersRef.current
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时拉取列表，属于与后端同步的副作用
    void loadCodes()
    void loadSubscriptionGroups()
    return () => {
      abortControllerRef.current?.abort()
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
    // 仅在挂载时加载（Vue 版 onMounted）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const typeTone = (type: string): BadgeTone => (type === 'balance' ? 'success' : type === 'subscription' ? 'warning' : 'info')
  const statusTone = (status: string): BadgeTone => (status === 'unused' ? 'success' : status === 'used' ? 'neutral' : 'danger')

  const renderGroupSelected = (option: SelectOption | null) => {
    const group = option as unknown as GroupOption | null
    return group ? (
      <GroupBadge name={group.label} platform={group.platform} subscriptionType={group.subscriptionType} rateMultiplier={group.rate} />
    ) : (
      <span className={styles.muted}>{t('admin.redeem.selectGroupPlaceholder')}</span>
    )
  }

  const renderGroupOption = (option: SelectOption, selected: boolean) => {
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
  }

  const headers = {
    select: () => (
      <Checkbox
        data-test="select-all-codes"
        aria-label={t('common.selectAll')}
        checked={allVisibleSelected}
        onClick={(event) => event.stopPropagation()}
        onCheckedChange={(checked) => toggleVisible(checked === true)}
      />
    )
  }

  const cells: Record<string, (context: DataTableCellContext<RedeemCode>) => ReactNode> = {
    select: ({ row }) => (
      <Checkbox
        data-test="select-code"
        aria-label={row.code}
        checked={selectedCodeIds.has(row.id)}
        onClick={(event) => event.stopPropagation()}
        onCheckedChange={(checked) => (checked === true ? select(row.id) : deselect(row.id))}
      />
    ),
    code: ({ value }) => (
      <div className={styles.codeCell}>
        <code className={styles.code}>{value}</code>
        <button
          type="button"
          className={styles.copyButton}
          data-copied={copiedCode === value ? '' : undefined}
          title={copiedCode === value ? t('admin.redeem.copied') : t('keys.copyToClipboard')}
          aria-label={copiedCode === value ? t('admin.redeem.copied') : t('keys.copyToClipboard')}
          onClick={() => void copyToClipboard(value)}
        >
          {copiedCode === value ? <Check {...iconProps} /> : <Copy {...iconProps} />}
        </button>
      </div>
    ),
    type: ({ value }) => <Badge tone={typeTone(value)}>{t('admin.redeem.types.' + value)}</Badge>,
    value: ({ value, row }) => (
      <span className={styles.value}>
        {row.type === 'balance' ? (
          <>${value.toFixed(2)}</>
        ) : row.type === 'subscription' ? (
          <>
            {row.validity_days || 30} {t('admin.redeem.days')}
            {row.group && <span className={styles.valueGroup}>({row.group.name})</span>}
          </>
        ) : (
          <>{value}</>
        )}
      </span>
    ),
    status: ({ value }) => <Badge tone={statusTone(value)}>{t('admin.redeem.status.' + value)}</Badge>,
    used_by: ({ value, row }) => (
      <span className={styles.secondary}>
        {row.user?.email || (value ? t('admin.redeem.userPrefix', { id: value }) : '-')}
      </span>
    ),
    used_at: ({ value }) => <span className={styles.secondary}>{value ? formatDateTime(value) : '-'}</span>,
    expires_at: ({ value, row }) => (
      <span className={styles.secondary} data-expired={row.status === 'expired' ? '' : undefined}>
        {value ? formatDateTime(value) : t('admin.redeem.neverExpires')}
      </span>
    ),
    actions: ({ row }) =>
      row.status === 'unused' ? (
        <button type="button" className={styles.actionButton} data-tone="danger" onClick={() => handleDelete(row)}>
          <Trash2 {...iconProps} />
          <span>{t('common.delete')}</span>
        </button>
      ) : (
        <span className={styles.muted}>-</span>
      )
  }

  const filtersBar = (
    <div className={styles.toolbar}>
      {/* Left: Search + Filters */}
      <div className={styles.search}>
        <SearchInput
          value={searchQuery}
          placeholder={t('admin.redeem.searchCodes')}
          onChange={(value) => {
            searchQueryRef.current = value
            setSearchQuery(value)
          }}
          onSearch={handleSearch}
        />
      </div>
      <div className={styles.filter}>
        <Select
          value={filters.type}
          options={filterTypeOptions}
          onChange={(value) => {
            updateFilters({ type: String(value ?? '') })
            void loadCodes()
          }}
        />
      </div>
      <div className={styles.filter}>
        <Select
          value={filters.status}
          options={filterStatusOptions}
          onChange={(value) => {
            updateFilters({ status: String(value ?? '') })
            void loadCodes()
          }}
        />
      </div>

      {/* Right: Action buttons */}
      <div className={styles.toolbarActions}>
        <Button
          type="button"
          variant="secondary"
          disabled={loading}
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
          onClick={() => void loadCodes()}
        >
          <RefreshCw {...iconProps} className={loading ? styles.spinning : undefined} />
        </Button>
        <Button type="button" variant="secondary" onClick={() => void handleExportCodes()}>
          {t('admin.redeem.exportCsv')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          data-test="batch-update-open"
          disabled={selectedCount === 0 || batchUpdating}
          onClick={openBatchUpdateDialog}
        >
          <Pencil {...iconProps} />
          {t('admin.redeem.batchUpdate')}
        </Button>
        <Button type="button" variant="primary" onClick={() => setShowGenerateDialog(true)}>
          {t('admin.redeem.generateCodes')}
        </Button>
      </div>
    </div>
  )

  const table = (
    <div className={styles.region}>
      {selectedCount > 0 && (
        <div className={styles.selectionBar} role="toolbar" aria-label={t('admin.redeem.selectedCount', { count: selectedCount })}>
          <span className={styles.selectionCount} aria-live="polite">
            {t('admin.redeem.selectedCount', { count: selectedCount })}
          </span>
          <div className={styles.selectionActions}>
            <button type="button" className={styles.selectionLink} onClick={clearSelectedCodes}>
              {t('admin.redeem.clearSelection')}
            </button>
            <Button type="button" variant="primary" size="sm" onClick={openBatchUpdateDialog}>
              {t('admin.redeem.batchUpdate')}
            </Button>
          </div>
        </div>
      )}
      <DataTable<RedeemCode>
        columns={columns}
        data={codes}
        loading={loading}
        serverSideSort
        defaultSortKey="id"
        defaultSortOrder="desc"
        onSort={handleSort}
        headers={headers}
        cells={cells}
        className={styles.dataTable}
      />
    </div>
  )

  const footer =
    pagination.total > 0 || filters.status === 'unused' ? (
      <div className={styles.footer}>
        {pagination.total > 0 && (
          <Pagination
            page={pagination.page}
            total={pagination.total}
            pageSize={pagination.page_size}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        )}
        {/* Batch Actions */}
        {filters.status === 'unused' && (
          <div className={styles.footerActions}>
            <Button type="button" variant="danger" onClick={() => setShowDeleteUnusedDialog(true)}>
              {t('admin.redeem.deleteAllUnused')}
            </Button>
          </div>
        )}
      </div>
    ) : null

  return (
    <>
      <TablePageLayout filters={filtersBar} table={table} pagination={footer} />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        show={showDeleteDialog}
        title={t('admin.redeem.deleteCode')}
        message={t('admin.redeem.deleteCodeConfirm')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setShowDeleteDialog(false)}
      />

      {/* Delete Unused Codes Dialog */}
      <ConfirmDialog
        show={showDeleteUnusedDialog}
        title={t('admin.redeem.deleteAllUnused')}
        message={t('admin.redeem.deleteAllUnusedConfirm')}
        confirmText={t('admin.redeem.deleteAll')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void confirmDeleteUnused()}
        onCancel={() => setShowDeleteUnusedDialog(false)}
      />

      {/* Generate Codes Dialog */}
      <BaseDialog
        show={showGenerateDialog}
        title={t('admin.redeem.generateCodesTitle')}
        width="normal"
        closeOnClickOutside
        onClose={() => setShowGenerateDialog(false)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setShowGenerateDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="generate-redeem-codes-form" variant="primary" disabled={generating}>
              {generating ? t('admin.redeem.generating') : t('admin.redeem.generate')}
            </Button>
          </>
        }
      >
        <form id="generate-redeem-codes-form" className={styles.form} onSubmit={(event) => void handleGenerateCodes(event)}>
          <div className={styles.field}>
            <label className={styles.label}>{t('admin.redeem.codeType')}</label>
            <Select
              value={generateForm.type}
              options={typeOptions}
              onChange={(value) => changeGenerateType(value as RedeemCodeType)}
            />
          </div>
          {/* 余额/并发类型：显示数值输入 */}
          {generateForm.type !== 'subscription' && generateForm.type !== 'invitation' && (
            <Input
              type="number"
              step={generateForm.type === 'balance' ? '0.01' : '1'}
              min={generateForm.type === 'balance' ? '0.01' : '1'}
              required
              label={generateForm.type === 'balance' ? t('admin.redeem.amount') : t('admin.redeem.columns.value')}
              value={generateForm.value}
              onChange={(value) => updateGenerateForm({ value: toNumberInput(value) })}
            />
          )}
          {/* 邀请码类型：显示提示信息 */}
          {generateForm.type === 'invitation' && <Alert tone="info" title={t('admin.redeem.invitationHint')} />}
          {/* 订阅类型：显示分组选择和有效天数 */}
          {generateForm.type === 'subscription' && (
            <>
              <div className={styles.field}>
                <label className={styles.label}>{t('admin.redeem.selectGroup')}</label>
                <Select
                  value={generateForm.group_id}
                  options={subscriptionGroupOptions as unknown as SelectOption[]}
                  placeholder={t('admin.redeem.selectGroupPlaceholder')}
                  onChange={(value) => updateGenerateForm({ group_id: value as number | null })}
                  renderSelected={renderGroupSelected}
                  renderOption={renderGroupOption}
                />
              </div>
              <Input
                type="number"
                min={1}
                max={36500}
                required
                label={t('admin.redeem.validityDays')}
                value={generateForm.validity_days}
                onChange={(value) => updateGenerateForm({ validity_days: toNumberInput(value) })}
              />
            </>
          )}
          <div className={styles.field}>
            <span className={styles.label}>{t('admin.redeem.codeExpiry')}</span>
            <SegmentedControl
              label={t('admin.redeem.codeExpiry')}
              options={redeemCodeExpiryOptions}
              value={generateForm.expiry_option}
              onValueChange={(value) => updateGenerateForm({ expiry_option: value as RedeemCodeExpiryOption })}
            />
            {generateForm.expiry_option === 'custom' && (
              <Input
                type="number"
                min={1}
                max={3650}
                required
                className={styles.customExpiry}
                aria-label={t('admin.redeem.customExpiryDays')}
                placeholder={t('admin.redeem.customExpiryDays')}
                value={generateForm.custom_expiry_days}
                onChange={(value) => updateGenerateForm({ custom_expiry_days: toNumberInput(value) })}
              />
            )}
          </div>
          <Input
            type="number"
            min={1}
            max={100}
            required
            label={t('admin.redeem.count')}
            value={generateForm.count}
            onChange={(value) => updateGenerateForm({ count: toNumberInput(value) })}
          />
        </form>
      </BaseDialog>

      {/* Batch Update Dialog */}
      <BaseDialog
        show={showBatchUpdateDialog}
        title={t('admin.redeem.batchUpdateTitle')}
        description={t('admin.redeem.selectedCount', { count: selectedCount })}
        width="normal"
        closeOnClickOutside
        onClose={closeBatchUpdateDialog}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeBatchUpdateDialog}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              form="redeem-batch-update-form"
              variant="primary"
              data-test="batch-update-submit"
              disabled={batchUpdating}
            >
              {batchUpdating ? t('common.submitting') : t('admin.redeem.batchUpdate')}
            </Button>
          </>
        }
      >
        <form
          id="redeem-batch-update-form"
          data-test="batch-update-form"
          className={styles.form}
          onSubmit={(event) => void handleBatchUpdate(event)}
        >
          <div className={styles.batchField}>
            <Checkbox
              data-test="batch-field-status"
              label={t('admin.redeem.batchFields.status')}
              checked={batchUpdateForm.update_status}
              onCheckedChange={(checked) => updateBatchForm({ update_status: checked === true })}
            />
            {batchUpdateForm.update_status && (
              <Select
                data-test="batch-status-select"
                value={batchUpdateForm.status}
                options={batchStatusOptions}
                onChange={(value) => updateBatchForm({ status: value as 'unused' | 'disabled' })}
              />
            )}
          </div>

          <div className={styles.batchField}>
            <Checkbox
              label={t('admin.redeem.batchFields.expiresAt')}
              checked={batchUpdateForm.update_expires_at}
              onCheckedChange={(checked) => updateBatchForm({ update_expires_at: checked === true })}
            />
            {batchUpdateForm.update_expires_at && (
              <>
                <Select
                  value={batchUpdateForm.expires_mode}
                  options={batchExpiryModeOptions}
                  onChange={(value) => updateBatchForm({ expires_mode: value as 'clear' | 'custom' })}
                />
                {batchUpdateForm.expires_mode === 'custom' && (
                  <Input
                    type="datetime-local"
                    aria-label={t('admin.redeem.batchFields.expiresAt')}
                    value={batchUpdateForm.expires_at_local}
                    hint={t('admin.redeem.localTimeZoneHint', { timezone: browserTimeZone })}
                    onChange={(value) => updateBatchForm({ expires_at_local: value })}
                  />
                )}
              </>
            )}
          </div>

          <div className={styles.batchField}>
            <Checkbox
              data-test="batch-field-notes"
              label={t('admin.redeem.batchFields.notes')}
              checked={batchUpdateForm.update_notes}
              onCheckedChange={(checked) => updateBatchForm({ update_notes: checked === true })}
            />
            {batchUpdateForm.update_notes && (
              <TextArea
                data-test="batch-notes-input"
                rows={3}
                aria-label={t('admin.redeem.batchFields.notes')}
                value={batchUpdateForm.notes}
                placeholder={t('admin.redeem.batchNotesPlaceholder')}
                onChange={(value) => updateBatchForm({ notes: value })}
              />
            )}
          </div>

          <div className={styles.batchField}>
            <Checkbox
              label={t('admin.redeem.batchFields.group')}
              checked={batchUpdateForm.update_group_id}
              onCheckedChange={(checked) => updateBatchForm({ update_group_id: checked === true })}
            />
            {batchUpdateForm.update_group_id && (
              <Select
                value={batchUpdateForm.group_id}
                options={batchGroupOptions as unknown as SelectOption[]}
                placeholder={t('admin.redeem.selectGroupPlaceholder')}
                onChange={(value) => updateBatchForm({ group_id: value as number | null })}
              />
            )}
          </div>
        </form>
      </BaseDialog>

      {/* Generated Codes Result Dialog */}
      <BaseDialog
        show={showResultDialog}
        title={t('admin.redeem.generatedSuccessfully')}
        description={t('admin.redeem.codesCreated', { count: generatedCodes.length })}
        width="normal"
        closeOnClickOutside
        onClose={closeResultDialog}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => void copyGeneratedCodes()}>
              {copiedAll ? <Check {...iconProps} className={styles.copiedIcon} /> : <Copy {...iconProps} />}
              {copiedAll ? t('admin.redeem.copied') : t('admin.redeem.copyAll')}
            </Button>
            <Button type="button" variant="primary" onClick={downloadGeneratedCodes}>
              <Download {...iconProps} />
              {t('admin.redeem.download')}
            </Button>
          </>
        }
      >
        <div className={styles.result}>
          <textarea
            readOnly
            aria-label={t('admin.redeem.generatedSuccessfully')}
            value={generatedCodesText}
            style={{ height: textareaHeight }}
            className={styles.resultCodes}
          />
        </div>
      </BaseDialog>
    </>
  )
}
