/**
 * Application State Store
 * Manages global UI state including sidebar, loading indicators, and toast notifications.
 * React 版与 Vue 版的 Pinia store 一一对应：状态与方法同名，组件内用 useAppStore(selector)，
 * 组件外用 useAppStore.getState()。
 */

import { create } from 'zustand'
import type { Toast, ToastType, PublicSettings } from '@/types'
import { t } from '@/i18n'
import {
  checkUpdates as checkUpdatesAPI,
  type VersionInfo,
  type ReleaseInfo
} from '@/api/admin/system'
import { getPublicSettings as fetchPublicSettingsAPI } from '@/api/auth'

const DEFAULT_SITE_NAME = 'RetooAi'

export interface AppState {
  sidebarCollapsed: boolean
  mobileOpen: boolean
  sidebarScrollTop: number
  loading: boolean
  toasts: Toast[]

  // Public settings state
  publicSettingsLoaded: boolean
  publicSettingsLoading: boolean
  siteName: string
  siteLogo: string
  siteVersion: string
  contactInfo: string
  apiBaseUrl: string
  docUrl: string
  cachedPublicSettings: PublicSettings | null

  // Version state
  versionLoaded: boolean
  versionLoading: boolean
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  buildType: string
  releaseInfo: ReleaseInfo | null

  // Derived
  hasActiveToasts: boolean
  backendModeEnabled: boolean

  // Actions
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleMobileSidebar: () => void
  setMobileOpen: (open: boolean) => void
  setSidebarScrollTop: (scrollTop: number) => void
  setLoading: (isLoading: boolean) => void
  showToast: (type: ToastType, message: string, duration?: number) => string
  showSuccess: (message: string, duration?: number) => string
  showError: (message: string, duration?: number) => string
  showInfo: (message: string, duration?: number) => string
  showWarning: (message: string, duration?: number) => string
  hideToast: (id: string) => void
  clearAllToasts: () => void
  withLoading: <T>(operation: () => Promise<T>) => Promise<T>
  withLoadingAndError: <T>(operation: () => Promise<T>, errorMessage?: string) => Promise<T | null>
  reset: () => void

  // Version actions
  fetchVersion: (force?: boolean) => Promise<VersionInfo | null>
  clearVersionCache: () => void

  // Public settings actions
  fetchPublicSettings: (force?: boolean) => Promise<PublicSettings | null>
  clearPublicSettingsCache: () => void
  initFromInjectedConfig: () => boolean
}

