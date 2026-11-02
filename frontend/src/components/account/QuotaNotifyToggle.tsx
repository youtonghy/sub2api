import Toggle from '@/components/common/Toggle'
import { QUOTA_THRESHOLD_TYPE_FIXED, QUOTA_THRESHOLD_TYPE_PERCENTAGE, type QuotaThresholdType } from '@/constants/account'
import { useI18n } from '@/i18n/useI18n'
import styles from './AccountForm.module.css'
import own from './QuotaLimitCard.module.css'

export interface QuotaNotifyToggleValues {
  enabled: boolean | null
  threshold: number | null
  thresholdType: QuotaThresholdType | null
}

export interface QuotaNotifyToggleProps extends QuotaNotifyToggleValues {
  /** Vue 版 update:enabled / update:threshold / update:thresholdType */
  onUpdate: (patch: Partial<QuotaNotifyToggleValues>) => void
}

/** 配额告警开关 + 阈值（金额或百分比） */
export default function QuotaNotifyToggle({ enabled, threshold, thresholdType, onUpdate }: QuotaNotifyToggleProps) {
  const { t } = useI18n()
  const isPercentage = thresholdType === QUOTA_THRESHOLD_TYPE_PERCENTAGE

  return (
    <div className={own.notify}>
      <Toggle value={!!enabled} onChange={() => onUpdate({ enabled: !enabled })} aria-label={t('admin.accounts.quotaNotify.alert')} />
      {enabled ? (
        <>
          <input
            value={threshold ?? ''}
            onChange={(e) => onUpdate({ threshold: parseFloat(e.target.value) || null })}
            type="number"
            min={0}
            max={isPercentage ? 100 : undefined}
            step={isPercentage ? 1 : 0.01}
            className={`${styles.input} ${own.notifyInput}`}
          />
          <select
            value={thresholdType || QUOTA_THRESHOLD_TYPE_FIXED}
            onChange={(e) => onUpdate({ thresholdType: e.target.value as QuotaThresholdType })}
            className={`${styles.select} ${own.notifyType}`}
          >
            <option value={QUOTA_THRESHOLD_TYPE_FIXED}>$</option>
            <option value={QUOTA_THRESHOLD_TYPE_PERCENTAGE}>%</option>
          </select>
        </>
      ) : null}
    </div>
  )
}
