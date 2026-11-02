/**
 * 批量生图页，对应 Vue 版 views/user/BatchImageGuideView.vue。
 * 工具栏（任务名搜索、Key/状态/下载筛选、重置、刷新、使用说明、创建任务）+ 任务表格（父子任务展开、多选批量下载/删除）
 * + 游标分页；详情、图片预览、创建任务、使用说明为对话框。
 * 页面状态放在组件实例自己的 zustand store 中：异步流程（轮询、提交、重试）读到的总是最新值，与 Vue 的 ref 语义一致。
 * 纯函数（错误映射、计费展示、缩略图与预览缓存、Agent 指令模板）见 ./batchImageHelpers。
 */
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  FileText,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { createStore, useStore } from 'zustand'

import { Alert } from '@/components/arc/alert/alert'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import buttonStyles from '@/components/arc/button/button.module.css'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { DropdownMenu, type DropdownItem } from '@/components/arc/dropdown-menu/dropdown-menu'
import { keysAPI } from '@/api'
import {
  cancelBatchImageJob,
  deleteBatchImageJobRecord,
  downloadBatchImageZip,
  getBatchImageItemContent,
  getBatchImageJob,
  listBatchImageItems,
  listBatchImageJobs,
  listBatchImageModels,
  saveBlob,
  submitBatchImageJob,
  type BatchImageItem,
  type BatchImageJob,
  type BatchImageJobsListOptions,
  type BatchImageReferenceImage,
  type BatchImageSubmitItem
} from '@/api/batchImage'
import BaseDialog from '@/components/common/BaseDialog'
import DataTable, { type DataTableCellContext } from '@/components/common/DataTable'
import Input from '@/components/common/Input'
import SearchInput from '@/components/common/SearchInput'
import Select, { type SelectOption } from '@/components/common/Select'
import TablePageLayout from '@/components/common/TablePageLayout'
import TextArea from '@/components/common/TextArea'
import type { Column } from '@/components/common/types'
import { useClipboard } from '@/composables/useClipboard'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { getPersistedPageSize, setPersistedPageSize } from '@/composables/usePersistedPageSize'
import { I18nT } from '@/i18n/I18nT'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { ApiKey } from '@/types'
import {
  BATCH_IMAGE_MAX_OUTPUTS_PER_ITEM,
  BATCH_IMAGE_MAX_OUTPUTS_PER_JOB,
  TERMINAL_STATUSES,
  batchImageErrorMessage,
  batchImageText,
  buildAgentInstruction,
  canLoadItemPreview,
  cleanupPreviewCache,
  costLabel,
  createThumbnailBlob,
  defaultTaskName,
  formatDate,
  friendlyItemError,
  getCachedPreviewBlob,
  isSuccessfulImageItem,
  itemStatusLabel,
  itemStatusTone,
  makeIdempotencyKey,
  makeLocalId,
  normalizeOutputCount,
  previewCacheKey,
  previewCacheSupported,
  putCachedPreviewBlob,
  readFileAsBase64,
  referenceImageLimitForModel,
  retryCustomID,
  retrySourceCustomID,
  statusLabel,
  statusTone,
  uniqueCustomID
} from './batchImageHelpers'
import styles from './BatchImageGuideView.module.css'

type BatchImageJobRow = Pick<BatchImageJob, 'id' | 'task_name' | 'parent_batch_id' | 'status' | 'model' | 'provider' | 'item_count' | 'success_count' | 'fail_count' | 'estimated_cost' | 'hold_amount' | 'actual_cost' | 'created_at' | 'downloaded_at'> & {
  api_key_id: number
  api_key_name: string
  child_count: number
  is_child?: boolean
}

type BatchImageDetailItem = BatchImageItem & {
  batch_id: string
  source_task_name: string
}

type PromptRow = {
  localId: string
  custom_id: string
  prompt: string
  output_count: number
  reference_images: BatchImageReferenceImage[]
}

type ReferenceImageDraft = BatchImageReferenceImage & {
  name: string
  size: number
}

type DisplayableJob = Pick<BatchImageJob, 'id' | 'parent_batch_id' | 'status' | 'item_count' | 'success_count' | 'fail_count' | 'estimated_cost' | 'hold_amount' | 'actual_cost'>

interface BatchState {
  form: { apiKeyId: number; taskName: string; model: string; responseMimeType: string }
  filters: { taskName: string; apiKeyId: string; status: string; downloaded: string }
  pagination: { page: number; page_size: number; has_more: boolean }
  apiKeys: ApiKey[]
  loadingKeys: boolean
  loadingJobs: boolean
  submitting: boolean
  refreshing: boolean
  cancelling: boolean
  downloading: boolean
  downloadingBatchId: string
  retryingBatchId: string
  bulkDownloading: boolean
  bulkDeleting: boolean
  deletingBatchId: string
  loadingItems: boolean
  loadingModels: boolean
  showCreateModal: boolean
  showGuideModal: boolean
  currentJob: BatchImageJob | null
  selectedBatchId: string
  selectedBatchApiKeyId: number
  items: BatchImageDetailItem[]
  batchJobs: BatchImageJobRow[]
  selectedJobIds: Set<string>
  expandedParentIds: Set<string>
  promptRows: PromptRow[]
  promptDraft: string
  customIdDraft: string
  outputCountDraft: number
  referenceImageDrafts: ReferenceImageDraft[]
  itemPreviewUrls: Record<string, string>
  previewLoadingIds: Set<string>
  previewErrorIds: Set<string>
  previewImageItem: BatchImageItem | null
  availableBatchImageModels: Array<{ value: string; label: string }>
  modelLoadError: string
  promptPopover: { visible: boolean; text: string; style: CSSProperties }
}

const outputCountOptions = Array.from({ length: BATCH_IMAGE_MAX_OUTPUTS_PER_ITEM }, (_, index) => index + 1)
const batchPageSizeOptions: SelectOption[] = [20, 50, 100].map(size => ({ value: size, label: String(size) }))
const ICON_SM = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

function createInitialState(): BatchState {
  return {
    form: { apiKeyId: 0, taskName: '', model: '', responseMimeType: 'image/png' },
    filters: { taskName: '', apiKeyId: '', status: '', downloaded: '' },
    pagination: { page: 1, page_size: Math.min(getPersistedPageSize(20), 100), has_more: false },
    apiKeys: [],
    loadingKeys: false,
    loadingJobs: false,
    submitting: false,
    refreshing: false,
    cancelling: false,
    downloading: false,
    downloadingBatchId: '',
    retryingBatchId: '',
    bulkDownloading: false,
    bulkDeleting: false,
    deletingBatchId: '',
    loadingItems: false,
    loadingModels: false,
    showCreateModal: false,
    showGuideModal: false,
    currentJob: null,
    selectedBatchId: '',
    selectedBatchApiKeyId: 0,
    items: [],
    batchJobs: [],
    selectedJobIds: new Set(),
    expandedParentIds: new Set(),
    promptRows: [],
    promptDraft: '',
    customIdDraft: '',
    outputCountDraft: 1,
    referenceImageDrafts: [],
    itemPreviewUrls: {},
    previewLoadingIds: new Set(),
    previewErrorIds: new Set(),
    previewImageItem: null,
    availableBatchImageModels: [],
    modelLoadError: '',
    promptPopover: { visible: false, text: '', style: {} }
  }
}

// ===== 由状态派生的值（对应 Vue 版 computed），渲染与事件处理共用 =====

function geminiApiKeys(st: BatchState): ApiKey[] {
  return st.apiKeys.filter((key) =>
    key.status === 'active' &&
    key.group?.platform === 'gemini' &&
    key.group?.allow_batch_image_generation === true,
  )
}

function selectedApiKey(st: BatchState): ApiKey | null {
  return geminiApiKeys(st).find((key) => key.id === Number(st.form.apiKeyId)) || null
}

function filteredApiKeys(st: BatchState): ApiKey[] {
  const selectedFilterID = Number(st.filters.apiKeyId || 0)
  if (!selectedFilterID) return geminiApiKeys(st)
  return geminiApiKeys(st).filter(key => key.id === selectedFilterID)
}

function selectedRows(st: BatchState): BatchImageJobRow[] {
  return st.batchJobs.filter(job => st.selectedJobIds.has(job.id))
}

function childrenByParent(st: BatchState): Map<string, BatchImageJobRow[]> {
  const groups = new Map<string, BatchImageJobRow[]>()
  for (const job of st.batchJobs) {
    if (!job.parent_batch_id) continue
    const rows = groups.get(job.parent_batch_id) || []
    rows.push(job)
    groups.set(job.parent_batch_id, rows)
  }
  for (const rows of groups.values()) {
    rows.sort((a, b) => a.created_at - b.created_at)
  }
  return groups
}

function visibleBatchJobs(st: BatchState): BatchImageJobRow[] {
  const children = childrenByParent(st)
  const rows: BatchImageJobRow[] = []
  for (const job of st.batchJobs.filter(item => !item.parent_batch_id)) {
    rows.push(job)
    if (st.expandedParentIds.has(job.id)) {
      rows.push(...(children.get(job.id) || []).map(child => ({ ...child, is_child: true })))
    }
  }
  return rows
}

function displayJob<T extends DisplayableJob>(st: BatchState, job: T): T {
  if (job.parent_batch_id) return job
  const children = childrenByParent(st).get(job.id) || []
  if (!children.length) return job

  const childSuccess = children.reduce((sum, child) => sum + child.success_count, 0)
  const childEstimated = children.reduce((sum, child) => sum + child.estimated_cost, 0)
  const childHold = children.reduce((sum, child) => sum + child.hold_amount, 0)
  const childActual = children.reduce((sum, child) => sum + (child.actual_cost || 0), 0)
  const childActualReady = children.every(child => child.actual_cost !== null)
  const successCount = Math.min(job.item_count, job.success_count + childSuccess)
  const failCount = Math.max(0, job.item_count - successCount)
  const actualCost = job.actual_cost === null
    ? (childActualReady ? childActual : null)
    : job.actual_cost + childActual

  return {
    ...job,
    success_count: successCount,
    fail_count: failCount,
    status: failCount === 0 && TERMINAL_STATUSES.has(job.status) ? 'completed' : job.status,
    estimated_cost: job.estimated_cost + childEstimated,
    hold_amount: job.hold_amount + childHold,
    actual_cost: actualCost,
  }
}

