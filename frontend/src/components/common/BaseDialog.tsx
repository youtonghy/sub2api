/**
 * 通用对话框，对应 Vue 版 BaseDialog.vue，基于 Arc dialog（Radix）。
 * - 叠放时 Escape 只关闭最上层对话框（Radix 的层栈保证）；closeOnEscape=false 的上层不会把 Escape 让给下层
 * - 默认点击遮罩不关闭（closeOnClickOutside=false）
 * - body 的 modal-open 类在最后一个可见对话框关闭或卸载后才移除
 * - 重新打开时内容滚动位置回到顶部
 */
import { useEffect, useId, useRef, type ReactNode } from 'react'

import { Dialog, DialogContent } from '@/components/arc/dialog/dialog'
import styles from './BaseDialog.module.css'

export type DialogWidth = 'narrow' | 'normal' | 'wide' | 'extra-wide' | 'full'

export interface BaseDialogProps {
  show: boolean
  title: string
  /** 可选副标题，显示在标题下方 */
  description?: string
  /**
   * Width guidance: narrow=confirm/short prompts, normal=standard forms,
   * wide=multi-section forms or rich content, extra-wide=analytics/tables,
   * full=full-screen or very dense layouts.
   */
  width?: DialogWidth
  closeOnEscape?: boolean
  closeOnClickOutside?: boolean
  showCloseButton?: boolean
  zIndex?: number
  onClose?: () => void
  /** 底部操作区（Vue 版 #footer 插槽） */
  footer?: ReactNode
  children?: ReactNode
  className?: string
}

const openDialogs = new Set<string>()

const updateScrollLock = (dialogId: string, isOpen: boolean) => {
  if (isOpen) openDialogs.add(dialogId)
  else openDialogs.delete(dialogId)
  document.body.classList.toggle('modal-open', openDialogs.size > 0)
}

const widthClass: Record<DialogWidth, string> = {
  narrow: styles.narrow,
  normal: styles.normal,
  wide: styles.wide,
  'extra-wide': styles.extraWide,
  full: styles.full
}

export default function BaseDialog({
  show,
  title,
  description,
  width = 'normal',
  closeOnEscape = true,
  closeOnClickOutside = false,
  showCloseButton = true,
  zIndex = 50,
  onClose,
  footer,
  children,
  className
}: BaseDialogProps) {
  const dialogId = useId()
  const bodyRef = useRef<HTMLDivElement>(null)

  // 使用 CSS 类而不是直接操作 style，更易于管理多个对话框
  useEffect(() => {
    if (!show) return
    updateScrollLock(dialogId, true)
    if (bodyRef.current) bodyRef.current.scrollTop = 0
    return () => updateScrollLock(dialogId, false)
  }, [show, dialogId])

  const classes = [
    styles.dialog,
    widthClass[width],
    showCloseButton ? undefined : styles.hideClose,
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Dialog
      open={show}
      onOpenChange={(open) => {
        if (!open) onClose?.()
      }}
    >
      <DialogContent
        title={title}
        description={description}
        className={classes}
        style={zIndex !== 50 ? { zIndex: zIndex + 1 } : undefined}
        {...(description ? {} : { 'aria-describedby': undefined })}
        onEscapeKeyDown={(event) => {
          if (!closeOnEscape) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (!closeOnClickOutside) event.preventDefault()
        }}
      >
        <div ref={bodyRef} className={styles.body} data-dialog-body="">
          {children}
        </div>
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </DialogContent>
    </Dialog>
  )
}
