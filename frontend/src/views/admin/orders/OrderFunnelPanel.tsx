/**
 * 支付看板的订单漏斗：所选天数内创建的订单 → 已支付 → 已完成，可按订单类型（余额充值 / 订阅）拆分。
 * 数据来自订单列表接口按创建时间倒序翻页（每页 100 条，最多 8 页），整理逻辑见 orderFunnel.ts。
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { adminPaymentAPI } from '@/api/admin/payment'
import { FunnelChart, type FunnelSegment } from '@/components/arc/funnel-chart/funnel-chart'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { useI18n } from '@/i18n/useI18n'
import type { PaymentOrder } from '@/types/payment'
import {
  coversRange,
  FUNNEL_PAGE_SIZE,
  OTHER_SEGMENT,
  oldestCreatedAt,
  ordersInRange,
  pageLimit,
  pagesToFetch,
  rangeStartMs,
  summarizeOrderFunnel,
  toFunnelStages,
  type OrderFunnelSummary
} from './orderFunnel'
import { useFunnelChartLabels } from './useFunnelChartLabels'
import styles from './Orders.module.css'

export interface OrderFunnelPanelProps {
  /** 看板选择的天数，变化时重新加载 */
  days: number
  /** 看板刷新按钮每点一次加一，触发重新加载 */
  refreshKey: number
}

interface FunnelResult {
  summary: OrderFunnelSummary
  /** 未覆盖整个范围时，实际统计到的最早创建时间 */
  truncatedFrom: string | null
}

async function fetchPages(pages: number[]): Promise<{ items: PaymentOrder[]; total: number }[]> {
  const responses = await Promise.all(pages.map((page) => adminPaymentAPI.getOrders({ page, page_size: FUNNEL_PAGE_SIZE })))
  return responses.map((res) => ({ items: res.data.items || [], total: res.data.total || 0 }))
}

/** 读第一页后按估算并行读后续页；仍未覆盖范围时再并行读到上限，总请求不超过 FUNNEL_MAX_PAGES */
async function loadFunnel(days: number): Promise<FunnelResult> {
  const now = Date.now()
  const since = rangeStartMs(days, now)
  const [first] = await fetchPages([1])
  const total = first.total
  const limit = pageLimit(total)
  const orders = [...first.items]
  let fetched = 1
  const wanted = pagesToFetch(first, since, now)
  if (wanted > fetched) {
    const wave = await fetchPages(Array.from({ length: wanted - fetched }, (_, i) => fetched + i + 1))
    wave.forEach((page) => orders.push(...page.items))
    fetched = wanted
  }
  if (!coversRange(orders, since, fetched, total) && fetched < limit) {
    const wave = await fetchPages(Array.from({ length: limit - fetched }, (_, i) => fetched + i + 1))
    wave.forEach((page) => orders.push(...page.items))
    fetched = limit
  }
  const inRange = ordersInRange(orders, since)
  const covered = coversRange(orders, since, fetched, total)
  return { summary: summarizeOrderFunnel(inRange), truncatedFrom: covered ? null : oldestCreatedAt(inRange) }
}