export const useAppStore = create<AppState>()((set, get) => {
  let publicSettingsRequest: Promise<PublicSettings | null> | null = null
  let toastIdCounter = 0
  let loadingCount = 0

  function setToasts(toasts: Toast[]): void {
    set({ toasts, hasActiveToasts: toasts.length > 0 })
  }

  function hideToast(id: string): void {
    const toasts = get().toasts
    if (toasts.some((toast) => toast.id === id)) {
      setToasts(toasts.filter((toast) => toast.id !== id))
    }
  }

  function showToast(type: ToastType, message: string, duration?: number): string {
    const id = `toast-${++toastIdCounter}`
    const toast: Toast = {
      id,
      type,
      message,
      duration,
      startTime: duration !== undefined ? Date.now() : undefined
    }

    setToasts([...get().toasts, toast])

    if (duration !== undefined) {
      setTimeout(() => {
        hideToast(id)
      }, duration)
    }

    return id
  }

  function setLoading(isLoading: boolean): void {
    loadingCount = isLoading ? loadingCount + 1 : Math.max(0, loadingCount - 1)
    set({ loading: loadingCount > 0 })
  }

  /**
   * Apply settings to store state (internal helper to avoid code duplication)
   */
  function applySettings(config: PublicSettings): void {
    if (typeof window !== 'undefined') {
      window.__APP_CONFIG__ = { ...config }
    }
    set({
      cachedPublicSettings: config,
      siteName: config.site_name || DEFAULT_SITE_NAME,
      siteLogo: config.site_logo || '',
      siteVersion: config.version || '',
      contactInfo: config.contact_info || '',
      apiBaseUrl: config.api_base_url || '',
      docUrl: config.doc_url || '',
      backendModeEnabled: config.backend_mode_enabled ?? false,
      publicSettingsLoaded: true
    })
  }

  function defaultPublicSettings(): PublicSettings {
    const state = get()
    return {
      registration_enabled: false,
      email_verify_enabled: false,
      force_email_on_third_party_signup: false,
      registration_email_suffix_whitelist: [],
      promo_code_enabled: true,
      password_reset_enabled: false,
      invitation_code_enabled: false,
      turnstile_enabled: false,
      turnstile_site_key: '',
      aliyun_captcha_enabled: false,
      aliyun_captcha_scene_id: '',
      aliyun_captcha_prefix: '',
      aliyun_captcha_region: 'cn',
      site_name: state.siteName,
      site_logo: state.siteLogo,
      site_subtitle: '',
      api_base_url: state.apiBaseUrl,
      contact_info: state.contactInfo,
      doc_url: state.docUrl,
      home_content: '',
      compact_home_enabled: false,
      hide_ccs_import_button: false,
      payment_enabled: false,
      table_default_page_size: 20,
      table_page_size_options: [10, 20, 50, 100],
      custom_menu_items: [],
      custom_endpoints: [],
      linuxdo_oauth_enabled: false,
      wechat_oauth_enabled: false,
      wechat_oauth_open_enabled: false,
      wechat_oauth_mp_enabled: false,
      wechat_oauth_mobile_enabled: false,
      oidc_oauth_enabled: false,
      oidc_oauth_provider_name: 'OIDC',
      github_oauth_enabled: false,
      google_oauth_enabled: false,
      backend_mode_enabled: false,
      passkey_enabled: false,
      version: state.siteVersion,
      balance_low_notify_enabled: false,
      account_quota_notify_enabled: false,
      balance_low_notify_threshold: 0,
      channel_monitor_enabled: true,
      channel_monitor_default_interval_seconds: 60,
      available_channels_enabled: false,
      subscription_enabled: true,
      payment_balance_disabled: false,
      model_plaza_enabled: false,
      model_plaza_require_auth: false,
      plugin_management_enabled: false,
      risk_control_enabled: false,
      service_quota_enabled: false,
      affiliate_enabled: false,
      allow_user_view_error_requests: false,
    }
  }

  return {
    sidebarCollapsed: false,
    mobileOpen: false,
    sidebarScrollTop: 0,
    loading: false,
    toasts: [],

    publicSettingsLoaded: false,
    publicSettingsLoading: false,
    siteName: DEFAULT_SITE_NAME,
    siteLogo: '',
    siteVersion: '',
    contactInfo: '',
    apiBaseUrl: '',
    docUrl: '',
    cachedPublicSettings: null,

    versionLoaded: false,
    versionLoading: false,
    currentVersion: '',
    latestVersion: '',
    hasUpdate: false,
    buildType: 'source',
    releaseInfo: null,

    hasActiveToasts: false,
    backendModeEnabled: false,

    toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    toggleMobileSidebar: () => set((state) => ({ mobileOpen: !state.mobileOpen })),
    setMobileOpen: (open) => set({ mobileOpen: open }),
    setSidebarScrollTop: (scrollTop) => set({ sidebarScrollTop: scrollTop }),
    setLoading,
    showToast,
    showSuccess: (message, duration = 3000) => showToast('success', message, duration),
    showError: (message, duration = 5000) => showToast('error', message, duration),
    showInfo: (message, duration = 3000) => showToast('info', message, duration),
    showWarning: (message, duration = 4000) => showToast('warning', message, duration),
    hideToast,
    clearAllToasts: () => setToasts([]),

    async withLoading(operation) {
      setLoading(true)
      try {
        return await operation()
      } finally {
        setLoading(false)
      }
    },

    async withLoadingAndError(operation, errorMessage) {
      setLoading(true)
      try {
        return await operation()
      } catch (error) {
        const message =
          errorMessage ||
          (error as { message?: string }).message ||
          t('common.unknownError')
        get().showError(message)
        return null
      } finally {
        setLoading(false)
      }
    },

    reset() {
      loadingCount = 0
      set({ sidebarCollapsed: false, loading: false, toasts: [], hasActiveToasts: false })
    },

    async fetchVersion(force = false) {
      const state = get()
      if (state.versionLoaded && !force) {
        return {
          current_version: state.currentVersion,
          latest_version: state.latestVersion,
          has_update: state.hasUpdate,
          build_type: state.buildType,
          release_info: state.releaseInfo || undefined,
          cached: true
        }
      }

      // Prevent duplicate requests
      if (state.versionLoading) {
        return null
      }

      set({ versionLoading: true })
      try {
        const data = await checkUpdatesAPI(force)
        set({
          currentVersion: data.current_version,
          latestVersion: data.latest_version,
          hasUpdate: data.has_update,
          buildType: data.build_type || 'source',
          releaseInfo: data.release_info || null,
          versionLoaded: true
        })
        return data
      } catch (error) {
        console.error('Failed to fetch version:', error)
        return null
      } finally {
        set({ versionLoading: false })
      }
    },

    clearVersionCache: () => set({ versionLoaded: false, hasUpdate: false }),

    fetchPublicSettings(force = false) {
      // An active request always wins over cache/force semantics so every caller observes
      // the same refresh result and no older request can overwrite a newer one.
      if (publicSettingsRequest) {
        return publicSettingsRequest
      }

      const state = get()

      // Check for injected config from server (eliminates flash)
      if (!state.publicSettingsLoaded && !force && window.__APP_CONFIG__) {
        applySettings(window.__APP_CONFIG__)
        return Promise.resolve(window.__APP_CONFIG__)
      }

      // Return cached data if available and not forcing refresh
      if (state.publicSettingsLoaded && !force) {
        if (state.cachedPublicSettings) {
          return Promise.resolve({ ...state.cachedPublicSettings })
        }
        return Promise.resolve(defaultPublicSettings())
      }

      set({ publicSettingsLoading: true })
      let apiRequest: Promise<PublicSettings>
      try {
        apiRequest = fetchPublicSettingsAPI()
      } catch (error) {
        console.error('Failed to fetch public settings:', error)
        set({ publicSettingsLoading: false })
        return Promise.resolve(null)
      }

      const request = apiRequest
        .then((data) => {
          applySettings(data)
          return data
        })
        .catch((error) => {
          console.error('Failed to fetch public settings:', error)
          return null
        })
        .finally(() => {
          if (publicSettingsRequest === request) {
            publicSettingsRequest = null
            set({ publicSettingsLoading: false })
          }
        })

      publicSettingsRequest = request
      return request
    },

    clearPublicSettingsCache: () =>
      set({ publicSettingsLoaded: false, cachedPublicSettings: null, backendModeEnabled: false }),

    initFromInjectedConfig() {
      if (window.__APP_CONFIG__) {
        applySettings(window.__APP_CONFIG__)
        return true
      }
      return false
    }
  }
})
