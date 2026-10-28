import { create } from 'zustand'
import { adminAPI } from '@/api'
import type { CustomMenuItem } from '@/types'

const readCachedBool = (key: string, defaultValue: boolean): boolean => {
  try {
    const raw = localStorage.getItem(key)
    if (raw === 'true') return true
    if (raw === 'false') return false
  } catch {
    // ignore localStorage failures
  }
  return defaultValue
}

const writeCachedBool = (key: string, value: boolean) => {
  try {
    localStorage.setItem(key, value ? 'true' : 'false')
  } catch {
    // ignore localStorage failures
  }
}

const readCachedString = (key: string, defaultValue: string): string => {
  try {
    const raw = localStorage.getItem(key)
    if (typeof raw === 'string' && raw.length > 0) return raw
  } catch {
    // ignore localStorage failures
  }
  return defaultValue
}

const writeCachedString = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore localStorage failures
  }
}

export interface AdminSettingsState {
  loaded: boolean
  loading: boolean
  opsMonitoringEnabled: boolean
  opsRealtimeMonitoringEnabled: boolean
  opsQueryModeDefault: string
  paymentEnabled: boolean
  customMenuItems: CustomMenuItem[]

  fetch: (force?: boolean) => Promise<void>
  setOpsMonitoringEnabledLocal: (value: boolean) => void
  setOpsRealtimeMonitoringEnabledLocal: (value: boolean) => void
  setPaymentEnabledLocal: (value: boolean) => void
  setOpsQueryModeDefaultLocal: (value: string) => void
}

export const useAdminSettingsStore = create<AdminSettingsState>()((set, get) => {
  async function fetch(force = false): Promise<void> {
    if (get().loaded && !force) return
    if (get().loading) return

    set({ loading: true })
    try {
      const [settings, paymentConfigResp] = await Promise.all([
        adminAPI.settings.getSettings(),
        adminAPI.payment.getConfig()
      ])
      const opsMonitoringEnabled = settings.ops_monitoring_enabled ?? true
      writeCachedBool('ops_monitoring_enabled_cached', opsMonitoringEnabled)

      const opsRealtimeMonitoringEnabled = settings.ops_realtime_monitoring_enabled ?? true
      writeCachedBool('ops_realtime_monitoring_enabled_cached', opsRealtimeMonitoringEnabled)

      const opsQueryModeDefault = settings.ops_query_mode_default || 'auto'
      writeCachedString('ops_query_mode_default_cached', opsQueryModeDefault)

      const customMenuItems = Array.isArray(settings.custom_menu_items) ? settings.custom_menu_items : []

      const paymentEnabled = paymentConfigResp.data?.enabled ?? false
      writeCachedBool('payment_enabled_cached', paymentEnabled)

      set({
        opsMonitoringEnabled,
        opsRealtimeMonitoringEnabled,
        opsQueryModeDefault,
        customMenuItems,
        paymentEnabled,
        loaded: true
      })
    } catch (err) {
      // Keep cached/default value: do not "flip" the UI based on a transient fetch failure.
      console.error('[adminSettings] Failed to fetch settings:', err)
    } finally {
      set({ loading: false })
    }
  }

  function setOpsMonitoringEnabledLocal(value: boolean) {
    set({ opsMonitoringEnabled: value, loaded: true })
    writeCachedBool('ops_monitoring_enabled_cached', value)
  }

  function setOpsRealtimeMonitoringEnabledLocal(value: boolean) {
    set({ opsRealtimeMonitoringEnabled: value, loaded: true })
    writeCachedBool('ops_realtime_monitoring_enabled_cached', value)
  }

  function setPaymentEnabledLocal(value: boolean) {
    set({ paymentEnabled: value, loaded: true })
    writeCachedBool('payment_enabled_cached', value)
  }

  function setOpsQueryModeDefaultLocal(value: string) {
    const opsQueryModeDefault = value || 'auto'
    set({ opsQueryModeDefault, loaded: true })
    writeCachedString('ops_query_mode_default_cached', opsQueryModeDefault)
  }

  // Keep UI consistent if we learn that ops is disabled via feature-gated 404s.
  // (event is dispatched from the axios interceptor)
  let eventHandlerCleanup: (() => void) | null = null

  function initializeEventListeners() {
    if (eventHandlerCleanup) return

    try {
      const handler = () => {
        setOpsMonitoringEnabledLocal(false)
      }
      window.addEventListener('ops-monitoring-disabled', handler)
      eventHandlerCleanup = () => {
        window.removeEventListener('ops-monitoring-disabled', handler)
      }
    } catch {
      // ignore window access failures (SSR)
    }
  }

  if (typeof window !== 'undefined') {
    initializeEventListeners()
  }

  return {
    loaded: false,
    loading: false,
    // Default open, but honor cached value to reduce UI flicker on first paint.
    opsMonitoringEnabled: readCachedBool('ops_monitoring_enabled_cached', true),
    opsRealtimeMonitoringEnabled: readCachedBool('ops_realtime_monitoring_enabled_cached', true),
    opsQueryModeDefault: readCachedString('ops_query_mode_default_cached', 'auto'),
    paymentEnabled: readCachedBool('payment_enabled_cached', false),
    customMenuItems: [],
    fetch,
    setOpsMonitoringEnabledLocal,
    setOpsRealtimeMonitoringEnabledLocal,
    setPaymentEnabledLocal,
    setOpsQueryModeDefaultLocal
  }
})
