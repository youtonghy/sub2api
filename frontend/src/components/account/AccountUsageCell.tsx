/**
 * 账号列表「用量」列，对应 Vue 版 AccountUsageCell.vue。
 * 按平台 × 账号类型展示用量窗口：Anthropic / OpenAI / Antigravity / Grok OAuth 拉取 /usage，
 * 多协议 API Key 供应商交给 CN / Ollama / OpenCode 子单元格，Gemini 展示等级与本地模拟配额，
 * Key 账号展示今日统计与额度进度条。
 * 父组件传入 requestBatchedUsage 时由父组件批量拉取（batch managed），否则单元格自行拉取并走模块级缓存；
 * 移动端视口内才懒加载。
 */
import { CircleAlert, CircleHelp, CreditCard, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { adminAPI } from '@/api/admin'
import { useI18n } from '@/i18n/useI18n'
import type { Account, AccountUsageInfo, GeminiCredentials, WindowStats } from '@/types'
import { supportsAccountQuota } from '@/utils/accountQuota'
import { buildOpenAIUsageRefreshKey } from '@/utils/accountUsageRefresh'
import { formatCompactNumber } from '@/utils/format'
import { isOfficialGeminiBaseUrl } from '@/utils/geminiExplicitCache'
import { enqueueUsageRequest } from '@/utils/usageLoadQueue'
import AccountQuotaInfo from './AccountQuotaInfo'
import ClaudeResetCreditsCell from './ClaudeResetCreditsCell'
import CNProviderBalanceCell from './CNProviderBalanceCell'
import CNProviderQuotaCell from './CNProviderQuotaCell'
import {
  cnBalanceCellVisible as cnBalanceCellVisibleFn,
  cnQuotaCellVisible as cnQuotaCellVisibleFn,
  isMultiProtocolApiKeyPlatform
} from './credentialsBuilder'
import GrokQuotaProbeCell from './GrokQuotaProbeCell'
import OllamaCloudUsageCell from './OllamaCloudUsageCell'
import OpenAIQuotaResetCell from './OpenAIQuotaResetCell'
import OpenCodeGoUsageCell from './OpenCodeGoUsageCell'
import UsageProgressBar, { type UsageProgressBarColor } from './UsageProgressBar'
import styles from './usageCells.module.css'
import local from './AccountUsageCell.module.css'

export interface AccountUsageCellProps {
  account: Account
  todayStats?: WindowStats | null
  todayStatsLoading?: boolean
  manualRefreshToken?: number
  batchedUsage?: AccountUsageInfo | null
  batchedUsageError?: string | null
  batchedUsageLoading?: boolean
  requestBatchedUsage?: ((account: Account, options?: { force?: boolean }) => void) | null
  onAccountUpdated?: (account: Account) => void
  onUsageLoaded?: (usage: AccountUsageInfo) => void
}

type UsageSource = 'passive' | 'active'

// Module-level cache shared across all AccountUsageCell instances
const _usageCache = new Map<number, { data: AccountUsageInfo; ts: number }>()
const USAGE_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const desktopViewportQuery = '(min-width: 768px)'

const readDesktopViewport = () =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? true
    : window.matchMedia(desktopViewportQuery).matches

// Antigravity quota types (用于 API 返回的数据)
interface AntigravityUsageResult {
  utilization: number
  resetTime: string | null
}

// 从 API 配额数据中获取使用率（多模型取最高使用率）
const getAntigravityUsageFromAPI = (
  usageInfo: AccountUsageInfo | null,
  modelNames: string[]
): AntigravityUsageResult | null => {
  const quota = usageInfo?.antigravity_quota
  if (!quota) return null

  let maxUtilization = 0
  let earliestReset: string | null = null

  for (const model of modelNames) {
    const modelQuota = quota[model]
    if (!modelQuota) continue

    if (modelQuota.utilization > maxUtilization) {
      maxUtilization = modelQuota.utilization
    }
    if (modelQuota.reset_time) {
      if (!earliestReset || modelQuota.reset_time < earliestReset) {
        earliestReset = modelQuota.reset_time
      }
    }
  }

  // 如果没有找到任何匹配的模型
  if (maxUtilization === 0 && earliestReset === null) {
    const hasAnyData = modelNames.some((m) => quota[m])
    if (!hasAnyData) return null
  }

  return {
    utilization: maxUtilization,
    resetTime: earliestReset
  }
}

const ANTIGRAVITY_PRO_MODELS = ['gemini-3-pro-low', 'gemini-3-pro-high', 'gemini-3-pro-preview']
const ANTIGRAVITY_FLASH_MODELS = ['gemini-3-flash']
const ANTIGRAVITY_IMAGE_MODELS = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image', 'gemini-3-pro-image']
const ANTIGRAVITY_CLAUDE_MODELS = [
  'claude-fable-5-1',
  'claude-fable-5',
  'claude-sonnet-4-5',
  'claude-opus-4-5-thinking',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-opus-4-6-thinking',
  'claude-opus-4-7',
  'claude-opus-4-8'
]

interface GrokQuotaBarInfo {
  utilization: number
  resetsAt: string | null
  windowStats?: WindowStats | null
}

const formatGrokMoney = (value?: number | null) => {
  if (value == null || Number.isNaN(value)) return '0'
  if (value >= 1000) return formatCompactNumber(value)
  if (value >= 100) return value.toFixed(0)
  if (value >= 10) return value.toFixed(1)
  return value.toFixed(2)
}

const grokPlanLabelIsFree = (value: string) => value.includes('free') || value.includes('basic')
const grokPlanLabelIsPaid = (value: string) => {
  return value !== '' && !grokPlanLabelIsFree(value) && !value.includes('unknown')
}

interface QuotaBarInfo {
  utilization: number
  resetsAt: string | null
}

const makeQuotaBar = (account: Account, used: number, limit: number, startKey?: string): QuotaBarInfo => {
  const utilization = limit > 0 ? (used / limit) * 100 : 0
  let resetsAt: string | null = null
  if (startKey) {
    const extra = account.extra as Record<string, unknown> | undefined
    const isDaily = startKey.includes('daily')
    const mode = isDaily
      ? (extra?.quota_daily_reset_mode as string) || 'rolling'
      : (extra?.quota_weekly_reset_mode as string) || 'rolling'

    if (mode === 'fixed') {
      // Use pre-computed next reset time for fixed mode
      const resetAtKey = isDaily ? 'quota_daily_reset_at' : 'quota_weekly_reset_at'
      resetsAt = (extra?.[resetAtKey] as string) || null
    } else {
      // Rolling mode: compute from start + period
      const startStr = extra?.[startKey] as string | undefined
      if (startStr) {
        const startDate = new Date(startStr)
        const periodMs = isDaily ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
        resetsAt = new Date(startDate.getTime() + periodMs).toISOString()
      }
    }
  }
  return { utilization, resetsAt }
}

/** 变化检测：值与上一次 effect 时不同才回调（Vue 版 watch，不含首次） */
function useOnChange<T>(value: T, onChange: (next: T, prev: T) => void, equals: (a: T, b: T) => boolean = Object.is) {
  const prevRef = useRef(value)
  const handlerRef = useRef(onChange)
  useEffect(() => {
    handlerRef.current = onChange
  })
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = value
    if (equals(prev, value)) return
    handlerRef.current(value, prev)
  })
}

const sameTuple = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((item, index) => Object.is(item, b[index]))

function SkeletonBarRow() {
  return (
    <div className={styles.skeletonRow} data-skeleton="">
      <div className={styles.skeletonBlock} style={{ width: 32 }} />
      <div className={styles.skeletonBar} />
      <div className={styles.skeletonBlock} style={{ width: 32 }} />
    </div>
  )
}

