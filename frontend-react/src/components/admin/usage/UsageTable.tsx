import { ArrowDown, ArrowUp, Check, Copy, Database, Image as ImageIcon, Info, PencilLine } from 'lucide-react'
import {
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import DataTable, { type DataTableCellContext } from '@/components/common/DataTable'
import EmptyState from '@/components/common/EmptyState'
import IpGeoCell from '@/components/common/IpGeoCell'
import type { Column } from '@/components/common/types'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminUsageLog } from '@/types'
import {
  BILLING_MODE_IMAGE,
  BILLING_MODE_PER_REQUEST,
  BILLING_MODE_TOKEN,
  BILLING_MODE_VIDEO,
  getBillingModeLabel,
  getDisplayBillingMode,
  imageUnitPrice,
  isImageUsage
} from '@/utils/billingMode'
import { formatDateTime, formatReasoningEffort, reasoningEffortValuesEqual } from '@/utils/format'
import { formatCacheTokens, formatMultiplier } from '@/utils/formatters'
import {
  formatImageBillingSize,
  formatImageInputSize,
  formatImageOutputSize,
  formatImageSizeBreakdown,
  formatImageSizeSource,
  hasImageInputCost,
  hasImageInputTokens,
  hasImageOutputCost,
  hasImageOutputTokens,
  textInputTokens,
  textOutputTokens
} from '@/utils/imageUsage'
import { fetchBatch, getEntry, getIpGeoRevision, subscribeIpGeo } from '@/utils/ipGeoLookup'
import {
  durationSeverity,
  firstTokenSeverity,
  formatUsageOutputRate,
  type LatencySeverity
} from '@/utils/latencyHealth'
import { formatTokenPricePerMillion } from '@/utils/usagePricing'
import { resolveUsageRequestType } from '@/utils/usageRequestType'
import { getUsageServiceTierLabel } from '@/utils/usageServiceTier'
import styles from './UsageTable.module.css'

/** Compute the account-billed cost for display: (account_stats_cost ?? total_cost) * rate_multiplier */
function accountBilled(row: { total_cost?: number | null; account_stats_cost?: number | null; account_rate_multiplier?: number | null }): number {
  const base = row.account_stats_cost != null ? row.account_stats_cost : (row.total_cost ?? 0)
  const result = base * (row.account_rate_multiplier ?? 1)
  return Number.isNaN(result) ? 0 : result
}

// 延迟健康度色条/文字（替代 Vue 版 Tailwind 色板，语义映射到 Arc 状态色）
const SEVERITY_COLOR: Record<LatencySeverity, string> = {
  good: 'var(--success)',
  warn: 'var(--warning)',
  slow: 'color-mix(in oklab, var(--warning) 50%, var(--danger))',
  critical: 'var(--danger)'
}
const SEVERITY_CLASS: Record<LatencySeverity, string> = {
  good: styles['sev-good'],
  warn: styles['sev-warn'],
  slow: styles['sev-slow'],
  critical: styles['sev-critical']
}

const BILLING_MODE_TONE: Record<string, BadgeTone> = {
  [BILLING_MODE_TOKEN]: 'info',
  [BILLING_MODE_PER_REQUEST]: 'neutral',
  [BILLING_MODE_IMAGE]: 'success',
  [BILLING_MODE_VIDEO]: 'warning'
}

