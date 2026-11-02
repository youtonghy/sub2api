import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSubscriptionStore } from '../subscriptions'
import { liveStore, resetStore } from './storeHarness'
import type { UserSubscription } from '@/types'

const getActive = vi.hoisted(() => vi.fn())
vi.mock('@/api/subscriptions', () => ({ default: { getActiveSubscriptions: getActive } }))

function deferred() {
  let resolve!: (value: UserSubscription[]) => void
  let reject!: (error: Error) => void
  const promise = new Promise<UserSubscription[]>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

beforeEach(() => {
  // Internal cache, in-flight request and poller live outside the state object
  useSubscriptionStore.getState().clear()
  resetStore(useSubscriptionStore)
  getActive.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('clearing in-flight subscriptions', () => {
  it.each(['resolve', 'reject'] as const)('resets loading immediately and after the old request %s', async (outcome) => {
    const pending = deferred()
    getActive.mockReturnValueOnce(pending.promise)
    const store = liveStore(useSubscriptionStore)
    const request = store.fetchActiveSubscriptions().catch(() => [])
    expect(store.loading).toBe(true)
    store.clear()
    expect(store.loading).toBe(false)
    if (outcome === 'resolve') pending.resolve([{ id: 1 } as UserSubscription])
    else pending.reject(new Error('offline'))
    await request
    expect(store.loading).toBe(false)
    expect(store.activeSubscriptions).toEqual([])
  })

  it('keeps a new request loading when an older cleared request finishes', async () => {
    const older = deferred()
    const newer = deferred()
    getActive.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const store = liveStore(useSubscriptionStore)
    const first = store.fetchActiveSubscriptions()
    store.clear()
    const second = store.fetchActiveSubscriptions()
    older.resolve([{ id: 1 } as UserSubscription])
    await first
    expect(store.loading).toBe(true)
    expect(store.activeSubscriptions).toEqual([])
    newer.resolve([{ id: 2 } as UserSubscription])
    await second
    expect(store.loading).toBe(false)
    expect(store.activeSubscriptions.map(item => item.id)).toEqual([2])
  })
})
