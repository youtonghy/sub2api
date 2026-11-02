import { Inbox, Plus } from 'lucide-react'
import { createElement, isValidElement, type ComponentType, type ReactNode } from 'react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/arc/button/button'
import { EmptyState as ArcEmptyState } from '@/components/arc/empty-state/empty-state'
import { useI18n } from '@/i18n/useI18n'

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>

export interface EmptyStateProps {
  /** 图标：React 元素或图标组件（如 lucide 图标），对应 Vue 版 icon 属性与 #icon 插槽 */
  icon?: ReactNode | IconComponent
  /** 默认 common.noData */
  title?: string
  description?: string
  actionText?: string
  /** 路由地址；设置后动作按钮跳转到该地址，否则触发 onAction */
  actionTo?: string
  /** 动作按钮前显示加号，默认 true */
  actionIcon?: boolean
  onAction?: () => void
  /** 自定义动作区（Vue 版 #action 插槽） */
  action?: ReactNode
  className?: string
}

/** 仅在设置 actionTo 时使用路由，避免无路由环境（如表格测试）报错 */
function NavigateButton({ to, children }: { to: string; children: ReactNode }) {
  const navigate = useNavigate()
  return (
    <Button type="button" variant="primary" onClick={() => navigate(to)}>
      {children}
    </Button>
  )
}

/** 空状态，对应 Vue 版 EmptyState.vue，基于 Arc empty-state */
export default function EmptyState({
  icon,
  title,
  description = '',
  actionText,
  actionTo,
  actionIcon = true,
  onAction,
  action,
  className
}: EmptyStateProps) {
  const { t } = useI18n()

  const glyph =
    icon == null ? (
      <Inbox size={24} strokeWidth={1.5} aria-hidden={true} />
    ) : isValidElement(icon) || typeof icon === 'string' || typeof icon === 'number' || Array.isArray(icon) ? (
      (icon as ReactNode)
    ) : (
      createElement(icon as IconComponent, { size: 24, strokeWidth: 1.5, 'aria-hidden': true })
    )

  const actionContent = (
    <>
      {actionIcon && <Plus size={16} strokeWidth={1.75} aria-hidden="true" />}
      {actionText}
    </>
  )
  const actionNode =
    action ??
    (actionText ? (
      actionTo ? (
        <NavigateButton to={actionTo}>{actionContent}</NavigateButton>
      ) : (
        <Button type="button" variant="primary" onClick={() => onAction?.()}>
          {actionContent}
        </Button>
      )
    ) : undefined)

  return (
    <ArcEmptyState
      icon={glyph}
      title={title || t('common.noData')}
      description={description}
      action={actionNode}
      className={className}
    />
  )
}
