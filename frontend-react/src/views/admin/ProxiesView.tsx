/**
 * 代理管理页，对应 Vue 版 views/admin/ProxiesView.vue。
 * 工具栏（搜索、协议/状态筛选、批量操作）+ 一个带边框的表格区域；创建/编辑/质量报告/关联账号用对话框。
 */
import {
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  CircleCheck,
  Files
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { adminAPI } from '@/api/admin'
import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import ImportDataModal from '@/components/admin/proxy/ImportDataModal'
import {
  EXPIRY_PRESETS,
  addDaysToBase,
  daysFromBase,
  emptyBatchParseResult,
  formatExportTimestamp,
  getCopyFormats,
  buildProxyUrl,
  parseBatchInput,
  type BatchParseResult
} from '@/components/admin/proxy/proxyHelpers'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import DataTable, { type DataTableCellContext, type DataTableHeaderContext, type SortOrder } from '@/components/common/DataTable'
import EmptyState from '@/components/common/EmptyState'
import Pagination from '@/components/common/Pagination'
import PlatformTypeBadge from '@/components/common/PlatformTypeBadge'
import ProxyAdBanner from '@/components/common/ProxyAdBanner'
import Select, { type SelectValue } from '@/components/common/Select'
import TablePageLayout from '@/components/common/TablePageLayout'
import type { Column } from '@/components/common/types'
import { useClipboard } from '@/composables/useClipboard'
import { getPersistedPageSize } from '@/composables/usePersistedPageSize'
import { useSwipeSelect } from '@/composables/useSwipeSelect'
import { useTableSelection } from '@/composables/useTableSelection'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { Proxy, ProxyAccountSummary, ProxyProtocol, ProxyQualityCheckResult } from '@/types'
import { formatDateTime } from '@/utils/format'
import { proxyExpiryBadgeClass, proxyExpiryLabelKey } from '@/utils/proxyExpiry'
import styles from './ProxiesView.module.css'

type FallbackMode = 'none' | 'proxy' | 'direct'
type ProxyStatusFilter = 'active' | 'inactive' | 'expired'

interface ProxyQuery {
  search: string
  protocol: string
  status: string
  page: number
  page_size: number
  total: number
  pages: number
  sort_by: string
  sort_order: SortOrder
}

interface CreateForm {
  name: string
  protocol: ProxyProtocol
  host: string
  port: number | ''
  username: string
  password: string
  expires_at: string
  fallback_mode: FallbackMode
  backup_proxy_id: number | null
  expiry_warn_days: number
}

interface EditForm extends CreateForm {
  status: 'active' | 'inactive' | 'expired'
}

interface LatencyResult {
  success: boolean
  latency_ms?: number
  message?: string
  ip_address?: string
  country?: string
  country_code?: string
  region?: string
  city?: string
}

const emptyCreateForm = (): CreateForm => ({
  name: '',
  protocol: 'http',
  host: '',
  port: 8080,
  username: '',
  password: '',
  expires_at: '',
  fallback_mode: 'none',
  backup_proxy_id: null,
  expiry_warn_days: 7
})

const emptyEditForm = (): EditForm => ({ ...emptyCreateForm(), status: 'active' })

const isAbortError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false
  const maybeError = error as { name?: string; code?: string }
  return maybeError.name === 'AbortError' || maybeError.code === 'ERR_CANCELED'
}

// v-model.number：空串保持空串，可解析时转为数字
const toNumberInput = (raw: string): number | '' => {
  if (raw === '') return ''
  const parsed = Number(raw)
  return Number.isNaN(parsed) ? '' : parsed
}

const summarizeQualityStatus = (result: ProxyQualityCheckResult): Proxy['quality_status'] => {
  if (result.challenge_count > 0) return 'challenge'
  if (result.failed_count > 0) return 'failed'
  if (result.warn_count > 0) return 'warn'
  return 'healthy'
}

const qualityStatusTone = (status: string): BadgeTone => {
  if (status === 'pass') return 'success'
  if (status === 'warn') return 'warning'
  return 'danger'
}

const qualityOverallTone = (status?: string): BadgeTone => {
  if (status === 'healthy') return 'success'
  if (status === 'warn') return 'warning'
  return 'danger'
}

// proxyExpiryBadgeClass 返回 Vue 版的 badge 类名，这里映射为 Arc badge 色调；非徽章时为 null（灰色文字）
const expiryTone = (row: Proxy): BadgeTone | null => {
  const cls = proxyExpiryBadgeClass(row.expires_at, row.status)
  if (cls.includes('badge-danger')) return 'danger'
  if (cls.includes('badge-warning')) return 'warning'
  return null
}

const formatLocation = (proxy: Proxy) => {
  const parts = [proxy.country, proxy.city].filter(Boolean) as string[]
  return parts.join(' · ')
}

const flagUrl = (code: string) => `https://unpkg.com/flag-icons/flags/4x3/${code.toLowerCase()}.svg`

const withId = (set: Set<number>, id: number) => new Set([...set, id])
const withoutId = (set: Set<number>, id: number) => {
  const next = new Set(set)
  next.delete(id)
  return next
}

