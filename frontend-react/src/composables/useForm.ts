import { useCallback, useEffect, useRef, useState } from 'react'

import { useAppStore } from '@/stores/app'

export interface UseFormOptions<T> {
  form: T
  submitFn: (data: T) => Promise<void>
  successMsg?: string
  errorMsg?: string
}

/**
 * 统一表单提交逻辑，对应 Vue 版 useForm
 * 管理加载状态、错误捕获及通知；submit 使用最近一次渲染传入的 form
 */
export function useForm<T>(options: UseFormOptions<T>) {
  const [loading, setLoading] = useState(false)
  const loadingRef = useRef(false)
  const optionsRef = useRef(options)

  useEffect(() => {
    optionsRef.current = options
  })

  const submit = useCallback(async () => {
    if (loadingRef.current) return

    const { form, submitFn, successMsg, errorMsg } = optionsRef.current
    const appStore = useAppStore.getState()
    loadingRef.current = true
    setLoading(true)
    try {
      await submitFn(form)
      if (successMsg) {
        appStore.showSuccess(successMsg)
      }
    } catch (error: any) {
      const detail = error.response?.data?.detail || error.response?.data?.message || error.message
      appStore.showError(errorMsg || detail)
      // 继续抛出错误，让组件有机会进行局部处理（如验证错误显示）
      throw error
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [])

  return {
    loading,
    submit
  }
}
