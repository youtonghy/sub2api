/**
 * API 端点列表，对应 Vue 版 EndpointPopover.vue：点击地址或复制按钮复制，悬停或聚焦时在地址上方显示说明与复制提示，
 * 并提供测速链接。说明浮层常驻 DOM、由 CSS 控制显隐（与 Vue 版一致），便于读屏与键盘聚焦时可见。
 */
import { Check, Copy, Zap } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { useClipboard } from '@/composables/useClipboard'
import { useI18n } from '@/i18n/useI18n'
import type { CustomEndpoint } from '@/types'
import styles from './EndpointPopover.module.css'

export interface EndpointPopoverProps {
  apiBaseUrl: string
  customEndpoints: CustomEndpoint[]
}

function speedTestUrl(endpoint: string): string {
  return `https://www.tcptest.cn/http/${encodeURIComponent(endpoint)}`
}

export default function EndpointPopover({ apiBaseUrl, customEndpoints }: EndpointPopoverProps) {
  const { t } = useI18n()
  const { copyToClipboard } = useClipboard()
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null)
  const copiedResetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => {
    if (copiedResetTimer.current !== undefined) clearTimeout(copiedResetTimer.current)
  }, [])

  const allEndpoints: Array<{ name: string; endpoint: string; description: string; isDefault: boolean }> = []
  if (apiBaseUrl) {
    allEndpoints.push({
      name: t('keys.endpoints.title'),
      endpoint: apiBaseUrl,
      description: '',
      isDefault: true
    })
  }
  for (const ep of customEndpoints) {
    allEndpoints.push({ ...ep, isDefault: false })
  }

  const copy = async (url: string) => {
    const success = await copyToClipboard(url, t('keys.endpoints.copied'))
    if (!success) return

    setCopiedEndpoint(url)
    if (copiedResetTimer.current !== undefined) clearTimeout(copiedResetTimer.current)
    copiedResetTimer.current = setTimeout(() => {
      setCopiedEndpoint((current) => (current === url ? null : current))
    }, 1800)
  }

  const tooltipHint = (endpoint: string): string =>
    copiedEndpoint === endpoint ? t('keys.endpoints.copiedHint') : t('keys.endpoints.clickToCopy')

  const onCodeKeyDown = (event: KeyboardEvent<HTMLElement>, endpoint: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      void copy(endpoint)
    }
  }

  if (allEndpoints.length === 0) return null

  return (
    <div className={styles.list}>
      {allEndpoints.map((item, index) => (
        <div key={index} className={styles.item}>
          <span className={styles.name}>{item.name}</span>
          {item.isDefault && <span className={styles.defaultTag}>{t('keys.endpoints.default')}</span>}

          <span className={styles.divider} aria-hidden="true">|</span>

          <div className={styles.endpoint}>
            <div className={styles.tooltip}>
              {item.description && <p className={styles.tooltipDescription}>{item.description}</p>}
              <p className={styles.tooltipHint} data-spaced={item.description ? 'true' : undefined}>
                <span className={styles.dot} aria-hidden="true" />
                {tooltipHint(item.endpoint)}
              </p>
            </div>

            <code
              className={styles.url}
              role="button"
              tabIndex={0}
              onClick={() => void copy(item.endpoint)}
              onKeyDown={(event) => onCodeKeyDown(event, item.endpoint)}
            >
              {item.endpoint}
            </code>

            <button
              type="button"
              className={styles.iconButton}
              data-copied={copiedEndpoint === item.endpoint}
              aria-label={tooltipHint(item.endpoint)}
              onClick={() => void copy(item.endpoint)}
            >
              {copiedEndpoint === item.endpoint
                ? <Check size={12} aria-hidden="true" />
                : <Copy size={12} aria-hidden="true" />}
            </button>

            <a
              href={speedTestUrl(item.endpoint)}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.iconButton}
              title={t('keys.endpoints.speedTest')}
            >
              <Zap size={12} aria-hidden="true" />
            </a>
          </div>
        </div>
      ))}
    </div>
  )
}
