import { Button } from '@/components/arc/button/button'
import { useI18n } from '@/i18n/useI18n'
import BaseDialog from './BaseDialog'
import styles from './ExportProgressDialog.module.css'

export interface ExportProgressDialogProps {
  show: boolean
  progress: number
  current: number
  total: number
  estimatedTime: string
  onCancel?: () => void
}

/** 导出进度对话框，对应 Vue 版 ExportProgressDialog.vue */
export default function ExportProgressDialog({
  show,
  progress,
  current,
  total,
  estimatedTime,
  onCancel
}: ExportProgressDialogProps) {
  const { t } = useI18n()
  const value = Number.isFinite(progress) ? progress : 0
  const normalizedProgress = Math.min(100, Math.max(0, Math.round(value)))

  return (
    <BaseDialog
      show={show}
      title={t('usage.exporting')}
      width="narrow"
      onClose={() => onCancel?.()}
      footer={
        <Button type="button" variant="secondary" onClick={() => onCancel?.()}>
          {t('usage.cancelExport')}
        </Button>
      }
    >
      <div className={styles.content}>
        <p className={styles.muted}>{t('usage.exportingProgress')}</p>
        <div className={styles.row}>
          <span>{t('usage.exportedCount', { current, total })}</span>
          <span className={styles.percent}>{normalizedProgress}%</span>
        </div>
        <div className={styles.track}>
          <div
            role="progressbar"
            aria-valuenow={normalizedProgress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${t('usage.exportingProgress')}: ${normalizedProgress}%`}
            className={styles.fill}
            style={{ width: `${normalizedProgress}%` }}
          />
        </div>
        {estimatedTime && (
          <p className={styles.hint} aria-live="polite" aria-atomic="true">
            {t('usage.estimatedTime', { time: estimatedTime })}
          </p>
        )}
      </div>
    </BaseDialog>
  )
}
