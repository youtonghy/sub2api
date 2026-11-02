/**
 * 主模型单元格，对应 Vue 版 MonitorPrimaryModelCell.vue：主模型名 + 状态徽章，悬停显示附加模型的状态与延迟；
 * 下方内联展示配额模式的最新用量 / 余额快照（管理端不受用户端开关限制）。
 */
import type { ChannelMonitor } from '@/api/admin/channelMonitor'
import { Badge } from '@/components/arc/badge/badge'
import HelpTooltip from '@/components/common/HelpTooltip'
import MonitorQuotaView from '@/components/common/MonitorQuotaView'
import { useChannelMonitorFormat } from '@/composables/useChannelMonitorFormat'
import { useI18n } from '@/i18n/useI18n'
import styles from './MonitorPrimaryModelCell.module.css'

export interface MonitorPrimaryModelCellProps {
  row: ChannelMonitor
}

export default function MonitorPrimaryModelCell({ row }: MonitorPrimaryModelCellProps) {
  const { t } = useI18n()
  const { statusLabel, statusTone, formatLatency, formatMonitorModel } = useChannelMonitorFormat()

  return (
    <div className={styles.cell}>
      <div className={styles.line}>
        {/* 纯配额模式主模型是占位符 "quota"（数据源是账号不是模型），展示层替换为本地化标签 */}
        <span className={styles.model}>{formatMonitorModel(row.primary_model)}</span>
        <HelpTooltip
          width="20rem"
          triggerContent={
            <Badge size="sm" tone={statusTone(row.primary_status)}>
              {statusLabel(row.primary_status)}
            </Badge>
          }
        >
          <div className={styles.tip}>
            <div className={styles.tipTitle}>
              {formatMonitorModel(row.primary_model)}{' '}
              <Badge size="sm" tone={statusTone(row.primary_status)}>
                {statusLabel(row.primary_status)}
              </Badge>
            </div>
            {(row.extra_models?.length ?? 0) === 0 ? (
              <div className={styles.tipMuted}>{t('monitorCommon.extraModelsEmpty')}</div>
            ) : (
              <div className={styles.tipBody}>
                <div className={styles.tipHeader}>{t('monitorCommon.extraModelsHeader')}</div>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>{t('admin.channelMonitor.columns.primaryModel')}</th>
                      <th>{t('admin.channelMonitor.columns.actions')}</th>
                      <th>{t('admin.channelMonitor.columns.latency')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(row.extra_models_status || []).map((m) => (
                      <tr key={m.model}>
                        <td>{m.model}</td>
                        <td>
                          <Badge size="sm" tone={statusTone(m.status)}>
                            {statusLabel(m.status)}
                          </Badge>
                        </td>
                        <td>{formatLatency(m.latency_ms)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </HelpTooltip>
      </div>
      <MonitorQuotaView snapshot={row.latest_quota} />
    </div>
  )
}
