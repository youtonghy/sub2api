import { BarChart3, ChevronRight, Gift, KeyRound, Sparkles, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'

import { useBatchImageAccess } from '@/composables/useBatchImageAccess'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import styles from './UserDashboardPanels.module.css'

interface QuickAction {
  to: string
  title: string
  description: string
  icon: LucideIcon
}

/** 快捷操作：创建 API 密钥、查看用量、批量生图（有可用密钥时）、兑换码 */
export default function UserDashboardQuickActions() {
  const { t } = useI18n()
  const { canUseBatchImage, refreshBatchImageAccess } = useBatchImageAccess()

  useMountOnce(() => {
    void refreshBatchImageAccess()
  })

  const actions: QuickAction[] = [
    { to: '/keys', title: t('dashboard.createApiKey'), description: t('dashboard.generateNewKey'), icon: KeyRound },
    { to: '/usage', title: t('dashboard.viewUsage'), description: t('dashboard.checkDetailedLogs'), icon: BarChart3 },
    ...(canUseBatchImage
      ? [{ to: '/batch-image', title: t('dashboard.batchImageAgent'), description: t('dashboard.batchImageAgentDesc'), icon: Sparkles }]
      : []),
    { to: '/redeem', title: t('dashboard.redeemCode'), description: t('dashboard.addBalanceWithCode'), icon: Gift }
  ]

  return (
    <section className={styles.panel} aria-labelledby="user-dashboard-quick-actions">
      <div className={styles.header}>
        <h2 id="user-dashboard-quick-actions" className={styles.title}>
          {t('dashboard.quickActions')}
        </h2>
      </div>
      <div className={styles.actions}>
        {actions.map((action) => (
          <Link key={action.to} to={action.to} className={styles.action}>
            <span className={styles.rowIcon}>
              <action.icon size={18} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>{action.title}</span>
              <span className={styles.rowMeta}>{action.description}</span>
            </span>
            <ChevronRight className={styles.chevron} size={16} aria-hidden="true" />
          </Link>
        ))}
      </div>
    </section>
  )
}
