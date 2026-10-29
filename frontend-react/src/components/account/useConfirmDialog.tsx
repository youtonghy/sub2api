import { useCallback, useRef, useState, type ReactNode } from 'react'

import ConfirmDialog from '@/components/common/ConfirmDialog'
import { useI18n } from '@/i18n/useI18n'

interface PendingConfirm {
  title: string
  message: string
  danger: boolean
}

export interface ConfirmOptions {
  /** 默认 common.confirm */
  title?: string
  danger?: boolean
}

/**
 * 以 ConfirmDialog 替代原生 window.confirm()：`await confirm(message)` 返回 true（继续）或 false（取消）。
 * 返回的 confirmDialog 需要渲染到组件树中。
 */
export function useConfirmDialog(): {
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>
  confirmDialog: ReactNode
} {
  const { t } = useI18n()
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const settle = useCallback((value: boolean) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setPending(null)
    resolve?.(value)
  }, [])

  const confirm = useCallback(
    (message: string, options?: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // 新的确认会取消尚未回答的上一个
        resolverRef.current?.(false)
        resolverRef.current = resolve
        setPending({ title: options?.title ?? t('common.confirm'), message, danger: options?.danger ?? false })
      }),
    [t]
  )

  const confirmDialog = (
    <ConfirmDialog
      show={pending !== null}
      title={pending?.title ?? ''}
      message={pending?.message ?? ''}
      danger={pending?.danger}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  )

  return { confirm, confirmDialog }
}