function SkeletonStatsRow() {
  return (
    <div className={styles.skeletonRow} data-skeleton="">
      <div className={styles.skeletonBlock} style={{ width: 40 }} />
      <div className={styles.skeletonBlock} style={{ width: 32 }} />
      <div className={styles.skeletonBlock} style={{ width: 48 }} />
    </div>
  )
}

/** Hover / focus 弹出的说明（Vue 版 group-hover 提示） */
function HoverHint({ icon, tone, children }: { icon: ReactNode; tone?: 'danger'; children: ReactNode }) {
  return (
    <span className={local.hint} tabIndex={0} data-tone={tone}>
      {icon}
      <span className={local.hintPanel} role="tooltip">
        {children}
      </span>
    </span>
  )
}

export default function AccountUsageCell({
  account,
  todayStats = null,
  todayStatsLoading = false,
  manualRefreshToken = 0,
  batchedUsage = null,
  batchedUsageError = null,
  batchedUsageLoading = false,
  requestBatchedUsage = null,
  onAccountUpdated,
  onUsageLoaded
}: AccountUsageCellProps) {
  const { t } = useI18n()

  const isBatchManaged = typeof requestBatchedUsage === 'function'

  const [loading, setLoading] = useState(() => (isBatchManaged ? batchedUsageLoading === true : false))
  const [activeQueryLoading, setActiveQueryLoading] = useState(false)
  const [error, setError] = useState<string | null>(() => (isBatchManaged ? (batchedUsageError ?? null) : null))
  const [usageInfo, setUsageInfo] = useState<AccountUsageInfo | null>(() =>
    isBatchManaged ? (batchedUsage ?? null) : null
  )
  const [isDesktopViewport, setIsDesktopViewport] = useState(readDesktopViewport)
  const [hasEnteredViewport, setHasEnteredViewport] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null)

  const disposed = useRef(false)
  const pendingAutoLoad = useRef(false)
  const pendingAutoLoadSource = useRef<UsageSource | undefined>(undefined)
  const hasEnteredViewportRef = useRef(false)

  // 父组件批量拉取：用量 / 错误 / 加载态跟随父组件（Vue 版 syncManagedUsageState 的 immediate watch）
  const managedTuple = [batchedUsage, batchedUsageError, batchedUsageLoading, isBatchManaged] as const
  const [prevManagedTuple, setPrevManagedTuple] = useState(managedTuple)
  if (!sameTuple(prevManagedTuple, managedTuple)) {
    setPrevManagedTuple(managedTuple)
    if (isBatchManaged) {
      setUsageInfo(batchedUsage ?? null)
      setError(batchedUsageError ?? null)
      setLoading(batchedUsageLoading === true)
    }
  }

  // Gemini 第三方上游 API Key：没有 AI Studio 等级与本地模拟配额
  const isGeminiThirdPartyApiKey = (() => {
    if (account.platform !== 'gemini' || account.type !== 'apikey') return false
    const creds = account.credentials as GeminiCredentials | undefined
    return !isOfficialGeminiBaseUrl(creds?.base_url)
  })()

  const isGeminiVertex = account.platform === 'gemini' && account.type === 'service_account'

  // Show usage windows for OAuth and Setup Token accounts
  const showUsageWindows = (() => {
    // Gemini: we can always compute local usage windows from DB logs (simulated quotas).
    // 第三方上游 API Key 没有模拟配额，按普通 Key 账号展示今日统计与额度进度条。
    if (account.platform === 'gemini') return !isGeminiThirdPartyApiKey
    // 多协议 API Key 供应商：apikey 账号也有滚动用量窗口（coding plan / 订阅）或余额，
    // 由 CNProviderQuotaCell / CNProviderBalanceCell 自行探测与展示。
    if (isMultiProtocolApiKeyPlatform(account.platform)) return true
    return account.type === 'oauth' || account.type === 'setup-token'
  })()

  const shouldFetchUsage = (() => {
    if (account.platform === 'anthropic') return account.type === 'oauth' || account.type === 'setup-token'
    if (account.platform === 'gemini') return !isGeminiThirdPartyApiKey && !isGeminiVertex
    if (account.platform === 'antigravity') return account.type === 'oauth'
    if (account.platform === 'grok') return account.type === 'oauth'
    if (account.platform === 'openai') return account.type === 'oauth'
    return false
  })()

  // CN 供应商子单元格可见性（与 CNProviderQuotaCell / CNProviderBalanceCell 共用
  // credentialsBuilder 的单一实现）：都不可见时显示 `-` 占位符。
  const cnQuotaCellVisible = cnQuotaCellVisibleFn(account)
  const cnBalanceCellVisible = cnBalanceCellVisibleFn(account)

  // Vertex 没有本地模拟配额，用量窗口展示今日统计
  const showGeminiTodayStats = isGeminiVertex

  const geminiUsageAvailable =
    !!usageInfo?.gemini_shared_daily ||
    !!usageInfo?.gemini_pro_daily ||
    !!usageInfo?.gemini_flash_daily ||
    !!usageInfo?.gemini_shared_minute ||
    !!usageInfo?.gemini_pro_minute ||
    !!usageInfo?.gemini_flash_minute

  const hasOpenAIUsageFallback =
    account.platform === 'openai' && account.type === 'oauth' && (!!usageInfo?.five_hour || !!usageInfo?.seven_day)

  const openAISevenDayEstimatedTotalCost = (() => {
    const sevenDay = usageInfo?.seven_day
    const utilization = sevenDay?.utilization
    const currentCost = sevenDay?.window_stats?.cost
    if (
      typeof utilization !== 'number' ||
      typeof currentCost !== 'number' ||
      !Number.isFinite(utilization) ||
      !Number.isFinite(currentCost) ||
      utilization <= 0 ||
      currentCost <= 0
    ) {
      return null
    }

    const estimate = (currentCost * 100) / utilization
    return Number.isFinite(estimate) && estimate > 0 ? estimate : null
  })()

  const openAIUsageRefreshKey = buildOpenAIUsageRefreshKey(account)
  const shouldAutoLoadUsageOnMount = shouldFetchUsage
  const shouldLazyLoadOnMobile = shouldFetchUsage && !isDesktopViewport

  // ===== Antigravity quota from API (usageInfo.antigravity_quota) =====

  // 检查是否有从 API 获取的配额数据
  const hasAntigravityQuotaFromAPI = !!usageInfo?.antigravity_quota && Object.keys(usageInfo.antigravity_quota).length > 0
  const antigravity3ProUsageFromAPI = getAntigravityUsageFromAPI(usageInfo, ANTIGRAVITY_PRO_MODELS)
  const antigravity3FlashUsageFromAPI = getAntigravityUsageFromAPI(usageInfo, ANTIGRAVITY_FLASH_MODELS)
  const antigravity3ImageUsageFromAPI = getAntigravityUsageFromAPI(usageInfo, ANTIGRAVITY_IMAGE_MODELS)
  const antigravityClaudeUsageFromAPI = getAntigravityUsageFromAPI(usageInfo, ANTIGRAVITY_CLAUDE_MODELS)

  const aiCreditsDisplay = (() => {
    const credits = usageInfo?.ai_credits
    if (!credits || credits.length === 0) return null
    const total = credits.reduce((sum, credit) => sum + (credit.amount ?? 0), 0)
    if (total <= 0) return null
    return total.toFixed(0)
  })()

  const extra = account.extra as Record<string, unknown> | undefined
  const loadCodeAssist = extra?.load_code_assist as Record<string, unknown> | undefined

  // Antigravity 账户类型（从 load_code_assist 响应中提取）
  const antigravityTier = (() => {
    if (!loadCodeAssist) return null
    // 优先取 paidTier，否则取 currentTier
    const paidTier = loadCodeAssist.paidTier as Record<string, unknown> | undefined
    if (paidTier && typeof paidTier.id === 'string') return paidTier.id
    const currentTier = loadCodeAssist.currentTier as Record<string, unknown> | undefined
    if (currentTier && typeof currentTier.id === 'string') return currentTier.id
    return null
  })()

  // 检测账户是否有不合格状态（ineligibleTiers）
  const hasIneligibleTiers = (() => {
    const ineligibleTiers = loadCodeAssist?.ineligibleTiers as unknown[] | undefined
    return Array.isArray(ineligibleTiers) && ineligibleTiers.length > 0
  })()

  // 账户类型显示标签与徽章色调
  const antigravityTierLabel =
    antigravityTier === 'free-tier'
      ? t('admin.accounts.tier.free')
      : antigravityTier === 'g1-pro-tier'
        ? t('admin.accounts.tier.pro')
        : antigravityTier === 'g1-ultra-tier'
          ? t('admin.accounts.tier.ultra')
          : null
  const antigravityTierTone =
    antigravityTier === 'g1-pro-tier' ? 'info' : antigravityTier === 'g1-ultra-tier' ? 'accent' : 'neutral'

  // ===== Gemini =====
  const geminiCreds = account.credentials as GeminiCredentials | undefined
  // Gemini 账户类型（从 credentials 中提取）
  const geminiTier = account.platform === 'gemini' ? geminiCreds?.tier_id || null : null
  const geminiOAuthType = account.platform === 'gemini' ? (geminiCreds?.oauth_type || '').trim() || null : null
  const showGeminiQuotaPolicy = !isGeminiVertex

  // Gemini 是否为 Code Assist OAuth
  const isGeminiCodeAssist =
    account.platform === 'gemini' &&
    (geminiCreds?.oauth_type === 'code_assist' || (!geminiCreds?.oauth_type && !!geminiCreds?.project_id))

  const geminiChannelShort = ((): 'ai studio' | 'vertex' | 'gcp' | 'google one' | 'client' | null => {
    if (account.platform !== 'gemini') return null
    if (isGeminiVertex) return 'vertex'
    // API Key accounts are AI Studio.
    if (account.type === 'apikey') return 'ai studio'
    if (geminiOAuthType === 'google_one') return 'google one'
    if (isGeminiCodeAssist) return 'gcp'
    if (geminiOAuthType === 'ai_studio') return 'client'
    // Fallback (unknown legacy data): treat as AI Studio.
    return 'ai studio'
  })()

  const geminiUserLevel = ((): string | null => {
    if (account.platform !== 'gemini') return null
    if (isGeminiVertex) return null

    const tier = (geminiTier || '').toString().trim()
    const tierLower = tier.toLowerCase()
    const tierUpper = tier.toUpperCase()

    // Google One: free / pro / ultra
    if (geminiOAuthType === 'google_one') {
      if (tierLower === 'google_one_free') return 'free'
      if (tierLower === 'google_ai_pro') return 'pro'
      if (tierLower === 'google_ai_ultra') return 'ultra'

      // Backward compatibility (legacy tier markers)
      if (tierUpper === 'AI_PREMIUM' || tierUpper === 'GOOGLE_ONE_STANDARD') return 'pro'
      if (tierUpper === 'GOOGLE_ONE_UNLIMITED') return 'ultra'
      if (tierUpper === 'FREE' || tierUpper === 'GOOGLE_ONE_BASIC' || tierUpper === 'GOOGLE_ONE_UNKNOWN' || tierUpper === '') {
        return 'free'
      }
      return null
    }

    // GCP Code Assist: standard / enterprise
    if (isGeminiCodeAssist) {
      if (tierLower === 'gcp_enterprise') return 'enterprise'
      if (tierLower === 'gcp_standard') return 'standard'
      // Backward compatibility
      if (tierUpper.includes('ULTRA') || tierUpper.includes('ENTERPRISE')) return 'enterprise'
      return 'standard'
    }

    // AI Studio (API Key) and Client OAuth: free / paid
    if (account.type === 'apikey' || geminiOAuthType === 'ai_studio') {
      if (tierLower === 'aistudio_paid') return 'paid'
      if (tierLower === 'aistudio_free') return 'free'
      // Backward compatibility
      if (tierUpper.includes('PAID') || tierUpper.includes('PAYG') || tierUpper.includes('PAY')) return 'paid'
      if (tierUpper.includes('FREE')) return 'free'
      if (account.type === 'apikey') return 'free'
      return null
    }

    return null
  })()

  // Gemini 认证类型（按要求：授权方式简称 + 用户等级）
  const geminiAuthTypeLabel =
    account.platform !== 'gemini' || !geminiChannelShort
      ? null
      : geminiUserLevel
        ? `${geminiChannelShort} ${geminiUserLevel}`
        : geminiChannelShort

  // Gemini 账户类型徽章色调（统一样式）：按渠道 + 等级取稳定颜色，不依赖原始 tier_id 变体
  const geminiTierTone = (() => {
    const channel = geminiChannelShort
    const level = geminiUserLevel
    if (channel === 'client' || channel === 'ai studio' || channel === 'vertex') return 'info'
    if (channel === 'google one') {
      if (level === 'ultra') return 'accent'
      if (level === 'pro') return 'info'
      return 'neutral'
    }
    if (channel === 'gcp') return level === 'enterprise' ? 'accent' : 'info'
    return 'neutral'
  })()

  // Gemini 配额政策信息
  const geminiQuotaPolicyChannel =
    geminiOAuthType === 'google_one'
      ? t('admin.accounts.gemini.quotaPolicy.rows.googleOne.channel')
      : isGeminiCodeAssist
        ? t('admin.accounts.gemini.quotaPolicy.rows.gcp.channel')
        : t('admin.accounts.gemini.quotaPolicy.rows.aiStudio.channel')

  const geminiQuotaPolicyLimits = (() => {
    const tierLower = (geminiTier || '').toString().trim().toLowerCase()

    if (geminiOAuthType === 'google_one') {
      if (tierLower === 'google_ai_ultra' || geminiUserLevel === 'ultra') {
        return t('admin.accounts.gemini.quotaPolicy.rows.googleOne.limitsUltra')
      }
      if (tierLower === 'google_ai_pro' || geminiUserLevel === 'pro') {
        return t('admin.accounts.gemini.quotaPolicy.rows.googleOne.limitsPro')
      }
      return t('admin.accounts.gemini.quotaPolicy.rows.googleOne.limitsFree')
    }

    if (isGeminiCodeAssist) {
      if (tierLower === 'gcp_enterprise' || geminiUserLevel === 'enterprise') {
        return t('admin.accounts.gemini.quotaPolicy.rows.gcp.limitsEnterprise')
      }
      return t('admin.accounts.gemini.quotaPolicy.rows.gcp.limitsStandard')
    }

    // AI Studio (API Key / custom OAuth)
    if (tierLower === 'aistudio_paid' || geminiUserLevel === 'paid') {
      return t('admin.accounts.gemini.quotaPolicy.rows.aiStudio.limitsPaid')
    }
    return t('admin.accounts.gemini.quotaPolicy.rows.aiStudio.limitsFree')
  })()

  const geminiQuotaPolicyDocsUrl =
    geminiOAuthType === 'google_one' || isGeminiCodeAssist
      ? 'https://developers.google.com/gemini-code-assist/resources/quotas'
      : 'https://ai.google.dev/pricing'

  // Per requirement: Google One & GCP are shared RPD pools (no per-model breakdown).
  const geminiUsesSharedDaily =
    account.platform === 'gemini' &&
    (!!usageInfo?.gemini_shared_daily ||
      !!usageInfo?.gemini_shared_minute ||
      geminiOAuthType === 'google_one' ||
      isGeminiCodeAssist)

  const geminiUsageBars = (() => {
    if (account.platform !== 'gemini' || !usageInfo) return []

    const bars: Array<{
      key: string
      label: string
      utilization: number
      resetsAt: string | null
      windowStats?: WindowStats | null
      color: UsageProgressBarColor
    }> = []

    if (geminiUsesSharedDaily) {
      const sharedDaily = usageInfo.gemini_shared_daily
      if (sharedDaily) {
        bars.push({
          key: 'shared_daily',
          label: '1d',
          utilization: sharedDaily.utilization,
          resetsAt: sharedDaily.resets_at,
          windowStats: sharedDaily.window_stats,
          color: 'indigo'
        })
      }
      return bars
    }

    const pro = usageInfo.gemini_pro_daily
    if (pro) {
      bars.push({
        key: 'pro_daily',
        label: 'pro',
        utilization: pro.utilization,
        resetsAt: pro.resets_at,
        windowStats: pro.window_stats,
        color: 'indigo'
      })
    }

    const flash = usageInfo.gemini_flash_daily
    if (flash) {
      bars.push({
        key: 'flash_daily',
        label: 'flash',
        utilization: flash.utilization,
        resetsAt: flash.resets_at,
        windowStats: flash.window_stats,
        color: 'emerald'
      })
    }

    return bars
  })()

  // ===== Grok =====
  const grokBilling = usageInfo?.grok_billing || null
  const grokLocalUsage7d = usageInfo?.grok_local_usage_7d || usageInfo?.seven_day?.window_stats || null
  const grokLocalUsageMonthly = usageInfo?.grok_local_usage_monthly || usageInfo?.thirty_day?.window_stats || null

  const grokWeeklyBillingBar = ((): GrokQuotaBarInfo | null => {
    const billing = grokBilling
    if (billing?.period_type?.toLowerCase() !== 'weekly' || billing.usage_percent == null) return null
    return {
      utilization: Math.min(100, Math.max(0, billing.usage_percent)),
      resetsAt: billing.period_end || null,
      windowStats: grokLocalUsage7d
    }
  })()

  // Monthly used/limit % from billing probe (used_percent or derived from cents).
  const grokMonthlyBillingBar = ((): GrokQuotaBarInfo | null => {
    const billing = grokBilling
    if (!billing) return null
    let utilization: number | null = null
    if (billing.used_percent != null && Number.isFinite(billing.used_percent)) {
      utilization = billing.used_percent
    } else if (billing.monthly_limit_cents != null && billing.monthly_limit_cents > 0 && billing.used_cents != null) {
      utilization = (billing.used_cents / billing.monthly_limit_cents) * 100
    }
    if (utilization == null) return null
    // Avoid duplicating the weekly bar when period_type is weekly-only without monthly.
    if (billing.period_type?.toLowerCase() === 'weekly' && billing.monthly_limit_cents == null) return null
    return {
      utilization: Math.min(100, Math.max(0, utilization)),
      resetsAt: billing.billing_period_end || billing.period_end || null,
      windowStats: grokLocalUsageMonthly
    }
  })()

  // Prepaid chip only when there is a positive prepaid balance.
  // Used/limit only when monthly limit is a positive number (0 means unlimited / unset).
  const grokPrepaidMoneyLine = (() => {
    const billing = grokBilling
    if (!billing) return null
    const prepaid = billing.prepaid_balance
    const showPrepaid = prepaid != null && Number.isFinite(prepaid) && prepaid > 0
    const limitRaw =
      billing.monthly_limit != null
        ? billing.monthly_limit
        : billing.monthly_limit_cents != null
          ? billing.monthly_limit_cents / 100
          : null
    const showUsedLimit = limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0
    if (!showPrepaid && !showUsedLimit) return null
    const used =
      billing.monthly_used != null ? billing.monthly_used : billing.used_cents != null ? billing.used_cents / 100 : 0
    return {
      showPrepaid,
      showUsedLimit,
      prepaid: showPrepaid ? formatGrokMoney(prepaid) : null,
      used: showUsedLimit ? formatGrokMoney(used) : null,
      limit: showUsedLimit ? formatGrokMoney(limitRaw) : null
    }
  })()

  const grokIsFree = (() => {
    if (account.platform !== 'grok' || account.type !== 'oauth') return false
    const billing = grokBilling
    const plan = (billing?.plan || '').trim().toLowerCase()
    const tier = (usageInfo?.subscription_tier || '').trim().toLowerCase()
    const entitlement = (usageInfo?.grok_entitlement_status || '').toLowerCase()
    if (grokPlanLabelIsFree(tier)) return true
    if (grokPlanLabelIsPaid(tier)) return false
    if (
      billing?.usage_percent != null ||
      billing?.used_percent != null ||
      (billing?.monthly_limit_cents != null && billing.monthly_limit_cents > 0)
    ) {
      return false
    }
    if (grokPlanLabelIsPaid(plan)) return false
    if (grokPlanLabelIsFree(plan) || grokPlanLabelIsFree(entitlement)) return true
    return billing != null
  })()

  const grokFreeQuotaUsage = usageInfo?.grok_local_usage_24h || null
  const grokFreeTokenBar = (() => {
    if (!grokIsFree || !grokFreeQuotaUsage) return null
    const limit = usageInfo?.grok_free_token_limit
    if (typeof limit !== 'number' || limit <= 0) return null
    const used = Math.max(0, grokFreeQuotaUsage.tokens || 0)
    return { utilization: Math.min(100, (used / limit) * 100), limit }
  })()

  const grokQuotaUnknown = (() => {
    if (account.platform !== 'grok') return false
    if (grokIsFree) return !grokFreeTokenBar
    if (grokWeeklyBillingBar || grokMonthlyBillingBar || grokPrepaidMoneyLine) return false
    return usageInfo?.grok_quota_snapshot_state !== 'observed'
  })()

  const grokQuotaUnknownLabel =
    usageInfo?.grok_quota_snapshot_state === 'no_headers'
      ? t('admin.accounts.usageWindow.grokNoHeaders')
      : t('admin.accounts.usageWindow.grokUnknown')

  const grokRetryAfterLabel = (() => {
    const seconds = usageInfo?.grok_retry_after_seconds
    if (seconds == null || seconds <= 0) return null
    if (seconds < 60) return `${seconds}s`
    return `${Math.ceil(seconds / 60)}m`
  })()

  // Antigravity 403 forbidden 状态
  const isForbidden = !!usageInfo?.is_forbidden
  const forbiddenType = usageInfo?.forbidden_type || 'forbidden'
  const validationURL = usageInfo?.validation_url || ''

  // 需要重新授权（401）
  const needsReauth = !!usageInfo?.needs_reauth

  // 降级错误标签（rate_limited / network_error）
  const usageErrorLabel =
    usageInfo?.error_code === 'rate_limited' ? t('admin.accounts.rateLimited') : t('admin.accounts.usageError')

  const forbiddenLabel =
    forbiddenType === 'validation'
      ? t('admin.accounts.forbiddenValidation')
      : forbiddenType === 'violation'
        ? t('admin.accounts.forbiddenViolation')
        : t('admin.accounts.forbidden')

  const isAnthropicOAuthOrSetupToken =
    account.platform === 'anthropic' && (account.type === 'oauth' || account.type === 'setup-token')

  // ===== API Key quota progress bars =====
  const hasApiKeyQuota =
    supportsAccountQuota(account.type) &&
    ((account.quota_daily_limit ?? 0) > 0 || (account.quota_weekly_limit ?? 0) > 0 || (account.quota_limit ?? 0) > 0)

  const quotaDailyBar =
    (account.quota_daily_limit ?? 0) > 0
      ? makeQuotaBar(account, account.quota_daily_used ?? 0, account.quota_daily_limit ?? 0, 'quota_daily_start')
      : null
  const quotaWeeklyBar =
    (account.quota_weekly_limit ?? 0) > 0
      ? makeQuotaBar(account, account.quota_weekly_used ?? 0, account.quota_weekly_limit ?? 0, 'quota_weekly_start')
      : null
  const quotaTotalBar =
    (account.quota_limit ?? 0) > 0 ? makeQuotaBar(account, account.quota_used ?? 0, account.quota_limit ?? 0) : null

  // ===== Key account today stats formatters =====
  const formatKeyRequests = todayStats ? formatCompactNumber(todayStats.requests, { allowBillions: false }) : ''
  const formatKeyTokens = todayStats ? formatCompactNumber(todayStats.tokens) : ''
  const formatKeyCost = todayStats ? todayStats.cost.toFixed(2) : '0.00'
  const formatKeyUserCost = todayStats && todayStats.user_cost != null ? todayStats.user_cost.toFixed(2) : '0.00'

  // ===== 数据加载 =====

  const requestParentBatchUsage = (options?: { force?: boolean }) => {
    if (!isBatchManaged || !shouldFetchUsage) return
    requestBatchedUsage?.(account, options)
  }

  const syncManagedUsageState = () => {
    if (!isBatchManaged) return
    setUsageInfo(batchedUsage ?? null)
    setError(batchedUsageError ?? null)
    setLoading(batchedUsageLoading === true)
  }

  const loadUsage = async (options?: { source?: UsageSource; bypassCache?: boolean }) => {
    if (!shouldFetchUsage) return
    if (isBatchManaged) {
      requestParentBatchUsage({ force: options?.bypassCache === true })
      return
    }

    const accountID = account.id
    // Check cache
    if (!options?.bypassCache) {
      const cached = _usageCache.get(accountID)
      if (cached && Date.now() - cached.ts < USAGE_CACHE_TTL) {
        setUsageInfo(cached.data)
        setLoading(false)
        return
      }
    }

    setLoading(true)
    setError(null)

    try {
      const fetchFn = () =>
        options?.source
          ? adminAPI.accounts.getUsage(accountID, options.source, options.bypassCache === true)
          : adminAPI.accounts.getUsage(accountID)
      const result = await enqueueUsageRequest(account, fetchFn)
      if (!disposed.current) {
        setUsageInfo(result)
        _usageCache.set(accountID, { data: result, ts: Date.now() })
      }
    } catch (e: unknown) {
      if (!disposed.current) {
        setError(t('common.error'))
        console.error('Failed to load usage:', e)
      }
    } finally {
      if (!disposed.current) setLoading(false)
    }
  }

  const flushPendingAutoLoad = () => {
    if (!pendingAutoLoad.current) return
    const source = pendingAutoLoadSource.current
    pendingAutoLoad.current = false
    pendingAutoLoadSource.current = undefined
    loadUsage({ source }).catch((e) => {
      console.error('Failed to load deferred usage:', e)
    })
  }

  const requestAutoLoad = (source?: UsageSource) => {
    if (!shouldFetchUsage) return
    if (shouldLazyLoadOnMobile && !hasEnteredViewportRef.current) {
      pendingAutoLoad.current = true
      pendingAutoLoadSource.current = source
      return
    }
    loadUsage({ source }).catch((e) => {
      console.error('Failed to auto load usage:', e)
    })
  }

  const loadActiveUsage = async () => {
    setActiveQueryLoading(true)
    try {
      const result = await adminAPI.accounts.getUsage(account.id, 'active', true)
      if (!disposed.current) setUsageInfo(result)
    } catch (e: unknown) {
      console.error('Failed to load active usage:', e)
    } finally {
      if (!disposed.current) setActiveQueryLoading(false)
    }
  }

  // The probe persists upstream quota state; refresh this cell so its compact
  // bars and entitlement status reflect the newly observed snapshot.
  const handleGrokProbed = async () => {
    await loadUsage({ source: 'active', bypassCache: true })
  }

  const copyValidationURL = async () => {
    if (!validationURL) return
    try {
      await navigator.clipboard.writeText(validationURL)
      setLinkCopied(true)
      window.setTimeout(() => {
        if (!disposed.current) setLinkCopied(false)
      }, 2000)
    } catch {
      // fallback: ignore
    }
  }

  const handleQuotaResetAccountUpdated = (updated: Account) => {
    onAccountUpdated?.(updated)
  }

  const handleOllamaCloudUsageUpdated = (state: NonNullable<Account['ollama_cloud_usage']>) => {
    onAccountUpdated?.({ ...account, ollama_cloud_usage: state })
  }

  const handleOpenCodeGoUsageUpdated = (state: NonNullable<Account['opencode_go_usage']>) => {
    onAccountUpdated?.({ ...account, opencode_go_usage: state })
  }

  // effect 内通过 ref 调用最新的处理函数（Vue 版 watch 回调读取的总是最新 props）
  const latest = useRef({
    requestParentBatchUsage,
    syncManagedUsageState,
    requestAutoLoad,
    flushPendingAutoLoad,
    loadUsage
  })
  useEffect(() => {
    latest.current = { requestParentBatchUsage, syncManagedUsageState, requestAutoLoad, flushPendingAutoLoad, loadUsage }
  })

  // 有用量数据时通知父组件
  const onUsageLoadedRef = useRef(onUsageLoaded)
  useEffect(() => {
    onUsageLoadedRef.current = onUsageLoaded
  })
  useEffect(() => {
    if (usageInfo) onUsageLoadedRef.current?.(usageInfo)
  }, [usageInfo])

  // 挂载：监听桌面视口；父组件批量拉取时向父组件申请，否则自行按需加载
  const mountRef = useRef({ isBatchManaged, shouldAutoLoadUsageOnMount, isAnthropicOAuthOrSetupToken })
  useEffect(() => {
    disposed.current = false
    let mediaQuery: MediaQueryList | null = null
    const listener = (event: MediaQueryListEvent) => setIsDesktopViewport(event.matches)
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      mediaQuery = window.matchMedia(desktopViewportQuery)
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', listener)
      } else {
        mediaQuery.addListener(listener)
      }
    }

    const mount = mountRef.current
    if (mount.isBatchManaged) {
      latest.current.requestParentBatchUsage()
    } else if (mount.shouldAutoLoadUsageOnMount) {
      latest.current.requestAutoLoad(mount.isAnthropicOAuthOrSetupToken ? 'passive' : undefined)
    }

    return () => {
      disposed.current = true
      if (mediaQuery) {
        if (typeof mediaQuery.removeEventListener === 'function') {
          mediaQuery.removeEventListener('change', listener)
        } else {
          mediaQuery.removeListener(listener)
        }
      }
    }
  }, [])

  // 由非批量切换为批量时，同步父组件状态并申请一次
  useOnChange(isBatchManaged, (managed, wasManaged) => {
    if (managed && !wasManaged) {
      latest.current.syncManagedUsageState()
      latest.current.requestParentBatchUsage()
    }
  })

  // 批量模式下行内账号变化（id / 平台 / 类型）时重新申请
  useOnChange(
    [account.id, account.platform, account.type, isBatchManaged] as const,
    ([accountID, platform, accountType, managed], [previousAccountID, previousPlatform, previousAccountType]) => {
      if (accountID === previousAccountID && platform === previousPlatform && accountType === previousAccountType) return
      if (!managed || !shouldFetchUsage) return
      latest.current.syncManagedUsageState()
      latest.current.requestParentBatchUsage()
    },
    sameTuple
  )

  // OpenAI 行数据刷新（重置、限流变化等）时重新拉取用量
  useOnChange(openAIUsageRefreshKey, (nextKey, prevKey) => {
    if (!prevKey || nextKey === prevKey) return
    if (account.platform !== 'openai' || account.type !== 'oauth') return

    if (isBatchManaged) {
      latest.current.requestParentBatchUsage({ force: true })
      return
    }

    _usageCache.delete(account.id)
    latest.current.requestAutoLoad()
  })

  // 列表手动刷新信号
  useOnChange(manualRefreshToken, () => {
    if (!shouldFetchUsage) return

    if (isBatchManaged) {
      latest.current.requestParentBatchUsage({ force: true })
      return
    }

    const source = isAnthropicOAuthOrSetupToken ? 'passive' : undefined
    _usageCache.delete(account.id)
    latest.current.loadUsage({ source, bypassCache: true }).catch((e) => {
      console.error('Failed to refresh usage after manual refresh:', e)
    })
  })

  // 移动端：进入视口（预留 200px）后才加载
  useEffect(() => {
    if (!shouldLazyLoadOnMobile || hasEnteredViewport) return
    const markEntered = () => {
      hasEnteredViewportRef.current = true
      setHasEnteredViewport(true)
      latest.current.flushPendingAutoLoad()
    }
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      markEntered()
      return
    }
    if (!rootEl) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        markEntered()
      },
      { root: null, rootMargin: '200px 0px', threshold: 0.01 }
    )
    observer.observe(rootEl)
    return () => observer.disconnect()
  }, [rootEl, shouldLazyLoadOnMobile, hasEnteredViewport])

  // 切回桌面视口时立即加载挂起的请求；切到移动端重新等待进入视口
  useOnChange(isDesktopViewport, (isDesktop) => {
    if (isDesktop) {
      hasEnteredViewportRef.current = true
      setHasEnteredViewport(true)
      latest.current.flushPendingAutoLoad()
      return
    }
    hasEnteredViewportRef.current = false
    setHasEnteredViewport(false)
  })

  // ===== 渲染 =====

  const refreshIcon = (spinning: boolean) => (
    <RefreshCw className={[styles.actionIcon, spinning ? styles.spin : ''].join(' ')} aria-hidden="true" />
  )

  const activeQueryButton = (
    <button
      type="button"
      className={styles.action}
      disabled={activeQueryLoading}
      onClick={() => void loadActiveUsage()}
    >
      {refreshIcon(activeQueryLoading)}
      {t('admin.accounts.usageWindow.activeQuery')}
    </button>
  )

  const todayStatsRow = todayStats ? (
    <div className={styles.statsRow}>
      <span className={styles.statChip}>{formatKeyRequests} req</span>
      <span className={styles.statChip}>{formatKeyTokens}</span>
      <span className={styles.statChip} title={t('usage.accountBilled')}>
        A ${formatKeyCost}
      </span>
      {todayStats.user_cost != null ? (
        <span className={styles.statChip} title={t('usage.userBilled')}>
          U ${formatKeyUserCost}
        </span>
      ) : null}
    </div>
  ) : null

  const quotaBars = (
    <>
      {quotaDailyBar ? (
        <UsageProgressBar label="1d" utilization={quotaDailyBar.utilization} resetsAt={quotaDailyBar.resetsAt} color="indigo" />
      ) : null}
      {quotaWeeklyBar ? (
        <UsageProgressBar
          label="7d"
          utilization={quotaWeeklyBar.utilization}
          resetsAt={quotaWeeklyBar.resetsAt}
          color="emerald"
        />
      ) : null}
      {quotaTotalBar ? <UsageProgressBar label="total" utilization={quotaTotalBar.utilization} color="purple" /> : null}
    </>
  )

  const dash = <div className={styles.dash}>-</div>

  const renderAnthropic = () => (
    <>
      {loading ? (
        // OAuth: 3 rows, Setup Token: 1 row
        <div className={styles.stackLoose}>
          <SkeletonBarRow />
          {account.type === 'oauth' ? (
            <>
              <SkeletonBarRow />
              <SkeletonBarRow />
            </>
          ) : null}
        </div>
      ) : error ? (
        <div className={styles.errorLine}>{error}</div>
      ) : usageInfo ? (
        <div className={styles.stack}>
          {/* API error (degraded response) */}
          {usageInfo.error ? (
            <div className={styles.warningTruncate} title={usageInfo.error}>
              {usageInfo.error}
            </div>
          ) : null}
          {/* 5h Window */}
          {usageInfo.five_hour ? (
            <UsageProgressBar
              label="5h"
              utilization={usageInfo.five_hour.utilization}
              resetsAt={usageInfo.five_hour.resets_at}
              windowStats={usageInfo.five_hour.window_stats}
              color="indigo"
            />
          ) : null}
          {/* 7d Window (OAuth only) */}
          {usageInfo.seven_day ? (
            <UsageProgressBar
              label="7d"
              utilization={usageInfo.seven_day.utilization}
              resetsAt={usageInfo.seven_day.resets_at}
              color="emerald"
            />
          ) : null}
          {/* 7d Sonnet Window (OAuth only) */}
          {usageInfo.seven_day_sonnet ? (
            <UsageProgressBar
              label="7d S"
              utilization={usageInfo.seven_day_sonnet.utilization}
              resetsAt={usageInfo.seven_day_sonnet.resets_at}
              color="purple"
            />
          ) : null}
          {/* 7d Fable Window (7d_oi) */}
          {usageInfo.seven_day_fable ? (
            <UsageProgressBar
              label="7d F"
              utilization={usageInfo.seven_day_fable.utilization}
              resetsAt={usageInfo.seven_day_fable.resets_at}
              color="amber"
            />
          ) : null}
        </div>
      ) : (
        // No data yet
        <div className={styles.stack}>{dash}</div>
      )}
      {/*
        One stable instance for every usage state, so a reset-credit query started
        while usage is still loading survives the usage response. The local query
        button shares its row once usage data exists.
      */}
      <ClaudeResetCreditsCell
        account={account}
        className={local.followUp}
        onRedeemed={() => void loadActiveUsage()}
        preActions={
          usageInfo ? (
            <>
              {usageInfo.source === 'passive' ? (
                <span className={styles.passive}>{t('admin.accounts.usageWindow.passiveSampled')}</span>
              ) : null}
              {activeQueryButton}
            </>
          ) : undefined
        }
      />
    </>
  )

  const renderOpenAI = () =>
    hasOpenAIUsageFallback ? (
      <div className={styles.stack}>
        {usageInfo?.five_hour ? (
          <UsageProgressBar
            label="5h"
            utilization={usageInfo.five_hour.utilization}
            resetsAt={usageInfo.five_hour.resets_at}
            windowStats={usageInfo.five_hour.window_stats}
            showNowWhenIdle
            color="indigo"
          />
        ) : null}
        {usageInfo?.seven_day ? (
          <UsageProgressBar
            label="7d"
            utilization={usageInfo.seven_day.utilization}
            resetsAt={usageInfo.seven_day.resets_at}
            windowStats={usageInfo.seven_day.window_stats}
            estimatedTotalCost={openAISevenDayEstimatedTotalCost}
            showNowWhenIdle
            color="emerald"
          />
        ) : null}
        {/*
          Upstream codex /wham/usage quota query + reset. The local active-sampling
          refresh button is rendered via preActions so the user sees a
          single row of related buttons instead of two stacked rows.
        */}
        <OpenAIQuotaResetCell
          account={account}
          onAccountUpdated={handleQuotaResetAccountUpdated}
          preActions={activeQueryButton}
        />
      </div>
    ) : loading ? (
      <div className={styles.stackLoose}>
        <SkeletonBarRow />
        <SkeletonBarRow />
      </div>
    ) : (
      <div>
        {dash}
        {/* Always allow on-demand upstream quota query, even before local data exists. */}
        <OpenAIQuotaResetCell account={account} className={local.followUp} onAccountUpdated={handleQuotaResetAccountUpdated} />
      </div>
    )

  const antigravityCreditsLine = aiCreditsDisplay ? (
    <span className={local.creditsLine}>
      <CreditCard className={styles.actionIcon} aria-hidden="true" />
      {t('admin.accounts.aiCreditsBalance')}: {aiCreditsDisplay}
    </span>
  ) : null

  const renderAntigravity = () => (
    <>
      {/* 账户类型徽章 */}
      {antigravityTierLabel ? (
        <div className={styles.tagRow}>
          <span className={styles.tag} data-tone={antigravityTierTone}>
            {antigravityTierLabel}
          </span>
          {/* 不合格账户警告图标 */}
          {hasIneligibleTiers ? (
            <HoverHint icon={<CircleAlert className={local.hintIcon} aria-hidden="true" />} tone="danger">
              {t('admin.accounts.ineligibleWarning')}
            </HoverHint>
          ) : null}
        </div>
      ) : null}

      {isForbidden ? (
        // Forbidden state (403)
        <div className={styles.stack}>
          <span className={styles.tag} data-tone={forbiddenType === 'validation' ? 'warning' : 'danger'}>
            {forbiddenLabel}
          </span>
          {validationURL ? (
            <div className={styles.wrapRow}>
              <a
                href={validationURL}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.link}
                title={t('admin.accounts.openVerification')}
              >
                {t('admin.accounts.openVerification')}
              </a>
              <button
                type="button"
                className={styles.plainButton}
                title={t('admin.accounts.copyLink')}
                onClick={() => void copyValidationURL()}
              >
                {linkCopied ? t('admin.accounts.linkCopied') : t('admin.accounts.copyLink')}
              </button>
            </div>
          ) : null}
        </div>
      ) : needsReauth ? (
        // Needs reauth (401)
        <div className={styles.stack}>
          <span className={styles.tag} data-tone="warning">
            {t('admin.accounts.needsReauth')}
          </span>
        </div>
      ) : usageInfo?.error ? (
        // Degraded error (non-403, non-401)
        <div className={styles.stack}>
          <span className={styles.tag} data-tone="warning">
            {usageErrorLabel}
          </span>
        </div>
      ) : loading ? (
        <div className={styles.stackLoose}>
          <SkeletonBarRow />
        </div>
      ) : error ? (
        <div className={styles.errorLine}>{error}</div>
      ) : hasAntigravityQuotaFromAPI ? (
        // Usage data from API
        <div className={styles.stack}>
          {/* Gemini 3 Pro */}
          {antigravity3ProUsageFromAPI !== null ? (
            <UsageProgressBar
              label={t('admin.accounts.usageWindow.gemini3Pro')}
              utilization={antigravity3ProUsageFromAPI.utilization}
              resetsAt={antigravity3ProUsageFromAPI.resetTime}
              color="indigo"
            />
          ) : null}
          {/* Gemini 3 Flash */}
          {antigravity3FlashUsageFromAPI !== null ? (
            <UsageProgressBar
              label={t('admin.accounts.usageWindow.gemini3Flash')}
              utilization={antigravity3FlashUsageFromAPI.utilization}
              resetsAt={antigravity3FlashUsageFromAPI.resetTime}
              color="emerald"
            />
          ) : null}
          {/* Gemini 3 Image */}
          {antigravity3ImageUsageFromAPI !== null ? (
            <UsageProgressBar
              label={t('admin.accounts.usageWindow.gemini3Image')}
              utilization={antigravity3ImageUsageFromAPI.utilization}
              resetsAt={antigravity3ImageUsageFromAPI.resetTime}
              color="purple"
            />
          ) : null}
          {/* Claude */}
          {antigravityClaudeUsageFromAPI !== null ? (
            <UsageProgressBar
              label={t('admin.accounts.usageWindow.claude')}
              utilization={antigravityClaudeUsageFromAPI.utilization}
              resetsAt={antigravityClaudeUsageFromAPI.resetTime}
              color="amber"
            />
          ) : null}
          {antigravityCreditsLine ? <div className={local.credits}>{antigravityCreditsLine}</div> : null}
        </div>
      ) : antigravityCreditsLine ? (
        <div className={styles.mutedLine}>{antigravityCreditsLine}</div>
      ) : (
        dash
      )}
    </>
  )

  const grokProbe = <GrokQuotaProbeCell account={account} compact onProbed={() => void handleGrokProbed()} />

  const renderGrok = () =>
    loading ? (
      <div className={styles.stackLoose}>
        <SkeletonBarRow />
      </div>
    ) : error ? (
      <div className={styles.errorLine}>{error}</div>
    ) : needsReauth ? (
      <div className={styles.stack}>
        <span className={styles.tag} data-tone="warning">
          {t('admin.accounts.needsReauth')}
        </span>
      </div>
    ) : isForbidden ? (
      <div className={styles.stack}>
        <span className={styles.tag} data-tone="danger">
          {usageInfo?.grok_entitlement_status || t('admin.accounts.forbidden')}
        </span>
      </div>
    ) : usageInfo ? (
      <div className={styles.stack}>
        {/* Free: only rolling 24h soft-gate bar. Paid: 7d + 30d + prepaid money. */}
        {grokIsFree ? (
          grokFreeTokenBar ? (
            <UsageProgressBar
              label="24h"
              title={t('admin.accounts.usageWindow.grokFreeQuota24hHint', {
                limit: formatCompactNumber(grokFreeTokenBar.limit)
              })}
              utilization={grokFreeTokenBar.utilization}
              windowStats={grokFreeQuotaUsage}
              showNowWhenIdle
              color="emerald"
            />
          ) : grokQuotaUnknown ? (
            <div className={styles.mutedLine}>{grokQuotaUnknownLabel}</div>
          ) : null
        ) : (
          <>
            {grokWeeklyBillingBar ? (
              <UsageProgressBar
                label="7d"
                utilization={grokWeeklyBillingBar.utilization}
                resetsAt={grokWeeklyBillingBar.resetsAt}
                windowStats={grokWeeklyBillingBar.windowStats}
                showNowWhenIdle
                color="indigo"
              />
            ) : null}
            {grokMonthlyBillingBar ? (
              <UsageProgressBar
                label="30d"
                utilization={grokMonthlyBillingBar.utilization}
                resetsAt={grokMonthlyBillingBar.resetsAt}
                windowStats={grokMonthlyBillingBar.windowStats}
                showNowWhenIdle
                color="indigo"
              />
            ) : null}
            {grokPrepaidMoneyLine ? (
              <div className={local.moneyLine}>
                {grokPrepaidMoneyLine.showPrepaid ? (
                  <span className={styles.tag} data-tone="success" title={t('admin.accounts.usageWindow.grokPrepaid')}>
                    {t('admin.accounts.usageWindow.grokPrepaid')} ${grokPrepaidMoneyLine.prepaid}
                  </span>
                ) : null}
                {grokPrepaidMoneyLine.showUsedLimit ? (
                  <span title={t('admin.accounts.usageWindow.grokMonthlyLimit')}>
                    {t('admin.accounts.usageWindow.grokUsed')} {grokPrepaidMoneyLine.used}/{grokPrepaidMoneyLine.limit}
                  </span>
                ) : null}
              </div>
            ) : null}
            {grokQuotaUnknown ? <div className={styles.mutedLine}>{grokQuotaUnknownLabel}</div> : null}
          </>
        )}
        {usageInfo.error ? (
          <div className={styles.warningTruncate} title={usageInfo.error}>
            {usageErrorLabel}
          </div>
        ) : null}
        {grokRetryAfterLabel ? (
          <div className={styles.warningTiny}>
            {t('admin.accounts.usageWindow.grokRetryAfter', { time: grokRetryAfterLabel })}
          </div>
        ) : null}
        {grokProbe}
      </div>
    ) : (
      <div className={styles.stack}>
        {dash}
        {grokProbe}
      </div>
    )

  // Multi-protocol API-key providers (CN vendors, OpenCode, Command Code):
  // coding-plan / subscription quota windows or balance
  const renderMultiProtocol = () =>
    // 挂在 CN 平台下的 Ollama Cloud 账号（资格由后端下发 eligible）：用量由
    // Ollama 用量窗口负责。这类账号不是国产厂商订阅，CN 的额度/余额探测端点由
    // base_url 衍生，对 ollama.com 会被后端出站 URL 白名单拒绝，渲染出来只会
    // 给用户一行探测报错，因此不再渲染 CN 子单元格与占位符。
    account.ollama_cloud_usage?.eligible ? (
      <OllamaCloudUsageCell account={account} onUpdated={handleOllamaCloudUsageUpdated} />
    ) : // 挂在 CN 平台下的 OpenCode Go 账号（资格由后端下发 eligible）：用量展示与
    // 刷新由本分支的 OpenCode 用量窗口独占。对 platform=opencode_go：上游 CN
    // 配额链路原生支持该平台（cnQuotaCellVisible 对它返回 true），但其探测
    // 端点（base_url + "/usage"，默认 base 即官方 Go 基址）与本 cell 刷新的
    // 是同一端点、同一份数据，抑制 CN 子单元格是为了避免同源双份探测与重复
    // 展示。对挂载在 kimi/zhipu/deepseek/minimax 下的账号：CN 的额度/余额
    // 探测端点由 base_url 衍生，对 opencode.ai 会被后端出站 URL 白名单拒绝，
    // 渲染出来只会给用户一行探测报错。两种情况都不再渲染 CN 子单元格与
    // 占位符（调度停调仍由上游 CN 触发各自驱动）。
    account.opencode_go_usage?.eligible ? (
      <OpenCodeGoUsageCell account={account} onUpdated={handleOpenCodeGoUsageUpdated} />
    ) : (
      <div className={styles.stack}>
        {/* 子单元格各自按 模式×平台 判定可见；两者都不可见时（智谱 payg 无公开
            余额端点、coding 探测也不适用）才回落到占位符。 */}
        {!cnQuotaCellVisible && !cnBalanceCellVisible ? (
          <div className={styles.dash} title={t('admin.accounts.cnProviders.noBalanceEndpoint')}>
            -
          </div>
        ) : null}
        <CNProviderQuotaCell account={account} />
        <CNProviderBalanceCell account={account} />
      </div>
    )

  const renderGemini = () => (
    <>
      {/* Auth Type + Tier Badge (first line) */}
      {geminiAuthTypeLabel ? (
        <div className={styles.tagRow}>
          <span className={styles.tag} data-tone={geminiTierTone}>
            {geminiAuthTypeLabel}
          </span>
          {/* Help icon */}
          {showGeminiQuotaPolicy ? (
            <HoverHint icon={<CircleHelp className={local.hintIcon} aria-hidden="true" />}>
              <span className={local.hintTitle}>{t('admin.accounts.gemini.quotaPolicy.title')}</span>
              <span className={local.hintNote}>{t('admin.accounts.gemini.quotaPolicy.note')}</span>
              <span className={local.hintBody}>
                <strong>{geminiQuotaPolicyChannel}:</strong>
                <span className={local.hintIndent}>• {geminiQuotaPolicyLimits}</span>
                <a href={geminiQuotaPolicyDocsUrl} target="_blank" rel="noopener noreferrer" className={local.hintLink}>
                  {t('admin.accounts.gemini.quotaPolicy.columns.docs')} →
                </a>
              </span>
            </HoverHint>
          ) : null}
        </div>
      ) : null}

      {/* Usage data or unlimited flow */}
      <div className={styles.stack}>
        {showGeminiTodayStats && todayStats ? (
          todayStatsRow
        ) : showGeminiTodayStats && todayStatsLoading ? (
          <SkeletonStatsRow />
        ) : null}
        {/* Vertex 设置了配额上限：显示配额进度条 */}
        {isGeminiVertex ? quotaBars : null}
        {loading ? (
          <div className={styles.stack}>
            <SkeletonBarRow />
          </div>
        ) : error ? (
          <div className={styles.errorLine}>{error}</div>
        ) : geminiUsageAvailable ? (
          // Gemini: show daily usage bars when available
          <div className={styles.stack}>
            {geminiUsageBars.map((bar) => (
              <UsageProgressBar
                key={bar.key}
                label={bar.label}
                utilization={bar.utilization}
                resetsAt={bar.resetsAt}
                windowStats={bar.windowStats}
                color={bar.color}
              />
            ))}
            <p className={styles.noteLine}>
              * {t('admin.accounts.gemini.quotaPolicy.simulatedNote') || 'Simulated quota'}
            </p>
          </div>
        ) : !showGeminiTodayStats ? (
          // AI Studio Client OAuth: show unlimited flow (no usage tracking)
          <div className={styles.dash}>{t('admin.accounts.gemini.rateLimit.unlimited')}</div>
        ) : null}
      </div>
    </>
  )

  if (showUsageWindows) {
    let content: ReactNode
    if (account.platform === 'anthropic' && (account.type === 'oauth' || account.type === 'setup-token')) {
      // Anthropic OAuth and Setup Token accounts: fetch real usage data
      content = renderAnthropic()
    } else if (account.platform === 'openai' && account.type === 'oauth') {
      // OpenAI OAuth accounts: single source from /usage API
      content = renderOpenAI()
    } else if (account.platform === 'antigravity' && account.type === 'oauth') {
      // Antigravity OAuth accounts: fetch usage from API
      content = renderAntigravity()
    } else if (account.platform === 'grok' && account.type === 'oauth') {
      // Grok OAuth accounts: passive xAI quota headers + local Sub2API usage
      content = renderGrok()
    } else if (isMultiProtocolApiKeyPlatform(account.platform)) {
      content = renderMultiProtocol()
    } else if (account.platform === 'gemini') {
      // Gemini platform: show quota + local usage window
      content = renderGemini()
    } else {
      // Other accounts: no usage window
      content = dash
    }
    return <div ref={setRootEl}>{content}</div>
  }

  // Non-OAuth/Setup-Token accounts
  return (
    <div ref={setRootEl}>
      {account.platform === 'gemini' && !isGeminiThirdPartyApiKey ? (
        // Gemini API Key accounts: show quota info
        <AccountQuotaInfo account={account} />
      ) : (
        // Key/Bedrock accounts: show today stats + optional quota bars
        <div className={styles.stack}>
          {account.ollama_cloud_usage?.eligible ? (
            <OllamaCloudUsageCell account={account} onUpdated={handleOllamaCloudUsageUpdated} />
          ) : // 与上方 CN 分支结构对齐：Ollama 与 OpenCode 用量身份互斥（基址 host 不同），
          // 互斥分支提供结构性保证，不改变实际渲染结果。
          account.opencode_go_usage?.eligible ? (
            <OpenCodeGoUsageCell account={account} onUpdated={handleOpenCodeGoUsageUpdated} />
          ) : null}
          {/* Today stats row (requests, tokens, cost, user_cost) */}
          {todayStats ? todayStatsRow : todayStatsLoading ? <SkeletonStatsRow /> : null}

          {/* API Key accounts with quota limits: show progress bars */}
          {quotaBars}

          {/* No data at all */}
          {!todayStats &&
          !todayStatsLoading &&
          !hasApiKeyQuota &&
          !account.ollama_cloud_usage?.eligible &&
          !account.opencode_go_usage?.eligible
            ? dash
            : null}
        </div>
      )}
    </div>
  )
}
