/**
 * 批量修改用户限额弹窗，对应 Vue 版 BulkEditUserModal.vue：
 * 只提交开启的字段（并发、RPM），RPM 为 0 表示不限制；一次最多 500 个用户，提交前二次确认覆盖。
 */
import { useEffect, useState, type FormEvent } from 'react'

import { adminAPI } from '@/api/admin'
import type { BatchUpdateUserLimitsRequest } from '@/api/admin/users'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import Input from '@/components/common/Input'
import Toggle from '@/components/common/Toggle'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { extractApiErrorMessage } from '@/utils/apiError'
import styles from './BulkEditUserModal.module.css'

export interface BulkEditUserModalProps {
  show: boolean
  selectedIds: number[]
  onClose?: () => void
  onSuccess?: (affected: number) => void
}

const MAX_BATCH_USER_IDS = 500

const parseLimit = (value: string | number): number | null | undefined => {
  const trimmed = String(value).trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 0) return null
  return parsed
}

export default function BulkEditUserModal({ show, selectedIds, onClose, onSuccess }: BulkEditUserModalProps) {
  const { t } = useI18n()
  const { confirm, confirmDialog } = useConfirmDialog()
  const [enableConcurrency, setEnableConcurrency] = useState(false)
  const [enableRPMLimit, setEnableRPMLimit] = useState(false)
  const [concurrencyValue, setConcurrencyValue] = useState('')
  const [rpmLimitValue, setRpmLimitValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const parsedConcurrency = enableConcurrency ? parseLimit(concurrencyValue) : undefined
  const parsedRPMLimit = enableRPMLimit ? parseLimit(rpmLimitValue) : undefined
  const hasInvalidValue = parsedConcurrency === null || parsedRPMLimit === null
  const hasUpdate =
    (parsedConcurrency !== undefined && parsedConcurrency !== null) || (parsedRPMLimit !== undefined && parsedRPMLimit !== null)
  const selectionTooLarge = selectedIds.length > MAX_BATCH_USER_IDS
  const canSubmit = selectedIds.length > 0 && !selectionTooLarge && hasUpdate && !hasInvalidValue && !submitting

  useEffect(() => {
    if (!show) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 对应 Vue 版 watch(show)：打开时重置
    setEnableConcurrency(false)
    setEnableRPMLimit(false)
    setConcurrencyValue('')
    setRpmLimitValue('')
    setSubmitting(false)
  }, [show])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return

    const request: BatchUpdateUserLimitsRequest = {
      user_ids: [...selectedIds],
      all: false
    }
    const fields: string[] = []
    if (parsedConcurrency !== undefined && parsedConcurrency !== null) {
      request.concurrency = parsedConcurrency
      fields.push(t('admin.users.bulkLimits.concurrencyValue', { value: parsedConcurrency }))
    }
    if (parsedRPMLimit !== undefined && parsedRPMLimit !== null) {
      request.rpm_limit = parsedRPMLimit
      fields.push(
        parsedRPMLimit === 0
          ? t('admin.users.bulkLimits.rpmUnlimitedValue')
          : t('admin.users.bulkLimits.rpmValue', { value: parsedRPMLimit })
      )
    }

    const confirmed = await confirm(
      t('admin.users.bulkLimits.confirm', {
        count: selectedIds.length,
        fields: fields.join(', ')
      })
    )
    if (!confirmed) return

    const appStore = useAppStore.getState()
    setSubmitting(true)
    try {
      const result = await adminAPI.users.batchUpdateLimits(request)
      appStore.showSuccess(t('admin.users.bulkLimits.success', { count: result.affected }))
      onSuccess?.(result.affected)
      onClose?.()
    } catch (error: any) {
      appStore.showError(extractApiErrorMessage(error, t('admin.users.bulkLimits.failed')))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <BaseDialog
        show={show}
        title={t('admin.users.bulkLimits.title')}
        width="normal"
        onClose={() => onClose?.()}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => onClose?.()}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="bulk-edit-user-limits-form" variant="primary" disabled={!canSubmit} data-test="submit">
              {submitting ? t('admin.users.bulkLimits.applying') : t('admin.users.bulkLimits.apply')}
            </Button>
          </>
        }
      >
        <form id="bulk-edit-user-limits-form" className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
          <p className={styles.count}>{t('admin.users.bulkLimits.selectedCount', { count: selectedIds.length })}</p>

          <div className={styles.rows}>
            <div className={styles.row}>
              <div className={styles.rowHead}>
                <label htmlFor="bulk-concurrency" className={styles.label}>
                  {t('admin.users.columns.concurrency')}
                </label>
                <Toggle
                  value={enableConcurrency}
                  onChange={setEnableConcurrency}
                  aria-label={t('admin.users.bulkLimits.enableConcurrency')}
                />
              </div>
              {enableConcurrency && (
                <Input
                  id="bulk-concurrency"
                  type="number"
                  min="0"
                  step="1"
                  data-test="concurrency-input"
                  value={concurrencyValue}
                  onChange={setConcurrencyValue}
                />
              )}
            </div>

            <div className={styles.row}>
              <div className={styles.rowHead}>
                <label htmlFor="bulk-rpm-limit" className={styles.label}>
                  {t('admin.users.form.rpmLimit')}
                </label>
                <Toggle
                  value={enableRPMLimit}
                  onChange={setEnableRPMLimit}
                  aria-label={t('admin.users.bulkLimits.enableRPMLimit')}
                />
              </div>
              {enableRPMLimit && (
                <Input
                  id="bulk-rpm-limit"
                  type="number"
                  min="0"
                  step="1"
                  data-test="rpm-limit-input"
                  hint={parsedRPMLimit === 0 ? t('admin.users.bulkLimits.unlimited') : undefined}
                  value={rpmLimitValue}
                  onChange={setRpmLimitValue}
                />
              )}
            </div>
          </div>

          {hasInvalidValue && <p className={styles.error}>{t('admin.users.bulkLimits.nonNegativeInteger')}</p>}
          {selectionTooLarge && (
            <p className={styles.error}>{t('admin.users.bulkLimits.selectionLimit', { max: MAX_BATCH_USER_IDS })}</p>
          )}
        </form>
      </BaseDialog>
      {confirmDialog}
    </>
  )
}
