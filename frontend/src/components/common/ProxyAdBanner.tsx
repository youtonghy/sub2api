import { ExternalLink } from 'lucide-react'

import { useI18n } from '@/i18n/useI18n'
import styles from './ProxyAdBanner.module.css'

export type ProxyAdBannerProps = Record<string, never>

/** 代理 IP 推广链接（行内） */
export default function ProxyAdBanner() {
  const { t } = useI18n()
  return (
    <a className={styles.link} href="https://sub2api.io/proxyip" target="_blank" rel="noopener noreferrer">
      <span className={styles.text}>{t('admin.proxies.ad.inline')}</span>
      <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
    </a>
  )
}
