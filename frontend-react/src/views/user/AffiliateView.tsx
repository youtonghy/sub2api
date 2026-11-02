import { Copy, DollarSign } from 'lucide-react'
import { useState } from 'react'

import userAPI from '@/api/user'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { MetricCard } from '@/components/arc/metric-card/metric-card'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { useClipboard } from '@/composables/useClipboard'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { UserAffiliateDetail } from '@/types'
import { extractApiErrorMessage } from '@/utils/apiError'
import { formatCurrency, formatDateTime } from '@/utils/format'
import styles from './AffiliateView.module.css'

/** 与 formatCurrency 同精度（极小金额 6 位小数，否则 2 位），拆成 MetricCard 的数值与小数位 */
const currencyDecimals = (amount: number) => (amount > 0 && amount < 0.01 ? 6 : 2)

/** 邀请返利：返利统计、邀请码与链接、额度转入余额、邀请用户列表 */
export default function AffiliateView() {
  const { t } = useI18n()
  const { copyToClipboard } = useClipboard()

  const [loading, setLoading] = useState(true)
  const [transferring, setTransferring] = useState(false)
  const [detail, setDetail] = useState<UserAffiliateDetail | null>(null)

  const inviteLink = (() => {
    if (!detail) return ''
    if (typeof window === 'undefined') return `/register?aff=${encodeURIComponent(detail.aff_code)}`
    return `${window.location.origin}/register?aff=${encodeURIComponent(detail.aff_code)}`
  })()

  // Rebate rate is a percentage in the range [0, 100]; backend already clamps it.
  // We trim trailing zeros (e.g. 20.00 → "20", 12.50 → "12.5") for a cleaner UI.
  const formattedRebateRate = (() => {
    const v = detail?.effective_rebate_rate_percent ?? 0
    const rounded = Math.round(v * 100) / 100
    return Number.isInteger(rounded) ? String(rounded) : rounded.toString()
  })()

  const loadAffiliateDetail = async (silent = false): Promise<void> => {
    if (!silent) {
      setLoading(true)
    }
    try {
      setDetail(await userAPI.getAffiliateDetail())
    } catch (error) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('affiliate.loadFailed')))
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }

  useMountOnce(() => {
    void loadAffiliateDetail()
  })

  const copyCode = async (): Promise<void> => {
    if (!detail?.aff_code) return
    await copyToClipboard(detail.aff_code, t('affiliate.codeCopied'))
  }

  const copyInviteLink = async (): Promise<void> => {
    if (!inviteLink) return
    await copyToClipboard(inviteLink, t('affiliate.linkCopied'))
  }

  const transferQuota = async (): Promise<void> => {
    if (!detail || detail.aff_quota <= 0 || transferring) return
    setTransferring(true)
    try {
      const resp = await userAPI.transferAffiliateQuota()
      useAppStore.getState().showSuccess(t('affiliate.transfer.success', { amount: formatCurrency(resp.transferred_quota) }))
      await Promise.all([
        loadAffiliateDetail(true),
        useAuthStore
          .getState()
          .refreshUser()
          .catch(() => undefined)
      ])
    } catch (error) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('affiliate.transferFailed')))
    } finally {
      setTransferring(false)
    }
  }

  if (loading) {
    return (
      <div className={styles.page} aria-busy="true">
        <div className={styles.kpis}>
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} lines={3} className={styles.kpiSkeleton} label={t('common.loading')} />
          ))}
        </div>
        <Skeleton lines={5} className={styles.blockSkeleton} label={t('common.loading')} />
      </div>
    )
  }

  if (!detail) return null

  return (
    <div className={styles.page}>
      <div className={styles.kpis}>
        <MetricCard
          label={t('affiliate.stats.rebateRate')}
          value={Number(formattedRebateRate)}
          decimals={formattedRebateRate.split('.')[1]?.length ?? 0}
          suffix="%"
          context={t('affiliate.stats.rebateRateHint')}
        />
        <MetricCard label={t('affiliate.stats.invitedUsers')} value={detail.aff_count} context="" />
        <MetricCard
          label={t('affiliate.stats.availableQuota')}
          prefix="$"
          value={detail.aff_quota}
          decimals={currencyDecimals(detail.aff_quota)}
          context=""
        />
        <MetricCard
          label={t('affiliate.stats.totalQuota')}
          prefix="$"
          value={detail.aff_history_quota}
          decimals={currencyDecimals(detail.aff_history_quota)}
          context={
            detail.aff_frozen_quota > 0 ? `${t('affiliate.stats.frozenQuota')}: ${formatCurrency(detail.aff_frozen_quota)}` : ''
          }
        />
      </div>

      <section className={styles.panel} aria-labelledby="affiliate-invite">
        <div className={styles.panelHeader}>
          <h2 id="affiliate-invite" className={styles.title}>
            {t('affiliate.title')}
          </h2>
          <p className={styles.description}>{t('affiliate.description')}</p>
        </div>

        <div className={styles.shareGrid}>
          <div className={styles.share}>
            <p className={styles.shareLabel}>{t('affiliate.yourCode')}</p>
            <div className={styles.copyRow}>
              <code className={`${styles.value} ${styles.codeValue}`}>{detail.aff_code}</code>
              <Button variant="secondary" size="sm" className={styles.copyButton} onClick={() => void copyCode()}>
                <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
                <span>{t('affiliate.copyCode')}</span>
              </Button>
            </div>
          </div>

          <div className={styles.share}>
            <p className={styles.shareLabel}>{t('affiliate.inviteLink')}</p>
            <div className={styles.copyRow}>
              <code className={styles.value}>{inviteLink}</code>
              <Button variant="secondary" size="sm" className={styles.copyButton} onClick={() => void copyInviteLink()}>
                <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
                <span>{t('affiliate.copyLink')}</span>
              </Button>
            </div>
          </div>
        </div>

        <Alert tone="info" title={t('affiliate.tips.title')}>
          <ul className={styles.tips}>
            <li>1. {t('affiliate.tips.line1')}</li>
            <li>2. {t('affiliate.tips.line2', { rate: `${formattedRebateRate}%` })}</li>
            <li>3. {t('affiliate.tips.line3')}</li>
            {detail.aff_frozen_quota > 0 && <li>4. {t('affiliate.tips.line4')}</li>}
          </ul>
        </Alert>
      </section>

      <section className={styles.panel} aria-labelledby="affiliate-transfer">
        <div className={styles.transferRow}>
          <div className={styles.panelHeader}>
            <h2 id="affiliate-transfer" className={styles.title}>
              {t('affiliate.transfer.title')}
            </h2>
            <p className={styles.description}>{t('affiliate.transfer.description')}</p>
          </div>
          <Button
            variant="primary"
            loading={transferring}
            disabled={transferring || detail.aff_quota <= 0}
            onClick={() => void transferQuota()}
          >
            {!transferring && <DollarSign size={16} strokeWidth={1.75} aria-hidden="true" />}
            <span>{transferring ? t('affiliate.transfer.transferring') : t('affiliate.transfer.button')}</span>
          </Button>
        </div>
        {detail.aff_quota <= 0 && <p className={styles.warning}>{t('affiliate.transfer.empty')}</p>}
      </section>

      <section className={styles.panel} aria-labelledby="affiliate-invitees">
        <h2 id="affiliate-invitees" className={styles.title}>
          {t('affiliate.invitees.title')}
        </h2>
        {detail.invitees.length === 0 ? (
          <p className={styles.empty}>{t('affiliate.invitees.empty')}</p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('affiliate.invitees.columns.email')}</th>
                  <th scope="col">{t('affiliate.invitees.columns.username')}</th>
                  <th scope="col" className={styles.numeric}>
                    {t('affiliate.invitees.columns.rebate')}
                  </th>
                  <th scope="col">{t('affiliate.invitees.columns.joinedAt')}</th>
                </tr>
              </thead>
              <tbody>
                {detail.invitees.map((item) => (
                  <tr key={item.user_id}>
                    <td>{item.email || '-'}</td>
                    <td className={styles.secondary}>{item.username || '-'}</td>
                    <td className={`${styles.numeric} ${styles.rebate}`}>{formatCurrency(item.total_rebate)}</td>
                    <td className={styles.secondary}>{formatDateTime(item.created_at) || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
