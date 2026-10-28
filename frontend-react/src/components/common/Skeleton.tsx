import type { CSSProperties } from 'react'

import styles from './Skeleton.module.css'

export interface SkeletonProps {
  /** 默认 rect */
  variant?: 'rect' | 'circle' | 'text'
  /** 数字按 px，默认 100% */
  width?: string | number
  /** 数字按 px；text 变体未指定时为 1em */
  height?: string | number
  className?: string
}

const toSize = (value: string | number) => (typeof value === 'number' ? `${value}px` : value)

/**
 * 单个占位块，对应 Vue 版 Skeleton.vue；颜色与脉冲节奏沿用 Arc skeleton。
 * 需要整段文本占位时可直接用 Arc 的 Skeleton（lines/avatar）。
 */
export default function Skeleton({ variant = 'rect', width = '100%', height, className }: SkeletonProps) {
  const style: CSSProperties = {}
  if (width) style.width = toSize(width)
  if (height) {
    style.height = toSize(height)
  } else if (variant === 'text') {
    style.height = '1em'
    style.marginTop = '0.25em'
    style.marginBottom = '0.25em'
  }
  return (
    <div
      className={[styles.block, className].filter(Boolean).join(' ')}
      data-variant={variant}
      style={style}
      aria-hidden="true"
    />
  )
}