export default function OrderFunnelPanel({ days, refreshKey }: OrderFunnelPanelProps) {
  const { t, locale } = useI18n()
  const chartLabels = useFunnelChartLabels()
  const [result, setResult] = useState<FunnelResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [view, setView] = useState('total')
  const loadSeq = useRef(0)

  useEffect(() => {
    const seq = ++loadSeq.current
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 切换天数或刷新时重新加载漏斗
    setLoading(true)
    setFailed(false)
    loadFunnel(days)
      .then((next) => {
        if (seq !== loadSeq.current) return
        setResult(next)
      })
      .catch((err: unknown) => {
        if (seq !== loadSeq.current) return
        console.error('[OrderFunnelPanel] failed to load orders for the funnel', err)
        setFailed(true)
        setResult(null)
      })
      .finally(() => {
        if (seq === loadSeq.current) setLoading(false)
      })
  }, [days, refreshKey])

  const summary = result?.summary ?? null

  const segmentLabel = (key: string) => {
    if (key === 'balance') return t('payment.admin.balanceOrder')
    if (key === 'subscription') return t('payment.admin.subscriptionOrder')
    if (key === OTHER_SEGMENT) return t('funnelUi.segments.other')
    return key
  }

  const segments = useMemo<FunnelSegment[]>(
    () => (summary?.segmentKeys ?? []).map((key) => ({ key, label: segmentLabel(key) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summary, t, locale]
  )

  const stages = useMemo(
    () =>
      summary
        ? toFunnelStages(summary, {
            created: t('funnelUi.stages.created'),
            paid: t('funnelUi.stages.paid'),
            completed: t('funnelUi.stages.completed')
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summary, t, locale]
  )

  const viewOptions = [
    { value: 'total', label: t('funnelUi.views.total') },
    { value: 'split', label: t('funnelUi.views.split') },
    ...segments.map((segment) => ({ value: segment.key, label: segment.label }))
  ]
  // 切换天数后若原先选中的分段不再出现，回到合计
  const activeView = viewOptions.some((option) => option.value === view) ? view : 'total'

  const dropoffGroups = summary
    ? [
        {
          key: 'unpaid',
          title: t('funnelUi.dropoff.unpaid'),
          items: [
            { key: 'pending', label: t('payment.status.pending'), value: summary.dropoff.pending },
            { key: 'expired', label: t('payment.status.expired'), value: summary.dropoff.expired },
            { key: 'cancelled', label: t('payment.status.cancelled'), value: summary.dropoff.cancelled },
            { key: 'failed', label: t('payment.status.failed'), value: summary.dropoff.failedUnpaid },
            { key: 'other', label: t('funnelUi.dropoff.other'), value: summary.dropoff.otherUnpaid }
          ]
        },
        {
          key: 'paid',
          title: t('funnelUi.dropoff.paidNotCompleted'),
          items: [
            { key: 'inProgress', label: t('funnelUi.dropoff.inProgress'), value: summary.dropoff.inProgress },
            { key: 'failed', label: t('payment.status.failed'), value: summary.dropoff.failedAfterPayment },
            { key: 'other', label: t('funnelUi.dropoff.other'), value: summary.dropoff.otherPaid }
          ]
        },
        {
          key: 'completed',
          title: t('funnelUi.dropoff.afterCompletion'),
          items: [{ key: 'refund', label: t('funnelUi.dropoff.refund'), value: summary.dropoff.refundAfterCompletion }]
        }
      ]
        .map((group) => ({ ...group, items: group.items.filter((item) => item.value > 0) }))
        .filter((group) => group.items.length > 0)
    : []

  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
    [locale]
  )

  return (
    <section className={styles.funnelPanel} aria-labelledby="order-funnel-title" aria-busy={loading || undefined}>
      <div className={styles.funnelHead}>
        <div className={styles.funnelHeading}>
          <h2 id="order-funnel-title" className={styles.funnelTitle}>
            {t('funnelUi.title')}
          </h2>
          <p className={styles.funnelHint}>{t('funnelUi.description', { days })}</p>
        </div>
        {summary && summary.inRange > 0 && (
          <SegmentedControl label={t('funnelUi.viewLabel')} options={viewOptions} value={activeView} onValueChange={setView} />
        )}
      </div>

      {loading && !summary ? (
        <Skeleton lines={5} label={t('common.loading')} />
      ) : failed ? (
        <p className={styles.funnelEmpty}>{t('funnelUi.loadFailed')}</p>
      ) : !summary || summary.inRange === 0 ? (
        <p className={styles.funnelEmpty}>{t('funnelUi.empty')}</p>
      ) : (
        <>
          <FunnelChart
            stages={stages}
            segments={segments}
            view={activeView}
            label={t('funnelUi.chartLabel', { days })}
            unit={t('funnelUi.unit')}
            locale={locale}
            labels={chartLabels}
            emptyLabel={t('funnelUi.empty')}
            height={168}
          />
          {activeView === 'split' && (
            <ul className={styles.funnelLegend}>
              {segments.map((segment, index) => (
                <li key={segment.key}>
                  <span className={styles.funnelSwatch} data-index={index} aria-hidden="true" />
                  {segment.label}
                </li>
              ))}
            </ul>
          )}
          {dropoffGroups.length > 0 && (
            <div className={styles.funnelDropoff}>
              <h3 className={styles.funnelSubTitle}>{t('funnelUi.dropoff.heading')}</h3>
              <dl className={styles.funnelDropoffList}>
                {dropoffGroups.map((group) => (
                  <div key={group.key} className={styles.funnelDropoffGroup}>
                    <dt>{group.title}</dt>
                    {group.items.map((item) => (
                      <dd key={item.key}>
                        <span>{item.label}</span>
                        <span className={styles.funnelDropoffValue}>{numberFormat.format(item.value)}</span>
                      </dd>
                    ))}
                  </div>
                ))}
              </dl>
            </div>
          )}
          {result?.truncatedFrom && (
            <p className={styles.funnelNote}>
              {t('funnelUi.truncated', {
                count: numberFormat.format(summary.inRange),
                date: dateFormat.format(new Date(result.truncatedFrom))
              })}
            </p>
          )}
        </>
      )}
    </section>
  )
}
