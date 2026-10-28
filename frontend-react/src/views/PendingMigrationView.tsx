import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { useI18n } from '@/i18n/useI18n'
import styles from './PendingMigrationView.module.css'

/** 尚未迁移到 React 的页面占位：在对应布局中显示迁移提示 */
export default function PendingMigrationView() {
  const { t } = useI18n()
  return (
    <div className={styles.page}>
      <EmptyState title={t('shell.pendingTitle')} description={t('shell.pendingDescription')} />
    </div>
  )
}