// 超过 1 分钟简化为 "Xm Ys"，免去人工换算（超过 1 小时再进位为 "Xh Ym"）
const formatDuration = (ms: number | null | undefined): string => {
  if (ms == null) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 3600) return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`
  return `${Math.floor(totalSec / 3600)}h ${Math.floor((totalSec % 3600) / 60)}m`
}

const sentUpstreamModel = (row: AdminUsageLog): string => row.upstream_model?.trim() || row.model?.trim() || ''

const normalizeModelVariant = (model: string): string =>
  model
    .trim()
    .toLowerCase()
    .replace(/-latest$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
    .replace(/-\d{8}$/, '')

const isLikelyModelVariant = (row: AdminUsageLog): boolean => {
  const sent = sentUpstreamModel(row)
  const response = row.upstream_response_model?.trim() || ''
  return sent !== '' && response !== '' && normalizeModelVariant(sent) === normalizeModelVariant(response)
}

const hasReasoningEffortMapping = (row: AdminUsageLog): boolean => {
  const requested = row.reasoning_effort?.trim() || ''
  const forwarded = row.upstream_reasoning_effort?.trim() || ''
  return requested !== '' && forwarded !== '' && !reasoningEffortValuesEqual(requested, forwarded)
}

const formatUserAgent = (ua: string): string => ua

export interface UsageTableProps {
  data: AdminUsageLog[]
  loading?: boolean
  columns: Column[]
  serverSideSort?: boolean
  defaultSortKey?: string
  defaultSortOrder?: 'asc' | 'desc'
  /** 默认 true */
  showAccountBilling?: boolean
  /** 默认 true */
  showUpstreamEndpoint?: boolean
  /** 嵌入统一卡片内使用：去掉自身卡片外观 */
  flat?: boolean
  onUserClick?: (userID: number, email?: string) => void
  onSort?: (key: string, order: 'asc' | 'desc') => void
  onIpGeoBatchFailed?: () => void
}

interface TooltipState {
  row: AdminUsageLog
  x: number
  y: number
}

export default function UsageTable({
  data,
  loading = false,
  columns,
  serverSideSort = false,
  defaultSortKey = '',
  defaultSortOrder = 'asc',
  showAccountBilling = true,
  showUpstreamEndpoint = true,
  flat = false,
  onUserClick,
  onSort,
  onIpGeoBatchFailed
}: UsageTableProps) {
  const { t } = useI18n()
  useSyncExternalStore(subscribeIpGeo, getIpGeoRevision, getIpGeoRevision)
  const [copiedRequestId, setCopiedRequestId] = useState<string | null>(null)
  const [ipGeoBatchLoading, setIpGeoBatchLoading] = useState(false)
  const [costTooltip, setCostTooltip] = useState<TooltipState | null>(null)
  const [tokenTooltip, setTokenTooltip] = useState<TooltipState | null>(null)

  const showIpGeoToolbar = columns.some((col) => col.key === 'ip_address')

  const currentPageIps = useMemo(
    () => Array.from(new Set(data.map((row) => row.ip_address).filter((ip): ip is string => Boolean(ip)))),
    [data]
  )

  const pendingIpCount = !showIpGeoToolbar
    ? 0
    : currentPageIps.filter((ip) => {
        const status = getEntry(ip).status
        return status === 'idle' || status === 'error'
      }).length

  const handleBatchFetchIpGeo = async () => {
    setIpGeoBatchLoading(true)
    try {
      const ok = await fetchBatch(currentPageIps)
      if (!ok) onIpGeoBatchFailed?.()
    } finally {
      setIpGeoBatchLoading(false)
    }
  }

  const copyIdentifier = async (value: string, copiedMessage: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedRequestId(value)
      useAppStore.getState().showSuccess(copiedMessage)
      window.setTimeout(() => {
        setCopiedRequestId((current) => (current === value ? null : current))
      }, 2000)
    } catch {
      useAppStore.getState().showError(t('common.copyFailed'))
    }
  }

  const modelAuditTitle = (row: AdminUsageLog): string =>
    [
      `${t('usage.requestedModel')}: ${row.model || '-'}`,
      `${t('usage.sentUpstreamModel')}: ${sentUpstreamModel(row) || '-'}`,
      `${t('usage.upstreamResponseModel')}: ${row.upstream_response_model || '-'}`
    ].join('\n')

  const getRequestTypeLabel = (row: AdminUsageLog): string => {
    const requestType = resolveUsageRequestType(row)
    if (requestType === 'cyber') return t('usage.cyber')
    if (requestType === 'live') return t('usage.live')
    if (requestType === 'ws_v2') return t('usage.ws')
    if (requestType === 'stream') return t('usage.stream')
    if (requestType === 'sync') return t('usage.sync')
    return t('usage.unknown')
  }

  const getRequestTypeTone = (row: AdminUsageLog): BadgeTone => {
    const requestType = resolveUsageRequestType(row)
    if (requestType === 'cyber') return 'danger'
    if (requestType === 'live') return 'success'
    if (requestType === 'ws_v2') return 'info'
    if (requestType === 'stream') return 'info'
    if (requestType === 'sync') return 'neutral'
    return 'warning'
  }

  const tooltipAnchor = (target: HTMLElement, row: AdminUsageLog): TooltipState => {
    const rect = target.getBoundingClientRect()
    return { row, x: rect.right + 8, y: rect.top + rect.height / 2 }
  }

  const tooltipTriggerProps = (
    row: AdminUsageLog,
    setter: (state: TooltipState | null) => void,
    label: string,
    testId: string
  ) => ({
    className: styles.infoTrigger,
    tabIndex: 0,
    role: 'button' as const,
    'aria-label': label,
    'data-testid': testId,
    onMouseEnter: (event: ReactMouseEvent<HTMLElement>) => setter(tooltipAnchor(event.currentTarget, row)),
    onMouseLeave: () => setter(null),
    onFocus: (event: FocusEvent<HTMLElement>) => setter(tooltipAnchor(event.currentTarget, row)),
    onBlur: () => setter(null)
  })

  const renderIdCell = (value: string | null | undefined, copiedMessage: string) => {
    if (!value) return <span className={styles.cellMuted}>-</span>
    const copied = copiedRequestId === value
    return (
      <div className={styles.idCell}>
        <span className={styles.idText} title={value}>
          {value}
        </span>
        <button
          type="button"
          className={`${styles.copyButton} ${copied ? styles.copied : ''}`}
          title={copied ? t('keys.copied') : t('keys.copyToClipboard')}
          onClick={() => void copyIdentifier(value, copiedMessage)}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        </button>
      </div>
    )
  }

  type Ctx = DataTableCellContext<AdminUsageLog>
  const cells: Record<string, (ctx: Ctx) => ReactNode> = {
    user: ({ row }) => (
      <div className={styles.inlineRow}>
        {row.user?.email ? (
          <button
            type="button"
            className={styles.userButton}
            title={t('admin.usage.clickToViewBalance')}
            onClick={() => onUserClick?.(row.user_id, row.user?.email)}
          >
            {row.user.email}
          </button>
        ) : (
          <span className={styles.cellText}>-</span>
        )}
        {row.user?.deleted_at ? (
          <Badge tone="danger" size="sm">
            {t('admin.usage.userDeletedBadge')}
          </Badge>
        ) : null}
        <span className={styles.userId}>#{row.user_id}</span>
      </div>
    ),
    api_key: ({ row }) => <span className={styles.cellText}>{row.api_key?.name || '-'}</span>,
    account: ({ row }) => <span className={styles.cellText}>{row.account?.name || '-'}</span>,
    model: ({ row }) => (
      <div className={styles.stack}>
        {row.model_mapping_chain && row.model_mapping_chain.includes('→') ? (
          <div className={styles.stack}>
            {row.model_mapping_chain.split('→').map((step, i) => (
              <div
                key={i}
                className={i === 0 ? styles.primary : styles.secondary}
                style={i > 0 ? { paddingLeft: `${i * 0.75}rem` } : undefined}
              >
                {i > 0 ? <span className={styles.arrow}>↳</span> : null}
                {step}
              </div>
            ))}
          </div>
        ) : row.upstream_model && row.upstream_model !== row.model ? (
          <div className={styles.stack}>
            <div className={styles.primary}>{row.model}</div>
            <div className={styles.secondary}>
              <span className={styles.arrow}>↳</span>
              {row.upstream_model}
            </div>
          </div>
        ) : (
          <span className={styles.primary}>{row.model}</span>
        )}
        {row.upstream_model_mismatch === true && row.upstream_response_model ? (
          <div
            className={`${styles.audit} ${isLikelyModelVariant(row) ? styles.auditVariant : styles.auditMismatch}`}
            title={modelAuditTitle(row)}
          >
            <span className={styles.arrow}>↳ {t('usage.upstreamResponseModel')}:</span>
            {row.upstream_response_model}{' '}
            <Badge tone="warning" size="sm">
              {isLikelyModelVariant(row) ? t('usage.modelVariant') : t('usage.modelMismatch')}
            </Badge>
          </div>
        ) : null}
      </div>
    ),
    reasoning_effort: ({ row }) =>
      hasReasoningEffortMapping(row) ? (
        <div data-testid="reasoning-effort-cell" className={styles.stack}>
          <div className={styles.primary}>{formatReasoningEffort(row.reasoning_effort)}</div>
          <div className={styles.secondary}>
            <span className={styles.arrow}>↳</span>
            {formatReasoningEffort(row.upstream_reasoning_effort)}
          </div>
        </div>
      ) : (
        <span data-testid="reasoning-effort-cell" className={styles.cellText}>
          {formatReasoningEffort(row.reasoning_effort)}
        </span>
      ),
    endpoint: ({ row }) => (
      <div className={styles.endpoint}>
        <div className={styles.endpointRow}>
          <span className={styles.endpointLabel}>{t('usage.inbound')}:</span>
          <span>{row.inbound_endpoint?.trim() || '-'}</span>
        </div>
        {showUpstreamEndpoint ? (
          <div className={styles.endpointRow}>
            <span className={styles.endpointLabel}>{t('usage.upstream')}:</span>
            <span>{row.upstream_endpoint?.trim() || '-'}</span>
          </div>
        ) : null}
      </div>
    ),
    group: ({ row }) =>
      row.group ? (
        <Badge tone="neutral" size="sm">
          {row.group.name}
        </Badge>
      ) : (
        <span className={styles.cellMuted}>-</span>
      ),
    stream: ({ row }) => (
      <div className={styles.inlineRow}>
        <Badge data-testid="request-type-badge" tone={getRequestTypeTone(row)} size="sm">
          {getRequestTypeLabel(row)}
        </Badge>
        {row.native_compaction_v2 ? (
          <Badge data-testid="native-compaction-badge" tone="success" size="sm">
            {t('usage.nativeCompactionV2')}
          </Badge>
        ) : null}
      </div>
    ),
    billing_mode: ({ row }) => {
      const mode = getDisplayBillingMode(row)
      return (
        <Badge tone={BILLING_MODE_TONE[mode || BILLING_MODE_TOKEN] ?? 'info'} size="sm">
          {getBillingModeLabel(mode, t)}
        </Badge>
      )
    },
    tokens: ({ row }) =>
      isImageUsage(row) ? (
        // 图片生成请求（仅按次计费时显示图片格式）
        <div className={styles.tokens}>
          <ImageIcon size={16} className={styles.iconImage} aria-hidden="true" />
          <span className={styles.imageCount}>
            {row.image_count}
            {t('usage.imageUnit')}
          </span>
          <span className={styles.cellMuted}>({formatImageBillingSize(row, t)})</span>
        </div>
      ) : (
        // Token 请求
        <div className={styles.tokens}>
          <div className={styles.tokenLines}>
            <div className={styles.tokenLine}>
              <span className={styles.tokenItem}>
                <ArrowDown size={14} className={styles.iconIn} aria-hidden="true" />
                {row.input_tokens?.toLocaleString() || 0}
              </span>
              <span className={styles.tokenItem}>
                <ArrowUp size={14} className={styles.iconOut} aria-hidden="true" />
                {row.output_tokens?.toLocaleString() || 0}
              </span>
            </div>
            {row.cache_read_tokens > 0 || row.cache_creation_tokens > 0 ? (
              <div className={styles.tokenLine}>
                {row.cache_read_tokens > 0 ? (
                  <span className={styles.tokenItem}>
                    <Database size={14} className={styles.iconCacheRead} aria-hidden="true" />
                    {formatCacheTokens(row.cache_read_tokens)}
                  </span>
                ) : null}
                {row.cache_creation_tokens > 0 ? (
                  <span className={styles.tokenItem}>
                    <PencilLine size={14} className={styles.iconCacheWrite} aria-hidden="true" />
                    {formatCacheTokens(row.cache_creation_tokens)}
                    {row.cache_creation_1h_tokens > 0 ? (
                      <Badge tone="warning" size="sm">
                        1h
                      </Badge>
                    ) : null}
                    {row.cache_ttl_overridden ? (
                      <Badge tone="danger" size="sm" title={t('usage.cacheTtlOverriddenHint')}>
                        R
                      </Badge>
                    ) : null}
                  </span>
                ) : null}
              </div>
            ) : null}
            {hasImageInputTokens(row) ? (
              <div className={styles.tokenLine}>
                <span className={styles.tokenItem}>
                  <ImageIcon size={14} className={styles.iconImage} aria-hidden="true" />
                  {row.image_input_tokens.toLocaleString()}
                </span>
              </div>
            ) : null}
            {hasImageOutputTokens(row) ? (
              <div className={styles.tokenLine}>
                <span className={styles.tokenItem}>
                  <ImageIcon size={14} className={styles.iconImage} aria-hidden="true" />
                  {row.image_output_tokens.toLocaleString()}
                </span>
              </div>
            ) : null}
          </div>
          {/* Token Detail Tooltip */}
          <span {...tooltipTriggerProps(row, setTokenTooltip, t('usage.tokenDetails'), 'token-tooltip-trigger')}>
            <Info size={12} aria-hidden="true" />
          </span>
        </div>
      ),
    cost: ({ row }) => (
      <div className={styles.cost}>
        <div className={styles.costMain}>
          <span className={styles.costValue}>${row.actual_cost?.toFixed(6) || '0.000000'}</span>
          {row.long_context_billing_applied ? (
            <Badge data-testid="long-context-billing-marker" tone="warning" size="sm" title={t('admin.usage.longContextPricingTooltip')}>
              {t('admin.usage.longContext')}
            </Badge>
          ) : null}
          {/* Cost Detail Tooltip */}
          <span {...tooltipTriggerProps(row, setCostTooltip, t('usage.costDetails'), 'cost-tooltip-trigger')}>
            <Info size={12} aria-hidden="true" />
          </span>
        </div>
        {showAccountBilling && row.account_rate_multiplier != null ? (
          <div className={styles.accountCost}>A ${accountBilled(row).toFixed(6)}</div>
        ) : null}
      </div>
    ),
    // 合并首字/总耗时的健康度列：左侧色条上端随首字档、下端随总耗时档，中段(40%-60%)短渐变过渡，便于纵向扫视整体健康状况
    latency: ({ row }) => {
      const durationSev = durationSeverity(row.duration_ms ?? 0)
      const fromSev = row.first_token_ms != null ? firstTokenSeverity(row.first_token_ms) : durationSev
      const barStyle = {
        '--bar-from': SEVERITY_COLOR[fromSev],
        '--bar-to': SEVERITY_COLOR[durationSev]
      } as CSSProperties
      return (
        <div className={styles.latency}>
          <span className={styles.latencyBar} style={barStyle} aria-hidden="true" />
          <div className={styles.latencyGrid}>
            <span className={styles.latencyLabel}>{t('usage.latencyFirstToken')}</span>
            {row.first_token_ms != null ? (
              <span className={`${styles.latencyValue} ${SEVERITY_CLASS[firstTokenSeverity(row.first_token_ms)]}`}>
                {formatDuration(row.first_token_ms)}
              </span>
            ) : (
              <span className={styles.latencyLabel}>-</span>
            )}
            <span className={styles.latencyLabel}>{t('usage.latencyDuration')}</span>
            <span className={`${styles.latencyValue} ${SEVERITY_CLASS[durationSev]}`}>{formatDuration(row.duration_ms)}</span>
            <span className={styles.latencyLabel} title={t('usage.outputTpsHint')}>
              {t('usage.outputTps')}
            </span>
            <span data-testid="output-tps" className={styles.tps}>
              {formatUsageOutputRate(row)}
            </span>
          </div>
        </div>
      )
    },
    created_at: ({ value }) => <span className={styles.time}>{formatDateTime(value)}</span>,
    request_id: ({ row }) => renderIdCell(row.request_id, t('admin.usage.requestIdCopied')),
    upstream_request_id: ({ row }) => renderIdCell(row.upstream_request_id, t('admin.usage.upstreamRequestIdCopied')),
    user_agent: ({ row }) =>
      row.user_agent ? (
        <span className={styles.userAgent} title={row.user_agent}>
          {formatUserAgent(row.user_agent)}
        </span>
      ) : (
        <span className={styles.cellMuted}>-</span>
      ),
    ip_address: ({ row }) =>
      row.ip_address ? (
        <div>
          <span className={styles.ip}>{row.ip_address}</span>
          <IpGeoCell ip={row.ip_address} />
        </div>
      ) : (
        <span className={styles.cellMuted}>-</span>
      )
  }

  const tooltipRow = (label: ReactNode, value: ReactNode, key?: string) => (
    <div className={styles.tooltipRow} key={key}>
      <span className={styles.tooltipLabel}>{label}</span>
      <span className={styles.tooltipValue}>{value}</span>
    </div>
  )

  const renderTokenTooltip = (state: TooltipState) => {
    const d = state.row
    return (
      <div className={styles.tooltip} style={{ left: state.x, top: state.y }} role="tooltip" data-testid="usage-token-tooltip">
        <div className={styles.tooltipBody}>
          <div className={styles.tooltipSection}>
            <div className={styles.tooltipSection}>
              <div className={styles.tooltipTitle}>{t('usage.tokenDetails')}</div>
              {d.input_tokens > 0 && !hasImageInputTokens(d) ? tooltipRow(t('admin.usage.inputTokens'), d.input_tokens.toLocaleString()) : null}
              {hasImageInputTokens(d) && textInputTokens(d) > 0
                ? tooltipRow(t('admin.usage.inputTokens'), textInputTokens(d).toLocaleString())
                : null}
              {hasImageInputTokens(d) ? tooltipRow(t('usage.imageInputTokens'), d.image_input_tokens.toLocaleString()) : null}
              {d.output_tokens > 0 && !hasImageOutputTokens(d) ? tooltipRow(t('admin.usage.outputTokens'), d.output_tokens.toLocaleString()) : null}
              {hasImageOutputTokens(d) && textOutputTokens(d) > 0
                ? tooltipRow(t('admin.usage.outputTokens'), textOutputTokens(d).toLocaleString())
                : null}
              {hasImageOutputTokens(d) ? tooltipRow(t('usage.imageOutputTokens'), d.image_output_tokens.toLocaleString()) : null}
              {d.cache_creation_tokens > 0 ? (
                d.cache_creation_5m_tokens > 0 || d.cache_creation_1h_tokens > 0 ? (
                  // 有 5m/1h 明细时，展开显示
                  <>
                    {d.cache_creation_5m_tokens > 0
                      ? tooltipRow(
                          <>
                            {t('admin.usage.cacheCreation5mTokens')}
                            <Badge tone="warning" size="sm">
                              5m
                            </Badge>
                          </>,
                          d.cache_creation_5m_tokens.toLocaleString(),
                          '5m'
                        )
                      : null}
                    {d.cache_creation_1h_tokens > 0
                      ? tooltipRow(
                          <>
                            {t('admin.usage.cacheCreation1hTokens')}
                            <Badge tone="warning" size="sm">
                              1h
                            </Badge>
                          </>,
                          d.cache_creation_1h_tokens.toLocaleString(),
                          '1h'
                        )
                      : null}
                  </>
                ) : (
                  // 无明细时，只显示聚合值
                  tooltipRow(t('admin.usage.cacheCreationTokens'), d.cache_creation_tokens.toLocaleString())
                )
              ) : null}
              {d.cache_ttl_overridden
                ? tooltipRow(
                    <>
                      {t('usage.cacheTtlOverriddenLabel')}
                      <Badge tone="danger" size="sm">
                        {`R-${d.cache_creation_1h_tokens > 0 ? '5m' : '1H'}`}
                      </Badge>
                    </>,
                    d.cache_creation_1h_tokens > 0 ? t('usage.cacheTtlOverridden1h') : t('usage.cacheTtlOverridden5m')
                  )
                : null}
              {d.cache_read_tokens > 0 ? tooltipRow(t('admin.usage.cacheReadTokens'), d.cache_read_tokens.toLocaleString()) : null}
            </div>
            <div className={`${styles.tooltipRow} ${styles.tooltipTotal}`}>
              <span className={styles.tooltipLabel}>{t('usage.totalTokens')}</span>
              <span className={styles.tooltipValue}>
                {(
                  (d.input_tokens || 0) +
                  (d.output_tokens || 0) +
                  (d.cache_creation_tokens || 0) +
                  (d.cache_read_tokens || 0)
                ).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderCostTooltip = (state: TooltipState) => {
    const d = state.row
    const tokenBilling = !isImageUsage(d) && (!d.billing_mode || d.billing_mode === BILLING_MODE_TOKEN)
    return (
      <div className={styles.tooltip} style={{ left: state.x, top: state.y }} role="tooltip" data-testid="usage-cost-tooltip">
        <div className={styles.tooltipBody}>
          <div className={styles.tooltipSection}>
            {/* Cost Breakdown */}
            <div className={`${styles.tooltipSection} ${styles.tooltipDivided}`}>
              <div className={styles.tooltipTitle}>{t('usage.costDetails')}</div>
              {d.input_cost > 0 ? tooltipRow(t('admin.usage.inputCost'), `$${d.input_cost.toFixed(8)}`) : null}
              {hasImageInputCost(d) ? tooltipRow(t('usage.imageInputCost'), `$${d.image_input_cost.toFixed(8)}`) : null}
              {d.output_cost > 0 ? tooltipRow(t('admin.usage.outputCost'), `$${d.output_cost.toFixed(8)}`) : null}
              {hasImageOutputCost(d) ? tooltipRow(t('usage.imageOutputCost'), `$${d.image_output_cost.toFixed(8)}`) : null}
              {tokenBilling ? (
                // Token billing: show unit prices per 1M tokens
                <>
                  {textInputTokens(d) > 0
                    ? tooltipRow(
                        t('usage.inputTokenPrice'),
                        `${formatTokenPricePerMillion(d.input_cost, textInputTokens(d))} ${t('usage.perMillionTokens')}`,
                        'inputPrice'
                      )
                    : null}
                  {hasImageInputTokens(d)
                    ? tooltipRow(
                        t('usage.imageInputTokenPrice'),
                        `${formatTokenPricePerMillion(d.image_input_cost ?? 0, d.image_input_tokens)} ${t('usage.perMillionTokens')}`,
                        'imageInputPrice'
                      )
                    : null}
                  {d.output_cost > 0 && textOutputTokens(d) > 0
                    ? tooltipRow(
                        t('usage.outputTokenPrice'),
                        `${formatTokenPricePerMillion(d.output_cost, textOutputTokens(d))} ${t('usage.perMillionTokens')}`,
                        'outputPrice'
                      )
                    : null}
                  {hasImageOutputTokens(d)
                    ? tooltipRow(
                        t('usage.imageOutputTokenPrice'),
                        `${formatTokenPricePerMillion(d.image_output_cost ?? 0, d.image_output_tokens)} ${t('usage.perMillionTokens')}`,
                        'imageOutputPrice'
                      )
                    : null}
                </>
              ) : isImageUsage(d) ? (
                <>
                  {tooltipRow(t('usage.imageCount'), `${d.image_count}${t('usage.imageUnit')}`, 'count')}
                  {tooltipRow(t('usage.imageBillingSize'), formatImageBillingSize(d, t), 'size')}
                  {tooltipRow(t('usage.imageSizeSource'), formatImageSizeSource(d, t), 'source')}
                  {tooltipRow(t('usage.imageInputSize'), formatImageInputSize(d, t), 'input')}
                  {tooltipRow(t('usage.imageOutputSize'), formatImageOutputSize(d, t), 'output')}
                  {formatImageSizeBreakdown(d)
                    ? tooltipRow(t('usage.imageSizeBreakdown'), formatImageSizeBreakdown(d), 'breakdown')
                    : null}
                  {tooltipRow(t('usage.imageUnitPrice'), `$${imageUnitPrice(d).toFixed(8)}`, 'unit')}
                  {tooltipRow(t('usage.imageTotalPrice'), `$${d.total_cost?.toFixed(8) || '0.00000000'}`, 'total')}
                </>
              ) : (
                tooltipRow(t('usage.unitPrice'), `$${d.total_cost?.toFixed(8) || '0.00000000'}`)
              )}
              {d.cache_creation_cost > 0 ? tooltipRow(t('admin.usage.cacheCreationCost'), `$${d.cache_creation_cost.toFixed(8)}`) : null}
              {d.cache_read_cost > 0 ? tooltipRow(t('admin.usage.cacheReadCost'), `$${d.cache_read_cost.toFixed(8)}`) : null}
            </div>
            {/* Rate and Summary */}
            {tooltipRow(t('usage.serviceTier'), getUsageServiceTierLabel(d.service_tier, t))}
            {tooltipRow(t('usage.rate'), `${formatMultiplier(d.rate_multiplier ?? 1)}x`)}
            {tooltipRow(t('usage.original'), `$${d.total_cost?.toFixed(8) || '0.00000000'}`)}
            {tooltipRow(t('usage.userBilled'), `$${d.actual_cost?.toFixed(8) || '0.00000000'}`)}
            {/* Account billing (separated from user billing) */}
            {showAccountBilling ? (
              <>
                <div className={`${styles.tooltipRow} ${styles.tooltipTotal}`}>
                  <span className={styles.tooltipLabel}>{t('usage.accountMultiplier')}</span>
                  <span className={styles.tooltipValue}>{formatMultiplier(d.account_rate_multiplier ?? 1)}x</span>
                </div>
                {tooltipRow(
                  t('usage.accountBilled'),
                  `$${accountBilled({
                    total_cost: d.total_cost,
                    account_stats_cost: d.account_stats_cost,
                    account_rate_multiplier: d.account_rate_multiplier
                  }).toFixed(8)}`
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className={flat ? styles.flat : styles.root}>
        {showIpGeoToolbar ? (
          <div className={styles.ipToolbar}>
            {pendingIpCount > 0 ? (
              <span className={styles.ipPending}>{t('usage.ipGeo.pending', { count: pendingIpCount })}</span>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={ipGeoBatchLoading || pendingIpCount === 0}
              onClick={() => void handleBatchFetchIpGeo()}
            >
              {ipGeoBatchLoading ? t('usage.ipGeo.batchFetching') : t('usage.ipGeo.batchFetch')}
            </Button>
          </div>
        ) : null}
        <div className={styles.scroll}>
          <DataTable
            columns={columns}
            data={data}
            loading={loading}
            serverSideSort={serverSideSort}
            defaultSortKey={defaultSortKey}
            defaultSortOrder={defaultSortOrder}
            onSort={(key, order) => onSort?.(key, order)}
            cells={cells}
            empty={<EmptyState title={t('usage.noRecords')} />}
          />
        </div>
      </div>
      {tokenTooltip ? createPortal(renderTokenTooltip(tokenTooltip), document.body) : null}
      {costTooltip ? createPortal(renderCostTooltip(costTooltip), document.body) : null}
    </>
  )
}
