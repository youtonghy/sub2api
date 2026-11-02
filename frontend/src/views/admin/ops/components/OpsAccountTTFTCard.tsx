import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

import { opsAPI, type OpsAccountTTFTItem } from '@/api/admin/ops'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { useI18n } from '@/i18n/useI18n'
import panel from './OpsPanel.module.css'
import styles from './OpsAccountTTFTCard.module.css'

export interface OpsAccountTTFTCardProps {
  platformFilter?: string
  groupIdFilter?: number | null
}

const REFRESH_INTERVAL_MS = 30_000

function formatMs(value: number): string {
  if (!Number.isFinite(value)) return '-'
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)}s`
  return `${Math.round(value)}ms`
}

// 排名越靠前（越慢）颜色越醒目。
function barTone(index: number): string {
  if (index === 0) return 'var(--danger)'
  if (index < 3) return 'var(--chart-cat-8)'
  if (index < 6) return 'var(--warning)'
  return 'var(--chart-cat-1)'
}

export default function OpsAccountTTFTCard({ platformFilter = '', groupIdFilter = null }: OpsAccountTTFTCardProps) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [items, setItems] = useState<OpsAccountTTFTItem[]>([])
  const requestController = useRef<AbortController | null>(null)

  const rows = [...items].sort((a, b) => b.avg_ms - a.avg_ms || b.p95_ms - a.p95_ms || a.account_id - b.account_id)
  const maxAverage = rows[0]?.avg_ms || 1

  const loadData = useCallback(async () => {
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    setErrorMessage('')
    try {
      const data = await opsAPI.getAccountTTFTStats(platformFilter, groupIdFilter)
      if (!controller.signal.aborted) setItems(data.items || [])
    } catch (err: any) {
      if (controller.signal.aborted || err?.code === 'ERR_CANCELED') return
      setErrorMessage(err?.response?.data?.detail || t('admin.ops.accountTTFT.loadFailed'))
    } finally {
      if (requestController.current === controller) setLoading(false)
    }
  }, [platformFilter, groupIdFilter, t])

  // 定时器与 effect 通过 ref 调用最新的 loadData（读取最新的筛选条件）。
  const loadRef = useRef(loadData)
  useEffect(() => {
    loadRef.current = loadData
  }, [loadData])

  // 挂载时加载一次，筛选条件变化时重新加载（对应 Vue 的 onMounted + watch）。
  useEffect(() => {
    void loadRef.current()
  }, [platformFilter, groupIdFilter])

  // 每 30 秒刷新一次。
  useEffect(() => {
    const timer = window.setInterval(() => void loadRef.current(), REFRESH_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
      requestController.current?.abort()
    }
  }, [])

  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <div>
          <h2 className={panel.title}>{t('admin.ops.accountTTFT.title')}</h2>
          <p className={panel.subtitle}>{t('admin.ops.accountTTFT.description')}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" title={t('common.refresh')} aria-label={t('common.refresh')} onClick={() => void loadData()}>
          <RefreshCw size={16} aria-hidden="true" />
        </Button>
      </header>

      {errorMessage && (
        <div className={styles.alert}>
          <Alert tone="danger" title={errorMessage} />
        </div>
      )}
      {loading ? (
        <div className={styles.loading}>
          <Skeleton label={t('common.loading')} lines={4} />
        </div>
      ) : rows.length === 0 ? (
        <div className={styles.empty}>{t('admin.ops.accountTTFT.empty')}</div>
      ) : (
        <div className={styles.scroll}>
          <div className={styles.headRow}>
            <span>{t('admin.ops.accountTTFT.account')}</span>
            <span>{t('admin.ops.accountTTFT.average')}</span>
            <span>P95</span>
            <span>{t('admin.ops.accountTTFT.maximum')}</span>
            <span>{t('admin.ops.accountTTFT.samples')}</span>
          </div>
          {rows.map((row, index) => (
            <div key={row.account_id} data-ttft-account-id={row.account_id} className={styles.row}>
              <div className={styles.account}>
                <div className={styles.accountName} title={row.account_name}>
                  {row.account_name}
                </div>
                <div className={styles.accountMeta}>
                  {row.platform} · #{row.account_id}
                </div>
              </div>
              <div className={styles.average}>
                <span className={styles.averageValue}>{formatMs(row.avg_ms)}</span>
                <div className={styles.track}>
                  <div
                    className={styles.bar}
                    style={{ width: `${Math.max(2, (row.avg_ms / maxAverage) * 100)}%`, '--bar-color': barTone(index) } as CSSProperties}
                  />
                </div>
              </div>
              <div className={styles.cell}>
                <span className={styles.inlineLabel}>P95</span>
                <span className={styles.mono}>{formatMs(row.p95_ms)}</span>
              </div>
              <div className={styles.cell}>
                <span className={styles.inlineLabel}>{t('admin.ops.accountTTFT.maximum')}</span>
                <span className={styles.mono}>{formatMs(row.max_ms)}</span>
              </div>
              <div className={[styles.cell, styles.mono, styles.muted].join(' ')}>{row.sample_count}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
