import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseAutoRefreshOptions {
  storageKey: string
  intervals?: readonly number[]
  defaultInterval?: number
  defaultEnabled?: boolean
  onRefresh: () => Promise<void> | void
  /** Skip tick when this returns true (e.g. modal open, document hidden). */
  shouldPause?: () => boolean
}

interface AutoRefreshState {
  enabled: boolean
  intervalSeconds: number
  countdown: number
  fetching: boolean
}

const DEFAULT_INTERVALS = [5, 10, 15, 30] as const

function loadInitialState(options: UseAutoRefreshOptions): AutoRefreshState {
  const intervals = options.intervals ?? DEFAULT_INTERVALS
  const state: AutoRefreshState = {
    enabled: options.defaultEnabled ?? false,
    intervalSeconds: options.defaultInterval ?? intervals[intervals.length - 1],
    countdown: 0,
    fetching: false
  }
  try {
    const saved = localStorage.getItem(options.storageKey)
    if (!saved) return state
    const parsed = JSON.parse(saved) as { enabled?: boolean; interval_seconds?: number }
    state.enabled = parsed.enabled === true
    const iv = Number(parsed.interval_seconds)
    if (intervals.includes(iv)) state.intervalSeconds = iv
  } catch {
    /* 存储内容损坏时沿用默认值 */
  }
  return state
}

/**
 * 自动刷新倒计时，对应 Vue 版 useAutoRefresh：状态保存到 localStorage，每秒倒数，归零时调用 onRefresh。
 * 与 Vue 版相同，读取到已启用的存储状态时不会自动开始计时，需要页面调用 start()。
 */
export function useAutoRefresh(options: UseAutoRefreshOptions) {
  const intervals = options.intervals ?? DEFAULT_INTERVALS
  const [state, setState] = useState(() => loadInitialState(options))
  const stateRef = useRef(state)
  const optionsRef = useRef(options)
  const timerId = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  useEffect(() => {
    optionsRef.current = options
  })

  const update = useCallback((patch: Partial<AutoRefreshState>) => {
    stateRef.current = { ...stateRef.current, ...patch }
    setState(stateRef.current)
  }, [])

  const saveToStorage = useCallback(() => {
    try {
      localStorage.setItem(
        optionsRef.current.storageKey,
        JSON.stringify({ enabled: stateRef.current.enabled, interval_seconds: stateRef.current.intervalSeconds })
      )
    } catch {
      /* 存储不可用（隐私模式等）时只保留内存状态 */
    }
  }, [])

  const tick = useCallback(async () => {
    const current = stateRef.current
    if (!current.enabled) return
    if (optionsRef.current.shouldPause?.()) return
    if (current.fetching) return

    if (current.countdown <= 1) {
      update({ countdown: current.intervalSeconds, fetching: true })
      try {
        await optionsRef.current.onRefresh()
      } finally {
        update({ fetching: false })
      }
      return
    }
    update({ countdown: current.countdown - 1 })
  }, [update])

  const start = useCallback(() => {
    if (timerId.current !== undefined) return
    timerId.current = setInterval(() => void tick(), 1000)
  }, [tick])

  const stop = useCallback(() => {
    if (timerId.current !== undefined) {
      clearInterval(timerId.current)
      timerId.current = undefined
    }
  }, [])

  const setEnabled = useCallback(
    (value: boolean) => {
      update({ enabled: value })
      saveToStorage()
      if (value) {
        update({ countdown: stateRef.current.intervalSeconds })
        start()
      } else {
        stop()
        update({ countdown: 0 })
      }
    },
    [update, saveToStorage, start, stop]
  )

  const setInterval_ = useCallback(
    (seconds: number) => {
      update({ intervalSeconds: seconds })
      saveToStorage()
      if (stateRef.current.enabled) update({ countdown: seconds })
    },
    [update, saveToStorage]
  )

  const resetCountdown = useCallback(() => {
    update({ countdown: stateRef.current.intervalSeconds })
  }, [update])

  useEffect(() => stop, [stop])

  return {
    enabled: state.enabled,
    intervalSeconds: state.intervalSeconds,
    countdown: state.countdown,
    fetching: state.fetching,
    intervals,
    setEnabled,
    setInterval: setInterval_,
    resetCountdown,
    start,
    stop
  }
}
