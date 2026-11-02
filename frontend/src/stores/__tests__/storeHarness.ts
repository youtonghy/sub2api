/**
 * Store test harness: replaces Pinia's setActivePinia(createPinia()) / store instance in specs
 * ported from the Vue frontend.
 */
import type { StoreApi, UseBoundStore } from 'zustand'

type Store<T> = UseBoundStore<StoreApi<T>>

/** Reset a store to the state it was created with */
export function resetStore<T>(store: Store<T>): void {
  store.setState(store.getInitialState(), true)
}

/**
 * Live read-only view over a store, like a Pinia store instance: every property read returns
 * the latest state. Writes throw so specs must go through store.setState().
 */
export function liveStore<T extends object>(store: Store<T>): T {
  return new Proxy({} as T, {
    get: (_target, key) => store.getState()[key as keyof T],
    set: (_target, key) => {
      throw new Error(`Use setState() instead of assigning store.${String(key)}`)
    }
  })
}

/** Replacement for flushPromises from @vue/test-utils */
export const flushPromises = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
