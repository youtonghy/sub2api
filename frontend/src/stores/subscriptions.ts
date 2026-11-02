/**
 * Subscription Store
 * Global state management for user subscriptions with caching and deduplication
 */

import { create } from 'zustand'
import subscriptionsAPI from '@/api/subscriptions'
import type { UserSubscription } from '@/types'

// Cache TTL: 60 seconds
const CACHE_TTL_MS = 60_000

// Request generation counter to invalidate stale in-flight responses
let requestGeneration = 0

export interface SubscriptionState {
  // State
  activeSubscriptions: UserSubscription[]
  loading: boolean
  hasActiveSubscriptions: boolean

  // Actions
  fetchActiveSubscriptions: (force?: boolean) => Promise<UserSubscription[]>
  startPolling: () => void
  stopPolling: () => void
  clear: () => void
  invalidateCache: () => void
}

export const useSubscriptionStore = create<SubscriptionState>()((set, get) => {
  // Internal state, not exposed by the Vue store either
  let loaded = false
  let lastFetchedAt: number | null = null

  // In-flight request deduplication
  let activePromise: Promise<UserSubscription[]> | null = null

  // Auto-refresh interval
  let pollerInterval: ReturnType<typeof setInterval> | null = null

  function setActiveSubscriptions(activeSubscriptions: UserSubscription[]): void {
    set({ activeSubscriptions, hasActiveSubscriptions: activeSubscriptions.length > 0 })
  }

  /**
   * Fetch active subscriptions with caching and deduplication
   * @param force - Force refresh even if cache is valid
   */
  async function fetchActiveSubscriptions(force = false): Promise<UserSubscription[]> {
    const now = Date.now()

    // Return cached data if valid
    if (
      !force &&
      loaded &&
      lastFetchedAt &&
      now - lastFetchedAt < CACHE_TTL_MS
    ) {
      return get().activeSubscriptions
    }

    // Return in-flight request if exists (deduplication)
    if (activePromise && !force) {
      return activePromise
    }

    const currentGeneration = ++requestGeneration

    // Start new request
    set({ loading: true })
    const requestPromise = subscriptionsAPI
      .getActiveSubscriptions()
      .then((data) => {
        if (currentGeneration === requestGeneration) {
          setActiveSubscriptions(data)
          loaded = true
          lastFetchedAt = Date.now()
        }
        return data
      })
      .catch((error) => {
        console.error('Failed to fetch active subscriptions:', error)
        throw error
      })
      .finally(() => {
        if (activePromise === requestPromise) {
          set({ loading: false })
          activePromise = null
        }
      })

    activePromise = requestPromise

    return activePromise
  }

  /**
   * Start auto-refresh polling
   */
  function startPolling() {
    if (pollerInterval) return

    pollerInterval = setInterval(() => {
      fetchActiveSubscriptions(true).catch((error) => {
        console.error('Subscription polling failed:', error)
      })
    }, 5 * 60 * 1000)
  }

  /**
   * Stop auto-refresh polling
   */
  function stopPolling() {
    if (pollerInterval) {
      clearInterval(pollerInterval)
      pollerInterval = null
    }
  }

  /**
   * Clear all subscription data and stop polling
   */
  function clear() {
    requestGeneration++
    activePromise = null
    set({ loading: false })
    setActiveSubscriptions([])
    loaded = false
    lastFetchedAt = null
    stopPolling()
  }

  /**
   * Invalidate cache (force next fetch to reload)
   */
  function invalidateCache() {
    lastFetchedAt = null
  }

  return {
    // State
    activeSubscriptions: [],
    loading: false,
    hasActiveSubscriptions: false,

    // Actions
    fetchActiveSubscriptions,
    startPolling,
    stopPolling,
    clear,
    invalidateCache
  }
})
