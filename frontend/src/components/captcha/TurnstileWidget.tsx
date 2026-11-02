/**
 * Cloudflare Turnstile 小组件。脚本地址与全局回调名和 Vue 版一致（CSP 白名单依赖它们）。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

import { useI18n } from '@/i18n/useI18n'
import styles from './captcha.module.css'

interface TurnstileRenderOptions {
  sitekey: string
  callback: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: () => void
  theme?: 'light' | 'dark' | 'auto'
  size?: 'normal' | 'compact' | 'flexible'
}

interface TurnstileAPI {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string
  reset: (widgetId?: string) => void
  remove: (widgetId?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileAPI
    onTurnstileLoad?: () => void
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad'

export interface TurnstileWidgetProps {
  siteKey: string
  theme?: 'light' | 'dark' | 'auto'
  size?: 'normal' | 'compact' | 'flexible'
  onVerify?: (token: string) => void
  onExpire?: () => void
  onError?: () => void
}

export interface TurnstileWidgetHandle {
  reset: () => void
}

let scriptLoaded = false

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      scriptLoaded = true
      resolve()
      return
    }

    // Check if script is already loading
    const existingScript = document.querySelector('script[src*="turnstile"]')
    if (existingScript) {
      window.onTurnstileLoad = () => {
        scriptLoaded = true
        resolve()
      }
      return
    }

    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true

    window.onTurnstileLoad = () => {
      scriptLoaded = true
      resolve()
    }

    script.onerror = () => {
      reject(new Error('Failed to load Turnstile script'))
    }

    document.head.appendChild(script)
  })
}

const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(function TurnstileWidget(
  { siteKey, theme = 'auto', size = 'flexible', onVerify, onExpire, onError },
  ref
) {
  const { t } = useI18n()
  // 脚本已由其它实例加载时不再显示加载占位
  const [loading, setLoading] = useState(() => !(scriptLoaded && window.turnstile))
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const startedRef = useRef(false)
  // 第三方脚本回调里始终读取最新的 props
  const latest = useRef({ siteKey, theme, size, onVerify, onExpire, onError })
  useEffect(() => {
    latest.current = { siteKey, theme, size, onVerify, onExpire, onError }
  })

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (window.turnstile && widgetIdRef.current) {
        window.turnstile.reset(widgetIdRef.current)
      }
    }
  }), [])

  useEffect(() => {
    const renderWidget = () => {
      const container = containerRef.current
      const current = latest.current
      if (!window.turnstile || !container || !current.siteKey) {
        return
      }

      // Remove existing widget if any
      if (widgetIdRef.current) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // Ignore errors when removing
        }
        widgetIdRef.current = null
      }

      // Clear container
      container.innerHTML = ''

      widgetIdRef.current = window.turnstile.render(container, {
        sitekey: current.siteKey,
        callback: (token: string) => latest.current.onVerify?.(token),
        'expired-callback': () => latest.current.onExpire?.(),
        'error-callback': () => latest.current.onError?.(),
        theme: current.theme,
        size: current.size
      })
    }

    if (!siteKey) {
      return
    }
    // Re-render when siteKey changes
    if (scriptLoaded && window.turnstile) {
      renderWidget()
      return
    }
    if (startedRef.current) {
      return
    }
    startedRef.current = true
    loadScript()
      .then(renderWidget)
      .catch((error: unknown) => {
        console.error('Failed to initialize Turnstile:', error)
        latest.current.onError?.()
      })
      .finally(() => setLoading(false))
  }, [siteKey])

  useEffect(() => () => {
    if (window.turnstile && widgetIdRef.current) {
      try {
        window.turnstile.remove(widgetIdRef.current)
      } catch {
        // Ignore errors when removing
      }
      widgetIdRef.current = null
    }
  }, [])

  if (!siteKey) {
    return null
  }

  return (
    <div className={styles.turnstile}>
      {loading && (
        <div role="status" className={styles.turnstileLoading}>
          {t('auth.captchaLoading')}
        </div>
      )}
      <div ref={containerRef} className={styles.turnstileContainer} />
    </div>
  )
})

export default TurnstileWidget
