/**
 * 模板应用到监控，对应 Vue 版 MonitorTemplateApplyPickerDialog.vue：列出模板关联的监控（默认全选），
 * 勾选后批量覆盖为模板快照。请求带版本号，关闭、切换模板或卸载后过期的响应与错误都被忽略。
 */
import { useEffect, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import type { AssociatedMonitorBrief } from '@/api/admin/channelMonitorTemplate'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import BaseDialog from '@/components/common/BaseDialog'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { extractApiErrorMessage } from '@/utils/apiError'
import styles from './MonitorTemplateApplyPickerDialog.module.css'

export interface MonitorTemplateApplyPickerDialogProps {
  show: boolean
  templateId: number | null
  templateName: string
  onClose?: () => void
  onApplied?: (affected: number) => void
}

export default function MonitorTemplateApplyPickerDialog({
  show,
  templateId,
  templateName,
  onClose,
  onApplied
}: MonitorTemplateApplyPickerDialogProps) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [monitors, setMonitors] = useState<AssociatedMonitorBrief[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const requestVersion = useRef(0)

  useEffect(() => {
    const version = ++requestVersion.current
    if (!show || templateId == null) return
    const fetchMonitors = async () => {
      setLoading(true)
      setMonitors([])
      setSelectedIds([])
      try {
        const { items } = await adminAPI.channelMonitorTemplate.listAssociatedMonitors(templateId)
        if (version !== requestVersion.current) return
        setMonitors(items)
        // 默认全选
        setSelectedIds(items.map((m) => m.id))
      } catch (err: unknown) {
        if (version !== requestVersion.current) return
        useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
      } finally {
        if (version === requestVersion.current) setLoading(false)
      }
    }
    void fetchMonitors()
  }, [show, templateId]) // eslint-disable-line react-hooks/exhaustive-deps -- 只随打开状态与模板变化重新拉取

  // 卸载后忽略未完成的请求
  useEffect(() => () => void requestVersion.current++, [])

  const selectedSet = new Set(selectedIds)

  const toggle = (id: number) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]))

  const handleApply = async () => {
    if (templateId == null || selectedIds.length === 0 || submitting) return
    setSubmitting(true)
    try {
      const { affected } = await adminAPI.channelMonitorTemplate.apply(templateId, [...selectedIds])
      useAppStore.getState().showSuccess(t('admin.channelMonitor.template.applySuccess', { n: affected }))
      onApplied?.(affected)
      onClose?.()
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <BaseDialog
      show={show}
      title={t('admin.channelMonitor.template.applyPickerTitle', { name: templateName })}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onClose?.()}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            data-testid="apply-picker-confirm"
            disabled={submitting || selectedIds.length === 0}
            onClick={() => void handleApply()}
          >
            {submitting
              ? t('common.submitting')
              : t('admin.channelMonitor.template.applyPickerConfirm', { n: selectedIds.length })}
          </Button>
        </>
      }
    >
      <p className={styles.hint}>{t('admin.channelMonitor.template.applyPickerHint')}</p>

      {loading ? (
        <p className={styles.empty}>{t('common.loading')}</p>
      ) : monitors.length === 0 ? (
        <p className={styles.empty}>{t('admin.channelMonitor.template.applyPickerEmpty')}</p>
      ) : (
        <div className={styles.stack}>
          {/* 全选/全不选 */}
          <div className={styles.bar}>
            <button type="button" className={styles.link} onClick={() => setSelectedIds(monitors.map((m) => m.id))}>
              {t('common.selectAll')}
            </button>
            <button type="button" className={[styles.link, styles.muted].join(' ')} onClick={() => setSelectedIds([])}>
              {t('admin.channelMonitor.template.selectNone')}
            </button>
            <span className={styles.count}>
              {t('admin.channelMonitor.template.selectedCount', { n: selectedIds.length, total: monitors.length })}
            </span>
          </div>

          <ul className={styles.list}>
            {monitors.map((m) => (
              <li key={m.id} className={styles.item}>
                <Checkbox checked={selectedSet.has(m.id)} aria-label={m.name} onCheckedChange={() => toggle(m.id)} />
                <span className={styles.name}>{m.name}</span>
                <span className={styles.meta}>{m.provider}</span>
                {m.provider === 'openai' ? <span className={styles.meta}>{m.api_mode}</span> : null}
                {!m.enabled ? (
                  <Badge size="sm" className={styles.disabled}>
                    {t('admin.channelMonitor.onlyDisabled').replace(/^仅|^Only /, '')}
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </BaseDialog>
  )
}
