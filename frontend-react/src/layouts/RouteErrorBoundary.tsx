import { useEffect } from 'react'
import { useRouteError } from 'react-router'

import { Button } from '@/components/arc/button/button'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { useI18n } from '@/i18n/useI18n'
import styles from './RouteErrorBoundary.module.css'

const RELOAD_KEY = 'chunk_reload_attempted'

function isChunkLoadError(error: unknown): boolean {
  const err = error as { message?: string; name?: string } | null
  const message = err?.message ?? ''
  return (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Loading chunk') ||
    message.includes('Loading CSS chunk') ||
    message.includes('Importing a module script failed') ||
    err?.name === 'ChunkLoadError'
  )
}

/**
 * 路由错误边界。部署更新导致懒加载分包失效时自动刷新一次（10 秒内不重复，避免死循环），
 * 与 Vue 版 router.onError 的处理一致；其他错误显示可重试的提示。
 */
export default function RouteErrorBoundary() {
  const error = useRouteError()
  const { t } = useI18n()
  const chunkError = isChunkLoadError(error)

  useEffect(() => {
    console.error('Router error:', error)
    if (!chunkError) return
    const lastReload = sessionStorage.getItem(RELOAD_KEY)
    const now = Date.now()
    if (!lastReload || now - parseInt(lastReload, 10) > 10000) {
      sessionStorage.setItem(RELOAD_KEY, now.toString())
      console.warn('Chunk load error detected, reloading page to fetch latest version...')
      window.location.reload()
    } else {
      console.error('Chunk load error persists after reload. Please clear browser cache.')
    }
  }, [error, chunkError])

  return (
    <main className={styles.page}>
      <EmptyState
        title={t('shell.errorTitle')}
        description={t('shell.errorDescription')}
        action={<Button variant="secondary" onClick={() => window.location.reload()}>{t('shell.reload')}</Button>}
      />
    </main>
  )
}
