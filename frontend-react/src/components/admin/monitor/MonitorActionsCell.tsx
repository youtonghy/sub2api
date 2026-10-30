/**
 * 监控列表的行操作，对应 Vue 版 MonitorActionsCell.vue：立即检测、复制、编辑、删除。
 * 复制在进行中或存储的 API Key 无法解密时禁用。
 */
import { Copy, Pencil, RefreshCw, Trash2 } from 'lucide-react'

import type { ChannelMonitor } from '@/api/admin/channelMonitor'
import { useI18n } from '@/i18n/useI18n'
import styles from './monitor.module.css'

export interface MonitorActionsCellProps {
  row: ChannelMonitor
  running: boolean
  duplicating: boolean
  onRun?: (row: ChannelMonitor) => void
  onDuplicate?: (row: ChannelMonitor) => void
  onEdit?: (row: ChannelMonitor) => void
  onDelete?: (row: ChannelMonitor) => void
}

export default function MonitorActionsCell({ row, running, duplicating, onRun, onDuplicate, onEdit, onDelete }: MonitorActionsCellProps) {
  const { t } = useI18n()

  let duplicateTitle = t('admin.channelMonitor.duplicate')
  if (row.api_key_decrypt_failed) duplicateTitle = t('admin.channelMonitor.duplicateKeyUnavailable')
  else if (duplicating) duplicateTitle = t('admin.channelMonitor.duplicating')

  return (
    <div className={styles.rowActions}>
      <button type="button" className={styles.rowAction} disabled={running} onClick={() => onRun?.(row)}>
        <RefreshCw size={14} strokeWidth={1.75} className={running ? styles.spinning : undefined} aria-hidden="true" />
        <span>{t('admin.channelMonitor.runNow')}</span>
      </button>
      <button
        type="button"
        data-testid="monitor-duplicate"
        className={styles.rowAction}
        title={duplicateTitle}
        disabled={duplicating || Boolean(row.api_key_decrypt_failed)}
        onClick={() => onDuplicate?.(row)}
      >
        <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
        <span>{duplicating ? t('admin.channelMonitor.duplicating') : t('admin.channelMonitor.duplicate')}</span>
      </button>
      <button type="button" className={styles.rowAction} onClick={() => onEdit?.(row)}>
        <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
        <span>{t('common.edit')}</span>
      </button>
      <button type="button" className={[styles.rowAction, styles.rowActionDanger].join(' ')} onClick={() => onDelete?.(row)}>
        <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
        <span>{t('common.delete')}</span>
      </button>
    </div>
  )
}
