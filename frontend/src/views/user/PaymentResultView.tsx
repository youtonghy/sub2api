import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Check, X } from 'lucide-react'

import { Button } from '@/components/arc/button/button'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import OrderStatusBadge from '@/components/payment/OrderStatusBadge'
import {
  PAYMENT_RECOVERY_STORAGE_KEY,
  clearPaymentRecoverySnapshot,
  readPaymentRecoverySnapshot,
} from '@/components/payment/paymentFlow'
import { formatPaymentAmount, normalizePaymentCurrency } from '@/components/payment/currency'
import ui from '@/components/payment/paymentUi.module.css'
import { paymentAPI } from '@/api/payment'
import type { PublicOrderVerifyResult } from '@/api/payment'
import { useI18n } from '@/i18n/useI18n'
import { useAuthStore } from '@/stores/auth'
import { usePaymentStore } from '@/stores/payment'
import type { OrderStatus, PaymentOrder } from '@/types/payment'
import { normalizePaymentMethodForDisplay, paymentMethodI18nKey } from './paymentUx'
import styles from './PaymentResultView.module.css'

type ResolvedOrder = PaymentOrder | PublicOrderVerifyResult

interface ReturnInfo {
  outTradeNo: string
  money: string
  type: string
  tradeStatus: string
}

const SUCCESS_STATUSES = new Set(['COMPLETED', 'PAID', 'RECHARGING'])
const PENDING_STATUSES = new Set(['PENDING', 'CREATED', 'WAITING', 'PROCESSING'])
const STATUS_REFRESH_INTERVAL_MS = 2000
const STATUS_REFRESH_MAX_ATTEMPTS = 15

function normalizedOrderPaymentType(paymentType: string): string {
  return normalizePaymentMethodForDisplay(paymentType || '') || paymentType || ''
}

function hasOrderId(nextOrder: ResolvedOrder | null): nextOrder is PaymentOrder {
  return !!nextOrder && 'id' in nextOrder && typeof nextOrder.id === 'number'
}

function hasAmountFields(nextOrder: ResolvedOrder | null): nextOrder is PaymentOrder {
  return !!nextOrder && 'pay_amount' in nextOrder && typeof nextOrder.pay_amount === 'number' && 'amount' in nextOrder && typeof nextOrder.amount === 'number'
}

/** 充值赠送额度（USD）；老接口/订阅订单没有该字段时视为 0 */
function orderBonusAmount(target: unknown): number {
  const value = (target as { bonus_amount?: unknown } | null | undefined)?.bonus_amount
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function hasPaymentType(nextOrder: ResolvedOrder | null): nextOrder is PaymentOrder {
  return !!nextOrder && 'payment_type' in nextOrder && typeof nextOrder.payment_type === 'string' && nextOrder.payment_type.trim() !== ''
}

function normalizeOrderStatus(status: string | null | undefined): string {
  return String(status || '').trim().toUpperCase()
}

function displayOrderStatus(status: string): OrderStatus {
  return normalizeOrderStatus(status) as OrderStatus
}

function isSuccessStatus(status: string | null | undefined): boolean {
  return SUCCESS_STATUSES.has(normalizeOrderStatus(status))
}

function isPendingStatus(status: string | null | undefined): boolean {
  return PENDING_STATUSES.has(normalizeOrderStatus(status))
}

function clearRecoverySnapshot(): void {
  if (typeof window === 'undefined') return
  clearPaymentRecoverySnapshot(window.localStorage, PAYMENT_RECOVERY_STORAGE_KEY)
}

function clearRecoverySnapshotForTerminalStatus(status: string | null | undefined): void {
  if (!status) return
  if (!isPendingStatus(status)) {
    clearRecoverySnapshot()
  }
}

function restoreRecoverySnapshot(context: {
  resumeToken: string
  routeOrderId: number
  routeOutTradeNo: string
}) {
  if (typeof window === 'undefined') {
    return null
  }

  const rawSnapshot = window.localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY)
  if (!rawSnapshot) {
    return null
  }

  if (context.resumeToken) {
    return readPaymentRecoverySnapshot(rawSnapshot, {
      resumeToken: context.resumeToken,
    })
  }

  if (!context.routeOrderId && !context.routeOutTradeNo) {
    return null
  }

  const restored = readPaymentRecoverySnapshot(rawSnapshot)
  if (!restored) {
    return null
  }

  if (context.routeOrderId > 0 && restored.orderId !== context.routeOrderId) {
    return null
  }

  if (context.routeOutTradeNo && restored.outTradeNo !== context.routeOutTradeNo) {
    return null
  }

  return restored
}

