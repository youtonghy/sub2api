/**
 * 批量生图页的纯函数与常量，从 Vue 版 views/user/BatchImageGuideView.vue 的 <script setup> 原样拆出：
 * 文案/错误映射、计费展示、custom_id 规则、Agent 指令模板、缩略图生成与 IndexedDB 预览缓存。
 */
import type { BatchImageItem, BatchImageJob, BatchImageStatus } from '@/api/batchImage'
import { getLocale, t } from '@/i18n'

export type PreviewCacheRecord = {
  key: string
  blob: Blob
  size: number
  createdAt: number
  lastAccessedAt: number
}

type PreviewImageSource = ImageBitmap | HTMLImageElement

export const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'output_deleted'])
const PREVIEW_CACHE_DB_NAME = 'sub2api-batch-image-preview-cache'
const PREVIEW_CACHE_STORE_NAME = 'thumbnails'
const PREVIEW_THUMBNAIL_MAX_EDGE = 360
const PREVIEW_THUMBNAIL_QUALITY = 0.72
const PREVIEW_CACHE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000
const PREVIEW_CACHE_MAX_ENTRIES = 120
const PREVIEW_CACHE_MAX_BYTES = 48 * 1024 * 1024
export const BATCH_IMAGE_MAX_OUTPUTS_PER_ITEM = 4
export const BATCH_IMAGE_MAX_OUTPUTS_PER_JOB = 200

let previewCacheDBPromise: Promise<IDBDatabase | null> | null = null

export function referenceImageLimitForModel(model: string) {
  const normalized = String(model || '').toLowerCase()
  if (normalized.includes('pro-image')) return 14
  if (normalized.includes('flash-image')) return 3
  return 0
}

