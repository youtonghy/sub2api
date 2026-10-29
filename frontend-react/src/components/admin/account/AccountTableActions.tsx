/**
 * 账号列表操作按钮组，对应 Vue 版 AccountTableActions.vue：刷新、创建账号，
 * 以及 before / after / beforeCreate / afterCreate 插槽位置的附加内容。
 */
import type { ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

import { Button } from '@/components/arc/button/button'
import { useI18n } from '@/i18n/useI18n'
import styles from './AccountTableActions.module.css'

export interface AccountTableActionsProps {
  loading?: boolean
  onRefresh?: () => void
  onCreate?: () => void
  before?: ReactNode
  after?: ReactNode
  beforeCreate?: ReactNode
  afterCreate?: ReactNode
}

export default function AccountTableActions({
  loading = false,
  onRefresh,
  onCreate,
  before,
  after,
  beforeCreate,
  afterCreate
}: AccountTableActionsProps) {
  const { t } = useI18n()

  return (
    <div className={styles.root}>
      {before}
      <Button
        type="button"
        variant="secondary"
        disabled={loading}
        aria-label={t('common.refresh')}
        title={t('common.refresh')}
        onClick={() => onRefresh?.()}
      >
        <RefreshCw size={16} strokeWidth={1.75} className={loading ? styles.spinning : undefined} aria-hidden="true" />
      </Button>
      {after}
      {beforeCreate}
      <Button type="button" variant="primary" data-tour="accounts-create-btn" onClick={() => onCreate?.()}>
        {t('admin.accounts.createAccount')}
      </Button>
      {afterCreate}
    </div>
  )
}