function hasChildJobs(st: BatchState, batchId: string) {
  return (childrenByParent(st).get(batchId) || []).length > 0
}

function canCancel(job: Pick<BatchImageJob, 'status'>) {
  return !TERMINAL_STATUSES.has(job.status)
}

function canDownload(job: Pick<BatchImageJob, 'status' | 'success_count'>) {
  return job.status === 'completed' && job.success_count > 0
}

function canRetry(st: BatchState, job: Pick<BatchImageJob, 'status' | 'fail_count'>) {
  const display = 'id' in job ? displayJob(st, job as BatchImageJob) : job
  return TERMINAL_STATUSES.has(display.status) && display.fail_count > 0
}

function canDeleteRecord(job: Pick<BatchImageJob, 'status'>) {
  return TERMINAL_STATUSES.has(job.status)
}

function selectedModelReferenceLimit(st: BatchState) {
  return referenceImageLimitForModel(st.form.model)
}

function estimatedOutputCount(st: BatchState) {
  return st.promptRows.reduce((sum, row) => sum + normalizeOutputCount(row.output_count), 0)
}

function parsedItems(st: BatchState): BatchImageSubmitItem[] {
  const used = new Set<string>()
  return st.promptRows
    .map((row, index) => {
      const customID = uniqueCustomID(row.custom_id || `img_${String(index + 1).padStart(3, '0')}`, used, index)
      const item: BatchImageSubmitItem = { custom_id: customID, prompt: row.prompt.trim() }
      const outputCount = normalizeOutputCount(row.output_count)
      if (outputCount > 1) {
        item.output_count = outputCount
      }
      if (row.reference_images.length) {
        item.reference_images = row.reference_images
      }
      return item
    })
    .filter(item => item.prompt)
}

function detailRootBatchId(st: BatchState) {
  return st.currentJob?.parent_batch_id || st.selectedBatchId || st.currentJob?.id || ''
}

function isChildDetailItem(st: BatchState, item: Pick<BatchImageDetailItem, 'batch_id'>) {
  const rootBatchId = detailRootBatchId(st)
  return Boolean(rootBatchId && item.batch_id && item.batch_id !== rootBatchId)
}

function recoveredOriginalCustomIds(st: BatchState): Set<string> {
  const rootBatchId = detailRootBatchId(st)
  if (!rootBatchId) return new Set<string>()
  const ids = new Set<string>()
  for (const item of st.items) {
    if (!isChildDetailItem(st, item) || !isSuccessfulImageItem(item)) continue
    const sourceCustomID = retrySourceCustomID(item.custom_id)
    if (sourceCustomID) ids.add(sourceCustomID)
  }
  return ids
}

function isRecoveredOriginalFailure(st: BatchState, item: BatchImageDetailItem, recovered = recoveredOriginalCustomIds(st)) {
  const rootBatchId = detailRootBatchId(st)
  return Boolean(
    rootBatchId
    && item.batch_id === rootBatchId
    && item.status === 'failed'
    && recovered.has(item.custom_id),
  )
}

function itemPreviewKey(st: BatchState, item: Pick<BatchImageItem, 'batch_id' | 'custom_id'>) {
  return previewCacheKey(item.batch_id || st.selectedBatchId || st.currentJob?.id || '', item.custom_id, 0)
}

