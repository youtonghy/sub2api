import { useCallback, useEffect, useRef, useState } from 'react'

import { t } from '@/i18n'
import { useAppStore } from '@/stores/app'

/**
 * 检测是否支持 Clipboard API（需要安全上下文：HTTPS/localhost）
 */
function isClipboardSupported(): boolean {
  return !!(navigator.clipboard && window.isSecureContext)
}

/**
 * 降级方案：使用 textarea + execCommand
 * 使用 textarea 而非 input，以正确处理多行文本
 */
function fallbackCopy(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
  document.body.appendChild(textarea)
  textarea.focus({ preventScroll: true })
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

/** 与 Vue 版 useClipboard 相同：复制成功后 2 秒内 copied 为 true，并用 toast 提示结果 */
export function useClipboard() {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copyToClipboard = useCallback(async (text: string, successMessage?: string): Promise<boolean> => {
    if (!text) return false

    let success: boolean

    if (isClipboardSupported()) {
      try {
        await navigator.clipboard.writeText(text)
        success = true
      } catch {
        success = fallbackCopy(text)
      }
    } else {
      success = fallbackCopy(text)
    }

    const appStore = useAppStore.getState()
    if (success) {
      setCopied(true)
      appStore.showSuccess(successMessage || t('common.copiedToClipboard'))
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        setCopied(false)
      }, 2000)
    } else {
      appStore.showError(t('common.copyFailed'))
    }

    return success
  }, [])

  return { copied, copyToClipboard }
}
