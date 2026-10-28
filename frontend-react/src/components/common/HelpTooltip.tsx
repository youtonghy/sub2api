/**
 * 帮助提示，对应 Vue 版 HelpTooltip.vue。外观沿用 Arc tooltip（前景色底、背景色字）。
 * Arc tooltip 基于 Radix，只支持悬停且内容不可交互；这里需要点击切换、关闭按钮，
 * 以及悬停时指针可移入提示框选中文字，因此保留自有实现。
 */
import { Info, X } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import styles from './HelpTooltip.module.css'

export interface HelpTooltipProps {
  /** 提示文字；也可用 children 传入富内容（Vue 版默认插槽） */
  content?: string
  /** 默认 hover */
  trigger?: 'hover' | 'click'
  /** 提示框宽度（CSS 长度），默认 16rem；对应 Vue 版 widthClass */
  width?: string
  /** 自定义触发内容（Vue 版 #trigger 插槽），默认信息图标 */
  triggerContent?: ReactNode
  children?: ReactNode
  className?: string
}

function isInside(container: HTMLElement | null, target: EventTarget | null): boolean {
  return target instanceof Node && !!container?.contains(target)
}

export default function HelpTooltip({
  content,
  trigger = 'hover',
  width = '16rem',
  triggerContent,
  children,
  className
}: HelpTooltipProps) {
  const [show, setShow] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const updatePosition = () => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPosition({ top: rect.top, left: rect.left + rect.width / 2 })
  }

  const openTooltip = () => {
    updatePosition()
    setShow(true)
  }

  const closeTooltip = () => setShow(false)

  useEffect(() => {
    if (!show) return
    const onDocumentClick = (event: MouseEvent) => {
      if (trigger !== 'click') return
      const target = event.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target) || tooltipRef.current?.contains(target)) return
      setShow(false)
    }
    const onDocumentKeydown = (event: KeyboardEvent) => {
      if (trigger === 'click' && event.key === 'Escape') setShow(false)
    }
    const onViewportChange = () => {
      const el = triggerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPosition({ top: rect.top, left: rect.left + rect.width / 2 })
    }
    document.addEventListener('click', onDocumentClick, true)
    document.addEventListener('keydown', onDocumentKeydown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('click', onDocumentClick, true)
      document.removeEventListener('keydown', onDocumentKeydown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [show, trigger])

  // 悬停模式下指针在触发图标与提示框之间往返时保持打开，便于选中提示里的文字。
  const onLeave = (event: ReactMouseEvent) => {
    if (trigger !== 'hover') return
    if (isInside(tooltipRef.current, event.relatedTarget)) return
    closeTooltip()
  }

  const onTooltipLeave = (event: ReactMouseEvent) => {
    if (trigger !== 'hover') return
    if (isInside(triggerRef.current, event.relatedTarget)) return
    closeTooltip()
  }

  const onClick = (event: ReactMouseEvent) => {
    if (trigger !== 'click') return
    event.stopPropagation()
    if (show) closeTooltip()
    else openTooltip()
  }

  return (
    <div
      ref={triggerRef}
      className={[styles.trigger, className].filter(Boolean).join(' ')}
      data-trigger={trigger}
      onMouseEnter={() => {
        if (trigger === 'hover') openTooltip()
      }}
      onMouseLeave={onLeave}
      onClick={onClick}
    >
      {triggerContent ?? <Info className={styles.icon} size={16} strokeWidth={1.75} aria-hidden="true" />}

      {/* 渲染到 body，避免被对话框的 overflow 截断 */}
      {createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          className={styles.tooltip}
          data-trigger={trigger}
          style={{
            display: show ? undefined : 'none',
            top: `calc(${position.top}px - 8px)`,
            left: `${position.left}px`,
            width
          }}
          onMouseLeave={onTooltipLeave}
          onClick={(event) => event.stopPropagation()}
        >
          {trigger === 'click' && (
            <button
              type="button"
              className={styles.close}
              aria-label="Close"
              onClick={(event) => {
                event.stopPropagation()
                closeTooltip()
              }}
            >
              <X size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
          {children ?? content}
        </div>,
        document.body
      )}
    </div>
  )
}
