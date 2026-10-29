/**
 * 临时不可调度状态弹窗，对应 Vue 版 TempUnschedStatusModal.vue：
 * 打开或切换账号时加载状态（迟到的旧请求结果与错误被丢弃），可一键恢复账号状态。
 */
import { useEffect, useState } from 'react'

import { adminAPI } from '@/api/admin'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import Skeleton from '@/components/common/Skeleton'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { Account, TempUnschedulableStatus } from '@/types'
import { formatDateTime } from '@/utils/format'
import styles from './TempUnschedStatusModal.module.css'

export interface TempUnschedStatusModalProps {
  show: boolean
  account: Account | null
  onClose?: () => void
  onReset?: (account: Account) => void
}

export default function TempUnschedStatusModal({ show, account, onClose, onReset }: TempUnschedStatusModalProps) {
  const { t } = useI18n()

  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false)
  // 与 Vue 版 computed 一致：剩余时间与是否生效在状态加载时按当时时间计算一次
  const [loaded, setLoaded] = useState<{ status: TempUnschedulableStatus; at: number } | null>(null)
  const accountId = account?.id

  useEffect(() => {
    if (!show || accountId == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 关闭或无账号时清空状态
      setLoaded(null)
      return
    }
    // 可见性或账号变化时作废进行中的请求（迟到的结果与错误都丢弃）
    let cancelled = false
    setLoaded(null)
    setLoading(true)
    adminAPI.accounts
      .getTempUnschedulableStatus(accountId)
      .then((result) => {
        if (!cancelled) setLoaded({ status: result, at: Date.now() })
      })
      .catch((error: any) => {
        if (cancelled) return
        useAppStore.getState().showError(error?.message || t('admin.accounts.tempUnschedulable.failedToLoad'))
        setLoaded(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [show, accountId, t])

  const status = loaded?.status ?? null
  const loadedAt = loaded?.at ?? 0
  const state = status?.state || null
  const isActive = !!(status?.active && state) && state!.until_unix * 1000 > loadedAt

  const ruleIndexDisplay =
    !state || !state.matched_keyword || state.rule_index < 0 ? '-' : state.rule_index + 1

  const hasThresholdEvidence = (state?.trigger_count || 0) > 1

  const triggerEvidenceText = (() => {
    const count = state?.trigger_count || 0
    const threshold = state?.trigger_threshold || 0
    const minutes = state?.trigger_window_minutes || 0
    if (threshold > 0 && minutes > 0) {
      return t('admin.accounts.tempUnschedulable.multipleErrorTrigger', { count, threshold, minutes })
    }
    if (threshold > 0) {
      return t('admin.accounts.tempUnschedulable.multipleErrorTriggerNoWindow', { count, threshold })
    }
    if (minutes > 0) {
      return t('admin.accounts.tempUnschedulable.multipleErrorCountInWindow', { count, minutes })
    }
    return t('admin.accounts.tempUnschedulable.multipleErrorCount', { count })
  })()

  const triggeredAtText = state?.triggered_at_unix ? formatDateTime(new Date(state.triggered_at_unix * 1000)) : '-'
  const untilText = state?.until_unix ? formatDateTime(new Date(state.until_unix * 1000)) : '-'

  const remainingText = (() => {
    if (!state) return '-'
    const remainingMs = state.until_unix * 1000 - loadedAt
    if (remainingMs <= 0) {
      return t('admin.accounts.tempUnschedulable.expired')
    }
    const minutes = Math.ceil(remainingMs / 60000)
    if (minutes < 60) {
      return t('admin.accounts.tempUnschedulable.remainingMinutes', { minutes })
    }
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    if (rest === 0) {
      return t('admin.accounts.tempUnschedulable.remainingHours', { hours })
    }
    return t('admin.accounts.tempUnschedulable.remainingHoursMinutes', { hours, minutes: rest })
  })()

  const handleClose = () => onClose?.()

  const handleReset = async () => {
    if (!account) return
    setResetting(true)
    try {
      const updated = await adminAPI.accounts.recoverState(account.id)
      useAppStore.getState().showSuccess(t('admin.accounts.recoverStateSuccess'))
      onReset?.(updated)
      handleClose()
    } catch (error: any) {
      useAppStore.getState().showError(error?.message || t('admin.accounts.recoverStateFailed'))
    } finally {
      setResetting(false)
    }
  }

  const fields: Array<{ label: string; value: string | number }> = [
    { label: t('admin.accounts.tempUnschedulable.triggeredAt'), value: triggeredAtText },
    { label: t('admin.accounts.tempUnschedulable.until'), value: untilText },
    { label: t('admin.accounts.tempUnschedulable.remaining'), value: remainingText },
    { label: t('admin.accounts.tempUnschedulable.errorCode'), value: state?.status_code || '-' },
    { label: t('admin.accounts.tempUnschedulable.matchedKeyword'), value: state?.matched_keyword || '-' },
    { label: t('admin.accounts.tempUnschedulable.ruleOrder'), value: ruleIndexDisplay }
  ]

  return (
    <BaseDialog
      show={show}
      title={t('admin.accounts.tempUnschedulable.statusTitle')}
      width="normal"
      onClose={handleClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={handleClose}>
            {t('common.close')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!isActive || resetting}
            loading={resetting}
            onClick={handleReset}
            data-testid="temp-unsched-recover"
          >
            {t('admin.accounts.recoverState')}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className={styles.loading} aria-busy="true" data-testid="temp-unsched-loading">
          <Skeleton height={20} width="60%" />
          <Skeleton height={56} />
          <Skeleton height={56} />
        </div>
      ) : !isActive ? (
        <p className={styles.notActive}>{t('admin.accounts.tempUnschedulable.notActive')}</p>
      ) : (
        <div className={styles.content}>
          <Alert tone="success" title={t('admin.accounts.recoverStateHint')} />

          <dl className={styles.list}>
            <div className={styles.row}>
              <dt>{t('admin.accounts.tempUnschedulable.accountName')}</dt>
              <dd>{account?.name || '-'}</dd>
            </div>
            {fields.map((field) => (
              <div key={field.label} className={styles.row}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
            <div className={`${styles.row} ${styles.stacked}`}>
              <dt>{t('admin.accounts.tempUnschedulable.errorMessage')}</dt>
              <dd className={styles.message}>{state?.error_message || '-'}</dd>
            </div>
          </dl>

          {hasThresholdEvidence ? (
            <Alert tone="info" title={triggerEvidenceText} data-testid="temp-unsched-trigger-evidence" />
          ) : null}
        </div>
      )}
    </BaseDialog>
  )
}
