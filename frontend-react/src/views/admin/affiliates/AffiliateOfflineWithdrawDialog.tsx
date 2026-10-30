/**
 * 线下提现登记对话框，对应 Vue 版 AffiliateOfflineWithdrawDialog.vue：
 * 搜索并选择用户 → 读取可提取额度 → 填写金额 → 带幂等键提交；结果未知时锁定用户与金额并沿用同一幂等键重试。
 */
import { Loader2, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { affiliatesAPI, type AffiliateWithdrawResult, type SimpleUser } from '@/api/admin/affiliates'
import { Button } from '@/components/arc/button/button'
import { FormNotice } from '@/components/account/AccountFormLayout'
import BaseDialog from '@/components/common/BaseDialog'
import Input from '@/components/common/Input'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { extractApiErrorCode, extractI18nErrorMessage } from '@/utils/apiError'
import {
  completeAffiliateWithdrawOperation,
  prepareAffiliateWithdrawOperation,
  type AffiliateWithdrawOperation
} from './affiliateWithdrawOperation'
import styles from './Affiliates.module.css'

export interface AffiliateOfflineWithdrawDialogProps {
  show: boolean
  onClose?: () => void
  onSuccess?: (result: AffiliateWithdrawResult) => void
}

// 返利额度按 8 位小数记账，金额比较在同一精度上进行。
const LEDGER_SCALE = 1e8

function formatPreciseAmount(value: number): string {
  const [intPart, fraction = ''] = Number(value || 0).toFixed(8).replace(/0+$/, '').split('.')
  return `${intPart}.${fraction.padEnd(2, '0')}`
}

export default function AffiliateOfflineWithdrawDialog({ show, onClose, onSuccess }: AffiliateOfflineWithdrawDialogProps) {
  const { t } = useI18n()

  const [userQuery, setUserQuery] = useState('')
  const [userResults, setUserResults] = useState<SimpleUser[]>([])
  const [searched, setSearched] = useState(false)
  const [selectedUser, setSelectedUser] = useState<SimpleUser | null>(null)
  const [availableQuota, setAvailableQuota] = useState(0)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // 已提交、尚未拿到确定结果的登记。结果未知时锁定用户与金额，重试沿用它的幂等键。
  const pendingOperation = useRef<AffiliateWithdrawOperation | null>(null)
  const [outcomeUncertain, setOutcomeUncertain] = useState(false)
  const outcomeUncertainRef = useRef(false)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeq = useRef(0)
  const overviewSeq = useRef(0)

  const markUncertain = (value: boolean) => {
    outcomeUncertainRef.current = value
    setOutcomeUncertain(value)
  }

  const amountText = amount.trim()
  const parsedAmount = amountText === '' ? Number.NaN : Number(amountText)

  const amountError = (() => {
    if (outcomeUncertain || !selectedUser || overviewLoading || amountText === '') return ''
    if (!Number.isFinite(parsedAmount) || Math.round(parsedAmount * LEDGER_SCALE) <= 0) {
      return t('admin.affiliates.withdraw.amountRequired')
    }
    if (Math.round(parsedAmount * LEDGER_SCALE) > Math.round(availableQuota * LEDGER_SCALE)) {
      return t('admin.affiliates.withdraw.amountExceeds')
    }
    return ''
  })()

  // 结果未知的登记可能已经扣减，重试不受刷新后的可提取额度约束。
  const canSubmit = (() => {
    if (selectedUser === null || submitting) return false
    if (outcomeUncertain) return true
    return !overviewLoading && amountText !== '' && amountError === ''
  })()

  const showError = (error: unknown) => {
    useAppStore.getState().showError(extractI18nErrorMessage(error, t, 'admin.affiliates.errors', t('common.error')))
  }

  const clearSearchTimer = () => {
    if (searchTimer.current) {
      clearTimeout(searchTimer.current)
      searchTimer.current = null
    }
  }

  async function searchUsers(query: string) {
    const seq = ++searchSeq.current
    try {
      const users = await affiliatesAPI.lookupUsers(query)
      if (seq !== searchSeq.current) return
      setUserResults(users || [])
      setSearched(true)
    } catch (error) {
      if (seq !== searchSeq.current) return
      showError(error)
    }
  }

  const onUserQueryInput = (value: string) => {
    setUserQuery(value)
    clearSearchTimer()
    setSearched(false)
    const query = value.trim()
    if (!query) {
      searchSeq.current++
      setUserResults([])
      return
    }
    searchTimer.current = setTimeout(() => {
      void searchUsers(query)
    }, 300)
  }

  async function loadAvailableQuota(userId: number) {
    const seq = ++overviewSeq.current
    setOverviewLoading(true)
    try {
      const overview = await affiliatesAPI.getUserOverview(userId)
      if (seq !== overviewSeq.current) return
      setAvailableQuota(Number(overview.available_quota || 0))
    } catch (error) {
      if (seq !== overviewSeq.current) return
      setAvailableQuota(0)
      // 从未产生过邀请返利的用户没有返利档案，概览接口返回 USER_NOT_FOUND，可提取额度即为 0。
      if (extractApiErrorCode(error) === 'USER_NOT_FOUND') return
      if (!outcomeUncertainRef.current) setSelectedUser(null)
      showError(error)
    } finally {
      if (seq === overviewSeq.current) setOverviewLoading(false)
    }
  }

  const selectUser = (user: SimpleUser) => {
    clearSearchTimer()
    searchSeq.current++
    setSelectedUser(user)
    setUserQuery('')
    setUserResults([])
    setSearched(false)
    setAvailableQuota(0)
    setAmount('')
    void loadAvailableQuota(user.id)
  }

  const clearUser = () => {
    overviewSeq.current++
    setSelectedUser(null)
    setAvailableQuota(0)
    setOverviewLoading(false)
    setAmount('')
  }

  const fillAll = () => {
    setAmount(String(Math.round(availableQuota * LEDGER_SCALE) / LEDGER_SCALE))
  }

  const resetForm = () => {
    clearSearchTimer()
    searchSeq.current++
    overviewSeq.current++
    setUserQuery('')
    setUserResults([])
    setSearched(false)
    setSelectedUser(null)
    setAvailableQuota(0)
    setOverviewLoading(false)
    setAmount('')
    setSubmitting(false)
    pendingOperation.current = null
    markUncertain(false)
  }

  const handleClose = () => {
    if (submitting) return
    onClose?.()
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    const user = selectedUser
    if (!user || !canSubmit) return
    if (!pendingOperation.current) {
      pendingOperation.current = prepareAffiliateWithdrawOperation(user.id, parsedAmount)
    }
    const operation = pendingOperation.current
    setSubmitting(true)
    try {
      const { result, replayed } = await affiliatesAPI.withdrawUserQuota(
        operation.userId,
        { amount: operation.amount },
        operation.key
      )
      completeAffiliateWithdrawOperation(operation)
      pendingOperation.current = null
      markUncertain(false)
      useAppStore.getState().showSuccess(
        t(replayed ? 'admin.affiliates.withdraw.replayed' : 'admin.affiliates.withdraw.success', {
          amount: `$${formatPreciseAmount(result.amount)}`,
          remaining: `$${formatPreciseAmount(result.available_quota_after)}`
        })
      )
      onSuccess?.(result)
    } catch (error) {
      showError(error)
      // 网络错误、超时、5xx 与 408/409 时服务端可能已经登记：保留这笔登记，
      // 重试沿用同一请求与幂等键，直到拿到确定结果。
      const status = (error as { status?: number } | null)?.status
      if (!operation.outcomeUncertain && status && status >= 400 && status < 500 && status !== 408 && status !== 409) {
        completeAffiliateWithdrawOperation(operation)
        pendingOperation.current = null
        markUncertain(false)
      } else {
        operation.outcomeUncertain = true
        markUncertain(true)
      }
      void loadAvailableQuota(operation.userId)
    } finally {
      setSubmitting(false)
    }
  }

  // 每次打开时重置（Vue 版 watch(show, { immediate: true })）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 与 Vue 版 watch(show) 一致：每次打开时重置表单
    if (show) resetForm()
  }, [show]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => clearSearchTimer, [])

  const amountLocked = !selectedUser || overviewLoading || submitting || outcomeUncertain

  return (
    <BaseDialog
      show={show}
      title={t('admin.affiliates.withdraw.title')}
      width="normal"
      onClose={handleClose}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={submitting} onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canSubmit}
            data-test="withdraw-submit"
            onClick={() => void submit()}
          >
            {submitting ? t('admin.affiliates.withdraw.submitting') : t('admin.affiliates.withdraw.submit')}
          </Button>
        </>
      }
    >
      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <div className={styles.field}>
          <span className={styles.label}>{t('admin.affiliates.withdraw.user')}</span>
          {selectedUser ? (
            <div className={styles.selectedUser} data-test="withdraw-selected-user">
              <div className={styles.selectedUserText}>
                <span className={styles.mono}>#{selectedUser.id}</span>
                <span className={styles.selectedEmail}>{selectedUser.email}</span>
                {selectedUser.username && <span className={styles.muted}>({selectedUser.username})</span>}
              </div>
              <button
                type="button"
                className={styles.clearUser}
                title={t('admin.affiliates.withdraw.changeUser')}
                aria-label={t('admin.affiliates.withdraw.changeUser')}
                disabled={submitting || outcomeUncertain}
                data-test="withdraw-clear-user"
                onClick={clearUser}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <>
              <Input
                value={userQuery}
                aria-label={t('admin.affiliates.withdraw.user')}
                placeholder={t('admin.affiliates.withdraw.userPlaceholder')}
                data-test="withdraw-user-search"
                onChange={onUserQueryInput}
              />
              {userResults.length > 0 ? (
                <div className={styles.userResults}>
                  {userResults.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className={styles.userOption}
                      data-test="withdraw-user-option"
                      onClick={() => selectUser(user)}
                    >
                      {user.email} <span className={styles.muted}>({user.username})</span>
                    </button>
                  ))}
                </div>
              ) : searched ? (
                <p className={styles.hint}>{t('admin.affiliates.withdraw.noUserFound')}</p>
              ) : null}
            </>
          )}
        </div>

        {selectedUser && (
          <div className={styles.quotaBox}>
            <div className={styles.quotaRow}>
              <span className={styles.secondary}>{t('admin.affiliates.withdraw.availableQuota')}</span>
              {overviewLoading ? (
                <Loader2 size={16} className={styles.spin} aria-label={t('common.loading')} />
              ) : (
                <span className={styles.strong} data-test="withdraw-available-quota">
                  ${formatPreciseAmount(availableQuota)}
                </span>
              )}
            </div>
            <p className={styles.hint}>{t('admin.affiliates.withdraw.frozenHint')}</p>
          </div>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="affiliate-withdraw-amount">
            {t('admin.affiliates.withdraw.amount')}
          </label>
          <div className={styles.amountRow}>
            <Input
              id="affiliate-withdraw-amount"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={amount}
              disabled={amountLocked}
              aria-invalid={amountError ? true : undefined}
              data-test="withdraw-amount"
              onChange={setAmount}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={amountLocked || availableQuota <= 0}
              data-test="withdraw-fill-all"
              onClick={fillAll}
            >
              {t('admin.affiliates.withdraw.fillAll')}
            </Button>
          </div>
          {amountError ? (
            <p className={styles.error} role="alert" data-test="withdraw-amount-error">
              {amountError}
            </p>
          ) : (
            <p className={styles.hint}>{t('admin.affiliates.withdraw.amountHint')}</p>
          )}
        </div>

        {outcomeUncertain && (
          <div data-test="withdraw-uncertain-hint">
            <FormNotice tone="info">{t('admin.affiliates.withdraw.uncertainHint')}</FormNotice>
          </div>
        )}

        <FormNotice tone="warning">{t('admin.affiliates.withdraw.warning')}</FormNotice>
      </form>
    </BaseDialog>
  )
}
