/**
 * 订阅套餐管理，对应 Vue 版 views/admin/orders/AdminPaymentPlansView.vue：
 * 套餐表格、上架开关、创建 / 编辑（PlanEditDialog）与删除确认。
 */
import { Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { adminAPI } from '@/api/admin'
import { adminPaymentAPI, type AdminPaymentConfig } from '@/api/admin/payment'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import DataTable from '@/components/common/DataTable'
import GroupBadge from '@/components/common/GroupBadge'
import TablePageLayout from '@/components/common/TablePageLayout'
import Toggle from '@/components/common/Toggle'
import type { Column } from '@/components/common/types'
import { currencySymbol } from '@/components/payment/currency'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminGroup } from '@/types'
import type { SubscriptionPlan } from '@/types/payment'
import { extractI18nErrorMessage } from '@/utils/apiError'
import { platformAccentColor } from '@/utils/platformColors'
import PlanEditDialog from './PlanEditDialog'
import styles from './Orders.module.css'

function planCurrencySymbol(currency?: string): string {
  return currencySymbol(currency || 'USD')
}

export default function AdminPaymentPlansView() {
  const { t } = useI18n()

  const showError = (err: unknown) =>
    useAppStore.getState().showError(extractI18nErrorMessage(err, t, 'payment.errors', t('common.error')))

  // ==================== Groups ====================

  const [groups, setGroups] = useState<AdminGroup[]>([])
  const [paymentConfig, setPaymentConfig] = useState<AdminPaymentConfig | null>(null)

  async function loadGroups() {
    try {
      setGroups(await adminAPI.groups.getAll())
    } catch {
      /* ignore */
    }
  }

  async function loadPaymentConfig() {
    try {
      const res = await adminPaymentAPI.getConfig()
      setPaymentConfig(res.data)
    } catch {
      /* preview only */
    }
  }

  const getGroup = (id: number) => groups.find((g) => g.id === id)
  const isGroupMissing = (id: number) => id > 0 && !groups.find((g) => g.id === id)

  // ==================== Plans ====================

  const [plansLoading, setPlansLoading] = useState(false)
  const [plans, setPlans] = useState<SubscriptionPlan[]>([])
  const [showPlanDialog, setShowPlanDialog] = useState(false)
  const [showDeletePlanDialog, setShowDeletePlanDialog] = useState(false)
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null)
  const [deletingPlanId, setDeletingPlanId] = useState<number | null>(null)

  const planColumns: Column<SubscriptionPlan>[] = [
    { key: 'id', label: 'ID' },
    { key: 'name', label: t('payment.admin.planName') },
    { key: 'group_id', label: t('payment.admin.group') },
    { key: 'price', label: t('payment.admin.price') },
    { key: 'validity_days', label: t('payment.admin.validity') },
    { key: 'for_sale', label: t('payment.admin.forSale') },
    { key: 'sort_order', label: t('payment.admin.sortOrder') },
    { key: 'actions', label: t('common.actions') }
  ]

  async function loadPlans() {
    setPlansLoading(true)
    try {
      const res = await adminPaymentAPI.getPlans()
      // Backend returns features as newline-separated string; parse to array
      setPlans(
        ((res.data || []) as Array<Omit<SubscriptionPlan, 'features'> & { features: string | string[] }>).map((p) => ({
          ...p,
          features:
            typeof p.features === 'string'
              ? p.features
                  .split('\n')
                  .map((f) => f.trim())
                  .filter(Boolean)
              : p.features || []
        }))
      )
    } catch (err: unknown) {
      showError(err)
    } finally {
      setPlansLoading(false)
    }
  }

  function openPlanEdit(plan: SubscriptionPlan | null) {
    setEditingPlan(plan)
    setShowPlanDialog(true)
  }

  /** Quick toggle for_sale from the list */
  async function toggleForSale(plan: SubscriptionPlan) {
    try {
      await adminPaymentAPI.updatePlan(plan.id, { for_sale: !plan.for_sale })
      setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, for_sale: !plan.for_sale } : p)))
    } catch (err: unknown) {
      showError(err)
    }
  }

  function confirmDeletePlan(plan: SubscriptionPlan) {
    setDeletingPlanId(plan.id)
    setShowDeletePlanDialog(true)
  }

  async function handleDeletePlan() {
    if (!deletingPlanId) return
    try {
      await adminPaymentAPI.deletePlan(deletingPlanId)
      useAppStore.getState().showSuccess(t('common.deleted'))
      setShowDeletePlanDialog(false)
      void loadPlans()
    } catch (err: unknown) {
      showError(err)
    }
  }

  // ==================== Lifecycle ====================

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 进入页面时加载分组、支付配置与套餐（Vue 版 onMounted）
    void loadGroups()
    void loadPaymentConfig()
    void loadPlans()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const cells: Record<string, (ctx: { row: SubscriptionPlan; value: any }) => ReactNode> = {
    name: ({ value, row }) => {
      const group = getGroup(row.group_id)
      return (
        <span className={styles.planName} style={group ? { color: platformAccentColor(group.platform) } : undefined}>
          {value}
        </span>
      )
    },
    group_id: ({ value }) => {
      if (isGroupMissing(value)) {
        return (
          <span className={styles.cellText}>
            <span className={styles.mutedInline}>#{value}</span>{' '}
            <Badge tone="danger" size="sm">
              {t('payment.admin.groupMissing')}
            </Badge>
          </span>
        )
      }
      const group = getGroup(value)
      if (group) {
        return <GroupBadge name={group.name} platform={group.platform} rateMultiplier={group.rate_multiplier} />
      }
      return <span className={styles.mutedInline}>-</span>
    },
    price: ({ value, row }) => (
      <div className={styles.cellText}>
        <span className={styles.strong}>
          {planCurrencySymbol(row.currency)}
          {(value ?? 0).toFixed(2)}
        </span>
        {row.currency && <span className={styles.aside}>{row.currency}</span>}
        {!!row.original_price && (
          <span className={styles.strike}>
            {planCurrencySymbol(row.currency)}
            {row.original_price.toFixed(2)}
          </span>
        )}
      </div>
    ),
    validity_days: ({ value, row }) => (
      <span className={styles.cellText}>
        {value} {t('payment.admin.' + (row.validity_unit || 'days'))}
      </span>
    ),
    for_sale: ({ value, row }) => (
      <Toggle value={!!value} aria-label={t('payment.admin.forSale')} onChange={() => void toggleForSale(row)} />
    ),
    actions: ({ row }) => (
      <div className={styles.rowActions}>
        <Button type="button" variant="ghost" size="sm" onClick={() => openPlanEdit(row)}>
          <Pencil size={14} aria-hidden="true" />
          {t('common.edit')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => confirmDeletePlan(row)}>
          <Trash2 size={14} aria-hidden="true" />
          {t('common.delete')}
        </Button>
      </div>
    )
  }

  return (
    <>
      <TablePageLayout
        actions={
          <div className={styles.actionsRow}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void loadPlans()}
              disabled={plansLoading}
              title={t('common.refresh')}
              aria-label={t('common.refresh')}
            >
              <RefreshCw size={16} className={plansLoading ? styles.spin : undefined} aria-hidden="true" />
            </Button>
            <Button type="button" variant="primary" onClick={() => openPlanEdit(null)}>
              {t('payment.admin.createPlan')}
            </Button>
          </div>
        }
        table={<DataTable columns={planColumns} data={plans} loading={plansLoading} cells={cells} />}
      />

      {/* Plan Edit Dialog */}
      <PlanEditDialog
        show={showPlanDialog}
        plan={editingPlan}
        groups={groups}
        paymentConfig={paymentConfig}
        onClose={() => setShowPlanDialog(false)}
        onSaved={() => void loadPlans()}
      />

      <ConfirmDialog
        show={showDeletePlanDialog}
        title={t('payment.admin.deletePlan')}
        message={t('payment.admin.deletePlanConfirm')}
        confirmText={t('common.delete')}
        danger
        onConfirm={() => void handleDeletePlan()}
        onCancel={() => setShowDeletePlanDialog(false)}
      />
    </>
  )
}
