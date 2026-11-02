/**
 * 账号批量操作栏，对应 Vue 版 AccountBulkActionsBar.vue。
 * 与 Vue 版一样始终显示在列表上方：未选中时可"选择全部结果"或"按筛选结果批量编辑"，
 * 有选中项时显示批量删除、重置状态、刷新令牌、探测上游计费、启停调度与批量编辑。
 * 外观参照 Arc Pro selection-toolbar（计数 + 分隔线 + 紧凑操作按钮），吸顶显示。
 */
import { useI18n } from '@/i18n/useI18n'
import styles from './AccountBulkActionsBar.module.css'

export interface AccountBulkActionsBarProps {
  selectedIds: number[]
  totalResults: number
  selectingAll: boolean
  allResultsSelected: boolean
  onDelete?: () => void
  onEditSelected?: () => void
  onEditFiltered?: () => void
  onClear?: () => void
  onSelectPage?: () => void
  onSelectAllResults?: () => void
  onToggleSchedulable?: (schedulable: boolean) => void
  onResetStatus?: () => void
  onRefreshToken?: () => void
  onProbeUpstreamBilling?: () => void
}

export default function AccountBulkActionsBar({
  selectedIds,
  totalResults,
  selectingAll,
  allResultsSelected,
  onDelete,
  onEditSelected,
  onEditFiltered,
  onClear,
  onSelectPage,
  onSelectAllResults,
  onToggleSchedulable,
  onResetStatus,
  onRefreshToken,
  onProbeUpstreamBilling
}: AccountBulkActionsBarProps) {
  const { t } = useI18n()
  const hasSelection = selectedIds.length > 0

  return (
    <div className={styles.bar} role="toolbar" aria-label={t('admin.accounts.bulkEdit.title')} data-has-selection={hasSelection ? '' : undefined}>
      <div className={styles.summary}>
        <span className={styles.count} aria-live="polite">
          {allResultsSelected
            ? t('admin.accounts.bulkActions.selectedAll', { count: selectedIds.length })
            : hasSelection
              ? t('admin.accounts.bulkActions.selected', { count: selectedIds.length })
              : t('admin.accounts.bulkEdit.title')}
        </span>
        {hasSelection && (
          <button type="button" className={styles.link} onClick={() => onSelectPage?.()}>
            {t('admin.accounts.bulkActions.selectCurrentPage')}
          </button>
        )}
        {!allResultsSelected && totalResults > selectedIds.length && (
          <>
            {hasSelection && <span className={styles.dot} aria-hidden="true">·</span>}
            <button type="button" className={styles.link} disabled={selectingAll} onClick={() => onSelectAllResults?.()}>
              {selectingAll
                ? t('admin.accounts.bulkActions.selectingAll')
                : t('admin.accounts.bulkActions.selectAllResults', { count: totalResults })}
            </button>
          </>
        )}
        {hasSelection && (
          <>
            <span className={styles.dot} aria-hidden="true">·</span>
            <button type="button" className={styles.link} onClick={() => onClear?.()}>
              {t('admin.accounts.bulkActions.clear')}
            </button>
          </>
        )}
      </div>
      <span className={styles.divider} aria-hidden="true" />
      <div className={styles.actions}>
        {hasSelection && (
          <>
            <button type="button" className={styles.destructive} onClick={() => onDelete?.()}>
              {t('admin.accounts.bulkActions.delete')}
            </button>
            <button type="button" onClick={() => onResetStatus?.()}>
              {t('admin.accounts.bulkActions.resetStatus')}
            </button>
            <button type="button" onClick={() => onRefreshToken?.()}>
              {t('admin.accounts.bulkActions.refreshToken')}
            </button>
            <button type="button" onClick={() => onProbeUpstreamBilling?.()}>
              {t('admin.accounts.bulkActions.probeUpstreamBilling')}
            </button>
            <button type="button" className={styles.success} onClick={() => onToggleSchedulable?.(true)}>
              {t('admin.accounts.bulkActions.enableScheduling')}
            </button>
            <button type="button" className={styles.warning} onClick={() => onToggleSchedulable?.(false)}>
              {t('admin.accounts.bulkActions.disableScheduling')}
            </button>
            <button type="button" className={styles.primary} onClick={() => onEditSelected?.()}>
              {t('admin.accounts.bulkActions.edit')}
            </button>
          </>
        )}
        <button type="button" className={styles.primary} onClick={() => onEditFiltered?.()}>
          {t('admin.accounts.bulkEdit.submit')}
        </button>
      </div>
    </div>
  )
}