export default function ProxiesView() {
  const { t } = useI18n()
  const { copyToClipboard } = useClipboard()

  const columns = useMemo<Column<Proxy>[]>(
    () => [
      { key: 'select', label: '', sortable: false },
      { key: 'name', label: t('admin.proxies.columns.name'), sortable: true },
      { key: 'protocol', label: t('admin.proxies.columns.protocol'), sortable: true },
      { key: 'address', label: t('admin.proxies.columns.address'), sortable: false },
      { key: 'auth', label: t('admin.proxies.columns.auth'), sortable: false },
      { key: 'location', label: t('admin.proxies.columns.location'), sortable: false },
      { key: 'account_count', label: t('admin.proxies.columns.accounts'), sortable: true },
      { key: 'latency', label: t('admin.proxies.columns.latency'), sortable: false },
      { key: 'expiry', label: t('admin.proxies.columns.expiry'), sortable: true },
      { key: 'created_at', label: t('admin.proxies.columns.createdAt'), sortable: true },
      { key: 'status', label: t('admin.proxies.columns.status'), sortable: true },
      { key: 'actions', label: t('admin.proxies.columns.actions'), sortable: false }
    ],
    [t]
  )

  // Filter options
  const protocolOptions = [
    { value: '', label: t('admin.proxies.allProtocols') },
    { value: 'http', label: 'HTTP' },
    { value: 'https', label: 'HTTPS' },
    { value: 'socks5', label: 'SOCKS5' },
    { value: 'socks5h', label: 'SOCKS5H' }
  ]

  const statusOptions = [
    { value: '', label: t('admin.proxies.allStatus') },
    { value: 'active', label: t('admin.accounts.status.active') },
    { value: 'inactive', label: t('admin.accounts.status.inactive') },
    { value: 'expired', label: t('admin.proxies.expired') }
  ]

  // Form options
  const protocolSelectOptions = [
    { value: 'http', label: t('admin.proxies.protocols.http') },
    { value: 'https', label: t('admin.proxies.protocols.https') },
    { value: 'socks5', label: t('admin.proxies.protocols.socks5') },
    { value: 'socks5h', label: t('admin.proxies.protocols.socks5h') }
  ]

  const editStatusOptions = [
    { value: 'active', label: t('admin.accounts.status.active') },
    { value: 'inactive', label: t('admin.accounts.status.inactive') }
  ]

  const fallbackOptions = [
    { label: t('admin.proxies.fallbackNone'), value: 'none' },
    { label: t('admin.proxies.fallbackProxy'), value: 'proxy' },
    { label: t('admin.proxies.fallbackDirect'), value: 'direct' }
  ]

  const [proxies, setProxies] = useState<Proxy[]>([])
  const [visiblePasswordIds, setVisiblePasswordIds] = useState<Set<number>>(() => new Set())
  const [copyMenuProxyId, setCopyMenuProxyId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  // 查询状态（搜索、筛选、分页、排序）：ref 保存最新值供异步加载读取，state 用于渲染
  const [query, setQueryState] = useState<ProxyQuery>(() => ({
    search: '',
    protocol: '',
    status: '',
    page: 1,
    page_size: getPersistedPageSize(),
    total: 0,
    pages: 0,
    sort_by: 'id',
    sort_order: 'desc'
  }))
  const queryRef = useRef<ProxyQuery>(query)
  const setQuery = useCallback((patch: Partial<ProxyQuery>) => {
    queryRef.current = { ...queryRef.current, ...patch }
    setQueryState(queryRef.current)
  }, [])

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createPasswordVisible, setCreatePasswordVisible] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editPasswordVisible, setEditPasswordVisible] = useState(false)
  const [editPasswordDirty, setEditPasswordDirty] = useState(false)
  const [showImportData, setShowImportData] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showBatchDeleteDialog, setShowBatchDeleteDialog] = useState(false)
  const [showExportDataDialog, setShowExportDataDialog] = useState(false)
  const [showAccountsModal, setShowAccountsModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const exportingData = useRef(false)
  const [testingProxyIds, setTestingProxyIds] = useState<Set<number>>(() => new Set())
  const [qualityCheckingProxyIds, setQualityCheckingProxyIds] = useState<Set<number>>(() => new Set())
  const [batchTesting, setBatchTesting] = useState(false)
  const [batchQualityChecking, setBatchQualityChecking] = useState(false)
  const batchTestingRef = useRef(false)
  const batchQualityCheckingRef = useRef(false)
  const proxyTableRef = useRef<HTMLDivElement>(null)

  const {
    selectedSet: selectedProxyIds,
    selectedCount,
    allVisibleSelected,
    isSelected,
    select,
    deselect,
    clear: clearSelectedProxies,
    removeMany: removeSelectedProxies,
    toggleVisible,
    batchUpdate
  } = useTableSelection<Proxy>({
    rows: proxies,
    getId: (proxy) => proxy.id
  })
  useSwipeSelect(proxyTableRef, { isSelected, select, deselect, batchUpdate })

  const [accountsProxy, setAccountsProxy] = useState<Proxy | null>(null)
  const [proxyAccounts, setProxyAccounts] = useState<ProxyAccountSummary[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [editingProxy, setEditingProxy] = useState<Proxy | null>(null)
  const [deletingProxy, setDeletingProxy] = useState<Proxy | null>(null)
  const [showQualityReportDialog, setShowQualityReportDialog] = useState(false)
  const [qualityReportProxy, setQualityReportProxy] = useState<Proxy | null>(null)
  const [qualityReport, setQualityReport] = useState<ProxyQualityCheckResult | null>(null)

  // Batch import state
  const [createMode, setCreateMode] = useState<'standard' | 'batch'>('standard')
  const [batchInput, setBatchInput] = useState('')
  const [batchParseResult, setBatchParseResult] = useState<BatchParseResult>(emptyBatchParseResult)

  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreateForm)
  const [editForm, setEditForm] = useState<EditForm>(emptyEditForm)
  const patchCreate = (patch: Partial<CreateForm>) => setCreateForm((prev) => ({ ...prev, ...patch }))
  const patchEdit = (patch: Partial<EditForm>) => setEditForm((prev) => ({ ...prev, ...patch }))

  const [allProxiesForBackup, setAllProxiesForBackup] = useState<Proxy[]>([])
  const backupProxyOptions = (excludeId?: number) =>
    allProxiesForBackup
      .filter((p) => p.id !== excludeId)
      .map((p) => ({ label: `${p.name} (${p.host}:${p.port})`, value: p.id }))

  const abortControllerRef = useRef<AbortController | null>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const buildProxyQueryFilters = () => {
    const q = queryRef.current
    return {
      protocol: q.protocol || undefined,
      status: (q.status || undefined) as ProxyStatusFilter | undefined,
      search: q.search || undefined,
      sort_by: q.sort_by,
      sort_order: q.sort_order
    }
  }

  const loadProxies = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const currentAbortController = new AbortController()
    abortControllerRef.current = currentAbortController
    setLoading(true)
    try {
      const q = queryRef.current
      const response = await adminAPI.proxies.list(
        q.page,
        q.page_size,
        {
          protocol: q.protocol || undefined,
          status: (q.status || undefined) as ProxyStatusFilter | undefined,
          search: q.search || undefined,
          sort_by: q.sort_by,
          sort_order: q.sort_order
        },
        { signal: currentAbortController.signal }
      )
      if (currentAbortController.signal.aborted || abortControllerRef.current !== currentAbortController) {
        return
      }
      setProxies(response.items)
      setQuery({ total: response.total, pages: response.pages })
    } catch (error) {
      if (isAbortError(error)) {
        return
      }
      useAppStore.getState().showError(t('admin.proxies.failedToLoad'))
      console.error('Error loading proxies:', error)
    } finally {
      if (abortControllerRef.current === currentAbortController) {
        setLoading(false)
        abortControllerRef.current = null
      }
    }
  }, [setQuery, t])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 与 Vue 版 onMounted 一致：挂载时加载列表
    void loadProxies()
    void adminAPI.proxies
      .getAllWithCount()
      .then((items) => setAllProxiesForBackup(items))
      .catch((error) => console.error('Error loading backup proxy options:', error))
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
      abortControllerRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 与 Vue 版 onMounted 一致，只在挂载时加载
  }, [])

  const handleFilterChange = (patch: Partial<ProxyQuery>) => {
    setQuery({ ...patch, page: 1 })
    void loadProxies()
  }

  const handleSearch = (value: string) => {
    setQuery({ search: value })
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      setQuery({ page: 1 })
      void loadProxies()
    }, 300)
  }

  const handlePageChange = (page: number) => {
    setQuery({ page })
    void loadProxies()
  }

  const handlePageSizeChange = (pageSize: number) => {
    setQuery({ page_size: pageSize, page: 1 })
    void loadProxies()
  }

  const handleSort = (key: string, order: SortOrder) => {
    setQuery({ sort_by: key, sort_order: order, page: 1 })
    void loadProxies()
  }

  const closeCreateModal = () => {
    setShowCreateModal(false)
    setCreateMode('standard')
    setCreateForm(emptyCreateForm())
    setCreatePasswordVisible(false)
    setBatchInput('')
    setBatchParseResult(emptyBatchParseResult())
  }

  const handleDataImported = () => {
    setShowImportData(false)
    void loadProxies()
  }

  const handleBatchInput = (value: string) => {
    setBatchInput(value)
    setBatchParseResult(parseBatchInput(value))
  }

  const handleBatchCreate = async () => {
    if (batchParseResult.valid === 0) return
    const appStore = useAppStore.getState()

    setSubmitting(true)
    try {
      const result = await adminAPI.proxies.batchCreate(batchParseResult.proxies)
      const created = result.created || 0
      const skipped = result.skipped || 0

      if (created > 0) {
        appStore.showSuccess(t('admin.proxies.batchImportSuccess', { created, skipped }))
      } else {
        appStore.showInfo(t('admin.proxies.batchImportAllSkipped', { skipped }))
      }

      closeCreateModal()
      void loadProxies()
    } catch (error: any) {
      appStore.showError(error.response?.data?.detail || t('admin.proxies.failedToImport'))
      console.error('Error batch creating proxies:', error)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateProxy = async (event?: FormEvent) => {
    event?.preventDefault()
    const appStore = useAppStore.getState()
    if (!createForm.name.trim()) {
      appStore.showError(t('admin.proxies.nameRequired'))
      return
    }
    if (!createForm.host.trim()) {
      appStore.showError(t('admin.proxies.hostRequired'))
      return
    }
    if (Number(createForm.port) < 1 || Number(createForm.port) > 65535) {
      appStore.showError(t('admin.proxies.portInvalid'))
      return
    }
    setSubmitting(true)
    try {
      await adminAPI.proxies.create({
        name: createForm.name.trim(),
        protocol: createForm.protocol,
        host: createForm.host.trim(),
        port: Number(createForm.port),
        username: createForm.username.trim() || null,
        password: createForm.password.trim() || null,
        expires_at: createForm.expires_at ? Math.floor(new Date(createForm.expires_at).getTime() / 1000) : null,
        fallback_mode: createForm.fallback_mode,
        backup_proxy_id: createForm.fallback_mode === 'proxy' ? createForm.backup_proxy_id : null,
        expiry_warn_days: createForm.expiry_warn_days
      })
      appStore.showSuccess(t('admin.proxies.proxyCreated'))
      closeCreateModal()
      void loadProxies()
    } catch (error: any) {
      appStore.showError(error.response?.data?.detail || t('admin.proxies.failedToCreate'))
      console.error('Error creating proxy:', error)
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = (proxy: Proxy) => {
    setEditingProxy(proxy)
    setEditForm({
      name: proxy.name,
      protocol: proxy.protocol,
      host: proxy.host,
      port: proxy.port,
      username: proxy.username || '',
      password: proxy.password || '',
      status: proxy.status === 'expired' ? 'inactive' : proxy.status,
      expires_at: proxy.expires_at ? proxy.expires_at.slice(0, 10) : '',
      fallback_mode: proxy.fallback_mode || 'none',
      backup_proxy_id: proxy.backup_proxy_id ?? null,
      expiry_warn_days: proxy.expiry_warn_days ?? 7
    })
    setEditPasswordVisible(false)
    setEditPasswordDirty(false)
    setShowEditModal(true)
  }

  const closeEditModal = () => {
    setShowEditModal(false)
    setEditingProxy(null)
    setEditPasswordVisible(false)
    setEditPasswordDirty(false)
  }

  const handleUpdateProxy = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!editingProxy) return
    const appStore = useAppStore.getState()
    if (!editForm.name.trim()) {
      appStore.showError(t('admin.proxies.nameRequired'))
      return
    }
    if (!editForm.host.trim()) {
      appStore.showError(t('admin.proxies.hostRequired'))
      return
    }
    if (Number(editForm.port) < 1 || Number(editForm.port) > 65535) {
      appStore.showError(t('admin.proxies.portInvalid'))
      return
    }

    setSubmitting(true)
    try {
      const updateData: Record<string, unknown> = {
        name: editForm.name.trim(),
        protocol: editForm.protocol,
        host: editForm.host.trim(),
        port: Number(editForm.port),
        username: editForm.username.trim(),
        status: editForm.status,
        expires_at: editForm.expires_at ? Math.floor(new Date(editForm.expires_at).getTime() / 1000) : null,
        fallback_mode: editForm.fallback_mode,
        backup_proxy_id: editForm.fallback_mode === 'proxy' ? editForm.backup_proxy_id : null,
        expiry_warn_days: editForm.expiry_warn_days
      }

      // Only include password if user actually modified the field
      if (editPasswordDirty) {
        updateData.password = editForm.password.trim()
      }

      await adminAPI.proxies.update(editingProxy.id, updateData)
      appStore.showSuccess(t('admin.proxies.proxyUpdated'))
      closeEditModal()
      void loadProxies()
    } catch (error: any) {
      appStore.showError(error.response?.data?.detail || t('admin.proxies.failedToUpdate'))
      console.error('Error updating proxy:', error)
    } finally {
      setSubmitting(false)
    }
  }

  const applyLatencyResult = (proxyId: number, result: LatencyResult) => {
    setProxies((prev) =>
      prev.map((target) => {
        if (target.id !== proxyId) return target
        const next: Proxy = result.success
          ? {
              ...target,
              latency_status: 'success',
              latency_ms: result.latency_ms,
              ip_address: result.ip_address,
              country: result.country,
              country_code: result.country_code,
              region: result.region,
              city: result.city
            }
          : {
              ...target,
              latency_status: 'failed',
              latency_ms: undefined,
              ip_address: undefined,
              country: undefined,
              country_code: undefined,
              region: undefined,
              city: undefined
            }
        next.latency_message = result.message
        return next
      })
    )
  }

  const applyQualityResult = (proxyId: number, result: ProxyQualityCheckResult) => {
    setProxies((prev) =>
      prev.map((target) =>
        target.id === proxyId
          ? {
              ...target,
              quality_status: summarizeQualityStatus(result),
              quality_score: result.score,
              quality_grade: result.grade,
              quality_summary: result.summary,
              quality_checked: result.checked_at
            }
          : target
      )
    )
  }

  const startTestingProxy = (proxyId: number) => setTestingProxyIds((prev) => withId(prev, proxyId))
  const stopTestingProxy = (proxyId: number) => setTestingProxyIds((prev) => withoutId(prev, proxyId))
  const startQualityCheckingProxy = (proxyId: number) => setQualityCheckingProxyIds((prev) => withId(prev, proxyId))
  const stopQualityCheckingProxy = (proxyId: number) => setQualityCheckingProxyIds((prev) => withoutId(prev, proxyId))

  const runProxyTest = async (proxyId: number, notify: boolean) => {
    const appStore = useAppStore.getState()
    startTestingProxy(proxyId)
    try {
      const result = await adminAPI.proxies.testProxy(proxyId)
      applyLatencyResult(proxyId, result)
      if (notify) {
        if (result.success) {
          const message = result.latency_ms
            ? t('admin.proxies.proxyWorkingWithLatency', { latency: result.latency_ms })
            : t('admin.proxies.proxyWorking')
          appStore.showSuccess(message)
        } else {
          appStore.showError(result.message || t('admin.proxies.proxyTestFailed'))
        }
      }
      return result
    } catch (error: any) {
      const message = error.response?.data?.detail || t('admin.proxies.failedToTest')
      applyLatencyResult(proxyId, { success: false, message })
      if (notify) {
        appStore.showError(message)
      }
      console.error('Error testing proxy:', error)
      return null
    } finally {
      stopTestingProxy(proxyId)
    }
  }

  const handleTestConnection = async (proxy: Proxy) => {
    await runProxyTest(proxy.id, true)
  }

  const handleQualityCheck = async (proxy: Proxy) => {
    const appStore = useAppStore.getState()
    startQualityCheckingProxy(proxy.id)
    try {
      const result = await adminAPI.proxies.checkProxyQuality(proxy.id)
      setQualityReportProxy(proxy)
      setQualityReport(result)
      setShowQualityReportDialog(true)

      const baseStep = result.items.find((item) => item.target === 'base_connectivity')
      if (baseStep && baseStep.status === 'pass') {
        applyLatencyResult(proxy.id, {
          success: true,
          latency_ms: result.base_latency_ms,
          message: result.summary,
          ip_address: result.exit_ip,
          country: result.country,
          country_code: result.country_code
        })
      }
      applyQualityResult(proxy.id, result)

      appStore.showSuccess(t('admin.proxies.qualityCheckDone', { score: result.score, grade: result.grade }))
    } catch (error: any) {
      const message = error.response?.data?.detail || t('admin.proxies.qualityCheckFailed')
      appStore.showError(message)
      console.error('Error checking proxy quality:', error)
    } finally {
      stopQualityCheckingProxy(proxy.id)
    }
  }

  const runBatchProxyQualityChecks = async (ids: number[]) => {
    if (ids.length === 0) return { total: 0, healthy: 0, warn: 0, challenge: 0, failed: 0 }

    const concurrency = 3
    let index = 0
    let healthy = 0
    let warn = 0
    let challenge = 0
    let failed = 0

    const worker = async () => {
      while (index < ids.length) {
        const current = ids[index]
        index++
        startQualityCheckingProxy(current)
        try {
          const result = await adminAPI.proxies.checkProxyQuality(current)
          const baseStep = result.items.find((item) => item.target === 'base_connectivity')
          if (baseStep && baseStep.status === 'pass') {
            // 只更新当前页里存在的行（applyLatencyResult 对不存在的行不做任何事）
            applyLatencyResult(current, {
              success: true,
              latency_ms: result.base_latency_ms,
              message: result.summary,
              ip_address: result.exit_ip,
              country: result.country,
              country_code: result.country_code
            })
          }
          applyQualityResult(current, result)
          if (result.challenge_count > 0) {
            challenge++
          } else if (result.failed_count > 0) {
            failed++
          } else if (result.warn_count > 0) {
            warn++
          } else {
            healthy++
          }
        } catch {
          failed++
        } finally {
          stopQualityCheckingProxy(current)
        }
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, ids.length) }, () => worker())
    await Promise.all(workers)
    return { total: ids.length, healthy, warn, challenge, failed }
  }

  const closeQualityReportDialog = () => {
    setShowQualityReportDialog(false)
    setQualityReportProxy(null)
    setQualityReport(null)
  }

  const qualityStatusLabel = (status: string) => {
    if (status === 'pass') return t('admin.proxies.qualityStatusPass')
    if (status === 'warn') return t('admin.proxies.qualityStatusWarn')
    if (status === 'challenge') return t('admin.proxies.qualityStatusChallenge')
    return t('admin.proxies.qualityStatusFail')
  }

  const qualityOverallLabel = (status?: string) => {
    if (status === 'healthy') return t('admin.proxies.qualityStatusHealthy')
    if (status === 'warn') return t('admin.proxies.qualityStatusWarn')
    if (status === 'challenge') return t('admin.proxies.qualityStatusChallenge')
    return t('admin.proxies.qualityStatusFail')
  }

  const qualityTargetLabel = (target: string) => {
    switch (target) {
      case 'base_connectivity':
        return t('admin.proxies.qualityTargetBase')
      case 'openai':
        return 'OpenAI'
      case 'anthropic':
        return 'Anthropic'
      case 'gemini':
        return 'Gemini'
      case 'grok':
        return 'Grok'
      case 'kimi':
        return 'Kimi'
      case 'zhipu':
        return 'Zhipu GLM'
      case 'deepseek':
        return 'DeepSeek'
      case 'minimax':
        return 'MiniMax'
      default:
        return target
    }
  }

  // 编辑时有效期自「代理创建日」起算;创建时无 created_at → base='' 用今天
  const editBaseDate = editingProxy?.created_at ? editingProxy.created_at.slice(0, 10) : ''
  const createExpiresDays = daysFromBase('', createForm.expires_at)
  const editExpiresDays = daysFromBase(editBaseDate, editForm.expires_at)

  const expiryLabel = (row: Proxy): string => {
    const { key, params } = proxyExpiryLabelKey(row.expires_at, row.status)
    return params ? t(key, params) : t(key)
  }

  const fetchAllProxiesForBatch = async (): Promise<Proxy[]> => {
    const pageSize = 200
    const result: Proxy[] = []
    let page = 1
    let totalPages = 1
    const q = queryRef.current
    // 与 Vue 版一致：status 原样传递（空串不转 undefined）
    const filters = {
      protocol: q.protocol || undefined,
      status: q.status as ProxyStatusFilter | undefined,
      search: q.search || undefined,
      sort_by: q.sort_by,
      sort_order: q.sort_order
    }

    while (page <= totalPages) {
      const response = await adminAPI.proxies.list(page, pageSize, filters)
      result.push(...response.items)
      totalPages = response.pages || 1
      page++
    }

    return result
  }

  const runBatchProxyTests = async (ids: number[]) => {
    if (ids.length === 0) return
    const concurrency = 5
    let index = 0

    const worker = async () => {
      while (index < ids.length) {
        const current = ids[index]
        index++
        await runProxyTest(current, false)
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, ids.length) }, () => worker())
    await Promise.all(workers)
  }

  const handleBatchTest = async () => {
    if (batchTestingRef.current) return
    const appStore = useAppStore.getState()

    batchTestingRef.current = true
    setBatchTesting(true)
    try {
      let ids: number[] = []
      if (selectedCount > 0) {
        ids = Array.from(selectedProxyIds)
      } else {
        const allProxies = await fetchAllProxiesForBatch()
        ids = allProxies.map((proxy) => proxy.id)
      }

      if (ids.length === 0) {
        appStore.showInfo(t('admin.proxies.batchTestEmpty'))
        return
      }

      await runBatchProxyTests(ids)
      appStore.showSuccess(t('admin.proxies.batchTestDone', { count: ids.length }))
      void loadProxies()
    } catch (error: any) {
      appStore.showError(error.response?.data?.detail || t('admin.proxies.batchTestFailed'))
      console.error('Error batch testing proxies:', error)
    } finally {
      batchTestingRef.current = false
      setBatchTesting(false)
    }
  }

  const handleBatchQualityCheck = async () => {
    if (batchQualityCheckingRef.current) return
    const appStore = useAppStore.getState()

    batchQualityCheckingRef.current = true
    setBatchQualityChecking(true)
    try {
      let ids: number[] = []
      if (selectedCount > 0) {
        ids = Array.from(selectedProxyIds)
      } else {
        const allProxies = await fetchAllProxiesForBatch()
        ids = allProxies.map((proxy) => proxy.id)
      }

      if (ids.length === 0) {
        appStore.showInfo(t('admin.proxies.batchQualityEmpty'))
        return
      }

      const summary = await runBatchProxyQualityChecks(ids)
      appStore.showSuccess(
        t('admin.proxies.batchQualityDone', {
          count: summary.total,
          healthy: summary.healthy,
          warn: summary.warn,
          challenge: summary.challenge,
          failed: summary.failed
        })
      )
      void loadProxies()
    } catch (error: any) {
      appStore.showError(error.response?.data?.detail || t('admin.proxies.batchQualityFailed'))
      console.error('Error batch checking quality:', error)
    } finally {
      batchQualityCheckingRef.current = false
      setBatchQualityChecking(false)
    }
  }

  const handleExportData = async () => {
    if (exportingData.current) return
    const appStore = useAppStore.getState()
    exportingData.current = true
    try {
      const dataPayload = await adminAPI.proxies.exportData(
        selectedCount > 0 ? { ids: Array.from(selectedProxyIds) } : { filters: buildProxyQueryFilters() }
      )
      const timestamp = formatExportTimestamp()
      const filename = `sub2api-proxy-${timestamp}.json`
      const blob = new Blob([JSON.stringify(dataPayload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      URL.revokeObjectURL(url)
      appStore.showSuccess(t('admin.proxies.dataExported'))
    } catch (error: any) {
      appStore.showError(error?.message || t('admin.proxies.dataExportFailed'))
    } finally {
      exportingData.current = false
      setShowExportDataDialog(false)
    }
  }

  const handleDelete = (proxy: Proxy) => {
    if ((proxy.account_count || 0) > 0) {
      useAppStore.getState().showError(t('admin.proxies.deleteBlockedInUse'))
      return
    }
    setDeletingProxy(proxy)
    setShowDeleteDialog(true)
  }

  const openBatchDelete = () => {
    if (selectedCount === 0) {
      return
    }
    setShowBatchDeleteDialog(true)
  }

  const confirmDelete = async () => {
    if (!deletingProxy) return
    const appStore = useAppStore.getState()

    try {
      await adminAPI.proxies.delete(deletingProxy.id)
      appStore.showSuccess(t('admin.proxies.proxyDeleted'))
      setShowDeleteDialog(false)
      removeSelectedProxies([deletingProxy.id])
      setDeletingProxy(null)
      void loadProxies()
    } catch (error: any) {
      appStore.showError(error.response?.data?.detail || t('admin.proxies.failedToDelete'))
      console.error('Error deleting proxy:', error)
    }
  }

  const confirmBatchDelete = async () => {
    const ids = Array.from(selectedProxyIds)
    if (ids.length === 0) {
      setShowBatchDeleteDialog(false)
      return
    }
    const appStore = useAppStore.getState()

    try {
      const result = await adminAPI.proxies.batchDelete(ids)
      const deleted = result.deleted_ids?.length || 0
      const skipped = result.skipped?.length || 0

      if (deleted > 0) {
        appStore.showSuccess(t('admin.proxies.batchDeleteDone', { deleted, skipped }))
      } else if (skipped > 0) {
        appStore.showInfo(t('admin.proxies.batchDeleteSkipped', { skipped }))
      }

      clearSelectedProxies()
      setShowBatchDeleteDialog(false)
      void loadProxies()
    } catch (error: any) {
      appStore.showError(error.response?.data?.detail || t('admin.proxies.batchDeleteFailed'))
      console.error('Error batch deleting proxies:', error)
    }
  }

  const openAccountsModal = async (proxy: Proxy) => {
    setAccountsProxy(proxy)
    setProxyAccounts([])
    setAccountsLoading(true)
    setShowAccountsModal(true)

    try {
      setProxyAccounts(await adminAPI.proxies.getProxyAccounts(proxy.id))
    } catch (error: any) {
      useAppStore.getState().showError(error.response?.data?.detail || t('admin.proxies.accountsFailed'))
      console.error('Error loading proxy accounts:', error)
    } finally {
      setAccountsLoading(false)
    }
  }

  const closeAccountsModal = () => {
    setShowAccountsModal(false)
    setAccountsProxy(null)
    setProxyAccounts([])
  }

  // ── Proxy URL copy ──
  const copyProxyUrl = (row: Proxy) => {
    void copyToClipboard(buildProxyUrl(row), t('admin.proxies.urlCopied'))
    setCopyMenuProxyId(null)
  }

  const toggleCopyMenu = (id: number) => {
    setCopyMenuProxyId((current) => (current === id ? null : id))
  }

  const copyFormat = (value: string) => {
    void copyToClipboard(value, t('admin.proxies.urlCopied'))
    setCopyMenuProxyId(null)
  }

  const togglePasswordVisible = (id: number) => {
    setVisiblePasswordIds((prev) => (prev.has(id) ? withoutId(prev, id) : withId(prev, id)))
  }

  const headers: Record<string, (context: DataTableHeaderContext) => ReactNode> = {
    select: () => (
      <Checkbox
        checked={allVisibleSelected}
        aria-label={t('common.selectAll')}
        onClick={(event) => event.stopPropagation()}
        onCheckedChange={(checked) => toggleVisible(checked === true)}
      />
    )
  }

  type Cell = (context: DataTableCellContext<Proxy>) => ReactNode
  const cells: Record<string, Cell> = {
    select: ({ row }) => (
      <Checkbox
        checked={selectedProxyIds.has(row.id)}
        aria-label={`${t('common.selectOption')} ${row.name}`}
        onClick={(event) => event.stopPropagation()}
        onCheckedChange={(checked) => (checked === true ? select(row.id) : deselect(row.id))}
      />
    ),
    name: ({ value }) => <span className={styles.strong}>{value}</span>,
    protocol: ({ value }) =>
      value ? (
        <Badge tone={String(value).startsWith('socks5') ? 'info' : 'neutral'} size="sm">
          {String(value).toUpperCase()}
        </Badge>
      ) : (
        <span className={styles.muted}>-</span>
      ),
    address: ({ row }) => (
      <div className={styles.addressCell}>
        <code className={styles.code}>
          {row.host}:{row.port}
        </code>
        <Popover
          open={copyMenuProxyId === row.id}
          onOpenChange={(open) => {
            if (!open) setCopyMenuProxyId(null)
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              className={styles.iconButton}
              title={t('admin.proxies.copyProxyUrl')}
              aria-label={t('admin.proxies.copyProxyUrl')}
              onClick={(event) => {
                // 左键直接复制完整 URL，不打开菜单
                event.preventDefault()
                event.stopPropagation()
                copyProxyUrl(row)
              }}
              onContextMenu={(event) => {
                // 右键展开格式选择菜单
                event.preventDefault()
                toggleCopyMenu(row.id)
              }}
            >
              <Copy size={14} aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent className={styles.copyMenu}>
            {getCopyFormats(row).map((fmt) => (
              <button key={fmt.label} type="button" className={styles.copyMenuItem} onClick={() => copyFormat(fmt.value)}>
                <span className={styles.copyMenuText}>{fmt.label}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>
    ),
    auth: ({ row }) =>
      row.username || row.password ? (
        <div className={styles.authCell}>
          <div className={styles.authLines}>
            {row.username ? <span>{row.username}</span> : null}
            {row.password ? (
              <span className={styles.mono}>{visiblePasswordIds.has(row.id) ? row.password : '••••••'}</span>
            ) : null}
          </div>
          {row.password ? (
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t('admin.proxies.password')}
              onClick={(event) => {
                event.stopPropagation()
                togglePasswordVisible(row.id)
              }}
            >
              {visiblePasswordIds.has(row.id) ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
            </button>
          ) : null}
        </div>
      ) : (
        <span className={styles.muted}>-</span>
      ),
    location: ({ row }) => (
      <div className={styles.locationCell}>
        {row.country_code ? (
          <img className={styles.flag} src={flagUrl(row.country_code)} alt={row.country || row.country_code} />
        ) : null}
        {formatLocation(row) ? <span>{formatLocation(row)}</span> : <span className={styles.muted}>-</span>}
      </div>
    ),
    account_count: ({ row, value }) =>
      (value || 0) > 0 ? (
        <button type="button" className={styles.countLink} onClick={() => void openAccountsModal(row)}>
          {t('admin.groups.accountsCount', { count: value || 0 })}
        </button>
      ) : (
        <span className={styles.countPill}>{t('admin.groups.accountsCount', { count: 0 })}</span>
      ),
    latency: ({ row }) => (
      <div className={styles.stack}>
        {row.latency_status === 'failed' ? (
          <Badge tone="danger" size="sm" title={row.latency_message || undefined}>
            {t('admin.proxies.latencyFailed')}
          </Badge>
        ) : typeof row.latency_ms === 'number' ? (
          <Badge tone={row.latency_ms < 200 ? 'success' : 'warning'} size="sm">
            {`${row.latency_ms}ms`}
          </Badge>
        ) : (
          <span className={styles.muted}>-</span>
        )}
        {typeof row.quality_checked === 'number' ? (
          <div className={styles.qualityInline} title={row.quality_summary || undefined}>
            <span>
              {t('admin.proxies.qualityInline', { grade: row.quality_grade || '-', score: row.quality_score ?? '-' })}
            </span>
            <Badge tone={qualityOverallTone(row.quality_status)} size="sm">
              {qualityOverallLabel(row.quality_status)}
            </Badge>
          </div>
        ) : null}
      </div>
    ),
    expiry: ({ row }) => {
      if (!row.expires_at) return <span className={styles.muted}>{t('admin.proxies.neverExpires')}</span>
      const tone = expiryTone(row)
      return (
        <div className={styles.stackXs}>
          <span>{formatDateTime(row.expires_at)}</span>
          {tone ? (
            <Badge tone={tone} size="sm">
              {expiryLabel(row)}
            </Badge>
          ) : (
            <span className={styles.muted}>{expiryLabel(row)}</span>
          )}
        </div>
      )
    },
    created_at: ({ row }) => <span className={styles.small}>{formatDateTime(row.created_at)}</span>,
    status: ({ value }) => (
      <Badge tone={value === 'active' ? 'success' : 'danger'} size="sm">
        {t('admin.accounts.status.' + value)}
      </Badge>
    ),
    actions: ({ row }) => (
      <div className={styles.actions}>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          loading={testingProxyIds.has(row.id)}
          disabled={testingProxyIds.has(row.id)}
          onClick={() => void handleTestConnection(row)}
        >
          {testingProxyIds.has(row.id) ? null : <CheckCircle2 size={14} aria-hidden="true" />}
          {t('admin.proxies.testConnection')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          loading={qualityCheckingProxyIds.has(row.id)}
          disabled={qualityCheckingProxyIds.has(row.id)}
          onClick={() => void handleQualityCheck(row)}
        >
          {qualityCheckingProxyIds.has(row.id) ? null : <ShieldCheck size={14} aria-hidden="true" />}
          {t('admin.proxies.qualityCheck')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => handleEdit(row)}>
          <Pencil size={14} aria-hidden="true" />
          {t('common.edit')}
        </Button>
        <Button type="button" size="sm" variant="ghost" className={styles.dangerAction} onClick={() => handleDelete(row)}>
          <Trash2 size={14} aria-hidden="true" />
          {t('common.delete')}
        </Button>
      </div>
    )
  }

  const filtersBar = (
    <div className={styles.toolbar}>
      {/* Left: Search + Filters */}
      <div className={styles.filterGroup}>
        <input
          type="search"
          className={`${styles.input} ${styles.search}`}
          value={query.search}
          placeholder={t('admin.proxies.searchProxies')}
          aria-label={t('admin.proxies.searchProxies')}
          onChange={(event) => handleSearch(event.target.value)}
        />
        <div className={styles.protocolFilter}>
          <Select
            value={query.protocol}
            options={protocolOptions}
            placeholder={t('admin.proxies.allProtocols')}
            aria-label={t('admin.proxies.allProtocols')}
            onChange={(value: SelectValue) => handleFilterChange({ protocol: value == null ? '' : String(value) })}
          />
        </div>
        <div className={styles.statusFilter}>
          <Select
            value={query.status}
            options={statusOptions}
            placeholder={t('admin.proxies.allStatus')}
            aria-label={t('admin.proxies.allStatus')}
            onChange={(value: SelectValue) => handleFilterChange({ status: value == null ? '' : String(value) })}
          />
        </div>
      </div>

      {/* Right: All action buttons */}
      <div className={styles.actionGroup}>
        <Button
          type="button"
          variant="secondary"
          disabled={loading}
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
          onClick={() => void loadProxies()}
        >
          <RefreshCw size={16} aria-hidden="true" className={loading ? styles.spin : undefined} />
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={batchTesting || loading}
          title={t('admin.proxies.testConnection')}
          onClick={() => void handleBatchTest()}
        >
          <Play size={16} aria-hidden="true" />
          {t('admin.proxies.testConnection')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={batchQualityChecking || loading}
          title={t('admin.proxies.batchQualityCheck')}
          onClick={() => void handleBatchQualityCheck()}
        >
          <ShieldCheck size={16} aria-hidden="true" className={batchQualityChecking ? styles.pulse : undefined} />
          {t('admin.proxies.batchQualityCheck')}
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={selectedCount === 0}
          title={t('admin.proxies.batchDeleteAction')}
          onClick={openBatchDelete}
        >
          <Trash2 size={16} aria-hidden="true" />
          {t('admin.proxies.batchDeleteAction')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setShowImportData(true)}>
          {t('admin.proxies.dataImport')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setShowExportDataDialog(true)}>
          {selectedCount > 0 ? t('admin.proxies.dataExportSelected') : t('admin.proxies.dataExport')}
        </Button>
        <Button type="button" variant="primary" onClick={() => setShowCreateModal(true)}>
          <Plus size={16} aria-hidden="true" />
          {t('admin.proxies.createProxy')}
        </Button>
      </div>
    </div>
  )

  const table = (
    <div className={styles.region}>
      <div ref={proxyTableRef} className={styles.tableArea}>
        <DataTable<Proxy>
          columns={columns}
          data={proxies}
          loading={loading}
          rowKey="id"
          serverSideSort
          defaultSortKey="id"
          defaultSortOrder="desc"
          onSort={handleSort}
          cells={cells}
          headers={headers}
          className={styles.dataTable}
          empty={
            <EmptyState
              title={t('admin.proxies.noProxiesYet')}
              description={t('admin.proxies.createFirstProxy')}
              actionText={t('admin.proxies.createProxy')}
              onAction={() => setShowCreateModal(true)}
            />
          }
        />
      </div>
    </div>
  )

  const renderPasswordInput = (
    value: string,
    visible: boolean,
    onToggle: () => void,
    onChange: (value: string) => void,
    placeholder: string,
    label: string
  ) => (
    <div className={styles.passwordWrap}>
      <input
        className={styles.input}
        type={visible ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="new-password"
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" className={styles.passwordToggle} aria-label={label} onClick={onToggle}>
        {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  )

  const renderExpiryField = (
    expiresAt: string,
    baseDate: string,
    days: number | null,
    onChangeExpiresAt: (value: string) => void
  ) => (
    <div className={styles.field}>
      <span className={styles.label}>{t('admin.proxies.expiresAt')}</span>
      <div className={styles.presets}>
        {EXPIRY_PRESETS.map((d) => (
          <Button
            key={d}
            type="button"
            size="sm"
            variant={expiresAt === addDaysToBase(baseDate, d) ? 'primary' : 'secondary'}
            onClick={() => onChangeExpiresAt(addDaysToBase(baseDate, d))}
          >
            {t('admin.proxies.nDays', { days: d })}
          </Button>
        ))}
      </div>
      <input
        type="number"
        min={0}
        className={styles.input}
        value={days ?? ''}
        placeholder={t('admin.proxies.expiryDaysPlaceholder')}
        aria-label={t('admin.proxies.expiryDaysPlaceholder')}
        onChange={(event) => onChangeExpiresAt(addDaysToBase(baseDate, toNumberInput(event.target.value)))}
      />
      <input
        type="date"
        max="9999-12-31"
        className={styles.input}
        value={expiresAt}
        aria-label={t('admin.proxies.expiresAt')}
        onChange={(event) => onChangeExpiresAt(event.target.value)}
      />
    </div>
  )

  return (
    <>
      <TablePageLayout
        filters={filtersBar}
        table={table}
        pagination={
          query.total > 0 ? (
            <Pagination
              page={query.page}
              total={query.total}
              pageSize={query.page_size}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          ) : null
        }
      />

      {/* Create Proxy Modal */}
      <BaseDialog
        show={showCreateModal}
        title={t('admin.proxies.createProxy')}
        width="normal"
        onClose={closeCreateModal}
        footer={
          <div className={styles.footer}>
            <Button type="button" variant="secondary" onClick={closeCreateModal}>
              {t('common.cancel')}
            </Button>
            {createMode === 'standard' ? (
              <Button type="submit" form="create-proxy-form" variant="primary" disabled={submitting} loading={submitting}>
                {submitting ? t('admin.proxies.creating') : t('common.create')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                disabled={submitting || batchParseResult.valid === 0}
                loading={submitting}
                onClick={() => void handleBatchCreate()}
              >
                {submitting
                  ? t('admin.proxies.importing')
                  : t('admin.proxies.importProxies', { count: batchParseResult.valid })}
              </Button>
            )}
          </div>
        }
      >
        {/* Tab Switch */}
        <div className={styles.createHeader}>
          <SegmentedControl
            options={[
              { value: 'standard', label: t('admin.proxies.standardAdd') },
              { value: 'batch', label: t('admin.proxies.batchAdd') }
            ]}
            value={createMode}
            onValueChange={(value) => setCreateMode(value as 'standard' | 'batch')}
            label={t('admin.proxies.createProxy')}
          />
          <ProxyAdBanner />
        </div>

        {createMode === 'standard' ? (
          <form id="create-proxy-form" className={styles.form} onSubmit={(event) => void handleCreateProxy(event)}>
            <label className={styles.field}>
              <span className={styles.label}>{t('admin.proxies.name')}</span>
              <input
                className={styles.input}
                type="text"
                required
                value={createForm.name}
                placeholder={t('admin.proxies.enterProxyName')}
                onChange={(event) => patchCreate({ name: event.target.value })}
              />
            </label>
            <div className={styles.field}>
              <span className={styles.label}>{t('admin.proxies.protocol')}</span>
              <Select
                value={createForm.protocol}
                options={protocolSelectOptions}
                aria-label={t('admin.proxies.protocol')}
                onChange={(value) => patchCreate({ protocol: (value as ProxyProtocol) || 'http' })}
              />
            </div>
            <div className={styles.grid2}>
              <label className={styles.field}>
                <span className={styles.label}>{t('admin.proxies.host')}</span>
                <input
                  className={styles.input}
                  type="text"
                  required
                  value={createForm.host}
                  placeholder={t('admin.proxies.form.hostPlaceholder')}
                  onChange={(event) => patchCreate({ host: event.target.value })}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>{t('admin.proxies.port')}</span>
                <input
                  className={styles.input}
                  type="number"
                  required
                  min={1}
                  max={65535}
                  value={createForm.port}
                  placeholder={t('admin.proxies.form.portPlaceholder')}
                  onChange={(event) => patchCreate({ port: toNumberInput(event.target.value) })}
                />
              </label>
            </div>
            <label className={styles.field}>
              <span className={styles.label}>{t('admin.proxies.username')}</span>
              <input
                className={styles.input}
                type="text"
                value={createForm.username}
                placeholder={t('admin.proxies.optionalAuth')}
                onChange={(event) => patchCreate({ username: event.target.value })}
              />
            </label>
            <div className={styles.field}>
              <span className={styles.label}>{t('admin.proxies.password')}</span>
              {renderPasswordInput(
                createForm.password,
                createPasswordVisible,
                () => setCreatePasswordVisible((v) => !v),
                (value) => patchCreate({ password: value }),
                t('admin.proxies.optionalAuth'),
                t('admin.proxies.password')
              )}
            </div>
            {renderExpiryField(createForm.expires_at, '', createExpiresDays, (value) => patchCreate({ expires_at: value }))}
            <div className={styles.field}>
              <span className={styles.label}>{t('admin.proxies.fallbackMode')}</span>
              <Select
                value={createForm.fallback_mode}
                options={fallbackOptions}
                aria-label={t('admin.proxies.fallbackMode')}
                onChange={(value) => patchCreate({ fallback_mode: (value as FallbackMode) || 'none' })}
              />
            </div>
            {createForm.fallback_mode === 'proxy' ? (
              <div className={styles.field}>
                <span className={styles.label}>{t('admin.proxies.backupProxy')}</span>
                <Select
                  value={createForm.backup_proxy_id}
                  options={backupProxyOptions()}
                  aria-label={t('admin.proxies.backupProxy')}
                  onChange={(value) => patchCreate({ backup_proxy_id: value == null ? null : Number(value) })}
                />
              </div>
            ) : null}
          </form>
        ) : (
          /* Batch Add Form */
          <div className={styles.form}>
            <label className={styles.field}>
              <span className={styles.label}>{t('admin.proxies.batchInput')}</span>
              <textarea
                className={`${styles.input} ${styles.textarea} ${styles.mono}`}
                rows={10}
                value={batchInput}
                placeholder={t('admin.proxies.batchInputPlaceholder')}
                onChange={(event) => handleBatchInput(event.target.value)}
              />
              <span className={styles.hint}>{t('admin.proxies.batchInputHint')}</span>
            </label>

            {/* Parse Result */}
            {batchParseResult.total > 0 ? (
              <div className={styles.parseResult}>
                <span className={styles.parseItem}>
                  <CircleCheck size={16} aria-hidden="true" className={styles.accentIcon} />
                  {t('admin.proxies.parsedCount', { count: batchParseResult.valid })}
                </span>
                {batchParseResult.invalid > 0 ? (
                  <span className={`${styles.parseItem} ${styles.warningText}`}>
                    <TriangleAlert size={16} aria-hidden="true" />
                    {t('admin.proxies.invalidCount', { count: batchParseResult.invalid })}
                  </span>
                ) : null}
                {batchParseResult.duplicate > 0 ? (
                  <span className={`${styles.parseItem} ${styles.muted}`}>
                    <Files size={16} aria-hidden="true" />
                    {t('admin.proxies.duplicateCount', { count: batchParseResult.duplicate })}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </BaseDialog>

      {/* Edit Proxy Modal */}
      <BaseDialog
        show={showEditModal}
        title={t('admin.proxies.editProxy')}
        width="normal"
        onClose={closeEditModal}
        footer={
          <div className={styles.footer}>
            <Button type="button" variant="secondary" onClick={closeEditModal}>
              {t('common.cancel')}
            </Button>
            {editingProxy ? (
              <Button type="submit" form="edit-proxy-form" variant="primary" disabled={submitting} loading={submitting}>
                {submitting ? t('admin.proxies.updating') : t('common.update')}
              </Button>
            ) : null}
          </div>
        }
      >
        {editingProxy ? (
          <form id="edit-proxy-form" className={styles.form} onSubmit={(event) => void handleUpdateProxy(event)}>
            <label className={styles.field}>
              <span className={styles.label}>{t('admin.proxies.name')}</span>
              <input
                className={styles.input}
                type="text"
                required
                value={editForm.name}
                onChange={(event) => patchEdit({ name: event.target.value })}
              />
            </label>
            <div className={styles.field}>
              <span className={styles.label}>{t('admin.proxies.protocol')}</span>
              <Select
                value={editForm.protocol}
                options={protocolSelectOptions}
                aria-label={t('admin.proxies.protocol')}
                onChange={(value) => patchEdit({ protocol: (value as ProxyProtocol) || 'http' })}
              />
            </div>
            <div className={styles.grid2}>
              <label className={styles.field}>
                <span className={styles.label}>{t('admin.proxies.host')}</span>
                <input
                  className={styles.input}
                  type="text"
                  required
                  value={editForm.host}
                  onChange={(event) => patchEdit({ host: event.target.value })}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>{t('admin.proxies.port')}</span>
                <input
                  className={styles.input}
                  type="number"
                  required
                  min={1}
                  max={65535}
                  value={editForm.port}
                  onChange={(event) => patchEdit({ port: toNumberInput(event.target.value) })}
                />
              </label>
            </div>
            <label className={styles.field}>
              <span className={styles.label}>{t('admin.proxies.username')}</span>
              <input
                className={styles.input}
                type="text"
                value={editForm.username}
                onChange={(event) => patchEdit({ username: event.target.value })}
              />
            </label>
            <div className={styles.field}>
              <span className={styles.label}>{t('admin.proxies.password')}</span>
              {renderPasswordInput(
                editForm.password,
                editPasswordVisible,
                () => setEditPasswordVisible((v) => !v),
                (value) => {
                  patchEdit({ password: value })
                  setEditPasswordDirty(true)
                },
                t('admin.proxies.leaveEmptyToKeep'),
                t('admin.proxies.password')
              )}
            </div>
            <div className={styles.field}>
              <span className={styles.label}>{t('admin.proxies.status')}</span>
              <Select
                value={editForm.status}
                options={editStatusOptions}
                aria-label={t('admin.proxies.status')}
                onChange={(value) => patchEdit({ status: (value as EditForm['status']) || 'active' })}
              />
            </div>
            {renderExpiryField(editForm.expires_at, editBaseDate, editExpiresDays, (value) => patchEdit({ expires_at: value }))}
            <div className={styles.field}>
              <span className={styles.label}>{t('admin.proxies.fallbackMode')}</span>
              <Select
                value={editForm.fallback_mode}
                options={fallbackOptions}
                aria-label={t('admin.proxies.fallbackMode')}
                onChange={(value) => patchEdit({ fallback_mode: (value as FallbackMode) || 'none' })}
              />
            </div>
            {editForm.fallback_mode === 'proxy' ? (
              <div className={styles.field}>
                <span className={styles.label}>{t('admin.proxies.backupProxy')}</span>
                <Select
                  value={editForm.backup_proxy_id}
                  options={backupProxyOptions(editingProxy.id)}
                  aria-label={t('admin.proxies.backupProxy')}
                  onChange={(value) => patchEdit({ backup_proxy_id: value == null ? null : Number(value) })}
                />
              </div>
            ) : null}
          </form>
        ) : null}
      </BaseDialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        show={showDeleteDialog}
        title={t('admin.proxies.deleteProxy')}
        message={t('admin.proxies.deleteConfirm', { name: deletingProxy?.name })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setShowDeleteDialog(false)}
      />

      {/* Batch Delete Confirmation Dialog */}
      <ConfirmDialog
        show={showBatchDeleteDialog}
        title={t('admin.proxies.batchDelete')}
        message={t('admin.proxies.batchDeleteConfirm', { count: selectedCount })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void confirmBatchDelete()}
        onCancel={() => setShowBatchDeleteDialog(false)}
      />
      <ConfirmDialog
        show={showExportDataDialog}
        title={t('admin.proxies.dataExport')}
        message={t('admin.proxies.dataExportConfirmMessage')}
        confirmText={t('admin.proxies.dataExportConfirm')}
        cancelText={t('common.cancel')}
        onConfirm={() => void handleExportData()}
        onCancel={() => setShowExportDataDialog(false)}
      />

      <ImportDataModal show={showImportData} onClose={() => setShowImportData(false)} onImported={handleDataImported} />

      <BaseDialog
        show={showQualityReportDialog}
        title={t('admin.proxies.qualityReportTitle')}
        width="normal"
        onClose={closeQualityReportDialog}
        footer={
          <div className={styles.footer}>
            <Button type="button" variant="secondary" onClick={closeQualityReportDialog}>
              {t('common.close')}
            </Button>
          </div>
        }
      >
        {qualityReport ? (
          <div className={styles.form}>
            <div className={styles.reportSummary}>
              <div className={styles.reportHead}>
                <div>
                  <div className={styles.mutedSm}>{qualityReportProxy?.name || '-'}</div>
                  <div className={styles.reportText}>{qualityReport.summary}</div>
                </div>
                <div className={styles.reportScore}>
                  <div className={styles.score}>{qualityReport.score}</div>
                  <div className={styles.mutedXs}>{t('admin.proxies.qualityGrade', { grade: qualityReport.grade })}</div>
                </div>
              </div>
              <div className={styles.reportMeta}>
                <div>
                  {t('admin.proxies.qualityExitIP')}: {qualityReport.exit_ip || '-'}
                </div>
                <div>
                  {t('admin.proxies.qualityCountry')}: {qualityReport.country || '-'}
                </div>
                <div>
                  {t('admin.proxies.qualityBaseLatency')}:{' '}
                  {typeof qualityReport.base_latency_ms === 'number' ? `${qualityReport.base_latency_ms}ms` : '-'}
                </div>
                <div>
                  {t('admin.proxies.qualityCheckedAt')}: {new Date(qualityReport.checked_at * 1000).toLocaleString()}
                </div>
              </div>
            </div>

            <div className={styles.innerTableWrap}>
              <table className={styles.innerTable}>
                <thead>
                  <tr>
                    <th>{t('admin.proxies.qualityTableTarget')}</th>
                    <th>{t('admin.proxies.qualityTableStatus')}</th>
                    <th>HTTP</th>
                    <th>{t('admin.proxies.qualityTableLatency')}</th>
                    <th>{t('admin.proxies.qualityTableMessage')}</th>
                  </tr>
                </thead>
                <tbody>
                  {qualityReport.items.map((item) => (
                    <tr key={item.target}>
                      <td className={styles.nowrap}>{qualityTargetLabel(item.target)}</td>
                      <td className={styles.nowrap}>
                        <Badge tone={qualityStatusTone(item.status)} size="sm">
                          {qualityStatusLabel(item.status)}
                        </Badge>
                      </td>
                      <td className={styles.nowrap}>{item.http_status ?? '-'}</td>
                      <td className={styles.nowrap}>{typeof item.latency_ms === 'number' ? `${item.latency_ms}ms` : '-'}</td>
                      <td>
                        <span>{item.message || '-'}</span>
                        {item.cf_ray ? <span className={styles.mutedXs}> (cf-ray: {item.cf_ray})</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </BaseDialog>

      {/* Proxy Accounts Dialog */}
      <BaseDialog
        show={showAccountsModal}
        title={t('admin.proxies.accountsTitle', { name: accountsProxy?.name || '' })}
        width="normal"
        onClose={closeAccountsModal}
        footer={
          <div className={styles.footer}>
            <Button type="button" variant="secondary" onClick={closeAccountsModal}>
              {t('common.close')}
            </Button>
          </div>
        }
      >
        {accountsLoading ? (
          <div className={styles.dialogLoading}>
            <RefreshCw size={16} aria-hidden="true" className={styles.spin} />
            {t('common.loading')}
          </div>
        ) : proxyAccounts.length === 0 ? (
          <div className={styles.dialogEmpty}>{t('admin.proxies.accountsEmpty')}</div>
        ) : (
          <div className={styles.innerTableWrap}>
            <table className={styles.innerTable}>
              <thead>
                <tr>
                  <th>{t('admin.proxies.accountName')}</th>
                  <th>{t('admin.accounts.columns.platformType')}</th>
                  <th>{t('admin.proxies.accountNotes')}</th>
                </tr>
              </thead>
              <tbody>
                {proxyAccounts.map((account) => (
                  <tr key={account.id}>
                    <td className={styles.strong}>{account.name}</td>
                    <td>
                      <PlatformTypeBadge platform={account.platform} type={account.type} />
                    </td>
                    <td>{account.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </BaseDialog>
    </>
  )
}
