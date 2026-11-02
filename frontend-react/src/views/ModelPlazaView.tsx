/**
 * 模型广场页，对应 Vue 版 views/ModelPlazaView.vue。
 * 路由布局为 none：独立形态自带导航条；?embedded=1 且已登录时套后台外壳（AppLayout）。
 */
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'

import { getModelPlaza, type ModelPlazaResponse } from '@/api/modelPlaza'
import ModelPlazaContent from '@/components/modelPlaza/ModelPlazaContent'
import PlazaNavBar from '@/components/modelPlaza/PlazaNavBar'
import AppLayout from '@/layouts/AppLayout'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import styles from './ModelPlazaView.module.css'

export default function ModelPlazaView() {
  const [searchParams] = useSearchParams()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)

  // embedded=1 但未登录（如转发的链接）自动降级为独立形态。
  const isEmbedded = searchParams.get('embedded') === '1' && isAuthenticated

  const [data, setData] = useState<ModelPlazaResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    // 独立形态导航条需要站点名/Logo；有 __APP_CONFIG__ 注入时同步命中缓存。
    void useAppStore.getState().fetchPublicSettings()
    getModelPlaza()
      .then((response) => {
        if (!cancelled) setData(response)
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (isEmbedded) {
    // 后台内嵌形态：?embedded=1 且已登录，套完整后台布局
    return (
      <AppLayout>
        <ModelPlazaContent response={data} loading={loading} error={loadFailed} embedded />
      </AppLayout>
    )
  }

  // 独立形态：自带导航条（logo/站名 + 登录/回后台）
  return (
    <div className={styles.page}>
      <PlazaNavBar />
      <main className={styles.main}>
        <ModelPlazaContent response={data} loading={loading} error={loadFailed} />
      </main>
    </div>
  )
}
