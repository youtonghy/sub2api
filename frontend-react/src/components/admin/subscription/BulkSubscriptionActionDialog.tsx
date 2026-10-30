/**
 * 订阅批量操作对话框，对应 Vue 版 BulkSubscriptionActionDialog.vue。
 * - 提交后冻结目标列表与参数；结果未知（超时、5xx、409 等）时用同一请求体与幂等键重试
 * - 提交中禁止关闭、禁止重复提交
 */
import { useRef, useState, type FormEvent } from 'react'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { adminAPI } from '@/api/admin'
import type {
  SubscriptionBulkAction,
  SubscriptionBulkActionRequest,
  SubscriptionBulkActionResult
} from '@/api/admin/subscriptions'
import BaseDialog from '@/components/common/BaseDialog'
import Input from '@/components/common/Input'
import { useI18n } from '@/i18n/useI18n'
import type { UserSubscription } from '@/types'
import {
  completeBulkSubscriptionOperation,
  prepareBulkSubscriptionOperation,
  type BulkSubscriptionOperation
} from './bulkSubscriptionOperation'
import styles from './BulkSubscriptionActionDialog.module.css'

export interface BulkSubscriptionActionDialogProps {
  show: boolean
  action: SubscriptionBulkAction
  subscriptions: UserSubscription[]
  onClose?: () => void
  onCompleted?: (result: SubscriptionBulkActionResult) => void
}

interface BulkTarget {
  id: number
  email?: string
  group?: string
  groupId: number
}

const quotaWindows = ['daily', 'weekly', 'monthly'] as const
type QuotaWindow = (typeof quotaWindows)[number]

const toTargets = (subscriptions: UserSubscription[]): BulkTarget[] =>
  subscriptions.map((subscription) => ({
    id: subscription.id,
    email: subscription.user?.email,
    group: subscription.group?.name,
    groupId: subscription.group_id
  }))

