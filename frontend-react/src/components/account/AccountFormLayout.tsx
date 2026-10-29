import type { ReactNode } from 'react'

import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer'
import Toggle from '@/components/common/Toggle'
import styles from './AccountForm.module.css'

export interface AccountFormDrawerProps {
  show: boolean
  title: string
  description?: string
  /** 'wide' ≈ Vue BaseDialog width="wide"；'extra-wide' 用于批量编辑等更宽的表单 */
  width?: 'normal' | 'wide' | 'extra-wide'
  onClose: () => void
  /** 底部操作区（Vue 版 #footer 插槽），固定在抽屉底部 */
  footer?: ReactNode
  children: ReactNode
  className?: string
}

const widthClass = {
  normal: styles.drawerNormal,
  wide: styles.drawerWide,
  'extra-wide': styles.drawerExtraWide
}

/**
 * 账号表单抽屉（右侧宽抽屉），替代 Vue 版 BaseDialog width="wide"。
 * 关闭（遮罩点击、Escape、关闭按钮、拖动）统一回调 onClose。
 */
export function AccountFormDrawer({
  show,
  title,
  description,
  width = 'wide',
  onClose,
  footer,
  children,
  className
}: AccountFormDrawerProps) {
  return (
    <Drawer
      open={show}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DrawerContent
        title={title}
        description={description}
        side="right"
        className={[widthClass[width], className].filter(Boolean).join(' ')}
      >
        <div className={styles.drawerInner}>
          <div className={styles.drawerBody}>{children}</div>
          {footer ? <div className={styles.drawerFooter}>{footer}</div> : null}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

export interface FormSectionProps {
  title?: ReactNode
  description?: ReactNode
  /** 标题行右侧的内容（例如开关） */
  action?: ReactNode
  children?: ReactNode
  className?: string
  'data-tour'?: string
}

/** 表单分组：标题 + 说明，组之间用 --border-subtle 分隔，不嵌套卡片 */
export function FormSection({ title, description, action, children, className, 'data-tour': dataTour }: FormSectionProps) {
  return (
    <section className={[styles.section, className].filter(Boolean).join(' ')} data-tour={dataTour}>
      {title || description || action ? (
        <div className={styles.sectionHeader}>
          <div className={styles.sectionHeading}>
            {title ? <h3 className={styles.sectionTitle}>{title}</h3> : null}
            {description ? <p className={styles.sectionDescription}>{description}</p> : null}
          </div>
          {action ? <div className={styles.sectionAction}>{action}</div> : null}
        </div>
      ) : null}
      {children ? <div className={styles.sectionBody}>{children}</div> : null}
    </section>
  )
}

export interface FormFieldProps {
  label?: ReactNode
  htmlFor?: string
  required?: boolean
  /** 标签旁的附加内容（例如 HelpTooltip） */
  labelExtra?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children?: ReactNode
  className?: string
  'data-tour'?: string
}

/** 纵向字段：标签、控件、提示、错误 */
export function FormField({
  label,
  htmlFor,
  required,
  labelExtra,
  hint,
  error,
  children,
  className,
  'data-tour': dataTour
}: FormFieldProps) {
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')} data-tour={dataTour}>
      {label ? (
        <div className={styles.labelRow}>
          <label className={styles.label} htmlFor={htmlFor}>
            {label}
            {required ? <span className={styles.required}> *</span> : null}
          </label>
          {labelExtra}
        </div>
      ) : null}
      {children}
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  )
}

export interface ToggleRowProps {
  label: ReactNode
  description?: ReactNode
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  /** 开关的无障碍名称；label 不是纯文本时必须提供 */
  ariaLabel?: string
  /** 标签旁的附加内容（例如 HelpTooltip） */
  labelExtra?: ReactNode
  /** 开关打开后显示在下方的内容 */
  children?: ReactNode
  className?: string
  'data-testid'?: string
}

/** 开关行：标签与说明在左，开关在右 */
export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
  ariaLabel,
  labelExtra,
  children,
  className,
  'data-testid': testId
}: ToggleRowProps) {
  return (
    <div className={[styles.toggleRow, className].filter(Boolean).join(' ')} data-testid={testId}>
      <div className={styles.toggleHead}>
        <div className={styles.toggleText}>
          <div className={styles.labelRow}>
            <span className={styles.label}>{label}</span>
            {labelExtra}
          </div>
          {description ? <p className={styles.hint}>{description}</p> : null}
        </div>
        <Toggle
          value={checked}
          onChange={onChange}
          disabled={disabled}
          aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
        />
      </div>
      {children ? <div className={styles.toggleBody}>{children}</div> : null}
    </div>
  )
}

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger'

/** 行内提示块（替代 Vue 版各色背景的提示框），用语义色调而不是原始颜色 */
export function FormNotice({
  tone = 'info',
  title,
  children,
  className
}: {
  tone?: NoticeTone
  title?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={[styles.notice, className].filter(Boolean).join(' ')} data-tone={tone}>
      {title ? <p className={styles.noticeTitle}>{title}</p> : null}
      {children ? <div className={styles.noticeBody}>{children}</div> : null}
    </div>
  )
}
