// ProxiesView 的纯函数（批量导入解析、代理 URL 复制格式、有效期天数联动），从 Vue 版 ProxiesView.vue 抽出以便单测。
import type { Proxy, ProxyProtocol } from '@/types'

export interface ParsedProxy {
  protocol: ProxyProtocol
  host: string
  port: number
  username: string
  password: string
}

export interface BatchParseResult {
  total: number
  valid: number
  invalid: number
  duplicate: number
  proxies: ParsedProxy[]
}

// Regex to parse proxy URL (supports http, https, socks5, socks5h).
// Host alternatives: [bracketed-IPv6] | hostname/IPv4 (colon-free, so the
// match stops before the final :port).
export const PROXY_URL_REGEX =
  /^(https?|socks5h?):\/\/(?:([^:@\[\]]+):([^@\[\]]+)@)?(\[[0-9a-f:.]+\]|[^:\[\]]+):(\d+)$/i

// Parse proxy URL: protocol://user:pass@host:port or protocol://host:port
// Host may be a domain, IPv4, or bracketed IPv6 ([2001:db8::1]).
export const parseProxyUrl = (line: string): ParsedProxy | null => {
  const trimmed = line.trim()
  if (!trimmed) return null

  const match = trimmed.match(PROXY_URL_REGEX)

  if (!match) return null

  const [, protocol, username, password, rawHost, port] = match
  const portNum = parseInt(port, 10)

  if (portNum < 1 || portNum > 65535) return null

  // Strip brackets from IPv6 literals; the backend re-brackets via net.JoinHostPort.
  const host = rawHost.replace(/^\[|\]$/g, '').trim()

  return {
    protocol: protocol.toLowerCase() as ProxyProtocol,
    host,
    port: portNum,
    username: username?.trim() || '',
    password: password?.trim() || ''
  }
}

export const emptyBatchParseResult = (): BatchParseResult => ({
  total: 0,
  valid: 0,
  invalid: 0,
  duplicate: 0,
  proxies: []
})

export const parseBatchInput = (input: string): BatchParseResult => {
  const lines = input.split('\n').filter((l) => l.trim())
  const seen = new Set<string>()
  const proxies: ParsedProxy[] = []
  let invalid = 0
  let duplicate = 0

  for (const line of lines) {
    const parsed = parseProxyUrl(line)
    if (!parsed) {
      invalid++
      continue
    }

    // Check for duplicates (same host:port:username:password)
    const key = `${parsed.host}:${parsed.port}:${parsed.username}:${parsed.password}`
    if (seen.has(key)) {
      duplicate++
      continue
    }
    seen.add(key)
    proxies.push(parsed)
  }

  return {
    total: lines.length,
    valid: proxies.length,
    invalid,
    duplicate,
    proxies
  }
}

// ── Proxy URL copy ──
type ProxyAddress = Pick<Proxy, 'protocol' | 'host' | 'port' | 'username' | 'password'>

function buildAuthPart(row: ProxyAddress): string {
  const user = row.username ? encodeURIComponent(row.username) : ''
  const pass = row.password ? encodeURIComponent(row.password) : ''
  if (user && pass) return `${user}:${pass}@`
  if (user) return `${user}@`
  if (pass) return `:${pass}@`
  return ''
}

export function buildProxyUrl(row: ProxyAddress): string {
  return `${row.protocol}://${buildAuthPart(row)}${row.host}:${row.port}`
}

export function getCopyFormats(row: ProxyAddress): Array<{ label: string; value: string }> {
  const hasAuth = row.username || row.password
  const fullUrl = buildProxyUrl(row)
  const formats = [{ label: fullUrl, value: fullUrl }]
  if (hasAuth) {
    const withoutProtocol = fullUrl.replace(/^[^:]+:\/\//, '')
    formats.push({ label: withoutProtocol, value: withoutProtocol })
  }
  formats.push({ label: `${row.host}:${row.port}`, value: `${row.host}:${row.port}` })
  return formats
}

// 有效期「选天数」⇄ 日历联动:天数自 base 起算(创建=今天;编辑=代理创建日),本地日历日 round-trip 稳定;canonical 仍是 expires_at 日期串
export const EXPIRY_PRESETS = [7, 30, 90, 180]

const toLocalDateStr = (dt: Date): string => {
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const d = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// base 为空 → 今天本地 00:00;否则该日期本地 00:00
const baseDateOrToday = (baseDateStr: string): Date => {
  const base = baseDateStr ? new Date(`${baseDateStr}T00:00:00`) : new Date()
  base.setHours(0, 0, 0, 0)
  return base
}

// base + N 天 → 本地 YYYY-MM-DD;N≤0/空 → '' 表示永不过期
export const addDaysToBase = (baseDateStr: string, n: number | string | null): string => {
  const days = Number(n)
  if (!days || days <= 0) return ''
  const dt = baseDateOrToday(baseDateStr)
  dt.setDate(dt.getDate() + days)
  return toLocalDateStr(dt)
}

// target 相对 base 的整天数(本地日历差,避免时区/时刻抖动)
export const daysFromBase = (baseDateStr: string, targetDateStr: string): number | null => {
  if (!targetDateStr) return null
  const target = new Date(`${targetDateStr}T00:00:00`)
  return Math.round((target.getTime() - baseDateOrToday(baseDateStr).getTime()) / 86400000)
}

export const formatExportTimestamp = () => {
  const now = new Date()
  const pad2 = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
}
