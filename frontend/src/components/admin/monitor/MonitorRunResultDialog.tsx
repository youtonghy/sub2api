/**
 * 立即检测结果，对应 Vue 版 MonitorRunResultDialog.vue：每个模型一行，显示消息、配额快照、状态与延迟。
 */
import type { CheckResult } from '@/api/admin/channelMonitor'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import MonitorQuotaView from '@/components/common/MonitorQuotaView'
import { useChannelMonitorFormat } from '@/composables/useChannelMonitorFormat'
import { useI18n } from '@/i18n/useI18n'
import styles from './MonitorRunResultDialog.module.css'

export interface MonitorRunResultDialogProps {
  show: boolean
  results: CheckResult[]
  onClose?: () => void
}

export default function MonitorRunResultDialog({ show, results, onClose }: MonitorRunResultDialogProps) {
  const { t } = useI18n()
  const { statusLabel, statusTone, formatLatency, formatMonitorModel } = useChannelMonitorFormat()

  return (
    <BaseDialog
      show={show}
      title={t('admin.channelMonitor.runResultTitle')}
      width="normal"
      onClose={onClose}
      footer={
        <Button type="button" variant="primary" onClick={() => onClose?.()}>
          {t('common.close')}
        </Button>
      }
    >
      <ul className={styles.list}>
        {results.map((r) => (
          <li key={r.model} className={styles.item}>
            <div className={styles.main}>
              <span className={styles.model}>{formatMonitorModel(r.model)}</span>
              {r.message ? <span className={styles.message}>{r.message}</span> : null}
              <MonitorQuotaView snapshot={r.quota} />
            </div>
            <div className={styles.meta}>
              <Badge size="sm" tone={statusTone(r.status)}>
                {statusLabel(r.status)}
              </Badge>
              <span className={styles.latency}>{formatLatency(r.latency_ms)} ms</span>
            </div>
          </li>
        ))}
      </ul>
    </BaseDialog>
  )
}
