/**
 * Gemini 账号等级与限流倒计时，对应 Vue 版 AccountQuotaInfo.vue。
 */
import { useEffect, useState } from 'react'

import { useI18n } from '@/i18n/useI18n'
import type { Account, GeminiCredentials } from '@/types'
import styles from './usageCells.module.css'

export interface AccountQuotaInfoProps {
  account: Account
}

type TierTone = 'neutral' | 'info' | 'accent'

// 是否为 Code Assist OAuth
// 判断逻辑与后端保持一致：project_id 存在即为 Code Assist
function isCodeAssistCreds(creds: GeminiCredentials | undefined): boolean {
  // 显式为 code_assist，或 legacy 情况（oauth_type 为空但 project_id 存在）
  return creds?.oauth_type === 'code_assist' || (!creds?.oauth_type && !!creds?.project_id)
}

// Tier 标签文本与徽章色调（统一样式）
function resolveTier(creds: GeminiCredentials | undefined): { label: string; tone: TierTone } {
  const tier = (creds?.tier_id || '').toString().trim().toLowerCase()
  const upper = (creds?.tier_id || '').toString().trim().toUpperCase()

  if (isCodeAssistCreds(creds)) {
    if (tier === 'gcp_enterprise') return { label: 'GCP Enterprise', tone: 'accent' }
    if (tier === 'gcp_standard') return { label: 'GCP Standard', tone: 'info' }
    // Backward compatibility
    if (upper.includes('ULTRA') || upper.includes('ENTERPRISE')) return { label: 'GCP Enterprise', tone: 'accent' }
    if (upper) return { label: `GCP ${upper}`, tone: 'info' }
    return { label: 'GCP', tone: 'info' }
  }

  if (creds?.oauth_type === 'google_one') {
    if (tier === 'google_ai_ultra') return { label: 'Google AI Ultra', tone: 'accent' }
    if (tier === 'google_ai_pro') return { label: 'Google AI Pro', tone: 'info' }
    if (tier === 'google_one_free') return { label: 'Google One Free', tone: 'neutral' }
    // Backward compatibility
    if (upper === 'AI_PREMIUM') return { label: 'Google AI Pro', tone: 'info' }
    if (upper === 'GOOGLE_ONE_UNLIMITED') return { label: 'Google AI Ultra', tone: 'accent' }
    if (upper) return { label: `Google One ${upper}`, tone: 'neutral' }
    return { label: 'Google One', tone: 'neutral' }
  }

  // API Key: 显示 AI Studio（默认蓝色）
  if (tier === 'aistudio_paid') return { label: 'AI Studio Pay-as-you-go', tone: 'info' }
  if (tier === 'aistudio_free') return { label: 'AI Studio Free Tier', tone: 'neutral' }
  return { label: 'AI Studio', tone: 'info' }
}

function parseResetTime(value: string | null | undefined): number | null {
  if (!value) return null
  const time = Date.parse(value)
  // 防护：如果日期解析失败（NaN），则认为未限流
  return Number.isNaN(time) ? null : time
}

export default function AccountQuotaInfo({ account }: AccountQuotaInfoProps) {
  const { t } = useI18n()
  const [now, setNow] = useState(() => Date.now())

  const resetRaw = account.rate_limit_reset_at
  const resetTime = parseResetTime(resetRaw)
  // 是否限流
  const isRateLimited = resetTime !== null && resetTime > now

  // 监听限流状态，动态启动/停止定时器（挂载时已限流也能启动）
  useEffect(() => {
    if (!isRateLimited) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isRateLimited])

  // 是否应该显示配额信息
  if (account.platform !== 'gemini') return null

  const { label: tierLabel, tone: tierTone } = resolveTier(account.credentials as GeminiCredentials | undefined)

  // 倒计时文本
  const resetCountdown = (() => {
    if (!resetRaw) return ''
    // 防护：如果日期解析失败，显示 "-"
    if (resetTime === null) return '-'
    const diffMs = resetTime - now
    if (diffMs <= 0) return t('admin.accounts.gemini.rateLimit.now')

    const diffSeconds = Math.floor(diffMs / 1000)
    const diffMinutes = Math.floor(diffSeconds / 60)
    const diffHours = Math.floor(diffMinutes / 60)

    if (diffMinutes < 1) return `${diffSeconds}s`
    if (diffHours < 1) return `${diffMinutes}m ${diffSeconds % 60}s`
    return `${diffHours}h ${diffMinutes % 60}m`
  })()

  // 是否紧急（< 1分钟）
  const isUrgent = resetTime !== null && resetTime - now > 0 && resetTime - now < 60000

  return (
    <div>
      {/* First line: Platform + Tier Badge */}
      <div className={styles.tagRow}>
        <span className={styles.tag} data-tone={tierTone}>
          {tierLabel}
        </span>
      </div>

      {/* Usage status: unlimited flow or rate limit */}
      <div className={styles.dash}>
        {!isRateLimited ? (
          <span>{t('admin.accounts.gemini.rateLimit.unlimited')}</span>
        ) : (
          <span className={isUrgent ? styles.errorTiny : styles.warningTiny} data-urgent={isUrgent ? '' : undefined}>
            {t('admin.accounts.gemini.rateLimit.limited', { time: resetCountdown })}
          </span>
        )}
      </div>
    </div>
  )
}
