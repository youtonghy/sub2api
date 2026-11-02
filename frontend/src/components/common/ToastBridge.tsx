import { useEffect, useRef } from 'react'

import { useToastStack } from '@/components/arc/toast-stack/toast-stack'
import { useAppStore } from '@/stores/app'

/**
 * 把 app store 的 toast 队列（showSuccess/showError 等，与 Vue 版同名）同步到 Arc toast-stack。
 * store 负责计时移除；用户手动关闭的 toast 会在 store 计时结束时一并清除。
 */
export default function ToastBridge() {
  const toasts = useAppStore((state) => state.toasts)
  const { toast, dismiss } = useToastStack()
  const shown = useRef(new Set<string>())

  useEffect(() => {
    const current = new Set(toasts.map((item) => item.id))
    for (const item of toasts) {
      if (!shown.current.has(item.id)) {
        shown.current.add(item.id)
        toast({ id: item.id, type: item.type, title: item.message, duration: item.duration ?? Infinity })
      }
    }
    for (const id of shown.current) {
      if (!current.has(id)) {
        shown.current.delete(id)
        dismiss(id)
      }
    }
  }, [toasts, toast, dismiss])

  return null
}
