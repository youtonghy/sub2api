/**
 * 用户平台配额单元格，对应 Vue 版 UserPlatformQuotaCell.vue：
 * 加载中显示 …，未配置时显示提示，否则按平台清单顺序列出 已用/限额（日 / 周 / 月）。
 */
import type { PlatformQuotaItem } from '@/api/admin/users'
import { listPlatformIds } from '@/constants/platformCatalog'
import { useI18n } from '@/i18n/useI18n'
import styles from './userCells.module.css'

export interface UserPlatformQuotaCellProps {
  quotas?: PlatformQuotaItem[]
}

// 按平台清单顺序展示；未登记的平台排在最后。
function platformRank(platform: string): number {
  const index = listPlatformIds().indexOf(platform)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

// 去尾零、最多 2 位小数：100→"100"，90.5→"90.5"，0.42→"0.42"
function fmtUsd(n: number): string {
  if (n == null || Number.isNaN(n)) return '0'
  return String(Math.round(n * 100) / 100)
}
function fmtLimit(n: number | null): string {
  return n == null ? '—' : fmtUsd(n)
}

export default function UserPlatformQuotaCell({ quotas }: UserPlatformQuotaCellProps) {
  const { t } = useI18n()

  if (quotas === undefined) return <span className={styles.mutedXs}>…</span>

  // 仅展示「至少一档限额非空」的平台（配额列，非用量列）
  const configured = quotas
    .filter((q) => q.daily_limit_usd != null || q.weekly_limit_usd != null || q.monthly_limit_usd != null)
    .slice()
    .sort((a, b) => platformRank(a.platform) - platformRank(b.platform))

  if (configured.length === 0) {
    return <span className={styles.mutedXs}>{t('admin.users.platformQuota.cellNotConfigured')}</span>
  }

  return (
    <div className={styles.quotaList}>
      {configured.map((row) => (
        <div key={row.platform} className={styles.quotaRow}>
          <span className={styles.quotaPlatform}>{row.platform}</span>
          <span className={styles.quotaWindow}>
            {t('admin.users.platformQuota.windowDaily')}{' '}
            <span className={styles.quotaValue}>
              {fmtUsd(row.daily_usage_usd)}/{fmtLimit(row.daily_limit_usd)}
            </span>
          </span>
          <span className={styles.quotaWindow}>
            {t('admin.users.platformQuota.windowWeekly')}{' '}
            <span className={styles.quotaValue}>
              {fmtUsd(row.weekly_usage_usd)}/{fmtLimit(row.weekly_limit_usd)}
            </span>
          </span>
          <span className={styles.quotaWindow}>
            {t('admin.users.platformQuota.windowMonthly')}{' '}
            <span className={styles.quotaValue}>
              {fmtUsd(row.monthly_usage_usd)}/{fmtLimit(row.monthly_limit_usd)}
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}