async function resolveOrderFromResumeToken(resumeToken: string): Promise<ResolvedOrder | null> {
  try {
    const result = await paymentAPI.resolveOrderPublicByResumeToken(resumeToken)
    return result.data
  } catch {
    return null
  }
}

async function resolveOrderFromOutTradeNo(outTradeNo: string): Promise<ResolvedOrder | null> {
  try {
    const result = await paymentAPI.verifyOrder(outTradeNo)
    return result.data
  } catch {
    try {
      const result = await paymentAPI.verifyOrderPublic(outTradeNo)
      return result.data
    } catch {
      return null
    }
  }
}

export default function PaymentResultView() {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [order, setOrderState] = useState<ResolvedOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [currency, setCurrencyState] = useState('CNY')
  const [returnInfo, setReturnInfo] = useState<ReturnInfo | null>(null)

  // 挂载流程是一段异步过程，需要同步读取最新订单与币种
  const orderRef = useRef<ResolvedOrder | null>(null)
  const userBalanceRefreshStarted = useRef(false)

  /** 充值金额 = pay_amount / (1 + fee_rate/100)，fee_rate=0 时等于 pay_amount */
  let baseAmount = 0
  /** 手续费 = pay_amount - baseAmount */
  let feeAmount = 0
  if (hasAmountFields(order)) {
    const feeRate = Number(order.fee_rate) || 0
    baseAmount = feeRate <= 0 ? (order.pay_amount ?? 0) : Math.round((order.pay_amount / (1 + feeRate / 100)) * 100) / 100
    feeAmount = feeRate <= 0 ? 0 : Math.round((order.pay_amount - baseAmount) * 100) / 100
  }

  const isSuccess = isSuccessStatus(order?.status)
  const isPending = isPendingStatus(order?.status)
  const statusTitle = isSuccess
    ? t('payment.result.success')
    : isPending ? t('payment.result.processing') : t('payment.result.failed')

  function formatGatewayAmount(value: number): string {
    return formatPaymentAmount(value, currency, locale)
  }

  useEffect(() => {
    let disposed = false
    let statusRefreshTimer: ReturnType<typeof setTimeout> | null = null
    let refreshAttempts = 0

    function readRouteQueryString(key: string): string {
      return searchParams.get(key) ?? ''
    }

    function refreshUserBalanceForSuccessfulOrder(nextOrder: ResolvedOrder | null): void {
      if (!nextOrder || userBalanceRefreshStarted.current || normalizeOrderStatus(nextOrder.status) !== 'COMPLETED') {
        return
      }
      if ('order_type' in nextOrder && nextOrder.order_type !== 'balance') {
        return
      }

      userBalanceRefreshStarted.current = true
      void useAuthStore.getState().refreshUser().catch(() => {
        // The order result remains authoritative even if refreshing profile data fails.
      })
    }

    function setResolvedOrder(nextOrder: ResolvedOrder | null): void {
      orderRef.current = nextOrder
      setOrderState(nextOrder)
      if (nextOrder && 'currency' in nextOrder && nextOrder.currency) {
        setCurrencyState(normalizePaymentCurrency(nextOrder.currency))
      }
      refreshUserBalanceForSuccessfulOrder(nextOrder)
    }

    function clearStatusRefreshTimer(): void {
      if (statusRefreshTimer !== null) {
        clearTimeout(statusRefreshTimer)
        statusRefreshTimer = null
      }
    }

    function scheduleStatusRefresh(refreshOrder: (() => Promise<ResolvedOrder | null>) | null): void {
      clearStatusRefreshTimer()
      if (disposed || !refreshOrder || !isPendingStatus(orderRef.current?.status) || refreshAttempts >= STATUS_REFRESH_MAX_ATTEMPTS) {
        return
      }

      statusRefreshTimer = setTimeout(async () => {
        refreshAttempts += 1
        const refreshedOrder = await refreshOrder()
        if (disposed) return
        if (refreshedOrder) {
          setResolvedOrder(refreshedOrder)
          clearRecoverySnapshotForTerminalStatus(refreshedOrder.status)
        }

        if (isPendingStatus(orderRef.current?.status)) {
          scheduleStatusRefresh(refreshOrder)
        }
      }, STATUS_REFRESH_INTERVAL_MS)
    }

    void (async () => {
      const resumeToken = readRouteQueryString('resume_token')
      const routeOrderId = Number(readRouteQueryString('order_id')) || 0
      let outTradeNo = readRouteQueryString('out_trade_no')
      let orderId = 0
      let resumeTokenLookupFailed = false

      const restored = restoreRecoverySnapshot({
        resumeToken,
        routeOrderId,
        routeOutTradeNo: outTradeNo,
      })
      if (restored?.orderId) {
        orderId = restored.orderId
      }
      if (restored?.currency) {
        setCurrencyState(normalizePaymentCurrency(restored.currency))
      }
      if (!outTradeNo && restored?.outTradeNo) {
        outTradeNo = restored.outTradeNo
      }

      if (resumeToken) {
        const resolvedOrder = await resolveOrderFromResumeToken(resumeToken)
        if (disposed) return
        if (resolvedOrder) {
          setResolvedOrder(resolvedOrder)
          if (!orderId) {
            orderId = hasOrderId(resolvedOrder) ? resolvedOrder.id : 0
          }
        } else if (routeOrderId > 0) {
          resumeTokenLookupFailed = true
          orderId = routeOrderId
        } else {
          resumeTokenLookupFailed = true
        }
      } else if (routeOrderId > 0) {
        orderId = routeOrderId
      }

      const hasLegacyFallbackContext = readRouteQueryString('trade_status').trim() !== ''
      const shouldUsePublicOutTradeNo = outTradeNo !== '' && (hasLegacyFallbackContext || routeOrderId > 0 || orderId > 0)

      if (!orderRef.current && orderId && (!resumeToken || routeOrderId > 0)) {
        try {
          const polled = await usePaymentStore.getState().pollOrderStatus(orderId)
          if (disposed) return
          setResolvedOrder(polled)
        } catch {
          // Order lookup failed, will try legacy fallback below when possible.
        }
      }

      if (!orderRef.current && shouldUsePublicOutTradeNo && (!resumeToken || resumeTokenLookupFailed)) {
        const legacyOrder = await resolveOrderFromOutTradeNo(outTradeNo)
        if (disposed) return
        if (legacyOrder) {
          setResolvedOrder(legacyOrder)
          if (!orderId) {
            orderId = hasOrderId(legacyOrder) ? legacyOrder.id : 0
          }
        }
      }

      let nextReturnInfo: ReturnInfo | null = null
      if (!orderRef.current && !orderId && outTradeNo && hasLegacyFallbackContext) {
        nextReturnInfo = {
          outTradeNo,
          money: readRouteQueryString('money'),
          type: readRouteQueryString('type'),
          tradeStatus: readRouteQueryString('trade_status'),
        }
        setReturnInfo(nextReturnInfo)
      }

      const refreshOrder = async (): Promise<ResolvedOrder | null> => {
        if (resumeToken) {
          const resolvedOrder = await resolveOrderFromResumeToken(resumeToken)
          if (resolvedOrder) {
            return resolvedOrder
          }
        }

        if (orderId) {
          try {
            return await usePaymentStore.getState().pollOrderStatus(orderId)
          } catch {
            // Fall through to legacy public verification when order polling is unavailable.
          }
        }

        if (shouldUsePublicOutTradeNo) {
          return await resolveOrderFromOutTradeNo(outTradeNo)
        }

        return null
      }

      if (isPendingStatus(orderRef.current?.status)) {
        scheduleStatusRefresh(refreshOrder)
      } else if (orderRef.current) {
        clearRecoverySnapshotForTerminalStatus(orderRef.current.status)
      } else if (nextReturnInfo) {
        clearRecoverySnapshot()
      }
      setLoading(false)
    })()

    return () => {
      disposed = true
      clearStatusRefreshTimer()
    }
    // 只在挂载时根据 URL 解析一次（与 Vue 版 onMounted 一致）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        {loading ? (
          <Skeleton lines={4} label={t('common.loading')} />
        ) : (
          <>
            {/* Status Icon */}
            <div className={styles.status}>
              {isSuccess ? (
                <div className={`${ui.statusIcon} ${styles.bigIcon}`} data-tone="success"><Check size={36} aria-hidden="true" /></div>
              ) : isPending ? (
                <div className={`${ui.statusIcon} ${styles.bigIcon}`} data-tone="warning">
                  <div className={ui.spinner} role="status" aria-label={t('payment.result.processing')} />
                </div>
              ) : (
                <div className={`${ui.statusIcon} ${styles.bigIcon}`} data-tone="danger"><X size={36} aria-hidden="true" /></div>
              )}
              <h1 className={styles.title}>{statusTitle}</h1>
              {isPending && <p className={ui.hint}>{t('payment.result.processingHint')}</p>}
            </div>

            {/* Order Info */}
            {order ? (
              <div className={ui.region}>
                <div className={ui.detailsPlain}>
                  {hasOrderId(order) && (
                    <div className={ui.row}>
                      <span className={ui.rowLabel}>{t('payment.orders.orderId')}</span>
                      <span className={ui.rowValue}>#{order.id}</span>
                    </div>
                  )}
                  {order.out_trade_no && (
                    <div className={ui.row}>
                      <span className={ui.rowLabel}>{t('payment.orders.orderNo')}</span>
                      <span className={ui.rowValue}>{order.out_trade_no}</span>
                    </div>
                  )}
                  {hasAmountFields(order) && (
                    <div className={ui.row}>
                      <span className={ui.rowLabel}>{t('payment.orders.baseAmount')}</span>
                      <span className={ui.rowValue}>{formatGatewayAmount(baseAmount)}</span>
                    </div>
                  )}
                  {hasAmountFields(order) && order.fee_rate > 0 && (
                    <div className={ui.row}>
                      <span className={ui.rowLabel}>{t('payment.orders.fee')} ({order.fee_rate}%)</span>
                      <span className={ui.rowValue}>{formatGatewayAmount(feeAmount)}</span>
                    </div>
                  )}
                  {hasAmountFields(order) && (
                    <div className={ui.row}>
                      <span className={ui.rowLabel}>{t('payment.orders.payAmount')}</span>
                      <span className={`${ui.rowValue} ${styles.accent}`}>{formatGatewayAmount(order.pay_amount)}</span>
                    </div>
                  )}
                  {hasAmountFields(order) && orderBonusAmount(order) > 0 && (
                    <div className={ui.row}>
                      <span className={ui.rowLabel}>{t('payment.orders.bonusAmount')}</span>
                      <span className={`${ui.rowValue} ${styles.bonus}`}>+${orderBonusAmount(order).toFixed(2)}</span>
                    </div>
                  )}
                  {hasAmountFields(order) && (order.amount !== order.pay_amount || orderBonusAmount(order) > 0) && (
                    <div className={ui.row}>
                      <span className={ui.rowLabel}>{t('payment.orders.creditedAmount')}</span>
                      <span className={ui.rowValue}>
                        {order.order_type === 'balance' ? '$' + order.amount.toFixed(2) : formatGatewayAmount(order.amount)}
                      </span>
                    </div>
                  )}
                  {hasPaymentType(order) && (
                    <div className={ui.row}>
                      <span className={ui.rowLabel}>{t('payment.orders.paymentMethod')}</span>
                      <span className={ui.rowValue}>
                        {t(paymentMethodI18nKey(order.payment_type), normalizedOrderPaymentType(order.payment_type))}
                      </span>
                    </div>
                  )}
                  <div className={ui.row}>
                    <span className={ui.rowLabel}>{t('payment.orders.status')}</span>
                    <OrderStatusBadge status={displayOrderStatus(order.status)} />
                  </div>
                </div>
              </div>
            ) : returnInfo ? (
              /* EasyPay return info (when no order loaded) */
              <div className={ui.region}>
                <div className={ui.detailsPlain}>
                  {returnInfo.outTradeNo && (
                    <div className={ui.row}>
                      <span className={ui.rowLabel}>{t('payment.orders.orderId')}</span>
                      <span className={ui.rowValue}>{returnInfo.outTradeNo}</span>
                    </div>
                  )}
                  {returnInfo.money && (
                    <div className={ui.row}>
                      <span className={ui.rowLabel}>{t('payment.orders.payAmount')}</span>
                      <span className={ui.rowValue}>{formatGatewayAmount(Number(returnInfo.money) || 0)}</span>
                    </div>
                  )}
                  {returnInfo.type && (
                    <div className={ui.row}>
                      <span className={ui.rowLabel}>{t('payment.orders.paymentMethod')}</span>
                      <span className={ui.rowValue}>
                        {t(paymentMethodI18nKey(returnInfo.type), normalizedOrderPaymentType(returnInfo.type))}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {/* Actions */}
            <div className={styles.actions}>
              <Button type="button" variant="secondary" onClick={() => navigate('/purchase')}>{t('payment.result.backToRecharge')}</Button>
              <Button type="button" onClick={() => navigate('/orders')}>{t('payment.result.viewOrders')}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