export default function BulkSubscriptionActionDialog({
  show,
  action,
  subscriptions,
  onClose,
  onCompleted
}: BulkSubscriptionActionDialogProps) {
  const { t } = useI18n()
  const [days, setDays] = useState<number | string>(30)
  const [windows, setWindows] = useState<Record<QuotaWindow, boolean>>({ daily: true, weekly: true, monthly: true })
  const [submitting, setSubmitting] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [result, setResult] = useState<SubscriptionBulkActionResult | null>(null)
  const [pendingOperation, setPendingOperation] = useState<BulkSubscriptionOperation | null>(null)
  const [targets, setTargets] = useState<BulkTarget[]>(() => toTargets(subscriptions))
  const [syncedSubscriptions, setSyncedSubscriptions] = useState(subscriptions)
  const [submittedAction, setSubmittedAction] = useState<SubscriptionBulkAction | null>(null)
  // 同一事件循环内的重复提交以 ref 判定，避免读到尚未重新渲染的状态
  const submittingRef = useRef(false)

  const currentAction = submittedAction ?? action
  const parametersLocked = submitting || !!pendingOperation || !!result
  const canClose = !submitting
  const failedResults = result?.results.filter((item) => !item.success) ?? []

  // 父组件刷新列表后，已提交的目标列表保持不变（Vue 版 watch 中 parametersLocked 时跳过）
  if (syncedSubscriptions !== subscriptions) {
    setSyncedSubscriptions(subscriptions)
    if (!parametersLocked) setTargets(toTargets(subscriptions))
  }

  const validationError = (() => {
    if (targets.length === 0) return t('admin.subscriptions.bulk.selectionRequired')
    if (targets.length > 100) return t('admin.subscriptions.bulk.selectionLimit')
    if (currentAction === 'extend') {
      const value = Number(days)
      if (!Number.isInteger(value) || value === 0 || Math.abs(value) > 36500) {
        return t('admin.subscriptions.bulk.invalidDays')
      }
    }
    if (currentAction === 'reset_quota' && !quotaWindows.some((window) => windows[window])) {
      return t('admin.subscriptions.bulk.selectWindow')
    }
    return ''
  })()

  const handleClose = () => {
    if (canClose) onClose?.()
  }

  const failedTargetLabel = (id: number) => {
    const target = targets.find((item) => item.id === id)
    return target?.email ? `${target.email} · #${id}` : `#${id}`
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (submittingRef.current || result) return
    let operation = pendingOperation
    if (!operation) {
      if (validationError) return
      const request: SubscriptionBulkActionRequest = {
        subscription_ids: targets.map((subscription) => subscription.id),
        action
      }
      if (request.action === 'extend') request.days = Number(days)
      if (request.action === 'reset_quota') Object.assign(request, { ...windows })
      operation = prepareBulkSubscriptionOperation(request)
      setPendingOperation(operation)
      setSubmittedAction(request.action)
    }

    submittingRef.current = true
    setSubmitting(true)
    setRequestError('')
    try {
      const next = await adminAPI.subscriptions.bulkAction(operation.request, operation.key)
      setResult(next)
      completeBulkSubscriptionOperation(operation)
      setPendingOperation(null)
      onCompleted?.(next)
    } catch (error: unknown) {
      const failure = error as {
        status?: number
        message?: string
        response?: { status?: number; data?: { message?: string } }
      }
      setRequestError(failure?.message || failure?.response?.data?.message || t('admin.subscriptions.bulk.requestFailed'))
      const status = failure?.status ?? failure?.response?.status
      // A timeout, server error or in-progress conflict may arrive after writes.
      // Retry the frozen payload and key until a definitive result is available.
      if (!operation.outcomeUncertain && status && status >= 400 && status < 500 && status !== 408 && status !== 409) {
        completeBulkSubscriptionOperation(operation)
        setPendingOperation(null)
        setSubmittedAction(null)
      } else {
        operation.outcomeUncertain = true
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <BaseDialog
      show={show}
      title={t(`admin.subscriptions.bulk.${currentAction}`)}
      width="normal"
      closeOnEscape={canClose}
      showCloseButton={canClose}
      onClose={handleClose}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={!canClose} onClick={handleClose}>
            {result ? t('common.close') : t('common.cancel')}
          </Button>
          {!result && (
            <Button
              type="submit"
              form="bulk-subscription-action-form"
              variant={currentAction === 'revoke' ? 'danger' : 'primary'}
              disabled={submitting || (!pendingOperation && !!validationError)}
            >
              {submitting
                ? t('common.processing')
                : pendingOperation
                  ? t('admin.subscriptions.bulk.retry')
                  : t('admin.subscriptions.bulk.confirm')}
            </Button>
          )}
        </>
      }
    >
      <form id="bulk-subscription-action-form" className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <div>
          <p className={styles.targetsTitle}>{t('admin.subscriptions.bulk.confirmTargets', { count: targets.length })}</p>
          <ul className={styles.targets}>
            {targets.map((subscription) => (
              <li key={subscription.id} className={styles.target}>
                <div className={styles.targetName}>{subscription.email || `#${subscription.id}`}</div>
                <div className={styles.targetMeta}>
                  {subscription.group || t('admin.subscriptions.bulk.groupFallback', { id: subscription.groupId })}
                  {subscription.email && <span className={styles.targetId}>#{subscription.id}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <fieldset disabled={parametersLocked} className={styles.parameters}>
          {currentAction === 'extend' ? (
            <Input
              id="bulk-subscription-days"
              type="number"
              min={-36500}
              max={36500}
              step={1}
              label={t('admin.subscriptions.form.adjustDays')}
              value={days}
              onChange={(value) => setDays(value === '' ? '' : Number(value))}
              disabled={parametersLocked}
              placeholder={t('admin.subscriptions.adjustDaysPlaceholder')}
              hint={t('admin.subscriptions.bulk.extendHint')}
            />
          ) : currentAction === 'reset_quota' ? (
            <>
              <legend className={styles.legend}>{t('admin.subscriptions.bulk.resetWindows')}</legend>
              <div className={styles.windows}>
                {quotaWindows.map((window) => (
                  <Checkbox
                    key={window}
                    name={window}
                    label={t(`admin.subscriptions.${window}`)}
                    checked={windows[window]}
                    disabled={parametersLocked}
                    onCheckedChange={(checked) => setWindows((prev) => ({ ...prev, [window]: checked === true }))}
                  />
                ))}
              </div>
              <p className={styles.hint}>{t('admin.subscriptions.bulk.resetHint')}</p>
            </>
          ) : (
            <Alert tone="warning" title={t(`admin.subscriptions.bulk.${currentAction}Hint`)} />
          )}
        </fieldset>

        {validationError && !parametersLocked && (
          <p role="alert" className={styles.validation}>
            {validationError}
          </p>
        )}

        {requestError && (
          <Alert tone="danger" title={requestError}>
            {pendingOperation ? t('admin.subscriptions.bulk.retryHint') : undefined}
          </Alert>
        )}

        {result && (
          <div aria-live="polite" className={styles.result}>
            <p className={styles.resultSummary}>
              {t('admin.subscriptions.bulk.result', { success: result.success_count, failed: result.failed_count })}
            </p>
            {failedResults.length > 0 && (
              <ul className={styles.failures}>
                {failedResults.map((item) => (
                  <li key={item.subscription_id} className={styles.failure}>
                    <p className={styles.failureTarget}>{failedTargetLabel(item.subscription_id)}</p>
                    <p className={styles.failureError}>{item.error || t('admin.subscriptions.bulk.itemFailed')}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </form>
    </BaseDialog>
  )
}
