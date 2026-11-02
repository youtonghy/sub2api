import { useEffect, useRef, useState } from 'react'

export interface KeyedDebouncedSearchContext {
  key: string
  signal: AbortSignal
}

export interface UseKeyedDebouncedSearchOptions<T> {
  delay?: number
  search: (keyword: string, context: KeyedDebouncedSearchContext) => Promise<T>
  onSuccess: (key: string, result: T) => void
  onError?: (key: string, error: unknown) => void
}

export interface KeyedDebouncedSearch {
  trigger: (key: string, keyword: string) => void
  clearKey: (key: string) => void
  clearAll: () => void
}

/**
 * 多实例隔离的防抖搜索：每个 key 有独立的防抖、请求取消与过期响应保护。
 * 组件外使用；options 每次调用时读取（getOptions），便于 Hook 传入最新回调。
 */
export function createKeyedDebouncedSearch<T>(
  getOptions: () => UseKeyedDebouncedSearchOptions<T>
): KeyedDebouncedSearch {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const controllers = new Map<string, AbortController>()
  const versions = new Map<string, number>()

  const clearKey = (key: string) => {
    const timer = timers.get(key)
    if (timer) {
      clearTimeout(timer)
      timers.delete(key)
    }

    const controller = controllers.get(key)
    if (controller) {
      controller.abort()
      controllers.delete(key)
    }

    versions.delete(key)
  }

  const clearAll = () => {
    const allKeys = new Set<string>([...timers.keys(), ...controllers.keys(), ...versions.keys()])
    allKeys.forEach((key) => clearKey(key))
  }

  const trigger = (key: string, keyword: string) => {
    const nextVersion = (versions.get(key) ?? 0) + 1
    versions.set(key, nextVersion)

    const existingTimer = timers.get(key)
    if (existingTimer) {
      clearTimeout(existingTimer)
      timers.delete(key)
    }

    const inFlight = controllers.get(key)
    if (inFlight) {
      inFlight.abort()
      controllers.delete(key)
    }

    const timer = setTimeout(async () => {
      timers.delete(key)

      const controller = new AbortController()
      controllers.set(key, controller)
      const requestVersion = versions.get(key)
      const options = getOptions()

      try {
        const result = await options.search(keyword, { key, signal: controller.signal })
        if (controller.signal.aborted) return
        if (versions.get(key) !== requestVersion) return
        getOptions().onSuccess(key, result)
      } catch (error) {
        if (controller.signal.aborted) return
        if (versions.get(key) !== requestVersion) return
        getOptions().onError?.(key, error)
      } finally {
        if (controllers.get(key) === controller) {
          controllers.delete(key)
        }
      }
    }, getOptions().delay ?? 300)

    timers.set(key, timer)
  }

  return { trigger, clearKey, clearAll }
}

/** React Hook 版本：返回稳定的 trigger/clearKey/clearAll，卸载时清理全部 key */
export function useKeyedDebouncedSearch<T>(options: UseKeyedDebouncedSearchOptions<T>): KeyedDebouncedSearch {
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })
  // getter 只在定时器回调中读取 ref，不在渲染期间读取
  // eslint-disable-next-line react-hooks/refs
  const [searcher] = useState(() => createKeyedDebouncedSearch<T>(() => optionsRef.current))
  useEffect(() => () => searcher.clearAll(), [searcher])
  return searcher
}
