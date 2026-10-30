/**
 * 余额 / 并发 / 订阅变动记录弹窗，对应 Vue 版 UserBalanceHistoryModal.vue。
 * 打开时重置类型筛选并加载第一页；关闭、卸载或发起新请求后，迟到的旧响应与错误都被忽略。
 * 也被用量页（UsageView）以 hideActions 方式复用。
 */
import { BadgeCheck, DollarSign, Minus, Plus, Zap } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'

import { adminAPI, type BalanceHistoryItem } from '@/api/admin'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import Select from '@/components/common/Select'
import Skeleton from '@/components/common/Skeleton'
import { useI18n } from '@/i18n/useI18n'
import type { AdminUser } from '@/types'
import { formatDateTime } from '@/utils/format'
import { UserAvatar } from './UserAvatar'
import styles from './UserBalanceHistoryModal.module.css'

export interface UserBalanceHistoryModalProps {
  show: boolean
  user: AdminUser | null
  hideActions?: boolean
  onClose?: () => void
  onDeposit?: () => void
  onWithdraw?: () => void
}

const pageSize = 15

type Tone = 'success' | 'danger' | 'accent' | 'warning'

// Helper: check if admin type
const isAdminType = (type: string) => type === 'admin_balance' || type === 'admin_concurrency'

// Helper: check if balance type (includes admin_balance)
const isBalanceType = (type: string) => type === 'balance' || type === 'admin_balance' || type === 'affiliate_balance'

// Helper: check if subscription type
const isSubscriptionType = (type: string) => type === 'subscription'

// 色调：余额增减为 success / danger，订阅为 accent，并发增减为 accent / warning
const getTone = (item: BalanceHistoryItem): Tone => {
  if (isBalanceType(item.type)) return item.value >= 0 ? 'success' : 'danger'
  if (isSubscriptionType(item.type)) return 'accent'
  return item.value >= 0 ? 'accent' : 'warning'
}

// Icon based on type
const ItemIcon = ({ item }: { item: BalanceHistoryItem }) => {
  const props = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const
  if (isBalanceType(item.type)) return <DollarSign {...props} />
  if (isSubscriptionType(item.type)) return <BadgeCheck {...props} />
  return <Zap {...props} /> // concurrency
}

// Format display value
const formatValue = (item: BalanceHistoryItem) => {
  if (isBalanceType(item.type)) {
    const sign = item.value >= 0 ? '+' : ''
    return `${sign}$${item.value.toFixed(2)}`
  }
  if (isSubscriptionType(item.type)) {
    const days = item.validity_days || Math.round(item.value)
    const groupName = item.group?.name || ''
    return groupName ? `${days}d - ${groupName}` : `${days}d`
  }
  // concurrency types
  const sign = item.value >= 0 ? '+' : ''
  return `${sign}${item.value}`
}

