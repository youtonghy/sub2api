/**
 * Payment Store
 * Manages payment configuration, current order state, and subscription plans
 */

import { create } from 'zustand'
import { paymentAPI } from '@/api/payment'
import type { PaymentConfig, PaymentOrder, SubscriptionPlan, CreateOrderRequest } from '@/types/payment'

export interface PaymentState {
  /** Payment configuration from backend */
  config: PaymentConfig | null
  /** Currently active order (for payment flow) */
  currentOrder: PaymentOrder | null
  /** Available subscription plans */
  plans: SubscriptionPlan[]

  configLoading: boolean
  configLoaded: boolean

  fetchConfig: (force?: boolean) => Promise<PaymentConfig | null>
  fetchPlans: () => Promise<SubscriptionPlan[]>
  createOrder: (params: CreateOrderRequest) => ReturnType<typeof createOrder>
  pollOrderStatus: (orderId: number) => Promise<PaymentOrder | null>
  clearCurrentOrder: () => void
}

/** Create a new order and set it as current */
async function createOrder(params: CreateOrderRequest) {
  const response = await paymentAPI.createOrder(params)
  return response.data
}

export const usePaymentStore = create<PaymentState>()((set, get) => {
  let configPromise: Promise<PaymentConfig | null> | null = null

  // ==================== Actions ====================

  /** Fetch payment configuration */
  async function fetchConfig(force = false): Promise<PaymentConfig | null> {
    if (get().configLoaded && !force) return get().config
    if (configPromise) return configPromise

    configPromise = loadConfig()
    return configPromise
  }

  async function loadConfig(): Promise<PaymentConfig | null> {
    set({ configLoading: true })
    try {
      const response = await paymentAPI.getConfig()
      set({ config: response.data, configLoaded: true })
      return get().config
    } catch (error: unknown) {
      console.error('[payment] Failed to fetch config:', error)
      return null
    } finally {
      set({ configLoading: false })
      configPromise = null
    }
  }

  /** Fetch available subscription plans */
  async function fetchPlans(): Promise<SubscriptionPlan[]> {
    try {
      const response = await paymentAPI.getPlans()
      // Backend returns features as newline-separated string; parse to array
      const plans = (response.data || []).map((p: Omit<SubscriptionPlan, 'features'> & { features: string | string[] }) => ({
        ...p,
        features: typeof p.features === 'string'
          ? p.features.split('\n').map((f: string) => f.trim()).filter(Boolean)
          : (p.features || []),
      }))
      set({ plans })
      return plans
    } catch (error: unknown) {
      console.error('[payment] Failed to fetch plans:', error)
      return []
    }
  }

  /** Poll order status by ID (read-only, no upstream check) */
  async function pollOrderStatus(orderId: number): Promise<PaymentOrder | null> {
    try {
      const response = await paymentAPI.getOrder(orderId)
      const order = response.data
      if (get().currentOrder?.id === orderId) {
        set({ currentOrder: order })
      }
      return order
    } catch (error: unknown) {
      console.error('[payment] Failed to poll order status:', error)
      return null
    }
  }

  /** Clear current order state */
  function clearCurrentOrder() {
    set({ currentOrder: null })
  }

  return {
    config: null,
    currentOrder: null,
    plans: [],
    configLoading: false,
    configLoaded: false,
    fetchConfig,
    fetchPlans,
    createOrder,
    pollOrderStatus,
    clearCurrentOrder
  }
})
