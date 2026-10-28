import { useEffect, useRef } from 'react'

/**
 * 只在首次挂载时执行一次，对应 Vue 的 onMounted。
 * StrictMode 开发模式会重复执行 effect，这里用 ref 防止一次性请求（如 OAuth 交换、发送验证码）被发出两次。
 */
export function useMountOnce(callback: () => void | Promise<void>): void {
  const callbackRef = useRef(callback)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void callbackRef.current()
  }, [])
}
