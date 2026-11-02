import { Loader2, RefreshCw } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { useI18n } from '@/i18n/useI18n'
import { fetchOne, getEntry, getIpGeoRevision, subscribeIpGeo } from '@/utils/ipGeoLookup'
import styles from './IpGeoCell.module.css'

export interface IpGeoCellProps {
  ip: string
}

/** IP 归属地单元格：未查询时可点击查询，成功后显示地区（点击打开外部详情页）并可刷新 */
export default function IpGeoCell({ ip }: IpGeoCellProps) {
  const { t } = useI18n()
  // 查询缓存变化时重新渲染
  useSyncExternalStore(subscribeIpGeo, getIpGeoRevision, getIpGeoRevision)
  const entry = getEntry(ip)

  const handleFetch = () => {
    void fetchOne(ip)
  }

  const handleRefresh = () => {
    void fetchOne(ip, true)
  }

  const handleOpenDetail = () => {
    window.open(`https://www.iplocation.net/ip-lookup?query=${encodeURIComponent(ip)}`, '_blank', 'noopener,noreferrer')
  }

  if (entry.status === 'idle') {
    return (
      <div className={styles.cell}>
        <button type="button" className={styles.link} onClick={handleFetch}>
          {t('usage.ipGeo.fetch')}
        </button>
      </div>
    )
  }

  if (entry.status === 'loading') {
    return (
      <div className={`${styles.cell} ${styles.muted}`}>
        <Loader2 className={styles.spin} size={12} strokeWidth={1.75} aria-hidden="true" />
        {t('usage.ipGeo.fetching')}
      </div>
    )
  }

  if (entry.status === 'success') {
    const detail = entry.detail
    const tooltipText = detail
      ? [
          detail.organization ? `${t('usage.ipGeo.detailOrg')}: ${detail.organization}` : '',
          detail.timezone ? `${t('usage.ipGeo.detailTimezone')}: ${detail.timezone}` : '',
          detail.accuracy != null ? `${t('usage.ipGeo.detailAccuracy')}: ${detail.accuracy}km` : '',
          detail.latitude && detail.longitude
            ? `${t('usage.ipGeo.detailCoordinates')}: ${detail.latitude}, ${detail.longitude}`
            : ''
        ]
          .filter(Boolean)
          .join('\n')
      : ''
    return (
      <div className={styles.cell}>
        <button type="button" className={styles.label} title={tooltipText} onClick={handleOpenDetail}>
          {entry.label}
        </button>
        <button
          type="button"
          className={styles.refresh}
          title={t('usage.ipGeo.refreshTitle')}
          aria-label={t('usage.ipGeo.refreshTitle')}
          onClick={handleRefresh}
        >
          <RefreshCw size={12} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    )
  }

  if (entry.status === 'error') {
    return (
      <div className={styles.cell}>
        <button type="button" className={`${styles.link} ${styles.error}`} onClick={handleFetch}>
          {t('usage.ipGeo.failed')}
        </button>
      </div>
    )
  }

  return <div className={`${styles.cell} ${styles.muted}`}>{t('usage.ipGeo.private')}</div>
}
