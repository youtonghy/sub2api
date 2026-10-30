/**
 * 用户平台配额弹窗，对应 Vue 版 UserPlatformQuotaModal.vue：
 * 为每个平台设置日 / 周 / 月美元限额（空 = 不限），全量提交所有平台；
 * 已保存限额的平台可单独重置某个窗口的用量。负数等非法值在保存前拦截，不会被静默转成"不限"。
 */
import { RotateCcw } from 'lucide-react'
import { useEffect, useEffectEvent, useState } from 'react'

import { adminAPI } from '@/api/admin'
import { platformQuotaPlatforms } from '@/api/admin/users'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import Input from '@/components/common/Input'
import Skeleton from '@/components/common/Skeleton'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminUser, PlatformQuotaItem, PlatformQuotaPlatform, PlatformQuotaWindow } from '@/types'
import { looseToNumber, toInputValue } from './formUtils'
import styles from './UserPlatformQuotaModal.module.css'

export interface UserPlatformQuotaModalProps {
  show: boolean
  user: AdminUser | null
  onClose?: () => void
  onSuccess?: () => void
}

/** 限额输入框保存原文（对应 Vue 版 v-model.number），保存时再按 looseToNumber 取值 */
interface QuotaRow {
  platform: PlatformQuotaPlatform
  daily_limit_usd: string
  weekly_limit_usd: string
  monthly_limit_usd: string
  daily_usage_usd: number
  weekly_usage_usd: number
  monthly_usage_usd: number
}

type LimitKey = 'daily_limit_usd' | 'weekly_limit_usd' | 'monthly_limit_usd'

const WINDOWS = ['daily', 'weekly', 'monthly'] as const

// 已保存且至少配置了一档限额的平台。只有这些平台在后端有配额记录，重置用量窗口才有对象。
function configuredPlatforms(items: PlatformQuotaItem[]): Set<PlatformQuotaPlatform> {
  const out = new Set<PlatformQuotaPlatform>()
  for (const it of items) {
    if (it.daily_limit_usd != null || it.weekly_limit_usd != null || it.monthly_limit_usd != null) {
      out.add(it.platform)
    }
  }
  return out
}

function emptyRow(p: PlatformQuotaPlatform): QuotaRow {
  return {
    platform: p,
    daily_limit_usd: '',
    weekly_limit_usd: '',
    monthly_limit_usd: '',
    daily_usage_usd: 0,
    weekly_usage_usd: 0,
    monthly_usage_usd: 0
  }
}

function normalize(items: PlatformQuotaItem[]): QuotaRow[] {
  const byPlatform = new Map<PlatformQuotaPlatform, PlatformQuotaItem>()
  for (const it of items) byPlatform.set(it.platform, it)
  return platformQuotaPlatforms().map((p) => {
    const it = byPlatform.get(p)
    if (!it) return emptyRow(p)
    return {
      platform: p,
      daily_limit_usd: toInputValue(it.daily_limit_usd),
      weekly_limit_usd: toInputValue(it.weekly_limit_usd),
      monthly_limit_usd: toInputValue(it.monthly_limit_usd),
      daily_usage_usd: it.daily_usage_usd ?? 0,
      weekly_usage_usd: it.weekly_usage_usd ?? 0,
      monthly_usage_usd: it.monthly_usage_usd ?? 0
    }
  })
}

function formatUsage(n: number): string {
  if (n == null || Number.isNaN(n)) return '-'
  return n.toFixed(2)
}