export default function BatchImageGuideView() {
  const { t } = useI18n()
  const { copyToClipboard } = useClipboard()
  const { confirm, confirmDialog } = useConfirmDialog()
  const apiBaseUrl = useAppStore((state) => state.apiBaseUrl)
  const [store] = useState(() => createStore<BatchState>(createInitialState))
  const st = useStore(store)
  const get = store.getState
  const set = store.setState

  const modelRequestSeq = useRef(0)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const promptPopoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const promptPopoverOpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activePromptPopoverTarget = useRef<HTMLElement | null>(null)

  const appStore = useAppStore.getState

  const endpointBase = (() => {
    const configured = apiBaseUrl?.trim()
    if (configured) return configured.replace(/\/+$/, '')
    if (typeof window !== 'undefined') return window.location.origin.replace(/\/+$/, '')
    return '<你的 RetooAi API 端点>'
  })()
  const agentInstruction = buildAgentInstruction(endpointBase)

  // ===== 创建任务草稿 =====

  function addPromptRow() {
    const s = get()
    const prompt = s.promptDraft.trim()
    if (!prompt) return
    const outputCount = normalizeOutputCount(s.outputCountDraft)
    const used = new Set(s.promptRows.map(row => row.custom_id))
    const customID = uniqueCustomID(s.customIdDraft || `img_${String(s.promptRows.length + 1).padStart(3, '0')}`, used, s.promptRows.length)
    set({
      promptRows: [
        ...s.promptRows,
        {
          localId: makeLocalId(),
          custom_id: customID,
          prompt,
          output_count: outputCount,
          reference_images: s.referenceImageDrafts.map(({ name: _name, size: _size, ...ref }) => ref),
        },
      ],
      promptDraft: '',
      customIdDraft: '',
      outputCountDraft: 1,
      referenceImageDrafts: [],
    })
  }

  function removePromptRow(index: number) {
    set(s => ({ promptRows: s.promptRows.filter((_, currentIndex) => currentIndex !== index) }))
  }

  function removeReferenceImageDraft(index: number) {
    set(s => ({ referenceImageDrafts: s.referenceImageDrafts.filter((_, currentIndex) => currentIndex !== index) }))
  }

  async function handleReferenceImageFiles(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target
    const files = Array.from(input.files || [])
    input.value = ''
    if (files.length === 0) return
    const limit = selectedModelReferenceLimit(get())
    if (limit <= 0) {
      appStore().showError(t('batchImage.create.modelNoReferenceImages'))
      return
    }
    const slots = Math.max(0, limit - get().referenceImageDrafts.length)
    if (slots <= 0) {
      appStore().showError(t('batchImage.create.refLimitReached', { limit }))
      return
    }
    const accepted = files.slice(0, slots)
    if (accepted.length < files.length) {
      appStore().showError(t('batchImage.create.refLimitExceededIgnored', { limit }))
    }
    const next: ReferenceImageDraft[] = []
    for (const file of accepted) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        appStore().showError(t('batchImage.create.refFormatUnsupported'))
        continue
      }
      if (file.size > 10 * 1024 * 1024) {
        appStore().showError(t('batchImage.create.refFileTooLarge', { name: file.name }))
        continue
      }
      const data = await readFileAsBase64(file)
      next.push({
        id: file.name,
        type: 'reference',
        mime_type: file.type,
        data,
        name: file.name,
        size: file.size,
      })
    }
    set(s => ({ referenceImageDrafts: [...s.referenceImageDrafts, ...next] }))
  }

  // ===== 数据加载 =====

  async function loadApiKeys() {
    set({ loadingKeys: true })
    try {
      const response = await keysAPI.list(1, 100, { status: 'active', sort_by: 'created_at', sort_order: 'desc' })
      set({ apiKeys: response.items || [] })
      const keys = geminiApiKeys(get())
      if (!selectedApiKey(get()) && keys.length > 0) {
        set(s => ({ form: { ...s.form, apiKeyId: keys[0].id } }))
      }
      const filterKey = get().filters.apiKeyId
      if (filterKey && !keys.some(key => String(key.id) === filterKey)) {
        set(s => ({ filters: { ...s.filters, apiKeyId: '' } }))
      }
      if (!selectedApiKey(get())) {
        set(s => ({ availableBatchImageModels: [], form: { ...s.form, model: '' } }))
      }
    } catch (error: any) {
      appStore().showError(batchImageErrorMessage(error, batchImageText('loadKeysFailed')))
    } finally {
      set({ loadingKeys: false })
    }
  }

  async function loadAvailableModels() {
    const key = selectedApiKey(get())
    const requestID = ++modelRequestSeq.current
    set(s => ({ modelLoadError: '', availableBatchImageModels: [], form: { ...s.form, model: '' } }))
    if (!key) return

    set({ loadingModels: true })
    try {
      const result = await listBatchImageModels(key.key)
      if (requestID !== modelRequestSeq.current) return
      const seen = new Set<string>()
      const models = (result.data || [])
        .map(model => String(model.id || '').trim())
        .filter((model) => {
          if (!model || seen.has(model)) return false
          seen.add(model)
          return true
        })
        .map(model => ({ value: model, label: model }))
      set(s => ({ availableBatchImageModels: models, form: { ...s.form, model: models[0]?.value || '' } }))
    } catch (error: any) {
      if (requestID !== modelRequestSeq.current) return
      set({ modelLoadError: batchImageErrorMessage(error, batchImageText('loadModelsFailed')) })
    } finally {
      if (requestID === modelRequestSeq.current) {
        set({ loadingModels: false })
      }
    }
  }

  async function refreshPage() {
    await loadApiKeys()
    await loadBatchJobs()
  }

  function applyFilters() {
    set(s => ({ pagination: { ...s.pagination, page: 1 }, selectedJobIds: new Set() }))
    void loadBatchJobs()
  }

  function resetFilters() {
    set({ filters: { taskName: '', apiKeyId: '', status: '', downloaded: '' } })
    applyFilters()
  }

  function updateFilter(patch: Partial<BatchState['filters']>) {
    set(s => ({ filters: { ...s.filters, ...patch } }))
  }

  function updateForm(patch: Partial<BatchState['form']>) {
    set(s => ({ form: { ...s.form, ...patch } }))
  }

  function listOptions(): BatchImageJobsListOptions {
    const { pagination, filters } = get()
    const options: BatchImageJobsListOptions = {
      limit: pagination.page_size,
      cursor: String((pagination.page - 1) * pagination.page_size),
    }
    if (filters.taskName.trim()) options.taskName = filters.taskName.trim()
    if (filters.status) options.status = filters.status
    if (filters.downloaded) options.downloaded = filters.downloaded
    return options
  }

  function toJobRow(job: BatchImageJob, key: ApiKey | null = selectedApiKey(get())): BatchImageJobRow {
    return {
      id: job.id,
      task_name: job.task_name || defaultTaskName(job.created_at),
      parent_batch_id: job.parent_batch_id || null,
      status: job.status,
      model: job.model,
      provider: job.provider,
      item_count: job.item_count,
      success_count: job.success_count,
      fail_count: job.fail_count,
      estimated_cost: job.estimated_cost,
      hold_amount: job.hold_amount,
      actual_cost: job.actual_cost,
      created_at: job.created_at,
      downloaded_at: job.downloaded_at,
      api_key_id: key?.id || 0,
      api_key_name: key?.name || '',
      child_count: 0,
    }
  }

  function applyChildCounts(rows: BatchImageJobRow[]) {
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (!row.parent_batch_id) continue
      counts.set(row.parent_batch_id, (counts.get(row.parent_batch_id) || 0) + 1)
    }
    return rows.map(row => ({ ...row, child_count: counts.get(row.id) || 0 }))
  }

  function toggleChildRows(batchId: string) {
    const next = new Set(get().expandedParentIds)
    if (next.has(batchId)) next.delete(batchId)
    else next.add(batchId)
    set({ expandedParentIds: next })
  }

  async function loadBatchJobs() {
    const keys = filteredApiKeys(get())
    if (!keys.length) {
      set(s => ({ batchJobs: [], pagination: { ...s.pagination, has_more: false } }))
      return
    }
    set({ loadingJobs: true })
    try {
      const options = listOptions()
      const results = await Promise.all(keys.map(async (key) => {
        const result = await listBatchImageJobs(key.key, options)
        return {
          hasMore: Boolean(result.has_more),
          rows: (result.data || []).map(job => toJobRow(job, key)),
        }
      }))
      set(s => ({
        batchJobs: applyChildCounts(results
          .flatMap(result => result.rows)
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, s.pagination.page_size)),
        pagination: { ...s.pagination, has_more: results.some(result => result.hasMore) },
      }))
      const visible = visibleBatchJobs(get())
      set(s => ({ selectedJobIds: new Set([...s.selectedJobIds].filter(id => visible.some(job => job.id === id))) }))
    } catch (error: any) {
      appStore().showError(batchImageErrorMessage(error, batchImageText('loadJobsFailed')))
    } finally {
      set({ loadingJobs: false })
    }
  }

  function upsertJob(job: BatchImageJob) {
    const next = toJobRow(job)
    const { batchJobs, pagination } = get()
    const index = batchJobs.findIndex(item => item.id === job.id)
    if (index >= 0) {
      const rows = [...batchJobs]
      rows[index] = { ...next, is_child: rows[index].is_child }
      set({ batchJobs: applyChildCounts(rows) })
      return
    }
    set({ batchJobs: applyChildCounts([next, ...batchJobs].slice(0, pagination.page_size)) })
  }

  function handlePageChange(page: number) {
    if (page < 1 || page === get().pagination.page) return
    set(s => ({ pagination: { ...s.pagination, page }, selectedJobIds: new Set() }))
    void loadBatchJobs()
  }

  function handlePageSizeChange(value: string | number | boolean | null) {
    if (value === null || typeof value === 'boolean') return
    const nextSize = Math.min(Math.max(Number(value) || 20, 1), 100)
    set(s => ({ pagination: { ...s.pagination, page_size: nextSize, page: 1 }, selectedJobIds: new Set() }))
    setPersistedPageSize(nextSize)
    void loadBatchJobs()
  }

  // ===== 创建 / 详情 =====

  function openCreateModal() {
    set({ showCreateModal: true })
    if (!get().apiKeys.length) {
      void loadApiKeys()
    }
  }

  function resetCreateDraft() {
    set(s => ({
      form: { ...s.form, taskName: '', responseMimeType: 'image/png' },
      promptRows: [],
      promptDraft: '',
      customIdDraft: '',
      outputCountDraft: 1,
      referenceImageDrafts: [],
    }))
  }

  function closeCreateModal() {
    if (get().submitting) return
    set({ showCreateModal: false })
    resetCreateDraft()
  }

  function closeDetail() {
    closePromptPopover()
    set({ currentJob: null, selectedBatchId: '', selectedBatchApiKeyId: 0, items: [] })
    clearItemPreviews()
  }

  function keyForSelectedBatch(): ApiKey | null {
    const s = get()
    if (s.selectedBatchApiKeyId) {
      const key = geminiApiKeys(s).find(item => item.id === s.selectedBatchApiKeyId)
      if (key) return key
    }
    return selectedApiKey(s)
  }

  function requireApiKey(): ApiKey | null {
    const key = selectedApiKey(get())
    if (!key) {
      appStore().showError(batchImageText('selectApiKey'))
      return null
    }
    return key
  }

  function validateForm(): boolean {
    if (!requireApiKey()) return false
    const s = get()
    if (!s.form.model) {
      appStore().showError(s.availableBatchImageModels.length === 0 ? batchImageText('noModelsForKey') : batchImageText('selectModel'))
      return false
    }
    if (parsedItems(s).length === 0) {
      appStore().showError(batchImageText('promptRequired'))
      return false
    }
    if (estimatedOutputCount(s) > BATCH_IMAGE_MAX_OUTPUTS_PER_JOB) {
      appStore().showError(batchImageText('tooManyOutputImages'))
      return false
    }
    const refLimit = selectedModelReferenceLimit(s)
    if (s.promptRows.some(row => row.reference_images.length > refLimit)) {
      appStore().showError(batchImageText('tooManyReferenceImages'))
      return false
    }
    return true
  }

  async function submitJob() {
    if (get().submitting) return
    if (get().promptDraft.trim()) addPromptRow()
    if (!validateForm()) return
    const key = requireApiKey()
    if (!key) return
    set({ submitting: true })
    try {
      const s = get()
      const job = await submitBatchImageJob(
        key.key,
        {
          model: s.form.model,
          task_name: s.form.taskName.trim() || defaultTaskName(),
          image_size: '1K',
          response_mime_type: s.form.responseMimeType,
          items: parsedItems(s),
        },
        makeIdempotencyKey('sub2api-ui'),
      )
      set({ currentJob: job, selectedBatchId: job.id, selectedBatchApiKeyId: key.id, items: [] })
      upsertJob(job)
      set({ showCreateModal: false })
      resetCreateDraft()
      appStore().showSuccess(batchImageText('submitted'))
      void loadItems()
      startPolling()
    } catch (error: any) {
      appStore().showError(batchImageErrorMessage(error, batchImageText('submitFailed')))
    } finally {
      set({ submitting: false })
    }
  }

  async function refreshSelected() {
    const batchId = get().selectedBatchId
    if (!batchId) return
    const key = keyForSelectedBatch() || requireApiKey()
    if (!key) return
    set({ refreshing: true })
    try {
      const job = await getBatchImageJob(key.key, batchId)
      set({ currentJob: job })
      upsertJob(job)
      if (TERMINAL_STATUSES.has(job.status)) stopPolling()
    } catch (error: any) {
      appStore().showError(batchImageErrorMessage(error, batchImageText('refreshFailed')))
    } finally {
      set({ refreshing: false })
    }
  }

  async function refreshDetail() {
    await Promise.all([
      refreshSelected(),
      loadItems(),
    ])
  }

  function selectJob(batchId: string) {
    const s = get()
    const row = s.batchJobs.find(job => job.id === batchId)
    if (row?.api_key_id && geminiApiKeys(s).some(key => key.id === row.api_key_id)) {
      set(prev => ({ form: { ...prev.form, apiKeyId: row.api_key_id }, selectedBatchApiKeyId: row.api_key_id }))
    } else {
      set({ selectedBatchApiKeyId: 0 })
    }
    set({ selectedBatchId: batchId, currentJob: null, items: [] })
    void refreshSelected()
    void loadItems()
  }

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }

  function startPolling() {
    stopPolling()
    pollTimer.current = setInterval(() => {
      const job = get().currentJob
      if (!job || TERMINAL_STATUSES.has(job.status)) {
        stopPolling()
        return
      }
      void refreshSelected()
    }, 8000)
  }

  function isDownloadingJob(s: BatchState, batchId: string) {
    return s.downloading && s.downloadingBatchId === batchId
  }

  function applyJobApiKey(job: BatchImageJobRow | Pick<BatchImageJob, 'id'>) {
    if ('api_key_id' in job && job.api_key_id && geminiApiKeys(get()).some(key => key.id === job.api_key_id)) {
      updateForm({ apiKeyId: job.api_key_id })
    }
  }

  function apiKeyForJob(job: BatchImageJobRow | Pick<BatchImageJob, 'id'>): ApiKey | null {
    if ('api_key_id' in job && job.api_key_id) {
      return geminiApiKeys(get()).find(key => key.id === job.api_key_id) || null
    }
    return selectedApiKey(get())
  }

  function toggleJobSelection(batchId: string, checked: boolean) {
    const next = new Set(get().selectedJobIds)
    if (checked) next.add(batchId)
    else next.delete(batchId)
    set({ selectedJobIds: next })
  }

  function toggleAllVisible(checked: boolean) {
    const s = get()
    const next = new Set(s.selectedJobIds)
    for (const job of visibleBatchJobs(s)) {
      if (checked) next.add(job.id)
      else next.delete(job.id)
    }
    set({ selectedJobIds: next })
  }

  async function cancelSelected() {
    const current = get().currentJob
    if (!current) return
    const key = keyForSelectedBatch() || requireApiKey()
    if (!key) return
    if (!(await confirm(batchImageText('cancelConfirm'), { danger: true }))) return
    set({ cancelling: true })
    try {
      const job = await cancelBatchImageJob(key.key, current.id)
      set({ currentJob: job })
      upsertJob(job)
      appStore().showSuccess(batchImageText('cancelled'))
    } catch (error: any) {
      appStore().showError(batchImageErrorMessage(error, batchImageText('cancelFailed')))
    } finally {
      set({ cancelling: false })
    }
  }

  async function downloadSelected() {
    const current = get().currentJob
    if (!current) return
    await downloadJob(current)
  }

  async function retrySelected() {
    const current = get().currentJob
    if (!current) return
    await retryFailedJob(current)
  }

  async function ensureItemsForRetry(apiKey: string, batchId: string) {
    const s = get()
    if (s.selectedBatchId === batchId && s.items.length > 0) {
      return s.items
    }
    const result = await listBatchImageItems(apiKey, batchId)
    return result.data || []
  }

  function rootBatchIdForRetry(job: BatchImageJobRow | BatchImageJob) {
    return job.parent_batch_id || job.id
  }

  async function retryFailedJob(job: BatchImageJobRow | BatchImageJob) {
    if (!canRetry(get(), job) || get().retryingBatchId) return
    const key = apiKeyForJob(job) || keyForSelectedBatch() || requireApiKey()
    if (!key) return
    set({ retryingBatchId: job.id })
    try {
      const sourceItems = await ensureItemsForRetry(key.key, job.id)
      const failedItems = sourceItems
        .filter(item => item.status === 'failed')
        .map(item => ({ custom_id: retryCustomID(item.custom_id), prompt: String(item.prompt_preview || '').trim() }))
        .filter(item => item.prompt)
      if (failedItems.length === 0) {
        appStore().showError(batchImageText('retryMissingPrompts'))
        return
      }
      const retryJob = await submitBatchImageJob(
        key.key,
        {
          model: job.model,
          task_name: `${job.task_name || defaultTaskName()} ${t('batchImage.messages.retryTaskNameSuffix')}`,
          parent_batch_id: rootBatchIdForRetry(job),
          provider: job.provider,
          image_size: '1K',
          response_mime_type: get().form.responseMimeType,
          items: failedItems,
        },
        makeIdempotencyKey(`sub2api-ui-retry-${job.id}`),
      )
      set({ currentJob: retryJob, selectedBatchId: retryJob.id, selectedBatchApiKeyId: key.id, items: [] })
      upsertJob(retryJob)
      if (retryJob.parent_batch_id) {
        set(s => ({ expandedParentIds: new Set([...s.expandedParentIds, retryJob.parent_batch_id as string]) }))
      }
      appStore().showSuccess(batchImageText('retrySubmitted'))
      void loadItems()
      startPolling()
    } catch (error: any) {
      appStore().showError(batchImageErrorMessage(error, batchImageText('retryFailed')))
    } finally {
      set({ retryingBatchId: '' })
    }
  }

  function markJobDownloaded(batchId: string) {
    const downloadedAt = Math.floor(Date.now() / 1000)
    set(s => ({
      batchJobs: s.batchJobs.map(job => job.id === batchId ? { ...job, downloaded_at: job.downloaded_at || downloadedAt } : job),
      currentJob: s.currentJob?.id === batchId && !s.currentJob.downloaded_at
        ? { ...s.currentJob, downloaded_at: downloadedAt }
        : s.currentJob,
    }))
  }

  function removeJobFromList(batchId: string) {
    set(s => ({ batchJobs: s.batchJobs.filter(job => job.id !== batchId) }))
    toggleJobSelection(batchId, false)
    if (get().currentJob?.id === batchId) closeDetail()
  }

  async function downloadJob(job: BatchImageJobRow | Pick<BatchImageJob, 'id'>) {
    if (get().downloading) return
    applyJobApiKey(job)
    const key = apiKeyForJob(job) || requireApiKey()
    if (!key) return
    set({ downloading: true, downloadingBatchId: job.id })
    try {
      const blob = await downloadBatchImageZip(key.key, job.id)
      saveBlob(blob, `${job.id}.zip`)
      markJobDownloaded(job.id)
    } catch (error: any) {
      appStore().showError(batchImageErrorMessage(error, batchImageText('downloadFailed')))
    } finally {
      set({ downloading: false, downloadingBatchId: '' })
    }
  }

  async function downloadSelectedJobs() {
    const rows = selectedRows(get()).filter(job => canDownload(job))
    if (get().bulkDownloading || rows.length === 0) return
    set({ bulkDownloading: true })
    try {
      for (const row of rows) {
        const key = apiKeyForJob(row)
        if (!key) continue
        set({ downloading: true, downloadingBatchId: row.id })
        const blob = await downloadBatchImageZip(key.key, row.id)
        saveBlob(blob, `${row.id}.zip`)
        markJobDownloaded(row.id)
      }
      appStore().showSuccess(batchImageText('batchDownloadStarted'))
    } catch (error: any) {
      appStore().showError(batchImageErrorMessage(error, batchImageText('downloadFailed')))
    } finally {
      set({ bulkDownloading: false, downloading: false, downloadingBatchId: '' })
    }
  }

  async function deleteJob(job: BatchImageJobRow) {
    if (!canDeleteRecord(job) || get().deletingBatchId) return
    const key = apiKeyForJob(job)
    if (!key) return
    if (!(await confirm(batchImageText('deleteConfirm'), { danger: true }))) return
    set({ deletingBatchId: job.id })
    try {
      await deleteBatchImageJobRecord(key.key, job.id)
      removeJobFromList(job.id)
      appStore().showSuccess(batchImageText('deleted'))
    } catch (error: any) {
      appStore().showError(batchImageErrorMessage(error, batchImageText('deleteFailed')))
    } finally {
      set({ deletingBatchId: '' })
    }
  }

  async function deleteSelectedJobs() {
    const rows = selectedRows(get()).filter(job => canDeleteRecord(job))
    if (get().bulkDeleting || rows.length === 0) return
    if (!(await confirm(batchImageText('deleteSelectedConfirm'), { danger: true }))) return
    set({ bulkDeleting: true })
    try {
      for (const row of rows) {
        const key = apiKeyForJob(row)
        if (!key) continue
        set({ deletingBatchId: row.id })
        await deleteBatchImageJobRecord(key.key, row.id)
        removeJobFromList(row.id)
      }
      appStore().showSuccess(batchImageText('deleted'))
    } catch (error: any) {
      appStore().showError(batchImageErrorMessage(error, batchImageText('deleteFailed')))
    } finally {
      set({ bulkDeleting: false, deletingBatchId: '' })
    }
  }

  // ===== 明细与预览 =====

  function setPreviewUrl(previewKey: string, url: string | null) {
    set(s => {
      const next = { ...s.itemPreviewUrls }
      if (url) next[previewKey] = url
      else delete next[previewKey]
      return { itemPreviewUrls: next }
    })
  }

  async function hydrateCachedItemPreviews(detailItems: BatchImageDetailItem[]) {
    const previewableItems = detailItems.filter(item => canLoadItemPreview(item))
    if (!previewableItems.length || !previewCacheSupported()) return

    await Promise.all(previewableItems.map(async (item) => {
      const s = get()
      const batchId = item.batch_id || s.selectedBatchId || s.currentJob?.id || ''
      const previewKey = itemPreviewKey(s, item)
      if (!batchId || s.itemPreviewUrls[previewKey] || s.previewErrorIds.has(previewKey)) return
      const cached = await getCachedPreviewBlob(previewCacheKey(batchId, item.custom_id, 0)).catch(() => null)
      if (!cached || get().itemPreviewUrls[previewKey]) return
      setPreviewUrl(previewKey, URL.createObjectURL(cached))
    }))
  }

  function detailJobsForBatch(batchId: string): BatchImageJobRow[] {
    const s = get()
    const row = s.batchJobs.find(job => job.id === batchId)
    const base = row || (s.currentJob && s.currentJob.id === batchId ? toJobRow(s.currentJob, keyForSelectedBatch() || selectedApiKey(s)) : null)
    if (!base) return []
    if (base.parent_batch_id) return [base]
    return [base, ...(childrenByParent(s).get(base.id) || [])]
  }

  function detailSourceName(job: Pick<BatchImageJobRow, 'id' | 'task_name' | 'parent_batch_id'>, rootBatchId: string) {
    const name = job.task_name || job.id
    if (job.id === rootBatchId) return t('batchImage.detail.mainTask', { name })
    return t('batchImage.detail.childTask', { name })
  }

  async function loadItems() {
    const s = get()
    const batchId = s.selectedBatchId || s.currentJob?.id || ''
    if (!batchId) return
    const key = keyForSelectedBatch() || requireApiKey()
    if (!key) return
    set({ loadingItems: true })
    try {
      clearItemPreviews()
      const jobs = detailJobsForBatch(batchId)
      const results = await Promise.all(jobs.map(async (job) => {
        const result = await listBatchImageItems(key.key, job.id)
        return (result.data || []).map(item => ({
          ...item,
          batch_id: job.id,
          source_task_name: detailSourceName(job, batchId),
        }))
      }))
      const detailItems = results.flat()
      set({ items: detailItems })
      void hydrateCachedItemPreviews(detailItems)
    } catch (error: any) {
      appStore().showError(batchImageErrorMessage(error, batchImageText('loadItemsFailed')))
    } finally {
      set({ loadingItems: false })
    }
  }

  async function loadItemPreview(item: BatchImageItem) {
    const s = get()
    const batchId = item.batch_id || s.selectedBatchId || s.currentJob?.id || ''
    const previewKey = itemPreviewKey(s, item)
    if (!batchId || !canLoadItemPreview(item) || (s.itemPreviewUrls[previewKey] && !s.previewErrorIds.has(previewKey))) return
    const key = keyForSelectedBatch() || requireApiKey()
    if (!key) return
    const cacheKey = previewCacheKey(batchId, item.custom_id, 0)
    set(prev => ({ previewLoadingIds: new Set([...prev.previewLoadingIds, previewKey]) }))
    try {
      set(prev => ({ previewErrorIds: new Set([...prev.previewErrorIds].filter(id => id !== previewKey)) }))
      const existing = get().itemPreviewUrls[previewKey]
      if (existing) {
        URL.revokeObjectURL(existing)
        setPreviewUrl(previewKey, null)
      }
      const cached = await getCachedPreviewBlob(cacheKey)
      if (cached) {
        setPreviewUrl(previewKey, URL.createObjectURL(cached))
        return
      }
      const blob = await getBatchImageItemContent(key.key, batchId, item.custom_id, 0)
      const thumbnail = await createThumbnailBlob(blob).catch(() => blob)
      setPreviewUrl(previewKey, URL.createObjectURL(thumbnail))
      if (thumbnail !== blob || thumbnail.size <= 1024 * 1024) {
        void putCachedPreviewBlob(cacheKey, thumbnail)
      }
    } catch (error: any) {
      set(prev => ({ previewErrorIds: new Set([...prev.previewErrorIds, previewKey]) }))
      appStore().showError(batchImageErrorMessage(error, batchImageText('loadPreviewFailed')))
    } finally {
      set(prev => {
        const next = new Set(prev.previewLoadingIds)
        next.delete(previewKey)
        return { previewLoadingIds: next }
      })
    }
  }

  function openImagePreview(item: BatchImageItem) {
    const s = get()
    const previewKey = itemPreviewKey(s, item)
    if (!s.itemPreviewUrls[previewKey] || s.previewErrorIds.has(previewKey)) return
    set({ previewImageItem: item })
  }

  function handlePreviewError(previewKey: string) {
    const url = get().itemPreviewUrls[previewKey]
    if (url) {
      URL.revokeObjectURL(url)
      setPreviewUrl(previewKey, null)
    }
    set(s => ({ previewErrorIds: new Set([...s.previewErrorIds, previewKey]) }))
  }

  function clearItemPreviews() {
    closePromptPopover()
    for (const url of Object.values(get().itemPreviewUrls)) {
      if (url) URL.revokeObjectURL(url)
    }
    set({ itemPreviewUrls: {}, previewLoadingIds: new Set(), previewErrorIds: new Set(), previewImageItem: null })
  }

  function copyInstruction() {
    void copyToClipboard(agentInstruction, batchImageText('copiedInstruction'))
  }

  // ===== Prompt 悬浮卡片 =====

  function cancelPromptPopoverClose() {
    if (!promptPopoverCloseTimer.current) return
    clearTimeout(promptPopoverCloseTimer.current)
    promptPopoverCloseTimer.current = null
  }

  function cancelPromptPopoverOpen() {
    if (!promptPopoverOpenTimer.current) return
    clearTimeout(promptPopoverOpenTimer.current)
    promptPopoverOpenTimer.current = null
  }

  function closePromptPopover() {
    cancelPromptPopoverOpen()
    cancelPromptPopoverClose()
    if (get().promptPopover.visible || get().promptPopover.text) {
      set({ promptPopover: { visible: false, text: '', style: {} } })
    }
    activePromptPopoverTarget.current = null
  }

  function schedulePromptPopoverClose() {
    cancelPromptPopoverOpen()
    cancelPromptPopoverClose()
    promptPopoverCloseTimer.current = setTimeout(() => {
      closePromptPopover()
    }, 180)
  }

  function openPromptPopover(target: HTMLElement, value: string) {
    const rect = target.getBoundingClientRect()
    if (!rect) return
    const viewportWidth = window.innerWidth || 1280
    const viewportHeight = window.innerHeight || 720
    const width = Math.min(440, Math.max(320, viewportWidth - 32))
    const left = Math.max(16, Math.min(rect.left, viewportWidth - width - 16))
    const estimatedHeight = 178
    const preferredTop = rect.bottom + 8
    const top = preferredTop + estimatedHeight > viewportHeight
      ? Math.max(16, rect.top - estimatedHeight - 8)
      : preferredTop
    set({ promptPopover: { visible: true, text: value, style: { left: `${left}px`, top: `${top}px`, width: `${width}px` } } })
  }

  function schedulePromptPopoverOpen(event: SyntheticEvent<HTMLElement>, text: string) {
    const target = event.currentTarget
    if (!target) return
    const value = String(text || '').trim()
    if (!value || value === '-') return
    activePromptPopoverTarget.current = target
    cancelPromptPopoverOpen()
    cancelPromptPopoverClose()
    promptPopoverOpenTimer.current = setTimeout(() => {
      if (activePromptPopoverTarget.current !== target || !document.body.contains(target)) return
      openPromptPopover(target, value)
    }, 520)
  }

  function showPromptPopover(event: SyntheticEvent<HTMLElement>, text: string) {
    const value = String(text || '').trim()
    if (!value || value === '-') return
    const target = event.currentTarget
    cancelPromptPopoverClose()
    cancelPromptPopoverOpen()
    if (!target) return
    activePromptPopoverTarget.current = target
    openPromptPopover(target, value)
  }

  function copyPromptPopover() {
    const text = get().promptPopover.text
    if (!text) return
    void copyToClipboard(text, t('batchImage.promptPopover.copied'))
  }

  // ===== 生命周期与监听（对应 Vue 版 onMounted / watch / onBeforeUnmount） =====

  useEffect(() => {
    void useAppStore.getState().fetchPublicSettings()
    void refreshPage()
    void cleanupPreviewCache()
    const previewCacheCleanupTimer = setInterval(() => {
      void cleanupPreviewCache()
    }, 60 * 60 * 1000)
    window.addEventListener('resize', closePromptPopover)
    window.addEventListener('scroll', closePromptPopover, true)
    return () => {
      stopPolling()
      clearInterval(previewCacheCleanupTimer)
      clearItemPreviews()
      window.removeEventListener('resize', closePromptPopover)
      window.removeEventListener('scroll', closePromptPopover, true)
    }
    // 仅在挂载/卸载时执行；处理函数通过 store.getState() 读取最新状态
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const formApiKeyId = st.form.apiKeyId
  const formModel = st.form.model
  const lastApiKeyId = useRef(formApiKeyId)
  useEffect(() => {
    if (lastApiKeyId.current === formApiKeyId) return
    lastApiKeyId.current = formApiKeyId
    void loadAvailableModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formApiKeyId])

  useEffect(() => {
    const limit = referenceImageLimitForModel(formModel)
    const drafts = store.getState().referenceImageDrafts
    if (limit <= 0) {
      if (drafts.length) store.setState({ referenceImageDrafts: [] })
      return
    }
    if (drafts.length > limit) {
      store.setState({ referenceImageDrafts: drafts.slice(0, limit) })
    }
  }, [formModel, store])

  // ===== 渲染 =====

  const keys = geminiApiKeys(st)
  const visibleRows = visibleBatchJobs(st)
  const downloadableSelected = selectedRows(st).filter(job => canDownload(job))
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every(job => st.selectedJobIds.has(job.id))
  const someVisibleSelected = visibleRows.some(job => st.selectedJobIds.has(job.id)) && !allVisibleSelected
  const currentSelectedKey = selectedApiKey(st)
  const referenceLimit = selectedModelReferenceLimit(st)
  const recovered = recoveredOriginalCustomIds(st)
  const currentDisplayJob = st.currentJob ? displayJob(st, st.currentJob) : null
  const previewImageUrl = st.previewImageItem ? st.itemPreviewUrls[itemPreviewKey(st, st.previewImageItem)] || '' : ''
  const loadingTable = st.loadingKeys || st.loadingJobs

  const columns: Column<BatchImageJobRow>[] = [
    { key: 'select', label: '', sortable: false, align: 'center', width: 48 },
    { key: 'id', label: t('batchImage.columns.taskName'), sortable: false, width: 240 },
    { key: 'model', label: t('batchImage.columns.model'), sortable: false, align: 'center', width: 180 },
    { key: 'api_key_name', label: t('batchImage.columns.apiKey'), sortable: false, align: 'center', width: 160 },
    { key: 'status', label: t('common.status'), sortable: false, align: 'center', width: 112 },
    { key: 'counts', label: t('batchImage.columns.result'), sortable: false, align: 'center', width: 128 },
    { key: 'cost', label: t('batchImage.columns.cost'), sortable: false, align: 'center', width: 144 },
    { key: 'downloaded', label: t('batchImage.columns.downloadStatus'), sortable: false, align: 'center', width: 160 },
    { key: 'actions', label: t('common.actions'), sortable: false, align: 'center', width: 200 },
  ]

  const statusFilterOptions: SelectOption[] = [
    { value: '', label: t('batchImage.filters.allStatuses') },
    { value: 'queued', label: t('batchImage.status.queued') },
    { value: 'running', label: t('batchImage.status.running') },
    { value: 'processing_results', label: t('batchImage.status.processingResults') },
    { value: 'settling', label: t('batchImage.status.settling') },
    { value: 'completed', label: t('batchImage.status.completed') },
    { value: 'failed', label: t('batchImage.status.failed') },
    { value: 'cancelled', label: t('batchImage.status.cancelled') },
    { value: 'output_deleted', label: t('batchImage.status.outputDeleted') },
  ]

  const downloadFilterOptions: SelectOption[] = [
    { value: '', label: t('batchImage.filters.allDownloadStates') },
    { value: 'true', label: t('batchImage.filters.downloaded') },
    { value: 'false', label: t('batchImage.filters.notDownloaded') },
  ]

  const apiKeyFilterOptions: SelectOption[] = [
    { value: '', label: t('batchImage.filters.allApiKeys') },
    ...keys.map(key => ({
      value: String(key.id),
      label: key.name || `API Key #${key.id}`,
    })),
  ]

  const spin = (active: boolean) => (active ? styles.spinning : undefined)

  const counts = (job: Pick<BatchImageJob, 'success_count' | 'fail_count'>, extra?: ReactNode) => (
    <span className={styles.counts}>
      <span className={styles.success}>{job.success_count}</span>
      <span className={styles.separator}>/</span>
      <span className={job.fail_count > 0 ? styles.failed : styles.mutedCount}>{job.fail_count}</span>
      {extra}
    </span>
  )

  const headers = {
    select: () => (
      <Checkbox
        aria-label={t('common.selectAll')}
        checked={someVisibleSelected ? 'indeterminate' : allVisibleSelected}
        onCheckedChange={(checked) => toggleAllVisible(checked === true)}
      />
    ),
  }

  const cells: Record<string, (context: DataTableCellContext<BatchImageJobRow>) => ReactNode> = {
    select: ({ row }) => (
      <Checkbox
        aria-label={row.task_name || row.id}
        checked={st.selectedJobIds.has(row.id)}
        onClick={(event) => event.stopPropagation()}
        onCheckedChange={(checked) => toggleJobSelection(row.id, checked === true)}
      />
    ),
    id: ({ row }) => {
      const expanded = st.expandedParentIds.has(row.id)
      return (
        <div className={styles.taskCell} data-child={row.is_child || undefined}>
          {row.child_count > 0 && !row.is_child ? (
            <button
              type="button"
              className={styles.expandButton}
              title={expanded ? t('batchImage.list.collapseChildren') : t('batchImage.list.expandChildren', { n: row.child_count }, row.child_count)}
              aria-expanded={expanded}
              onClick={(event) => {
                event.stopPropagation()
                toggleChildRows(row.id)
              }}
            >
              {expanded ? <ChevronDown size={14} strokeWidth={2} aria-hidden="true" /> : <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />}
            </button>
          ) : (
            <span className={styles.expandSpacer} />
          )}
          <button type="button" className={styles.taskButton} onClick={() => selectJob(row.id)}>
            <span className={styles.taskName} data-placeholder={!row.task_name || undefined}>
              <span className={styles.truncate}>{row.task_name || defaultTaskName(row.created_at)}</span>
              {row.child_count > 0 && !row.is_child && (
                <Badge size="sm">{t('batchImage.list.childCount', { n: row.child_count }, row.child_count)}</Badge>
              )}
              {row.is_child && <Badge size="sm" tone="warning">{t('batchImage.list.childBadge')}</Badge>}
            </span>
            <span className={styles.taskMeta}>{formatDate(row.created_at)}</span>
          </button>
        </div>
      )
    },
    model: ({ row }) => (
      <p className={styles.modelCell} title={row.model}>{row.model}</p>
    ),
    api_key_name: ({ value }) => (
      <span className={styles.keyCell}>{value || t('batchImage.list.keyNotRecorded')}</span>
    ),
    status: ({ row }) => {
      const display = displayJob(st, row)
      return <Badge tone={statusTone(display)}>{statusLabel(display)}</Badge>
    },
    counts: ({ row }) => {
      const display = displayJob(st, row)
      return counts(display, <span className={styles.total}>{t('batchImage.list.totalCount', { n: display.item_count })}</span>)
    },
    cost: ({ row }) => <span className={styles.cellText}>{costLabel(displayJob(st, row))}</span>,
    downloaded: ({ row }) => (
      <span className={row.downloaded_at ? styles.downloaded : styles.cellMuted}>
        {row.downloaded_at ? formatDate(row.downloaded_at) : t('batchImage.list.notDownloaded')}
      </span>
    ),
    actions: ({ row }) => {
      const moreItems: DropdownItem[] = []
      if (canRetry(st, row)) {
        moreItems.push({
          label: t('batchImage.actions.retryFailedItems'),
          icon: <RefreshCw {...ICON_SM} className={spin(st.retryingBatchId === row.id)} />,
          disabled: st.retryingBatchId === row.id,
          onSelect: () => void retryFailedJob(row),
        })
      }
      if (canDeleteRecord(row)) {
        moreItems.push({
          label: t('batchImage.actions.deleteRecords'),
          icon: st.deletingBatchId === row.id ? <RefreshCw {...ICON_SM} className={styles.spinning} /> : <Trash2 {...ICON_SM} />,
          disabled: st.deletingBatchId === row.id,
          destructive: true,
          onSelect: () => void deleteJob(row),
        })
      }
      return (
        <div className={styles.rowActions}>
          <Button type="button" variant="ghost" size="sm" title={t('batchImage.actions.viewDetail')} onClick={() => selectJob(row.id)}>
            <Eye {...ICON_SM} />
            {t('common.view')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title={t('batchImage.actions.downloadZip')}
            disabled={!canDownload(row) || st.downloading}
            onClick={() => void downloadJob(row)}
          >
            {isDownloadingJob(st, row.id) ? <RefreshCw {...ICON_SM} className={styles.spinning} /> : <Download {...ICON_SM} />}
            {t('batchImage.actions.download')}
          </Button>
          {moreItems.length > 0 && (
            <DropdownMenu label={t('common.more')} icon={<MoreHorizontal {...ICON_SM} />} items={moreItems} />
          )}
        </div>
      )
    },
  }

  const filtersBar = (
    <div className={styles.toolbar}>
      <div className={styles.filters}>
        <div className={styles.searchFilter}>
          <SearchInput
            value={st.filters.taskName}
            placeholder={t('batchImage.filters.searchTaskName')}
            onChange={(value) => updateFilter({ taskName: value })}
            onSearch={applyFilters}
          />
        </div>
        <div className={styles.filter}>
          <Select
            value={st.filters.apiKeyId}
            options={apiKeyFilterOptions}
            aria-label={t('batchImage.columns.apiKey')}
            onChange={(value) => {
              updateFilter({ apiKeyId: String(value ?? '') })
              applyFilters()
            }}
          />
        </div>
        <div className={styles.filter}>
          <Select
            value={st.filters.status}
            options={statusFilterOptions}
            aria-label={t('common.status')}
            onChange={(value) => {
              updateFilter({ status: String(value ?? '') })
              applyFilters()
            }}
          />
        </div>
        <div className={styles.filter}>
          <Select
            value={st.filters.downloaded}
            options={downloadFilterOptions}
            aria-label={t('batchImage.columns.downloadStatus')}
            onChange={(value) => {
              updateFilter({ downloaded: String(value ?? '') })
              applyFilters()
            }}
          />
        </div>
      </div>
      <div className={styles.toolbarActions}>
        <Button type="button" variant="secondary" disabled={st.loadingJobs} onClick={resetFilters}>
          {t('common.reset')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={loadingTable}
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
          onClick={() => void refreshPage()}
        >
          <RefreshCw {...ICON_SM} className={spin(loadingTable)} />
        </Button>
        <Button type="button" variant="secondary" onClick={() => set({ showGuideModal: true })}>
          <BookOpen {...ICON_SM} />
          {t('batchImage.actions.usageGuide')}
        </Button>
        <Button type="button" variant="primary" onClick={openCreateModal}>
          <Plus {...ICON_SM} />
          {t('batchImage.actions.createJob')}
        </Button>
      </div>
    </div>
  )

  const table = (
    <div className={styles.region}>
      {st.selectedJobIds.size > 0 && (
        <div className={styles.selectionBar} role="toolbar">
          <span className={styles.selectionCount} aria-live="polite">
            <I18nT
              keypath="batchImage.list.selectedJobs"
              plural={st.selectedJobIds.size}
              slots={{ count: <span className={styles.selectionNumber}>{st.selectedJobIds.size}</span> }}
            />
          </span>
          <div className={styles.selectionActions}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={st.bulkDownloading || downloadableSelected.length === 0}
              onClick={() => void downloadSelectedJobs()}
            >
              {st.bulkDownloading ? <RefreshCw {...ICON_SM} className={styles.spinning} /> : <Download {...ICON_SM} />}
              {t('batchImage.actions.downloadSelected')}
            </Button>
            <Button type="button" variant="danger" size="sm" disabled={st.bulkDeleting} onClick={() => void deleteSelectedJobs()}>
              {st.bulkDeleting ? <RefreshCw {...ICON_SM} className={styles.spinning} /> : <Trash2 {...ICON_SM} />}
              {t('batchImage.actions.deleteRecords')}
            </Button>
          </div>
        </div>
      )}
      <DataTable<BatchImageJobRow>
        columns={columns}
        data={visibleRows}
        loading={loadingTable}
        rowKey="id"
        headers={headers}
        cells={cells}
        className={styles.dataTable}
        empty={
          <div className={styles.empty}>
            <Sparkles size={40} strokeWidth={1.5} aria-hidden="true" className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>{t('batchImage.list.empty')}</p>
            <p className={styles.emptyText}>{t('batchImage.list.emptyHint')}</p>
          </div>
        }
      />
    </div>
  )

  const footer =
    visibleRows.length > 0 || st.pagination.page > 1 ? (
      <div className={styles.footer}>
        <div className={styles.footerInfo}>
          <span>
            <I18nT
              keypath="batchImage.pagination.pageNumber"
              slots={{ page: <span className={styles.strong}>{st.pagination.page}</span> }}
            />
          </span>
          <span>
            <I18nT
              keypath="batchImage.pagination.pageItems"
              slots={{ count: <span className={styles.strong}>{visibleRows.length}</span> }}
            />
          </span>
          <div className={styles.pageSize}>
            <span>{t('pagination.perPage')}</span>
            <div className={styles.pageSizeSelect}>
              <Select
                value={st.pagination.page_size}
                options={batchPageSizeOptions}
                aria-label={t('pagination.perPage')}
                onChange={handlePageSizeChange}
              />
            </div>
          </div>
        </div>
        <div className={styles.footerNav}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={st.pagination.page <= 1 || st.loadingJobs}
            onClick={() => handlePageChange(st.pagination.page - 1)}
          >
            <ChevronLeft {...ICON_SM} />
            {t('pagination.previous')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!st.pagination.has_more || st.loadingJobs}
            onClick={() => handlePageChange(st.pagination.page + 1)}
          >
            {t('pagination.next')}
            <ChevronRight {...ICON_SM} />
          </Button>
        </div>
      </div>
    ) : null

  const currentJob = st.currentJob
  const summaryJob = currentDisplayJob || currentJob

  return (
    <>
      <TablePageLayout filters={filtersBar} table={table} pagination={footer} />

      {st.promptPopover.visible && createPortal(
        <div
          className={styles.promptPopover}
          style={st.promptPopover.style}
          onMouseEnter={cancelPromptPopoverClose}
          onMouseLeave={schedulePromptPopoverClose}
        >
          <div className={styles.promptPopoverHeader}>
            <span className={styles.promptPopoverTitle}>{t('batchImage.promptPopover.title')}</span>
            <button type="button" className={styles.linkButton} onClick={copyPromptPopover}>
              {t('common.copy')}
            </button>
          </div>
          <p className={styles.promptPopoverText}>{st.promptPopover.text}</p>
        </div>,
        document.body
      )}

      {/* 任务详情 */}
      <BaseDialog
        show={!!currentJob}
        title={t('batchImage.detail.title')}
        width="extra-wide"
        onClose={closeDetail}
        footer={
          <div className={styles.dialogFooter}>
            <Button
              type="button"
              variant="secondary"
              disabled={!currentJob || !canCancel(currentJob) || st.cancelling}
              onClick={() => void cancelSelected()}
            >
              {st.cancelling && <RefreshCw {...ICON_SM} className={styles.spinning} />}
              {t('batchImage.actions.cancelJob')}
            </Button>
            {currentJob && currentDisplayJob && canRetry(st, currentDisplayJob) && (
              <Button
                type="button"
                variant="secondary"
                disabled={st.retryingBatchId === currentJob.id}
                onClick={() => void retrySelected()}
              >
                <RefreshCw {...ICON_SM} className={spin(st.retryingBatchId === currentJob.id)} />
                {t('batchImage.actions.retryFailedItems')}
              </Button>
            )}
            <Button
              type="button"
              variant="primary"
              disabled={!currentJob || !canDownload(currentJob) || st.downloading}
              onClick={() => void downloadSelected()}
            >
              {currentJob && isDownloadingJob(st, currentJob.id) ? <RefreshCw {...ICON_SM} className={styles.spinning} /> : <Download {...ICON_SM} />}
              {t('batchImage.actions.downloadZip')}
            </Button>
          </div>
        }
      >
        {currentJob && summaryJob && (
          <div className={styles.detail}>
            <div className={styles.summary}>
              <div className={styles.summaryItem}>
                <p className={styles.summaryLabel}>{t('common.status')}</p>
                <div className={styles.summaryValue}>
                  <Badge tone={statusTone(summaryJob)}>{statusLabel(summaryJob)}</Badge>
                </div>
              </div>
              <div className={styles.summaryItem}>
                <p className={styles.summaryLabel}>
                  {hasChildJobs(st, currentJob.id) ? t('batchImage.detail.aggregatedResult') : t('batchImage.detail.result')}
                </p>
                <div className={styles.summaryValue}>{counts(summaryJob)}</div>
              </div>
              <div className={styles.summaryItem}>
                <p className={styles.summaryLabel}>{t('batchImage.detail.cost')}</p>
                <p className={styles.summaryText}>{costLabel(summaryJob)}</p>
              </div>
              <div className={styles.summaryItem}>
                <p className={styles.summaryLabel}>{t('batchImage.detail.downloadStatus')}</p>
                <p className={styles.summaryText}>
                  {currentJob.downloaded_at ? formatDate(currentJob.downloaded_at) : t('batchImage.list.notDownloaded')}
                </p>
              </div>
            </div>

            <div className={styles.itemsHeader}>
              <h3 className={styles.sectionTitle}>{t('batchImage.detail.items')}</h3>
              <Button type="button" variant="secondary" size="sm" disabled={st.refreshing || st.loadingItems} onClick={() => void refreshDetail()}>
                <RefreshCw {...ICON_SM} className={spin(st.refreshing || st.loadingItems)} />
                {t('common.refresh')}
              </Button>
            </div>

            {st.items.length ? (
              <div className={styles.itemsTableWrap}>
                <table className={styles.itemsTable}>
                  <colgroup>
                    <col style={{ width: '18%' }} />
                    <col style={{ width: '34%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '26%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className={styles.center}>Custom ID</th>
                      <th>Prompt</th>
                      <th className={styles.center}>{t('common.status')}</th>
                      <th className={styles.center}>{t('batchImage.detail.preview')}</th>
                      <th className={styles.center}>{t('batchImage.detail.result')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {st.items.map((item) => {
                      const previewKey = itemPreviewKey(st, item)
                      const recoveredFailure = isRecoveredOriginalFailure(st, item, recovered)
                      const previewUrl = st.itemPreviewUrls[previewKey]
                      const previewError = st.previewErrorIds.has(previewKey)
                      const previewLoading = st.previewLoadingIds.has(previewKey)
                      const promptText = item.prompt_preview || '-'
                      let resultLabel: string
                      let resultTone: 'muted' | 'danger' | 'success' | 'neutral'
                      if (recoveredFailure) {
                        resultLabel = t('batchImage.itemResult.recoveredByRetry')
                      } else if (item.error) {
                        resultLabel = friendlyItemError(item.error)
                      } else if (item.status === 'succeeded' || item.status === 'success') {
                        resultLabel = previewUrl ? t('batchImage.itemResult.readyPreview') : t('batchImage.itemResult.readyDownload')
                      } else if (item.status === 'failed') {
                        resultLabel = t('batchImage.itemResult.noUsableImage')
                      } else if (item.status === 'cancelled') {
                        resultLabel = t('batchImage.itemResult.cancelled')
                      } else {
                        resultLabel = t('batchImage.itemResult.waiting')
                      }
                      if (recoveredFailure) resultTone = 'muted'
                      else if (item.error || item.status === 'failed' || item.status === 'cancelled') resultTone = 'danger'
                      else if (item.status === 'succeeded' || item.status === 'success') resultTone = 'success'
                      else resultTone = 'neutral'
                      const statusText = recoveredFailure ? t('batchImage.itemStatus.recovered') : itemStatusLabel(item.status)

                      return (
                        <tr key={previewKey} className={styles.itemRow} data-recovered={recoveredFailure || undefined}>
                          <td className={styles.center}>
                            <span className={styles.customId} title={item.custom_id}>{item.custom_id}</span>
                          </td>
                          <td>
                            <div
                              className={styles.promptTrigger}
                              tabIndex={0}
                              onPointerEnter={(event) => schedulePromptPopoverOpen(event, promptText)}
                              onPointerLeave={schedulePromptPopoverClose}
                              onMouseEnter={(event) => schedulePromptPopoverOpen(event, promptText)}
                              onMouseLeave={schedulePromptPopoverClose}
                              onClick={(event) => showPromptPopover(event, promptText)}
                              onFocus={(event) => showPromptPopover(event, promptText)}
                              onBlur={schedulePromptPopoverClose}
                            >
                              {promptText}
                            </div>
                          </td>
                          <td className={styles.center}>
                            <Badge tone={recoveredFailure ? 'neutral' : itemStatusTone(item.status)} title={statusText}>
                              {statusText}
                            </Badge>
                          </td>
                          <td className={styles.center}>
                            <div className={styles.previewBox}>
                              {previewUrl && !previewError ? (
                                <button
                                  type="button"
                                  className={styles.previewButton}
                                  title={t('batchImage.detail.previewZoom', { id: item.custom_id })}
                                  onClick={() => openImagePreview(item)}
                                >
                                  <img src={previewUrl} alt="" onError={() => handlePreviewError(previewKey)} />
                                </button>
                              ) : canLoadItemPreview(item) ? (
                                <button
                                  type="button"
                                  className={styles.previewLoad}
                                  disabled={previewLoading}
                                  title={previewError ? t('batchImage.detail.previewReload') : t('batchImage.detail.previewLoad')}
                                  aria-label={previewError ? t('batchImage.detail.previewReload') : t('batchImage.detail.previewLoad')}
                                  onClick={() => void loadItemPreview(item)}
                                >
                                  {previewLoading ? <RefreshCw {...ICON_SM} className={styles.spinning} /> : <Eye {...ICON_SM} />}
                                </button>
                              ) : (
                                <div
                                  className={styles.previewNone}
                                  title={item.image_count > 0 ? t('batchImage.detail.previewUnavailable') : t('batchImage.detail.noImage')}
                                >
                                  <FileText {...ICON_SM} />
                                </div>
                              )}
                            </div>
                          </td>
                          <td className={styles.center}>
                            <span className={styles.result} data-tone={resultTone} title={resultLabel}>
                              {resultLabel}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.itemsEmpty}>
                <RefreshCw size={22} strokeWidth={1.75} aria-hidden="true" className={[styles.itemsEmptyIcon, spin(st.loadingItems)].filter(Boolean).join(' ')} />
                <p className={styles.itemsEmptyTitle}>
                  {st.loadingItems ? t('batchImage.detail.loadingItems') : t('batchImage.detail.noItems')}
                </p>
                {!st.loadingItems && <p className={styles.itemsEmptyText}>{t('batchImage.detail.noItemsHint')}</p>}
              </div>
            )}
          </div>
        )}
      </BaseDialog>

      {/* 图片预览 */}
      <BaseDialog
        show={!!st.previewImageItem}
        title={st.previewImageItem?.custom_id || t('batchImage.imagePreview.title')}
        width="extra-wide"
        zIndex={60}
        onClose={() => set({ previewImageItem: null })}
      >
        <div className={styles.detail}>
          <Alert tone="warning" title={t('batchImage.imagePreview.notice')} />
          <div className={styles.previewStage}>
            {previewImageUrl && (
              <img src={previewImageUrl} className={styles.previewImage} alt={st.previewImageItem?.custom_id || ''} />
            )}
          </div>
        </div>
      </BaseDialog>

      {/* 创建任务 */}
      <BaseDialog
        show={st.showCreateModal}
        title={t('batchImage.create.title')}
        width="wide"
        onClose={closeCreateModal}
        footer={
          <div className={styles.dialogFooter}>
            <Button type="button" variant="secondary" disabled={st.submitting} onClick={closeCreateModal}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={st.submitting}
              disabled={st.submitting || st.loadingModels || (parsedItems(st).length === 0 && !st.promptDraft.trim()) || !currentSelectedKey || !st.form.model}
              onClick={() => void submitJob()}
            >
              {st.submitting ? t('common.submitting') : t('batchImage.actions.submitJob')}
            </Button>
          </div>
        }
      >
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault()
            void submitJob()
          }}
        >
          <div className={styles.formGrid}>
            <div className={styles.fullWidth}>
              <Input
                label={t('batchImage.create.taskName')}
                value={st.form.taskName}
                maxLength={255}
                placeholder={t('batchImage.create.taskNamePlaceholder')}
                onChange={(value) => updateForm({ taskName: value })}
              />
            </div>

            <div className={styles.fullWidth}>
              <label className={styles.fieldLabel} htmlFor="batch-image-api-key">API Key</label>
              <Select
                id="batch-image-api-key"
                value={st.form.apiKeyId}
                disabled={st.loadingKeys}
                options={[
                  { value: 0, label: st.loadingKeys ? t('batchImage.create.loadingKeys') : t('batchImage.create.selectKeyPlaceholder') },
                  ...keys.map(key => ({ value: key.id, label: `${key.name} · ${key.group?.name || 'Gemini'}` })),
                ]}
                onChange={(value) => updateForm({ apiKeyId: Number(value) || 0 })}
              />
              {!st.loadingKeys && keys.length === 0 && (
                <p className={styles.warningHint}>{t('batchImage.create.noKeysHint')}</p>
              )}
            </div>

            <div>
              <label className={styles.fieldLabel} htmlFor="batch-image-model">{t('batchImage.create.model')}</label>
              <Select
                id="batch-image-model"
                value={st.form.model}
                disabled={st.loadingModels || st.availableBatchImageModels.length === 0}
                placeholder={st.loadingModels ? batchImageText('loadingModels') : batchImageText('noModels')}
                options={st.availableBatchImageModels}
                onChange={(value) => updateForm({ model: String(value ?? '') })}
              />
              {st.modelLoadError ? (
                <p className={styles.warningHint}>{st.modelLoadError}</p>
              ) : currentSelectedKey && !st.loadingModels && st.availableBatchImageModels.length === 0 ? (
                <p className={styles.warningHint}>{batchImageText('noModelsHint')}</p>
              ) : null}
            </div>

            <div>
              <span className={styles.fieldLabel}>{t('batchImage.create.imageSize')}</span>
              <div className={styles.readonlyField}>1K</div>
              <p className={styles.hint}>{t('batchImage.create.imageSizeHint')}</p>
            </div>

            <div>
              <label className={styles.fieldLabel} htmlFor="batch-image-format">{t('batchImage.create.outputFormat')}</label>
              <Select
                id="batch-image-format"
                value={st.form.responseMimeType}
                options={[
                  { value: 'image/png', label: 'PNG' },
                  { value: 'image/jpeg', label: 'JPEG' },
                  { value: 'image/webp', label: 'WebP' },
                ]}
                onChange={(value) => updateForm({ responseMimeType: String(value ?? 'image/png') })}
              />
            </div>

            <div>
              <span className={styles.fieldLabel}>{t('batchImage.create.estimatedOutput')}</span>
              <div className={styles.readonlyField}>
                {t('batchImage.create.estimatedOutputValue', { images: estimatedOutputCount(st), prompts: st.promptRows.length })}
              </div>
            </div>
          </div>

          <div className={styles.promptSection}>
            <div className={styles.promptSectionHeader}>
              <span className={styles.fieldLabel}>Prompt</span>
              <span className={styles.hint}>{t('batchImage.create.promptAdded', { count: st.promptRows.length })}</span>
            </div>
            <div className={styles.promptComposer}>
              <TextArea
                value={st.promptDraft}
                rows={3}
                aria-label="Prompt"
                placeholder={t('batchImage.create.promptPlaceholder')}
                onChange={(value) => set({ promptDraft: value })}
              />
              <div className={styles.composerRow}>
                <Input
                  value={st.customIdDraft}
                  maxLength={255}
                  aria-label={t('batchImage.create.customIdPlaceholder')}
                  placeholder={t('batchImage.create.customIdPlaceholder')}
                  onChange={(value) => set({ customIdDraft: value })}
                />
                <Select
                  value={st.outputCountDraft}
                  aria-label={t('batchImage.create.outputCountPerPrompt')}
                  options={outputCountOptions.map(count => ({ value: count, label: t('batchImage.create.outputCountOption', { n: count }, count) }))}
                  onChange={(value) => set({ outputCountDraft: Number(value) || 1 })}
                />
                <label
                  className={[buttonStyles.button, buttonStyles.secondary, buttonStyles.md, styles.uploadLabel].join(' ')}
                  data-disabled={st.referenceImageDrafts.length >= referenceLimit || undefined}
                >
                  <Upload {...ICON_SM} />
                  {t('batchImage.create.referenceImage')}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    className={styles.hiddenInput}
                    disabled={st.referenceImageDrafts.length >= referenceLimit}
                    onChange={(event) => void handleReferenceImageFiles(event)}
                  />
                </label>
                <Button type="button" variant="secondary" disabled={!st.promptDraft.trim()} onClick={addPromptRow}>
                  <Plus {...ICON_SM} />
                  {t('common.add')}
                </Button>
              </div>
              {st.referenceImageDrafts.length > 0 && (
                <div className={styles.refChips}>
                  {st.referenceImageDrafts.map((ref, refIndex) => (
                    <span key={`${ref.name}-${refIndex}`} className={styles.refChip}>
                      <span className={styles.refName}>{ref.name}</span>
                      <button
                        type="button"
                        className={styles.refRemove}
                        title={t('batchImage.create.removeReferenceImage')}
                        aria-label={t('batchImage.create.removeReferenceImage')}
                        onClick={() => removeReferenceImageDraft(refIndex)}
                      >
                        <X size={12} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <p className={styles.hint}>
                {t('batchImage.create.limitsHint', { maxPerItem: BATCH_IMAGE_MAX_OUTPUTS_PER_ITEM, maxPerJob: BATCH_IMAGE_MAX_OUTPUTS_PER_JOB, refLimit: referenceLimit })}
              </p>
            </div>
            {st.promptRows.length ? (
              <div className={styles.promptList}>
                {st.promptRows.map((row, index) => (
                  <div key={row.localId} className={styles.promptRow}>
                    <span className={styles.promptRowId}>{row.custom_id}</span>
                    <p className={styles.promptRowText}>{row.prompt}</p>
                    {row.output_count > 1 && <span className={styles.hint}>x{row.output_count}</span>}
                    {row.reference_images.length > 0 && (
                      <span className={styles.hint}>
                        {t('batchImage.create.referenceCount', { n: row.reference_images.length }, row.reference_images.length)}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      title={t('common.delete')}
                      aria-label={t('common.delete')}
                      className={styles.dangerIcon}
                      onClick={() => removePromptRow(index)}
                    >
                      <Trash2 {...ICON_SM} />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.promptEmpty}>{t('batchImage.create.noPrompts')}</div>
            )}
          </div>

          <Alert tone="warning" title={t('batchImage.create.cancelNotice')} />
          {st.submitting && <Alert tone="info" title={t('batchImage.create.submittingNotice')} />}
        </form>
      </BaseDialog>

      {/* 使用说明 */}
      <BaseDialog
        show={st.showGuideModal}
        title={t('batchImage.guide.title')}
        width="wide"
        onClose={() => set({ showGuideModal: false })}
        footer={
          <div className={styles.dialogFooter}>
            <Button type="button" variant="secondary" onClick={() => set({ showGuideModal: false })}>
              {t('common.close')}
            </Button>
            <Button type="button" variant="primary" onClick={copyInstruction}>
              <Copy {...ICON_SM} />
              {t('batchImage.actions.copyInstruction')}
            </Button>
          </div>
        }
      >
        <div className={styles.guide}>
          <section className={styles.guideSection}>
            <h3 className={styles.sectionTitle}>{t('batchImage.guide.uiTitle')}</h3>
            <div className={styles.guideSteps}>
              <p>{t('batchImage.guide.step1')}</p>
              <p>{t('batchImage.guide.step2')}</p>
              <p>{t('batchImage.guide.step3')}</p>
              <p>{t('batchImage.guide.step4')}</p>
            </div>
          </section>
          <section className={styles.guideSection}>
            <div className={styles.guideSkillHeader}>
              <h3 className={styles.sectionTitle}>{t('batchImage.guide.skillTitle')}</h3>
              <p className={styles.hint}>{t('batchImage.guide.skillDesc')}</p>
            </div>
            <textarea value={agentInstruction} readOnly className={styles.instruction} aria-label={t('batchImage.guide.skillTitle')} />
          </section>
        </div>
      </BaseDialog>

      {confirmDialog}
    </>
  )
}
