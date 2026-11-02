import { useSyncExternalStore } from 'react'

/** 对应 @vueuse/core 的 useMediaQuery：订阅媒体查询结果，环境不支持时返回 false。 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false
  )
}