export default function UserBalanceHistoryModal({
  show,
  user,
  hideActions = false,
  onClose,
  onDeposit,
  onWithdraw
}: UserBalanceHistoryModalProps) {
  const { t } = useI18n()

  const [history, setHistory] = useState<BalanceHistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalRecharged, setTotalRecharged] = useState(0)
  const [typeFilter, setTypeFilter] = useState('')
  const requestVersion = useRef(0)

  useEffect(
    () => () => {
      requestVersion.current++
    },
    []
  )

  const totalPages = Math.ceil(total / pageSize) || 1

  // Type filter options
  const typeOptions = [
    { value: '', label: t('admin.users.allTypes') },
    { value: 'balance', label: t('admin.users.typeBalance') },
    { value: 'affiliate_balance', label: t('admin.users.typeAffiliateBalance') },
    { value: 'admin_balance', label: t('admin.users.typeAdminBalance') },
    { value: 'concurrency', label: t('admin.users.typeConcurrency') },
    { value: 'admin_concurrency', label: t('admin.users.typeAdminConcurrency') },
    { value: 'subscription', label: t('admin.users.typeSubscription') }
  ]

  const loadHistory = async (page: number, filter: string = typeFilter) => {
    if (!user) return
    const version = ++requestVersion.current
    setLoading(true)
    setCurrentPage(page)
    try {
      const res = await adminAPI.users.getUserBalanceHistory(user.id, page, pageSize, filter || undefined)
      if (version !== requestVersion.current) return
      setHistory(res.items || [])
      setTotal(res.total || 0)
      setTotalRecharged(res.total_recharged || 0)
    } catch (error) {
      if (version !== requestVersion.current) return
      console.error('Failed to load balance history:', error)
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }

  // Watch modal open
  const onShowChange = useEffectEvent((visible: boolean) => {
    requestVersion.current++
    if (visible && user) {
      setTypeFilter('')
      void loadHistory(1, '')
    }
  })
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 对应 Vue 版 watch(show)：打开时重置筛选并加载
    onShowChange(show)
  }, [show])

  // Item title
  const getItemTitle = (item: BalanceHistoryItem) => {
    switch (item.type) {
      case 'balance':
        return t('redeem.balanceAddedRedeem')
      case 'affiliate_balance':
        return t('redeem.balanceAddedAffiliate')
      case 'admin_balance':
        return item.value >= 0 ? t('redeem.balanceAddedAdmin') : t('redeem.balanceDeductedAdmin')
      case 'concurrency':
        return t('redeem.concurrencyAddedRedeem')
      case 'admin_concurrency':
        return item.value >= 0 ? t('redeem.concurrencyAddedAdmin') : t('redeem.concurrencyReducedAdmin')
      case 'subscription':
        return t('redeem.subscriptionAssigned')
      default:
        return t('common.unknown')
    }
  }

  return (
    <BaseDialog
      show={show}
      title={t('admin.users.balanceHistoryTitle')}
      width="wide"
      closeOnClickOutside
      zIndex={40}
      onClose={() => onClose?.()}
    >
      {user && (
        <div className={styles.content}>
          {/* User header: two-row layout with full user info */}
          <div className={styles.header}>
            {/* Row 1: avatar + email/username/created_at (left) + current balance (right) */}
            <div className={styles.headerMain}>
              <UserAvatar email={user.email} />
              <div className={styles.identity}>
                <div className={styles.identityTitle}>
                  <p className={styles.email}>{user.email}</p>
                  {user.deleted_at && (
                    <Badge size="sm" tone="danger">
                      {t('admin.usage.userDeletedBadge')}
                    </Badge>
                  )}
                  {user.username && (
                    <Badge size="sm" tone="info">
                      {user.username}
                    </Badge>
                  )}
                </div>
                <p className={styles.created}>
                  {t('admin.users.createdAt')}: {formatDateTime(user.created_at)}
                </p>
              </div>
              {/* Current balance: prominent display on the right */}
              <div className={styles.balance}>
                <p className={styles.balanceLabel}>{t('admin.users.currentBalance')}</p>
                <p className={styles.balanceValue}>${user.balance?.toFixed(2) || '0.00'}</p>
              </div>
            </div>
            {/* Row 2: notes + total recharged */}
            <div className={styles.headerFoot}>
              <p className={styles.notes} title={user.notes || ''}>
                {user.notes ? `${t('admin.users.notes')}: ${user.notes}` : '\u00a0'}
              </p>
              <p className={styles.recharged}>
                {t('admin.users.totalRecharged')}: <span className={styles.rechargedValue}>${totalRecharged.toFixed(2)}</span>
              </p>
            </div>
          </div>

          {/* Type filter + Action buttons */}
          <div className={styles.toolbar}>
            <div className={styles.filter}>
              <Select
                value={typeFilter}
                options={typeOptions}
                aria-label={t('admin.users.allTypes')}
                onChange={(value) => {
                  const next = value == null ? '' : String(value)
                  setTypeFilter(next)
                  void loadHistory(1, next)
                }}
              />
            </div>
            {!hideActions && (
              <>
                <Button type="button" variant="secondary" onClick={() => onDeposit?.()}>
                  <Plus size={16} strokeWidth={2} className={styles.depositIcon} aria-hidden="true" />
                  {t('admin.users.deposit')}
                </Button>
                <Button type="button" variant="secondary" onClick={() => onWithdraw?.()}>
                  <Minus size={16} strokeWidth={2} className={styles.withdrawIcon} aria-hidden="true" />
                  {t('admin.users.withdraw')}
                </Button>
              </>
            )}
          </div>

          {loading ? (
            // Loading
            <div className={styles.loading} aria-busy="true" data-testid="balance-history-loading">
              <Skeleton height={64} />
              <Skeleton height={64} />
              <Skeleton height={64} />
            </div>
          ) : history.length === 0 ? (
            // Empty state
            <p className={styles.empty}>{t('admin.users.noBalanceHistory')}</p>
          ) : (
            // History list
            <ul className={styles.list}>
              {history.map((item) => (
                <li key={item.id} className={styles.item}>
                  {/* Left: type icon + description */}
                  <div className={styles.itemMain}>
                    <span className={styles.itemIcon} data-tone={getTone(item)}>
                      <ItemIcon item={item} />
                    </span>
                    <div className={styles.itemText}>
                      <p className={styles.itemTitle}>{getItemTitle(item)}</p>
                      {/* Notes (admin adjustment reason) */}
                      {item.notes && (
                        <p className={styles.itemNotes} title={item.notes}>
                          {item.notes.length > 60 ? item.notes.substring(0, 55) + '...' : item.notes}
                        </p>
                      )}
                      <p className={styles.itemDate}>{formatDateTime(item.used_at || item.created_at)}</p>
                    </div>
                  </div>
                  {/* Right: value */}
                  <div className={styles.itemSide}>
                    <p className={styles.itemValue} data-tone={getTone(item)}>
                      {formatValue(item)}
                    </p>
                    {isAdminType(item.type) ? (
                      <p className={styles.itemDate}>{t('redeem.adminAdjustment')}</p>
                    ) : (
                      <p className={`${styles.itemDate} ${styles.mono}`}>{item.code.slice(0, 8)}...</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className={styles.pager}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => void loadHistory(currentPage - 1)}
              >
                {t('pagination.previous')}
              </Button>
              <span className={styles.pageInfo}>
                {currentPage} / {totalPages}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => void loadHistory(currentPage + 1)}
              >
                {t('pagination.next')}
              </Button>
            </div>
          )}
        </div>
      )}
    </BaseDialog>
  )
}
