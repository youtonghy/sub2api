import { useEffect, useState } from 'react'

import { status as fetchChannelMonitorDetail, type UserMonitorDetail } from '@/api/channelMonitor'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import { useChannelMonitorFormat } from '@/composables/useChannelMonitorFormat'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { extractApiErrorMessage } from '@/utils/apiError'
import styles from './MonitorDetailDialog.module.css'

export interface MonitorDetailDialogProps {
  show: boolean
  monitorId: number | null
  title: string
  onClose?: () => void
}

/** 渠道监控详情（各模型最新状态与可用率），对应 Vue 版 MonitorDetailDialog.vue */
export default function MonitorDetailDialog({ show, monitorId, title, onClose }: MonitorDetailDialogProps) {
  const { t } = useI18n()
  const { statusLabel, statusTone, formatLatency, formatPercent, formatMonitorModel } = useChannelMonitorFormat()
  const [detail, setDetail] = useState<UserMonitorDetail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // 对应 Vue 版 watch([show, monitorId])：每次切换都作废上一次请求，迟到的响应与错误一律忽略
    let current = true
    if (!show) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 与 Vue 版一致：关闭时清空详情
      setDetail(null)
      return () => {
        current = false
      }
    }
    if (monitorId != null) {
      setDetail(null)
      setLoading(true)
      fetchChannelMonitorDetail(monitorId)
        .then((result) => {
          if (current) setDetail(result)
        })
        .catch((err: unknown) => {
          if (!current) return
          useAppStore.getState().showError(extractApiErrorMessage(err, t('channelStatus.detailLoadError')))
        })
        .finally(() => {
          if (current) setLoading(false)
        })
    }
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 与 Vue 版一致，只在 show / monitorId 变化时加载
  }, [show, monitorId])

  return (
    <BaseDialog
      show={show}
      title={title}
      width="wide"
      onClose={onClose}
      footer={
        <Button type="button" variant="secondary" onClick={() => onClose?.()}>
          {t('channelStatus.closeDetail')}
        </Button>
      }
    >
      {loading ? (
        <div className={styles.message}>{t('common.loading')}</div>
      ) : !detail ? (
        <div className={styles.message}>{t('channelStatus.detailLoadError')}</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('channelStatus.detailColumns.model')}</th>
                <th>{t('channelStatus.detailColumns.latestStatus')}</th>
                <th>{t('channelStatus.detailColumns.latestLatency')}</th>
                <th>{t('channelStatus.detailColumns.availability7d')}</th>
                <th>{t('channelStatus.detailColumns.availability15d')}</th>
                <th>{t('channelStatus.detailColumns.availability30d')}</th>
                <th>{t('channelStatus.detailColumns.avgLatency7d')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.models.map((m) => (
                <tr key={m.model}>
                  <td className={styles.model}>{formatMonitorModel(m.model)}</td>
                  <td>
                    <Badge size="sm" tone={statusTone(m.latest_status)}>
                      {statusLabel(m.latest_status)}
                    </Badge>
                  </td>
                  <td>{formatLatency(m.latest_latency_ms)}</td>
                  <td>{formatPercent(m.availability_7d)}</td>
                  <td>{formatPercent(m.availability_15d)}</td>
                  <td>{formatPercent(m.availability_30d)}</td>
                  <td>{formatLatency(m.avg_latency_7d_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </BaseDialog>
  )
}