// 仅在合法输入下返回数字：null/undefined/NaN/±Inf/负数 → null（视为"无限额"）。
// 调用方在保存前拦截非法数值（见 onSave）。
function normalizeLimit(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v
  return null
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

export default function UserPlatformQuotaModal({ show, user, onClose, onSuccess }: UserPlatformQuotaModalProps) {
  const { t } = useI18n()
  const { confirm, confirmDialog } = useConfirmDialog()

  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [resetting, setResetting] = useState<Record<string, boolean>>({})
  const [quotas, setQuotas] = useState<QuotaRow[]>([])
  const [savedConfigured, setSavedConfigured] = useState<Set<PlatformQuotaPlatform>>(() => new Set())

  const hasActiveSubscription = user?.subscriptions?.some((s) => s.status === 'active') ?? false

  const load = async () => {
    if (!user) return
    setLoading(true)
    try {
      const data = await adminAPI.users.getPlatformQuotas(user.id)
      setQuotas(normalize(data.platform_quotas || []))
      setSavedConfigured(configuredPlatforms(data.platform_quotas || []))
    } catch {
      useAppStore.getState().showError(t('admin.users.platformQuota.loadFailed'))
      setQuotas(platformQuotaPlatforms().map(emptyRow))
      setSavedConfigured(new Set())
    } finally {
      setLoading(false)
    }
  }

  const onShowChange = useEffectEvent((visible: boolean) => {
    if (visible && user) void load()
  })
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 对应 Vue 版 watch(show)：打开时加载配额
    onShowChange(show)
  }, [show])

  const updateLimit = (platform: PlatformQuotaPlatform, key: LimitKey, value: string) =>
    setQuotas((prev) => prev.map((row) => (row.platform === platform ? { ...row, [key]: value } : row)))

  async function onClearAll() {
    // 二次确认：一键清空全部平台的 daily/weekly/monthly 限额属于高风险批量操作，
    // 误点后所有平台变为"无限额"，且本地无 undo 机制（需要逐个手动重填或取消保存）。
    const confirmed = await confirm(t('admin.users.platformQuota.clearAllConfirm'), { danger: true })
    if (!confirmed) return
    setQuotas((prev) => prev.map((row) => ({ ...row, daily_limit_usd: '', weekly_limit_usd: '', monthly_limit_usd: '' })))
  }

  async function onSave() {
    if (!user) return
    const appStore = useAppStore.getState()
    // 拒绝非法数值，避免 normalizeLimit 将其静默转换为 null（无限额）。
    const invalid: string[] = []
    for (const row of quotas) {
      for (const win of WINDOWS) {
        const v = looseToNumber(row[`${win}_limit_usd`])
        if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) {
          invalid.push(`${row.platform}.${win}`)
        }
      }
    }
    if (invalid.length > 0) {
      appStore.showError(t('admin.users.platformQuota.invalidNumber', { fields: invalid.join(', ') }))
      return
    }

    setSubmitting(true)
    try {
      const payload = quotas.map((r) => ({
        platform: r.platform,
        daily_limit_usd: normalizeLimit(looseToNumber(r.daily_limit_usd)),
        weekly_limit_usd: normalizeLimit(looseToNumber(r.weekly_limit_usd)),
        monthly_limit_usd: normalizeLimit(looseToNumber(r.monthly_limit_usd))
      }))
      await adminAPI.users.updatePlatformQuotas(user.id, payload)
      appStore.showSuccess(t('admin.users.platformQuota.updateSuccess'))
      onSuccess?.()
      onClose?.()
    } catch (e: any) {
      appStore.showError(e?.response?.data?.message || t('admin.users.platformQuota.updateFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  async function onReset(platform: PlatformQuotaPlatform, quotaWindow: PlatformQuotaWindow) {
    if (!user) return
    const appStore = useAppStore.getState()
    const windowLabel = t(`admin.users.platformQuota.window${capitalize(quotaWindow)}`)
    const confirmed = await confirm(t('admin.users.platformQuota.reset.confirm', { platform, window: windowLabel }), {
      danger: true
    })
    if (!confirmed) return
    const key = `${platform}.${quotaWindow}`
    setResetting((prev) => ({ ...prev, [key]: true }))
    try {
      const data = await adminAPI.users.resetPlatformQuotaWindow(user.id, platform, quotaWindow)
      setQuotas(normalize(data.platform_quotas || []))
      setSavedConfigured(configuredPlatforms(data.platform_quotas || []))
      appStore.showSuccess(t('admin.users.platformQuota.reset.success', { platform, window: windowLabel }))
    } catch (e: any) {
      appStore.showError(e?.response?.data?.message || t('admin.users.platformQuota.reset.failed'))
    } finally {
      setResetting((prev) => ({ ...prev, [key]: false }))
    }
  }

  const renderLimitCell = (row: QuotaRow, win: PlatformQuotaWindow) => {
    const configured = savedConfigured.has(row.platform)
    const resetTitle = t(configured ? 'admin.users.platformQuota.reset.button' : 'admin.users.platformQuota.reset.unavailable')
    return (
      <td key={win}>
        <div className={styles.limitCell}>
          <Input
            type="number"
            min="0"
            step="0.01"
            className={styles.limitInput}
            aria-label={`${row.platform} ${t(`admin.users.platformQuota.window${capitalize(win)}`)}`}
            placeholder={t('admin.users.platformQuota.placeholder')}
            value={row[`${win}_limit_usd`]}
            onChange={(value) => updateLimit(row.platform, `${win}_limit_usd`, value)}
          />
          <button
            type="button"
            className={styles.resetButton}
            disabled={!!resetting[`${row.platform}.${win}`] || !configured}
            title={resetTitle}
            aria-label={resetTitle}
            data-testid="quota-reset"
            onClick={() => void onReset(row.platform, win)}
          >
            <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </td>
    )
  }

  return (
    <>
      <BaseDialog
        show={show}
        title={t('admin.users.platformQuota.title')}
        width="wide"
        onClose={() => onClose?.()}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => onClose?.()}>
              {t('admin.users.platformQuota.cancel')}
            </Button>
            <Button type="button" variant="primary" disabled={submitting || loading} onClick={() => void onSave()}>
              {submitting ? t('admin.users.platformQuota.saving') : t('admin.users.platformQuota.save')}
            </Button>
          </>
        }
      >
        {user && (
          <div className={styles.content}>
            {hasActiveSubscription && <Alert tone="warning" title={t('admin.users.platformQuota.subscriptionWarning')} />}
            <p className={styles.subtitle}>{t('admin.users.platformQuota.subtitle', { email: user.email })}</p>
            {loading ? (
              <div className={styles.loading} aria-busy="true">
                <span className={styles.srOnly}>{t('common.loading')}</span>
                <Skeleton height={36} />
                <Skeleton height={36} />
                <Skeleton height={36} />
                <Skeleton height={36} />
              </div>
            ) : (
              <>
                <div className={styles.tableRegion}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>{t('admin.users.platformQuota.columns.platform')}</th>
                        <th>{t('admin.users.platformQuota.columns.daily')}</th>
                        <th>{t('admin.users.platformQuota.columns.weekly')}</th>
                        <th>{t('admin.users.platformQuota.columns.monthly')}</th>
                        <th>{t('admin.users.platformQuota.columns.usage')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quotas.map((row) => (
                        <tr key={row.platform}>
                          <td className={styles.platform}>{row.platform}</td>
                          {WINDOWS.map((win) => renderLimitCell(row, win))}
                          <td className={styles.usage}>
                            {formatUsage(row.daily_usage_usd)} / {formatUsage(row.weekly_usage_usd)} / {formatUsage(row.monthly_usage_usd)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className={styles.hint}>{t('admin.users.platformQuota.hint')}</p>
                <div>
                  <Button type="button" variant="secondary" size="sm" onClick={() => void onClearAll()}>
                    {t('admin.users.platformQuota.clearAll')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </BaseDialog>
      {confirmDialog}
    </>
  )
}
