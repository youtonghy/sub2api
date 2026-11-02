/**
 * 支付看板，对应 Vue 版 views/admin/orders/AdminPaymentDashboardView.vue：
 * 7 / 30 / 90 天切换、KPI、每日收入趋势、支付方式分布与付费用户排行。
 */
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { adminPaymentAPI } from '@/api/admin/payment'
import { Button } from '@/components/arc/button/button'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import DailyRevenueChart from '@/components/admin/payment/DailyRevenueChart'
import OrderStatsCards from '@/components/admin/payment/OrderStatsCards'
import PaymentMethodChart from '@/components/admin/payment/PaymentMethodChart'
import TopUsersLeaderboard from '@/components/admin/payment/TopUsersLeaderboard'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { DashboardStats } from '@/types/payment'
import { extractI18nErrorMessage } from '@/utils/apiError'
import styles from './Orders.module.css'

const DAYS_OPTIONS = [7, 30, 90] as const

export default function AdminPaymentDashboardView() {
  const { t } = useI18n()
  const [days, setDays] = useState<number>(30)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const loadSeq = useRef(0)

  async function loadDashboard(range: number) {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      const res = await adminPaymentAPI.getDashboard(range)
      if (seq !== loadSeq.current) return
      setStats(res.data)
    } catch (err: unknown) {
      if (seq !== loadSeq.current) return
      useAppStore.getState().showError(extractI18nErrorMessage(err, t, 'payment.errors', t('common.error')))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }

  // Vue 版 onMounted + watch(days)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 进入页面与切换天数时加载看板数据
    void loadDashboard(days)
  }, [days]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.page}>
      {/* Header with Day Switcher */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarEnd}>
          <SegmentedControl
            label={t('admin.dashboard.timeRange')}
            options={DAYS_OPTIONS.map((d) => ({ value: String(d), label: `${d}${t('payment.admin.daySuffix')}` }))}
            value={String(days)}
            onValueChange={(value) => setDays(Number(value))}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void loadDashboard(days)}
            disabled={loading}
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
          >
            <RefreshCw size={16} className={loading ? styles.spin : undefined} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Dashboard Content */}
      {loading ? (
        <div className={styles.page} aria-busy="true">
          <div className={styles.kpis}>
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} lines={3} className={styles.kpiSkeleton} label={t('common.loading')} />
            ))}
          </div>
          <div className={styles.panelSkeleton}>
            <Skeleton lines={6} label={t('common.loading')} />
          </div>
        </div>
      ) : stats ? (
        <>
          <OrderStatsCards stats={stats} />
          <DailyRevenueChart data={stats.daily_series || []} loading={loading} />
          <div className={styles.split}>
            {/* 看板页的支付方式分布与 Vue 版一致，不显示占比条 */}
            <PaymentMethodChart methods={stats.payment_methods || []} showBars={false} />
            <TopUsersLeaderboard users={stats.top_users || {}} />
          </div>
        </>
      ) : null}
    </div>
  )
}
