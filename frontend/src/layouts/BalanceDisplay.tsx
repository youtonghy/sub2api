import { Wallet } from 'lucide-react'

import { Tooltip } from '@/components/arc/tooltip/tooltip'
import { useI18n } from '@/i18n/useI18n'
import type { User } from '@/types'
import styles from './AppLayout.module.css'

function formatHeaderMoney(value: number): string {
  if (!Number.isFinite(value)) return '$0.00'
  return `$${value.toFixed(2)}`
}

/** 顶栏余额：显示可用余额，悬停查看可用、冻结与总余额（与 Vue 版 AppHeader 一致） */
export default function BalanceDisplay({ user }: { user: User }) {
  const { t } = useI18n()
  const available = Number(user.balance || 0)
  const frozen = Number(user.frozen_balance || 0)
  const total = available + frozen

  const details = (
    <span className={styles.balanceDetails}>
      <span>{t('common.availableBalance')}</span><span>{formatHeaderMoney(available)}</span>
      <span>{t('common.frozenBalance')}</span><span>{formatHeaderMoney(frozen)}</span>
      <span>{t('common.totalBalance')}</span><span>{formatHeaderMoney(total)}</span>
    </span>
  )

  return (
    <Tooltip side="bottom" content={details}>
      <span className={styles.balance} tabIndex={0} aria-label={`${t('common.availableBalance')} ${formatHeaderMoney(available)}`}>
        <Wallet size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className={styles.balanceValue}>{formatHeaderMoney(available)}</span>
        {frozen > 0 && <span className={styles.balanceFrozen}>{t('common.frozenBalance')} {formatHeaderMoney(frozen)}</span>}
      </span>
    </Tooltip>
  )
}
