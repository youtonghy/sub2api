/**
 * 系统设置页的纯函数（来自 Vue 版 SettingsView.vue 的 script 部分）：
 * 登录条款文档、表格分页选项、codex 名单、转发 IP 请求头、默认订阅去重等。
 */
import { listPlatformIds } from '@/constants/platformCatalog'
import type { DefaultPlatformQuotasMap, DefaultSubscriptionSetting } from '@/api/admin/settings'
import type { LoginAgreementDocument } from '@/types'

export type LocalText = (zh: string, en: string) => string

export const tablePageSizeMin = 5
export const tablePageSizeMax = 1000
export const tablePageSizeDefault = 20

export const DEFAULT_WEB_SEARCH_QUOTA_LIMIT = 1000

export interface CustomMenuItem {
  id: string
  label: string
  icon_svg: string
  url: string
  visibility: 'user' | 'admin'
  sort_order: number
  hide_open_button?: boolean
}

export interface CustomEndpoint {
  name: string
  endpoint: string
  description: string
}

// ── codex_cli_only 黑/白名单结构化编辑（行 ↔ JSON）──
export interface CodexClientRow {
  originator: string
  uaContains: string // 逗号分隔，序列化时拆成 ua_contains 数组
  skipEngineFingerprint?: boolean // 仅白名单：命中即跳过引擎指纹门
}

export function defaultLoginAgreementDocuments(localText: LocalText): LoginAgreementDocument[] {
  return [
    { id: 'terms', title: localText('服务条款', 'Terms of Service'), content_md: '' },
    { id: 'usage-policy', title: localText('使用政策', 'Usage Policy'), content_md: '' },
    { id: 'supported-regions', title: localText('支持的国家和地区', 'Supported Countries and Regions'), content_md: '' },
    { id: 'service-specific-terms', title: localText('服务特定条款', 'Service-Specific Terms'), content_md: '' }
  ]
}

export function normalizeLoginAgreementDocumentId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/[-_]{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
}

export function loginAgreementRoutePath(doc: LoginAgreementDocument, index: number): string {
  const id = normalizeLoginAgreementDocumentId(doc.id || doc.title) || `doc-${index + 1}`
  return `/legal/${id}`
}

export function normalizeLoginAgreementDocumentsForSave(documents: LoginAgreementDocument[]): LoginAgreementDocument[] {
  return documents
    .map((doc, index) => ({
      id: normalizeLoginAgreementDocumentId(doc.id || doc.title) || `doc-${index + 1}`,
      title: doc.title.trim(),
      content_md: doc.content_md.trim()
    }))
    .filter((doc) => doc.title || doc.content_md)
}

export function findDuplicateLoginAgreementDocumentId(documents: LoginAgreementDocument[]): string | null {
  const seen = new Set<string>()
  for (const doc of documents) {
    if (seen.has(doc.id)) return doc.id
    seen.add(doc.id)
  }
  return null
}

export function formatTablePageSizeOptions(options: number[]): string {
  return options.join(', ')
}

export function parseTablePageSizeOptionsInput(raw: string): number[] | null {
  const tokens = raw
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
  if (tokens.length === 0) return null
  const parsed = tokens.map((token) => Number(token))
  if (parsed.some((value) => !Number.isInteger(value))) return null
  const deduped = Array.from(new Set(parsed)).sort((a, b) => a - b)
  if (deduped.some((value) => value < tablePageSizeMin || value > tablePageSizeMax)) return null
  return deduped
}

export function parseCodexEntriesToRows(raw: string): CodexClientRow[] {
  if (!raw || !raw.trim()) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.map((e) => ({
      originator: typeof e?.originator === 'string' ? e.originator : '',
      uaContains: Array.isArray(e?.ua_contains) ? e.ua_contains.filter((x: unknown) => typeof x === 'string').join(', ') : '',
      skipEngineFingerprint: e?.skip_engine_fingerprint === true
    }))
  } catch {
    return []
  }
}

export function serializeCodexRowsToJSON(rows: CodexClientRow[]): string {
  const entries = rows
    .map((r) => {
      const entry: { originator: string; ua_contains: string[]; skip_engine_fingerprint?: boolean } = {
        originator: r.originator.trim(),
        ua_contains: r.uaContains
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      }
      if (r.skipEngineFingerprint) entry.skip_engine_fingerprint = true
      return entry
    })
    .filter((e) => e.originator !== '' || e.ua_contains.length > 0)
  return entries.length > 0 ? JSON.stringify(entries) : ''
}

// ── 转发客户端 IP 请求头 ──
export const separatorKeys = new Set([' ', ',', '，', 'Enter', 'Tab'])
const forwardedClientIpHeaderTokenPattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
export const maxForwardedClientIpHeaders = 16

export type ForwardedClientIpHeaderResult = 'added' | 'duplicate' | 'invalid' | 'full'

export function normalizeForwardedClientIpHeader(raw: string): string {
  const header = raw.trim()
  if (!forwardedClientIpHeaderTokenPattern.test(header)) return ''
  return header
    .toLowerCase()
    .split('-')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('-')
}

export function normalizeForwardedClientIpHeaders(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const headers: string[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const header = normalizeForwardedClientIpHeader(raw)
    const key = header.toLowerCase()
    if (!header || seen.has(key) || headers.length >= maxForwardedClientIpHeaders) continue
    seen.add(key)
    headers.push(header)
  }
  return headers
}

/** 尝试追加一个请求头，返回结果与新列表 */
export function addForwardedClientIpHeader(
  headers: string[],
  raw: string
): { result: ForwardedClientIpHeaderResult; headers: string[] } {
  const header = normalizeForwardedClientIpHeader(raw)
  if (!header) return { result: 'invalid', headers }
  if (headers.some((item) => item.toLowerCase() === header.toLowerCase())) return { result: 'duplicate', headers }
  if (headers.length >= maxForwardedClientIpHeaders) return { result: 'full', headers }
  return { result: 'added', headers: [...headers, header] }
}

export function findDuplicateDefaultSubscription(
  subscriptions: DefaultSubscriptionSetting[]
): DefaultSubscriptionSetting | undefined {
  const seenGroupIDs = new Set<number>()
  return subscriptions.find((item) => {
    if (seenGroupIDs.has(item.group_id)) return true
    seenGroupIDs.add(item.group_id)
    return false
  })
}

// 平台限额表格的行：平台清单顺序中、已在归一化 map 里的平台（清单晚于设置加载时
// 不渲染尚未归一化的平台，保持模板非空绑定）。
export function platformQuotaRows(map: DefaultPlatformQuotasMap | undefined): string[] {
  return listPlatformIds().filter((platform) => !!map?.[platform as keyof DefaultPlatformQuotasMap])
}

export function formatSubscribedAt(ts: number | null | undefined): string {
  if (!ts) return ''
  // Use UTC to avoid timezone drift on repeated edits
  const d = new Date(ts * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseSubscribedAt(dateStr: string): number | null {
  if (!dateStr) return null
  // Parse as UTC to match formatSubscribedAt
  return Math.floor(new Date(dateStr + 'T00:00:00Z').getTime() / 1000)
}

export function isValidHttpUrl(url: string): boolean {
  if (!url) return true
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
