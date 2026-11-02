import { useI18n } from '@/i18n/useI18n'
import type { TopUserPaymentStats } from '@/types/payment'
import { formatMoney, hasTopUsers, sortedTopUsers } from './paymentStats'
import styles from './AdminPayment.module.css'

export interface TopUsersLeaderboardProps {
  users: Record<string, TopUserPaymentStats[]>
}

/** 付费用户排行（按币种分组），对应 Vue 版 TopUsersLeaderboard.vue；前三名用不同色调的名次 */
export default function TopUsersLeaderboard({ users }: TopUsersLeaderboardProps) {
  const { t } = useI18n()

  return (
    <section className={styles.panel} aria-labelledby="top-users-title">
      <h2 id="top-users-title" className={styles.panelTitle}>
        {t('payment.admin.topUsers')}
      </h2>
      {!hasTopUsers(users) ? (
        <p className={styles.emptyLine}>{t('payment.admin.noData')}</p>
      ) : (
        <div className={styles.leaderboard}>
          {sortedTopUsers(users).map(([currency, currencyUsers]) => (
            <div key={currency} className={styles.leaderGroup}>
              <p className={styles.leaderCurrency}>{currency}</p>
              <ol className={styles.leaderList}>
                {currencyUsers.map((user, idx) => (
                  <li key={user.user_id} className={styles.leaderRow}>
                    <div className={styles.leaderUser}>
                      <span className={styles.rank} data-rank={idx < 3 ? idx + 1 : undefined}>
                        {idx + 1}
                      </span>
                      <span className={styles.leaderEmail}>{user.email}</span>
                    </div>
                    <span className={styles.strong}>{formatMoney(currency, user.amount)}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
