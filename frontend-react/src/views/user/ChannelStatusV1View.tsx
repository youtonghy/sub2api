import { useEffect, useRef, useState } from 'react'

import {
  list as listChannelMonitorViews,
  status as fetchChannelMonitorDetail,
  type UserMonitorDetail,
  type UserMonitorView
} from '@/api/channelMonitor'
import MonitorDetailDialog from '@/components/user/MonitorDetailDialog'
import MonitorCardGrid from '@/components/user/monitor/MonitorCardGrid'
import MonitorHero, { type MonitorWindow, type OverallStatus } from '@/components/user/monitor/MonitorHero'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { DEFAULT_INTERVAL_SECONDS, STATUS_OPERATIONAL } from '@/constants/channelMonitor'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { extractApiErrorMessage } from '@/utils/apiError'
import styles from './ChannelStatusV1View.module.css'

const AUTO_REFRESH_INTERVALS = [30, 60, 120] as const

/** 渠道状态 V1：监控卡片网格 + 详情弹窗，对应 Vue 版 ChannelStatusV1View.vue */
export default function ChannelStatusV1View() {
  const { t } = useI18n()
  const monitorEnabled = useAppStore((s) => s.cachedPublicSettings?.channel_monitor_enabled)

  // ── State ──
  const [items, setItems] = useState<UserMonitorView[]>([])
  const [loading, setLoading] = useState(false)
  const [currentWindow, setCurrentWindow] = useState<MonitorWindow>('7d')
  const [detailCache, setDetailCache] = useState<Record<number, UserMonitorDetail>>({})
  const [showDetail, setShowDetail] = useState(false)
  const [detailTarget, setDetailTarget] = useState<UserMonitorView | null>(null)

  // 异步流程读取最新值用的镜像（Vue 版直接读 ref.value）
  const itemsRef = useRef(items)
  const loadingRef = useRef(loading)
  const windowRef = useRef(currentWindow)
  const detailCacheRef = useRef(detailCache)
  const abortRef = useRef<AbortController | null>(null)

  const autoRefresh = useAutoRefresh({
    storageKey: 'channel-status-auto-refresh',
    intervals: AUTO_REFRESH_INTERVALS,
    defaultInterval: DEFAULT_INTERVAL_SECONDS,
    defaultEnabled: true,
    onRefresh: () => refresh(true),
    shouldPause: () => document.hidden || loadingRef.current
  })

  function updateLoading(value: boolean) {
    loadingRef.current = value
    setLoading(value)
  }

  // ── Computed ──
  let overallStatus: OverallStatus = 'operational'
  for (const it of items) {
    if (it.primary_status === 'failed' || it.primary_status === 'error') {
      overallStatus = 'degraded'
      break
    }
    if (it.primary_status !== STATUS_OPERATIONAL) {
      overallStatus = 'degraded'
      break
    }
  }
  const detailTitle = detailTarget?.name || t('channelStatus.detailTitle')

  // ── Loaders ──
  async function reload(silent = false) {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    if (!silent) updateLoading(true)
    try {
      const res = await listChannelMonitorViews({ signal: ctrl.signal })
      if (ctrl.signal.aborted || abortRef.current !== ctrl) return
      itemsRef.current = res.items || []
      setItems(itemsRef.current)
    } catch (err: unknown) {
      const e = err as { name?: string; code?: string }
      if (e?.name === 'AbortError' || e?.code === 'ERR_CANCELED') return
      useAppStore.getState().showError(extractApiErrorMessage(err, t('channelStatus.loadError')))
    } finally {
      if (abortRef.current === ctrl) {
        if (!silent) updateLoading(false)
        autoRefresh.resetCountdown()
        abortRef.current = null
      }
    }
  }

  async function refresh(silent = false) {
    await reload(silent)
    // After base reload, refresh any cached detail records so non-7d availability
    // values stay in sync without forcing the user to switch tabs again.
    if (windowRef.current !== '7d') {
      await Promise.all(itemsRef.current.map((it) => loadDetail(it.id, true)))
    }
  }

  async function loadDetail(id: number, force = false) {
    if (!force && detailCacheRef.current[id]) return
    try {
      const detail = await fetchChannelMonitorDetail(id)
      detailCacheRef.current = { ...detailCacheRef.current, [id]: detail }
      setDetailCache(detailCacheRef.current)
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('channelStatus.detailLoadError')))
    }
  }

  async function ensureDetailsForWindow() {
    if (windowRef.current === '7d') return
    await Promise.all(itemsRef.current.map((it) => loadDetail(it.id)))
  }

  // ── Handlers ──
  async function handleWindowChange(value: MonitorWindow) {
    windowRef.current = value
    setCurrentWindow(value)
    await ensureDetailsForWindow()
  }

  function openDetail(row: UserMonitorView) {
    setDetailTarget(row)
    setShowDetail(true)
  }

  function closeDetail() {
    setShowDetail(false)
    setDetailTarget(null)
  }

  // 对应 Vue 版 watch(items)
  useEffect(() => {
    void ensureDetailsForWindow()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 与 Vue 版一致，只在列表变化时补齐详情
  }, [items])

  // 对应 Vue 版 watch(channel_monitor_enabled)：仅在开关变化时启停自动刷新
  const prevMonitorEnabled = useRef(monitorEnabled)
  useEffect(() => {
    if (prevMonitorEnabled.current === monitorEnabled) return
    prevMonitorEnabled.current = monitorEnabled
    if (monitorEnabled === false) autoRefresh.stop()
    else if (autoRefresh.enabled) autoRefresh.start()
  }, [monitorEnabled, autoRefresh])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时加载（Vue 版 onMounted）
    void reload(false)
    if (useAppStore.getState().cachedPublicSettings?.channel_monitor_enabled !== false) {
      autoRefresh.setEnabled(autoRefresh.enabled)
    }
    return () => {
      abortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载时加载（Vue 版 onMounted / onBeforeUnmount）
  }, [])

  return (
    <div className={styles.page}>
      <MonitorHero
        overallStatus={overallStatus}
        intervalSeconds={DEFAULT_INTERVAL_SECONDS}
        window={currentWindow}
        loading={loading}
        autoRefresh={autoRefresh}
        onWindowChange={(value) => void handleWindowChange(value)}
        onRefresh={() => void refresh()}
      />

      <MonitorCardGrid
        items={items}
        window={currentWindow}
        countdownSeconds={autoRefresh.countdown}
        loading={loading}
        detailCache={detailCache}
        onCardClick={openDetail}
      />

      <MonitorDetailDialog
        show={showDetail}
        monitorId={detailTarget?.id ?? null}
        title={detailTitle}
        onClose={closeDetail}
      />
    </div>
  )
}
