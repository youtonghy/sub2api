import { adminAPI } from '@/api/admin'
import { QUOTA_THRESHOLD_TYPE_FIXED, type QuotaThresholdType } from '@/constants/account'
import { createObservableState, useObservableInstance } from './useObservableState'

export const QUOTA_NOTIFY_DIMS = ['daily', 'weekly', 'total'] as const
export type QuotaNotifyDim = (typeof QUOTA_NOTIFY_DIMS)[number]

export interface QuotaNotifyDimState {
  enabled: boolean | null
  threshold: number | null
  thresholdType: QuotaThresholdType | null
}

interface QuotaNotifySnapshot {
  globalEnabled: boolean
  state: Record<QuotaNotifyDim, QuotaNotifyDimState>
}

const emptyDims = (): Record<QuotaNotifyDim, QuotaNotifyDimState> => ({
  daily: { enabled: null, threshold: null, thresholdType: null },
  weekly: { enabled: null, threshold: null, thresholdType: null },
  total: { enabled: null, threshold: null, thresholdType: null }
})

/**
 * 账号配额通知状态（对应 Vue 版 useQuotaNotifyState）。
 * `state` 为只读快照，用 setDim 修改；writeToExtra 总是读取最新值。
 */
export function createQuotaNotifyState() {
  const observable = createObservableState<QuotaNotifySnapshot>({ globalEnabled: false, state: emptyDims() })
  const s = () => observable.get()

  function setDim(dim: QuotaNotifyDim, patch: Partial<QuotaNotifyDimState>) {
    observable.set({ state: { ...s().state, [dim]: { ...s().state[dim], ...patch } } })
  }

  function loadGlobalState() {
    adminAPI.settings
      .getSettings()
      .then((settings) => {
        observable.set({ globalEnabled: settings.account_quota_notify_enabled === true })
      })
      .catch(() => {
        observable.set({ globalEnabled: false })
      })
  }

  function loadFromExtra(extra: Record<string, unknown> | null | undefined) {
    const next = emptyDims()
    for (const d of QUOTA_NOTIFY_DIMS) {
      next[d].enabled = (extra?.[`quota_notify_${d}_enabled`] as boolean) ?? null
      next[d].threshold = (extra?.[`quota_notify_${d}_threshold`] as number) ?? null
      next[d].thresholdType = (extra?.[`quota_notify_${d}_threshold_type`] as QuotaThresholdType) ?? null
    }
    observable.set({ state: next })
  }

  function writeToExtra(extra: Record<string, unknown>, mode: 'create' | 'update') {
    for (const d of QUOTA_NOTIFY_DIMS) {
      const dimState = s().state[d]
      if (dimState.enabled) {
        extra[`quota_notify_${d}_enabled`] = true
        if (dimState.threshold != null) {
          extra[`quota_notify_${d}_threshold`] = dimState.threshold
        } else if (mode === 'update') {
          delete extra[`quota_notify_${d}_threshold`]
        }
        extra[`quota_notify_${d}_threshold_type`] = dimState.thresholdType || QUOTA_THRESHOLD_TYPE_FIXED
      } else if (mode === 'update') {
        delete extra[`quota_notify_${d}_enabled`]
        delete extra[`quota_notify_${d}_threshold`]
        delete extra[`quota_notify_${d}_threshold_type`]
      }
    }
  }

  function reset() {
    observable.set({ state: emptyDims() })
  }

  return {
    observable,
    get globalEnabled() {
      return s().globalEnabled
    },
    get state() {
      return s().state
    },
    setDim,
    loadGlobalState,
    loadFromExtra,
    writeToExtra,
    reset
  }
}

export type QuotaNotifyState = ReturnType<typeof createQuotaNotifyState>

export function useQuotaNotifyState(): QuotaNotifyState {
  return useObservableInstance(createQuotaNotifyState)
}
