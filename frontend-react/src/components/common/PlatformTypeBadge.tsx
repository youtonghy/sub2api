import { Cloud, Key, KeyRound, Shield, ShieldAlert, ShieldCheck, Zap } from 'lucide-react'

import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { useI18n } from '@/i18n/useI18n'
import type { AccountPlatform, AccountType } from '@/types'
import { platformLabel as sharedPlatformLabel } from '@/utils/platformColors'
import { normalizePlanType, openAIPlanTypeLabel } from '@/utils/planType'
import GrokFreeIcon from './GrokFreeIcon'
import PlatformIcon from './PlatformIcon'
import styles from './PlatformTypeBadge.module.css'

export interface PlatformTypeBadgeProps {
  platform: AccountPlatform
  type: AccountType
  authMode?: string
  planType?: string
  privacyMode?: string
  subscriptionExpiresAt?: string
}

/**
 * 色系名沿用 Vue 版的 Tailwind 色名，渲染为 data-color（便于测试与后续主题细化），
 * 实际颜色映射到 Arc badge 的语义色调。
 */
type ChipColor =
  | 'orange' | 'emerald' | 'purple' | 'zinc' | 'pink' | 'indigo' | 'teal' | 'rose' | 'blue'
  | 'red' | 'gray' | 'cyan' | 'amber' | 'sky' | 'violet' | 'green' | 'yellow'

const COLOR_TONES: Record<ChipColor, BadgeTone> = {
  orange: 'warning',
  amber: 'warning',
  yellow: 'warning',
  emerald: 'success',
  green: 'success',
  red: 'danger',
  gray: 'neutral',
  zinc: 'neutral',
  purple: 'info',
  pink: 'info',
  indigo: 'info',
  teal: 'info',
  rose: 'info',
  blue: 'info',
  cyan: 'info',
  sky: 'info',
  violet: 'info'
}

const PLATFORM_COLORS: Record<string, ChipColor> = {
  anthropic: 'orange',
  openai: 'emerald',
  antigravity: 'purple',
  grok: 'zinc',
  kimi: 'pink',
  zhipu: 'indigo',
  deepseek: 'teal',
  minimax: 'rose'
}

const OPENAI_TEAM_PLANS = [
  'selfservebusinessusagebased', 'business', 'enterprise', 'ent26', 'enterprisecbpautomation',
  'enterprisecbpusagebased', 'edu', 'eduplus', 'edupro'
]

const SHIELD_ICON_SIZE = 12

