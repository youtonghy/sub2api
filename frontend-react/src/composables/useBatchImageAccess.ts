import { create } from 'zustand'

import { keysAPI } from '@/api/keys'
import { useAuthStore } from '@/stores/auth'
import type { ApiKey } from '@/types'

interface BatchImageAccessState {
  loaded: boolean
  loading: boolean
  hasAllowedBatchImageKey: boolean
}

const useBatchImageAccessStore = create<BatchImageAccessState>()(() => ({
  loaded: false,
  loading: false,
  hasAllowedBatchImageKey: false,
}))

let pendingLoad: Promise<boolean> | null = null
const pageSize = 100

function keyAllowsBatchImage(key: ApiKey): boolean {
  return (
    key.status === 'active' &&
    key.group?.platform === 'gemini' &&
    key.group?.allow_batch_image_generation === true
  )
}

async function loadBatchImageAccess(force = false): Promise<boolean> {
  const set = useBatchImageAccessStore.setState
  const state = useBatchImageAccessStore.getState()
  if (!useAuthStore.getState().isAuthenticated) {
    set({ loaded: true, hasAllowedBatchImageKey: false })
    return false
  }

  if (state.loaded && !force) {
    return state.hasAllowedBatchImageKey
  }

  if (pendingLoad && !force) {
    return pendingLoad
  }

  set({ loading: true })
  pendingLoad = (async () => {
    let page = 1
    while (true) {
      const response = await keysAPI.list(page, pageSize, {
        status: 'active',
        sort_by: 'created_at',
        sort_order: 'desc'
      })

      if ((response.items || []).some(keyAllowsBatchImage)) {
        set({ hasAllowedBatchImageKey: true, loaded: true })
        return true
      }

      if (page >= response.pages || (response.items || []).length === 0) {
        set({ hasAllowedBatchImageKey: false, loaded: true })
        return false
      }

      page += 1
    }
  })()
    .catch(() => {
      set({ hasAllowedBatchImageKey: false, loaded: false })
      return false
    })
    .finally(() => {
      set({ loading: false })
      pendingLoad = null
    })

  return pendingLoad
}

/** 与 Vue 版同名同形：是否存在允许批量生图的有效密钥 */
export function useBatchImageAccess() {
  const canUseBatchImage = useBatchImageAccessStore((state) => state.hasAllowedBatchImageKey)
  const batchImageAccessLoaded = useBatchImageAccessStore((state) => state.loaded)
  const batchImageAccessLoading = useBatchImageAccessStore((state) => state.loading)

  return {
    canUseBatchImage,
    batchImageAccessLoaded,
    batchImageAccessLoading,
    refreshBatchImageAccess: loadBatchImageAccess,
  }
}