export function joinEndpointPath(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export function uniqueCustomID(raw: string, used: Set<string>, index: number): string {
  const base = raw.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || `img_${String(index + 1).padStart(3, '0')}`
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`
    suffix += 1
  }
  used.add(candidate)
  return candidate
}

export function normalizeOutputCount(value: unknown): number {
  const parsed = Math.floor(Number(value || 1))
  if (!Number.isFinite(parsed)) return 1
  return Math.min(BATCH_IMAGE_MAX_OUTPUTS_PER_ITEM, Math.max(1, parsed))
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

export function retryCustomID(customID: string) {
  const base = String(customID || 'item').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'item'
  return `${base}_retry_${Date.now().toString(36)}`
}

export function retrySourceCustomID(customID: string) {
  return String(customID || '').replace(/(?:_retry_[a-z0-9]+)+$/i, '')
}

export function friendlyItemError(error: BatchImageItem['error']) {
  if (!error) return '-'
  if (error.code === 'EMPTY_IMAGE_OUTPUT') return t('batchImage.itemResult.emptyImageOutput')
  if (error.code === 'PROVIDER_ITEM_FAILED') return t('batchImage.itemResult.providerItemFailed')
  return error.message || error.code || '-'
}

export function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '$0.00'
  return `$${Number(value).toFixed(2)}`
}

export function terminalZeroCost(job: Pick<BatchImageJob, 'status' | 'actual_cost'>) {
  return job.actual_cost === null && (job.status === 'failed' || job.status === 'cancelled')
}

export function costLabel(job: Pick<BatchImageJob, 'status' | 'hold_amount' | 'actual_cost'>) {
  if (job.actual_cost !== null) return formatMoney(job.actual_cost)
  if (terminalZeroCost(job)) return formatMoney(0)
  return t('batchImage.detail.holdCost', { amount: formatMoney(job.hold_amount) })
}

export type BatchImageTextKey =
  | 'loadKeysFailed'
  | 'loadModelsFailed'
  | 'loadJobsFailed'
  | 'selectApiKey'
  | 'noModelsForKey'
  | 'selectModel'
  | 'promptRequired'
  | 'submitted'
  | 'submitFailed'
  | 'refreshFailed'
  | 'cancelConfirm'
  | 'cancelled'
  | 'cancelFailed'
  | 'batchDownloadStarted'
    | 'downloadFailed'
    | 'retrySubmitted'
    | 'retryFailed'
    | 'retryMissingPrompts'
  | 'deleteConfirm'
  | 'deleteSelectedConfirm'
  | 'deleted'
  | 'deleteFailed'
    | 'loadItemsFailed'
    | 'loadPreviewFailed'
  | 'copiedInstruction'
  | 'loadingModels'
  | 'noModels'
  | 'noModelsHint'
  | 'noCompatibleAccount'
  | 'unsupportedProvider'
  | 'providerSubmitFailed'
  | 'vertexGcsBucketMissing'
  | 'queueFailed'
  | 'billingHoldFailed'
  | 'groupDisabled'
  | 'pricingMissing'
  | 'insufficientBalance'
  | 'invalidModel'
  | 'invalidItems'
  | 'duplicateCustomId'
  | 'promptTooLong'
  | 'invalidReferenceImage'
  | 'tooManyReferenceImages'
  | 'referenceImagesTooLarge'
  | 'tooManyOutputImages'
  | 'idempotencyConflict'
  | 'notReady'
  | 'outputDeleted'
  | 'resultMissing'
  | 'itemFailed'
  | 'itemImageIndexOutOfRange'
  | 'downloadLimited'
  | 'downloadTooLarge'
  | 'deleteNotReady'
  | 'disabled'
  | 'authRequired'
  | 'adminReference'
  | 'errorReference'

export function isZhLocale() {
  return String(getLocale() || '').toLowerCase().startsWith('zh')
}

export function batchImageText(key: BatchImageTextKey) {
  return t(`batchImage.messages.${key}`)
}

export function batchImageErrorReference(error: any) {
  const parts: string[] = []
  const code = String(error?.code || '').trim()
  const requestId = String(error?.requestId || '').trim()
  const status = String(error?.status || '').trim()
  if (code) parts.push(t('batchImage.messages.errorCodeRef', { code }))
  if (requestId) parts.push(t('batchImage.messages.requestIdRef', { id: requestId }))
  if (!code && status) parts.push(t('batchImage.messages.httpStatusRef', { status }))
  return parts.length ? `（${parts.join(isZhLocale() ? '，' : ', ')}）` : ''
}

export function batchImageAdminError(base: string, error: any) {
  const reference = batchImageErrorReference(error)
  return `${base}${reference ? ` ${reference}` : ''} ${batchImageText('adminReference')}`
}

export function batchImagePlainError(base: string) {
  return base
}

export function batchImageErrorMessage(error: any, fallback: string) {
  const code = String(error?.code || '').trim()
  const message = String(error?.message || '').trim()
  if (code === 'API_KEY_REQUIRED' || code === '401') {
    return batchImagePlainError(batchImageText('authRequired'))
  }
  if (code === 'BATCH_IMAGE_NO_ACCOUNT_AVAILABLE' || /no compatible batch image account/i.test(message)) {
    return batchImageAdminError(batchImageText('noCompatibleAccount'), error)
  }
  if (code === 'BATCH_IMAGE_UNSUPPORTED_PROVIDER' || /unsupported batch image provider/i.test(message)) {
    return batchImageAdminError(batchImageText('unsupportedProvider'), error)
  }
  if (code === 'BATCH_IMAGE_VERTEX_GCS_BUCKET_MISSING' || code === 'VERTEX_MANAGED_GCS_BUCKET_MISSING') {
    return batchImageAdminError(batchImageText('vertexGcsBucketMissing'), error)
  }
  if (
    code === 'BATCH_IMAGE_PROVIDER_SUBMIT_FAILED' ||
    code === 'BATCH_IMAGE_PROVIDER_MISSING_API_KEY' ||
    code === 'BATCH_IMAGE_PROVIDER_MISSING_SERVICE_ACCOUNT' ||
    code === 'BATCH_IMAGE_PROVIDER_UNSUPPORTED_ACCOUNT'
  ) {
    return batchImageAdminError(batchImageText('providerSubmitFailed'), error)
  }
  if (code === 'BATCH_IMAGE_QUEUE_FAILED' || code === 'BATCH_IMAGE_QUEUE_NOT_CONFIGURED') {
    return batchImageAdminError(batchImageText('queueFailed'), error)
  }
  if (code === 'BATCH_IMAGE_BILLING_HOLD_FAILED') {
    return batchImageAdminError(batchImageText('billingHoldFailed'), error)
  }
  if (code === 'BATCH_IMAGE_GROUP_DISABLED') {
    return batchImagePlainError(batchImageText('groupDisabled'))
  }
  if (code === 'BATCH_IMAGE_SETTLEMENT_PRICING_MISSING') {
    return batchImageAdminError(batchImageText('pricingMissing'), error)
  }
  if (code === 'BATCH_IMAGE_INSUFFICIENT_BALANCE') {
    return batchImagePlainError(batchImageText('insufficientBalance'))
  }
  if (code === 'BATCH_IMAGE_INVALID_MODEL') {
    return batchImageText('invalidModel')
  }
  if (code === 'BATCH_IMAGE_INVALID_ITEMS') {
    return batchImageText('invalidItems')
  }
  if (code === 'BATCH_IMAGE_DUPLICATE_CUSTOM_ID') {
    return batchImageText('duplicateCustomId')
  }
  if (code === 'BATCH_IMAGE_PROMPT_TOO_LONG') {
    return batchImageText('promptTooLong')
  }
  if (code === 'BATCH_IMAGE_INVALID_REFERENCE_IMAGE') {
    return batchImageText('invalidReferenceImage')
  }
  if (code === 'BATCH_IMAGE_TOO_MANY_REFERENCE_IMAGES') {
    return batchImageText('tooManyReferenceImages')
  }
  if (code === 'BATCH_IMAGE_REFERENCE_IMAGES_TOO_LARGE') {
    return batchImageText('referenceImagesTooLarge')
  }
  if (code === 'BATCH_IMAGE_TOO_MANY_OUTPUT_IMAGES') {
    return batchImageText('tooManyOutputImages')
  }
  if (code === 'BATCH_IMAGE_IDEMPOTENCY_CONFLICT') {
    return batchImagePlainError(batchImageText('idempotencyConflict'))
  }
  if (code === 'BATCH_IMAGE_NOT_READY') {
    return batchImageText('notReady')
  }
  if (code === 'BATCH_IMAGE_OUTPUT_DELETED') {
    return batchImageText('outputDeleted')
  }
  if (code === 'BATCH_IMAGE_RESULT_MISSING') {
    return batchImageAdminError(batchImageText('resultMissing'), error)
  }
  if (code === 'BATCH_IMAGE_ITEM_FAILED') {
    return batchImagePlainError(batchImageText('itemFailed'))
  }
  if (code === 'BATCH_IMAGE_ITEM_IMAGE_INDEX_OUT_OF_RANGE') {
    return batchImagePlainError(batchImageText('itemImageIndexOutOfRange'))
  }
  if (code === 'BATCH_IMAGE_DOWNLOAD_LIMITED') {
    return batchImageText('downloadLimited')
  }
  if (code === 'BATCH_IMAGE_DOWNLOAD_TOO_LARGE') {
    return batchImageText('downloadTooLarge')
  }
  if (code === 'BATCH_IMAGE_RECORD_DELETE_NOT_READY') {
    return batchImagePlainError(batchImageText('deleteNotReady'))
  }
  if (code === 'BATCH_IMAGE_DISABLED') {
    return batchImageAdminError(batchImageText('disabled'), error)
  }
  if (code === 'INTERNAL_ERROR' || code === '500') {
    return batchImageAdminError(fallback, error)
  }
  if (isZhLocale()) {
    const detail = message ? `${batchImageText('errorReference')}：${message}` : batchImageText('adminReference')
    return `${fallback}。${detail} ${batchImageErrorReference(error)}`
  }
  return message || fallback
}

export function formatDate(timestamp: number) {
  if (!timestamp) return ''
  return new Date(timestamp * 1000).toLocaleString()
}

export function defaultTaskName(timestamp?: number) {
  const date = timestamp ? new Date(timestamp * 1000) : new Date()
  return date.toLocaleString()
}

export function previewCacheSupported() {
  return typeof window !== 'undefined' && 'indexedDB' in window
}

export function previewCacheKey(batchId: string, customID: string, imageIndex = 0) {
  return [batchId, customID, imageIndex].map(part => encodeURIComponent(String(part))).join(':')
}


export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function openPreviewCacheDB(): Promise<IDBDatabase | null> {
  if (!previewCacheSupported()) return Promise.resolve(null)
  if (previewCacheDBPromise) return previewCacheDBPromise

  previewCacheDBPromise = new Promise((resolve) => {
    const request = window.indexedDB.open(PREVIEW_CACHE_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PREVIEW_CACHE_STORE_NAME)) {
        const store = db.createObjectStore(PREVIEW_CACHE_STORE_NAME, { keyPath: 'key' })
        store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return previewCacheDBPromise
}

export async function getCachedPreviewBlob(cacheKey: string): Promise<Blob | null> {
  const db = await openPreviewCacheDB()
  if (!db) return null
  const record = await idbRequest<PreviewCacheRecord | undefined>(
    db.transaction(PREVIEW_CACHE_STORE_NAME, 'readonly').objectStore(PREVIEW_CACHE_STORE_NAME).get(cacheKey),
  ).catch(() => undefined)
  if (!record?.blob) return null

  const now = Date.now()
  if (now - record.createdAt > PREVIEW_CACHE_MAX_AGE_MS) {
    void deleteCachedPreview(cacheKey)
    return null
  }
  void touchCachedPreview(cacheKey, now)
  return record.blob
}

export async function putCachedPreviewBlob(cacheKey: string, blob: Blob) {
  const db = await openPreviewCacheDB()
  if (!db) return
  const now = Date.now()
  const record: PreviewCacheRecord = {
    key: cacheKey,
    blob,
    size: blob.size,
    createdAt: now,
    lastAccessedAt: now,
  }
  await idbRequest(db.transaction(PREVIEW_CACHE_STORE_NAME, 'readwrite').objectStore(PREVIEW_CACHE_STORE_NAME).put(record)).catch(() => null)
  void cleanupPreviewCache()
}

export async function touchCachedPreview(cacheKey: string, lastAccessedAt: number) {
  const db = await openPreviewCacheDB()
  if (!db) return
  const record = await idbRequest<PreviewCacheRecord | undefined>(
    db.transaction(PREVIEW_CACHE_STORE_NAME, 'readonly').objectStore(PREVIEW_CACHE_STORE_NAME).get(cacheKey),
  ).catch(() => undefined)
  if (!record) return
  record.lastAccessedAt = lastAccessedAt
  await idbRequest(db.transaction(PREVIEW_CACHE_STORE_NAME, 'readwrite').objectStore(PREVIEW_CACHE_STORE_NAME).put(record)).catch(() => null)
}

export async function deleteCachedPreview(cacheKey: string) {
  const db = await openPreviewCacheDB()
  if (!db) return
  await idbRequest(db.transaction(PREVIEW_CACHE_STORE_NAME, 'readwrite').objectStore(PREVIEW_CACHE_STORE_NAME).delete(cacheKey)).catch(() => null)
}

export async function cleanupPreviewCache() {
  const db = await openPreviewCacheDB()
  if (!db) return
  const records = await idbRequest<PreviewCacheRecord[]>(
    db.transaction(PREVIEW_CACHE_STORE_NAME, 'readonly').objectStore(PREVIEW_CACHE_STORE_NAME).getAll(),
  ).catch(() => [])
  if (!records.length) return

  const now = Date.now()
  const sorted = [...records].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)
  const deleteKeys = new Set<string>()
  let totalBytes = 0
  let keptCount = 0

  for (const record of sorted) {
    if (now - record.createdAt > PREVIEW_CACHE_MAX_AGE_MS) {
      deleteKeys.add(record.key)
      continue
    }
    totalBytes += record.size || record.blob?.size || 0
    keptCount += 1
  }

  for (const record of sorted) {
    if (deleteKeys.has(record.key)) continue
    if (keptCount <= PREVIEW_CACHE_MAX_ENTRIES && totalBytes <= PREVIEW_CACHE_MAX_BYTES) break
    deleteKeys.add(record.key)
    totalBytes -= record.size || record.blob?.size || 0
    keptCount -= 1
  }

  if (!deleteKeys.size) return
  const store = db.transaction(PREVIEW_CACHE_STORE_NAME, 'readwrite').objectStore(PREVIEW_CACHE_STORE_NAME)
  for (const key of deleteKeys) {
    store.delete(key)
  }
}

export async function createThumbnailBlob(blob: Blob): Promise<Blob> {
  const source = await loadPreviewImageSource(blob)
  const width = source.width
  const height = source.height
  const scale = Math.min(1, PREVIEW_THUMBNAIL_MAX_EDGE / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(source.image, 0, 0, targetWidth, targetHeight)
  source.close()
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((thumbnail) => {
      if (thumbnail) resolve(thumbnail)
      else reject(new Error('thumbnail unavailable'))
    }, 'image/webp', PREVIEW_THUMBNAIL_QUALITY)
  })
}

export async function loadPreviewImageSource(blob: Blob): Promise<{ image: PreviewImageSource, width: number, height: number, close: () => void }> {
  if ('createImageBitmap' in window) {
    const bitmap = await window.createImageBitmap(blob)
    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    }
  }

  const url = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('image unavailable'))
      img.src = url
    })
    return {
      image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      close: () => URL.revokeObjectURL(url),
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

export function buildAgentInstruction(endpointBase: string): string {
  return `---
name: sub2api-batch-image
description: 当用户希望用 Gemini/Vertex 批量生成图片、批量跑提示词、下载批量生图结果、重试失败图片时使用。
---

你是 Codex 中的批量生图执行 Agent。用户不需要手动填写页面表单；你应从当前聊天、用户给的文件、目录或上下文中整理任务名称、prompt 列表和输出目录，只有缺少关键决策时才向用户提问。

默认端点：
${endpointBase}

你需要自己完成：
1. 从用户聊天或附件中提取 prompt。每条 prompt 保留完整文本，按顺序生成稳定 custom_id，例如 img_001、img_002。
2. 从用户要求或上下文推断任务名称；没有明确名称时用当前时间生成任务名。
3. 从用户要求或上下文推断输出目录；如果用户没有说保存到哪里，才询问用户。
4. 提交前必须先计算 expected_output_count = 所有 item 的 output_count 之和。单个批量任务硬性最多 200 张输出图；超过 200 张必须拆成多组任务，不能提交一个超大任务，也不能把参考图附件上限当成生成张数上限。
5. 如果用户提供参考图，把参考图按用途绑定到具体 item。参考图只是输入附件，不是输出图数量。模型单条限制必须按模型执行：Gemini 2.5 Flash Image 每条最多 3 张参考图；Gemini 3 Pro Image 每条最多 14 张参考图。不要把后端附件风控理解成 Pro 单条能力：按 output_count 展开后，所有 item 的参考图附件总数还有内部保护阈值 1000 个，inline base64 参考图解码后总量最多 128MB。这个 1000 只是服务器拒绝异常请求的保护阈值，不是推荐规模；参考图很多或总请求体较大时应主动拆分任务。
6. 参考图会按 output_count 重复消耗输入 token；大量任务、重复复用同一张参考图或参考图总体积较大时，优先使用 gs:// file_uri 或拆分成多组任务。
7. 选择 API Key 和模型：先获取当前可用的批量生图 Key/模型；如果用户指定模型且该 Key 支持，则使用用户指定模型；否则使用该 Key 可用模型中的默认/第一个。不要展示或询问内部 provider 名称。
8. 调用批量生图 API 提交、轮询、下载，不要求用户去页面里手填。

API 调用规范：
- 模型：GET ${joinEndpointPath(endpointBase, '/v1/images/batches/models')}
- 提交：POST ${joinEndpointPath(endpointBase, '/v1/images/batches')}
- 查询：GET ${joinEndpointPath(endpointBase, '/v1/images/batches/{id}')}
- 明细：GET ${joinEndpointPath(endpointBase, '/v1/images/batches/{id}/items')}
- 下载：GET ${joinEndpointPath(endpointBase, '/v1/images/batches/{id}/download')}
- 取消：POST ${joinEndpointPath(endpointBase, '/v1/images/batches/{id}/cancel')}

提交请求体：
{
  "model": "<按所选 Key 可用模型填写>",
  "task_name": "<从聊天推断；为空则用当前时间>",
  "image_size": "1K",
  "response_mime_type": "image/png",
  "items": [
    {
      "custom_id": "img_001",
      "prompt": "<第一条完整 prompt>",
      "output_count": 1,
      "reference_images": [
        {
          "id": "face",
          "type": "subject",
          "mime_type": "image/png",
          "data": "<base64，不含 data:image/png;base64, 前缀>"
        }
      ]
    }
  ]
}

必须遵守：
- 不要把 API Key 写入仓库、日志、提交记录或最终回复。
- 不要把参考图 base64 写入最终回复、日志或公开文件。恢复记录中只保存参考图文件名、用途、数量和请求 JSON 文件路径；若请求 JSON 文件包含 base64，应保存在用户指定输出目录且不要提交到仓库。
- output_count 表示同一 prompt 和参考图重复生成几张，默认 1，每条最多 4；这不是依赖 Gemini 单次请求返回多图，而是系统展开成多个真实任务项。提交前必须确认预计输出图总数不超过 200，超过就拆分成多组任务。绝不能因为参考图附件有更高的内部保护阈值，就提交会生成超过 200 张图的任务。
- 当前对用户的批量生图计费仍按成功输出图片数量结算，不单独对参考图加价。可以向用户说明：参考图会产生少量上游输入 token 和临时存储成本，且会随 output_count 重复计算；页面显示的冻结/结算金额按输出图片数量计算。
- 提交成功后，必须立刻在输出目录写入本地恢复记录，例如 batch-image-resume.json。不要在恢复记录里保存 API Key。
- 恢复记录至少包含：endpoint、task_name、batch_id、model、output_dir、request_file、submitted_at、last_status、status_url、items_url、download_url、prompt_count、expected_output_count，以及可用于失败重试的 custom_id 到 prompt 映射或请求 JSON 文件路径。
- 每次查询状态后更新恢复记录，写入 last_checked_at、last_status、成功数、失败数、实际扣费和失败摘要。会话中断或暂停后，下次必须能凭该文件继续查询、下载或重试。
- 不要高频轮询。首次查询等待约 20 到 30 秒；queued 状态每 60 到 120 秒查询一次；如果连续 3 次仍是 queued，就先停止主动查询，告诉用户任务仍在排队，并保留恢复记录，之后可继续其他任务或等待用户稍后让你恢复。
- running 状态每约 60 秒查询一次，服务器压力大或大批量任务时可以更久；processing_results 等接近完成的状态可每 20 到 45 秒查询一次。
- 任务完成后报告任务名、任务 id、成功数、失败数、实际扣费和保存路径。
- 只下载成功图片。部分失败时，先展示失败 custom_id、错误码、错误来源和简要原因。
- 重试只能重试失败项，不能重复提交已成功项。若历史任务没有保存失败项 prompt，必须告诉用户无法自动重试，并询问用户是否提供原 prompt。
- 取消任务前必须提醒：已被系统索引为成功的图片仍会按成功项结算扣费，其余冻结金额会释放。
- 图片预览按需加载；不要为了查看列表自动批量加载图片内容。`
}

type JobStatusSource = BatchImageStatus | Pick<BatchImageJob, 'status' | 'success_count' | 'fail_count'>

export function statusLabel(jobOrStatus: JobStatusSource) {
  const status = typeof jobOrStatus === 'string' ? jobOrStatus : jobOrStatus.status
  if (typeof jobOrStatus !== 'string' && status === 'completed' && jobOrStatus.fail_count > 0) {
    if (jobOrStatus.success_count > 0) return t('batchImage.status.partialSuccess')
    return t('batchImage.status.allFailed')
  }
  const statusKeys: Record<string, string> = {
    queued: 'queued',
    running: 'running',
    indexing: 'processingResults',
    processing_results: 'processingResults',
    settling: 'settling',
    completed: 'completed',
    failed: 'failed',
    cancelled: 'cancelled',
    output_deleted: 'outputDeleted',
  }
  const key = statusKeys[status]
  return key ? t(`batchImage.status.${key}`) : status
}

/** Vue 版 statusBadgeClass 的 badge-* 映射到 Arc badge 色调（primary → info，gray → neutral） */
export function statusTone(jobOrStatus: JobStatusSource): 'neutral' | 'success' | 'info' | 'warning' | 'danger' {
  const status = typeof jobOrStatus === 'string' ? jobOrStatus : jobOrStatus.status
  if (typeof jobOrStatus !== 'string' && status === 'completed' && jobOrStatus.fail_count > 0) {
    if (jobOrStatus.success_count > 0) return 'warning'
    return 'danger'
  }
  if (status === 'completed') return 'success'
  if (status === 'failed' || status === 'cancelled') return 'danger'
  if (status === 'output_deleted') return 'neutral'
  return 'info'
}

export function itemStatusLabel(status: string) {
  const statusKeys: Record<string, string> = {
    pending: 'pending',
    succeeded: 'succeeded',
    success: 'succeeded',
    failed: 'failed',
    cancelled: 'cancelled',
  }
  const key = statusKeys[status]
  return key ? t(`batchImage.itemStatus.${key}`) : status
}

export function itemStatusTone(status: string): 'success' | 'danger' | 'info' {
  if (status === 'succeeded' || status === 'success') return 'success'
  if (status === 'failed' || status === 'cancelled') return 'danger'
  return 'info'
}

export function canLoadItemPreview(item: Pick<BatchImageItem, 'status' | 'image_count'>) {
  return (item.status === 'succeeded' || item.status === 'success') && item.image_count > 0
}

export function isSuccessfulImageItem(item: Pick<BatchImageItem, 'status' | 'image_count'>) {
  return (item.status === 'succeeded' || item.status === 'success') && item.image_count > 0
}

/** 提示词草稿行的本地 key（与 Vue 版相同格式） */
export function makeLocalId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 提交批量任务的幂等键：`<prefix>-<时间戳>-<随机串>`，与 Vue 版格式一致 */
export function makeIdempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