export default function PlatformTypeBadge({
  platform,
  type,
  authMode,
  planType,
  privacyMode,
  subscriptionExpiresAt
}: PlatformTypeBadgeProps) {
  const { t } = useI18n()

  const platformLabel = sharedPlatformLabel(platform)
  const normalizedAuthMode = (authMode || '').trim().toLowerCase().replace(/[\s_-]+/g, '')

  const typeLabel = (() => {
    if (platform === 'openai' && type === 'oauth') {
      if (normalizedAuthMode === 'agentidentity') return 'Agent Identity'
      if (normalizedAuthMode === 'personalaccesstoken') return 'PAT'
    }
    switch (type) {
      case 'oauth':
        return 'OAuth'
      case 'setup-token':
        return 'Token'
      case 'apikey':
        return 'Key'
      case 'bedrock':
        return 'AWS'
      case 'service_account':
        return 'Agent Platform (Vertex)'
      default:
        return type
    }
  })()

  const normalizedPlanType = normalizePlanType(planType)
  const isFreeTier = normalizedPlanType === 'free' || normalizedPlanType === 'basic' || normalizedPlanType === 'xbasic'

  const planLabel = (() => {
    if (!normalizedPlanType) return ''
    // ChatGPT 档位命名（Pro 100 / Pro 200 / Pro 500、Business / Business Premium）只适用于
    // OpenAI：Antigravity 与 Grok 各自的 pro/team 沿用下面的通用标签。
    if (platform === 'openai') {
      const label = openAIPlanTypeLabel(planType)
      if (label) return label
    }
    switch (normalizedPlanType) {
      case 'plus':
        return 'Plus'
      case 'team':
        return 'Team'
      case 'chatgptpro':
      case 'pro':
        return 'Pro'
      case 'free':
      case 'basic':
        return platform === 'grok' ? 'Grok Free' : 'Free'
      case 'supergrok':
        return 'SuperGrok'
      case 'supergroklite':
        return 'SuperGrok Lite'
      case 'supergrokplus':
        return 'SuperGrok Plus'
      case 'supergrokheavy':
        return 'SuperGrok Heavy'
      case 'heavy':
        return 'Heavy'
      case 'xbasic':
        return 'X Basic'
      case 'abnormal':
        return t('admin.accounts.subscriptionAbnormal')
      default:
        return planType ?? ''
    }
  })()

  const isGrokFreePlan = platform === 'grok' && isFreeTier

  // Paid Grok tiers (SuperGrok / Heavy) share the bolt mark; free uses GrokFreeIcon.
  const showGrokPlanIcon =
    platform === 'grok' &&
    (normalizedPlanType === 'supergrok' ||
      normalizedPlanType === 'supergrokheavy' ||
      normalizedPlanType === 'heavy' ||
      normalizedPlanType.includes('heavy'))

  const platformColor: ChipColor = PLATFORM_COLORS[platform] ?? 'blue'

  const planColor: ChipColor = (() => {
    if (normalizedPlanType === 'abnormal') return 'red'
    // Free stays muted gray; paid Grok tiers get distinct colors.
    if (isFreeTier) return 'gray'
    if (platform === 'grok' && normalizedPlanType) {
      // Heavy / SuperGrok Heavy → purple
      if (normalizedPlanType.includes('heavy')) return 'purple'
      // SuperGrok → cyan
      if (normalizedPlanType.includes('supergrok')) return 'cyan'
      // Any other non-free Grok plan (future tiers) → amber so it still stands out
      return 'amber'
    }
    // OpenAI / other paid plan labels: keep readable distinction from free gray
    if (normalizedPlanType === 'plus') return 'sky'
    if (
      normalizedPlanType === 'team' ||
      normalizedPlanType === 'selfservebusinessprolite' ||
      (platform === 'openai' && OPENAI_TEAM_PLANS.includes(normalizedPlanType))
    ) {
      return 'indigo'
    }
    if (
      normalizedPlanType === 'pro' ||
      normalizedPlanType === 'chatgptpro' ||
      normalizedPlanType === 'prolite' ||
      (platform === 'openai' && normalizedPlanType === 'promax')
    ) {
      return 'violet'
    }
    return platformColor
  })()

  // Subscription expiration label (non-free only)
  const expiresLabel = (() => {
    if (!subscriptionExpiresAt || !planType) return ''
    if (isFreeTier) return ''
    const d = new Date(subscriptionExpiresAt)
    if (isNaN(d.getTime())) return ''
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${t('admin.accounts.subscriptionExpires')} ${yyyy}-${mm}-${dd}`
  })()

  // Privacy badge — shows different states for OpenAI/Antigravity OAuth privacy setting
  const privacyBadge = (() => {
    if (type !== 'oauth' || !privacyMode) return null
    // 支持 OpenAI 和 Antigravity 平台
    if (platform !== 'openai' && platform !== 'antigravity') return null
    switch (privacyMode) {
      // OpenAI states
      case 'training_off':
        return { label: 'Private', ok: true, title: t('admin.accounts.privacyTrainingOff'), color: 'green' as const }
      case 'training_set_cf_blocked':
        return { label: 'CF', ok: false, title: t('admin.accounts.privacyCfBlocked'), color: 'yellow' as const }
      case 'training_set_failed':
        return { label: 'Fail', ok: false, title: t('admin.accounts.privacyFailed'), color: 'red' as const }
      // Antigravity states
      case 'privacy_set':
        return { label: 'Private', ok: true, title: t('admin.accounts.privacyAntigravitySet'), color: 'green' as const }
      case 'privacy_set_failed':
        return { label: 'Fail', ok: false, title: t('admin.accounts.privacyAntigravityFailed'), color: 'red' as const }
      default:
        return null
    }
  })()

  const typeIcon = (() => {
    if (type === 'oauth') return <KeyRound size={12} strokeWidth={1.75} />
    if (type === 'setup-token') return <Shield size={12} strokeWidth={1.75} />
    if (type === 'service_account') return <Cloud size={12} strokeWidth={1.75} />
    return <Key size={12} strokeWidth={1.75} />
  })()

  const planIcon = isGrokFreePlan
    ? <GrokFreeIcon data-testid="grok-free-plan-icon" />
    : showGrokPlanIcon
      ? <Zap size={12} strokeWidth={1.75} data-testid="grok-plan-icon" aria-hidden="true" />
      : undefined

  return (
    <div className={styles.root}>
      {/* Row 1: Platform + Type */}
      <div className={styles.row}>
        <Badge
          size="sm"
          tone={COLOR_TONES[platformColor]}
          data-color={platformColor}
          icon={<PlatformIcon platform={platform} size="xs" />}
        >
          {platformLabel}
        </Badge>
        <Badge size="sm" tone={COLOR_TONES[platformColor]} data-color={platformColor} icon={typeIcon}>
          {typeLabel}
        </Badge>
      </div>
      {/* Row 2: Plan type + Privacy mode (only if either exists) */}
      {(planLabel || privacyBadge) && (
        <div className={styles.row}>
          {planLabel && (
            <Badge size="sm" tone={COLOR_TONES[planColor]} data-color={planColor} icon={planIcon}>
              {planLabel}
            </Badge>
          )}
          {privacyBadge && (
            <Badge
              size="sm"
              tone={COLOR_TONES[privacyBadge.color]}
              data-color={privacyBadge.color}
              title={privacyBadge.title}
              icon={privacyBadge.ok
                ? <ShieldCheck size={SHIELD_ICON_SIZE} strokeWidth={1.75} />
                : <ShieldAlert size={SHIELD_ICON_SIZE} strokeWidth={1.75} />}
            >
              {privacyBadge.label}
            </Badge>
          )}
        </div>
      )}
      {/* Row 3: Subscription expiration (non-free paid accounts only) */}
      {expiresLabel && (
        <div className={styles.expires} title={subscriptionExpiresAt}>
          {expiresLabel}
        </div>
      )}
    </div>
  )
}
