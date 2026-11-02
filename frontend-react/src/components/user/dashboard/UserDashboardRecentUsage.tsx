import { ArrowRight, FlaskConical } from 'lucide-react'
import { Link } from 'react-router'

import { Badge } from '@/components/arc/badge/badge'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import EmptyState from '@/components/common/EmptyState'
import { useI18n } from '@/i18n/useI18n'
import type { UsageLog } from '@/types'
import { formatDateTime } from '@/utils/format'
import styles from './UserDashboardPanels.module.css'

export interface UserDashboardRecentUsageProps {
  data: UsageLog[]
  loading: boolean
}

const formatCost = (c: number) => c.toFixed(4)

/** 最近 7 天的最新 5 条用量记录 */
export default function UserDashboardRecentUsage({ data, loading }: UserDashboardRecentUsageProps) {
  const { t } = useI18n()

  const renderBody = () => {
    if (loading) return <Skeleton lines={5} label={t('common.loading')} />
    if (data.length === 0) {
      return <EmptyState title={t('dashboard.noUsageRecords')} description={t('dashboard.startUsingApi')} />
    }
    return (
      <>
        <ul className={styles.list}>
          {data.map((log) => (
            <li key={log.id} className={styles.row}>
              <span className={styles.rowIcon}>
                <FlaskConical size={18} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>{log.model}</span>
                <span className={styles.rowMeta}>{formatDateTime(log.created_at)}</span>
              </span>
              <span className={styles.rowEnd}>
                <span className={styles.rowCost}>
                  <span className={styles.actual} title={t('dashboard.actual')}>
                    ${formatCost(log.actual_cost)}
                  </span>
                  <span className={styles.standard} title={t('dashboard.standard')}>
                    {' '}/ ${formatCost(log.total_cost)}
                  </span>
                </span>
                <span className={styles.rowMeta}>{(log.input_tokens + log.output_tokens).toLocaleString()} tokens</span>
              </span>
            </li>
          ))}
        </ul>

        <Link to="/usage" className={styles.footerLink}>
          {t('dashboard.viewAllUsage')}
          <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </>
    )
  }

  return (
    <section className={styles.panel} aria-labelledby="user-dashboard-recent" aria-busy={loading || undefined}>
      <div className={styles.header}>
        <h2 id="user-dashboard-recent" className={styles.title}>
          {t('dashboard.recentUsage')}
        </h2>
        <Badge size="sm">{t('dashboard.last7Days')}</Badge>
      </div>
      {renderBody()}
    </section>
  )
}
