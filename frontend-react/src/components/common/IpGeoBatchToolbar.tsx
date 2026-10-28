import { useMemo, useState, useSyncExternalStore } from 'react'

import { Button } from '@/components/arc/button/button'
import { useI18n } from '@/i18n/useI18n'
import { fetchBatch, getEntry, getIpGeoRevision, subscribeIpGeo } from '@/utils/ipGeoLookup'
import styles from './IpGeoBatchToolbar.module.css'

export interface IpGeoBatchToolbarProps {
  /** 原始 IP 列表（可含空值），内部去重 */
  ips: Array<string | null | undefined>
  /** 批量查询失败时调用，由使用方弹提示（Vue 版的 failed 事件） */
  onFailed?: () => void
}

// 当前页 IP 批量地理查询工具条:传入原始 IP 列表(可含空值),内部去重;
// 无 IP 时自身不渲染。批量失败 emit failed,由使用方弹提示。
export default function IpGeoBatchToolbar({ ips, onFailed }: IpGeoBatchToolbarProps) {
  const { t } = useI18n()
  useSyncExternalStore(subscribeIpGeo, getIpGeoRevision, getIpGeoRevision)
  const [loading, setLoading] = useState(false)

  const uniqueIps = useMemo(() => Array.from(new Set(ips.filter((ip): ip is string => Boolean(ip)))), [ips])

  const pendingCount = uniqueIps.filter((ip) => {
    const status = getEntry(ip).status
    return status === 'idle' || status === 'error'
  }).length

  if (uniqueIps.length === 0) return null

  const run = async () => {
    setLoading(true)
    try {
      const ok = await fetchBatch(uniqueIps)
      if (!ok) onFailed?.()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.toolbar}>
      {pendingCount > 0 && <span className={styles.pending}>{t('usage.ipGeo.pending', { count: pendingCount })}</span>}
      <Button variant="ghost" size="sm" disabled={loading || pendingCount === 0} onClick={() => void run()}>
        {loading ? t('usage.ipGeo.batchFetching') : t('usage.ipGeo.batchFetch')}
      </Button>
    </div>
  )
}
