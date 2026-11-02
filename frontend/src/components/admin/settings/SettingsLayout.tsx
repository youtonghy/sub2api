/**
 * 系统设置页的布局积木：区域（带边框的分组）、设置行（左文字右控件）、纵向字段、开关与提示块。
 * 设置页各 Tab 与 BackupView 共用，替代 Vue 版的 .card / .input-label 等全局类。
 */
import { useId, type ReactNode } from 'react'

import { Switch } from '@/components/arc/switch/switch'
import { cx } from './settingsUtils'
import styles from './SettingsLayout.module.css'

export interface SettingsRegionProps {
  title?: ReactNode
  description?: ReactNode
  /** 标题行右侧的操作 */
  actions?: ReactNode
  children?: ReactNode
  className?: string
  id?: string
  'data-testid'?: string
}

/** 区域：带边框的分组，对应 Vue 版的 .card（标题 + 说明 + 主体） */
export function SettingsRegion({
  title,
  description,
  actions,
  children,
  className,
  id,
  'data-testid': testId
}: SettingsRegionProps) {
  const headingId = useId()
  return (
    <section
      className={cx(styles.region, className)}
      id={id}
      data-testid={testId}
      aria-labelledby={title ? headingId : undefined}
    >
      {title || description || actions ? (
        <header className={styles.regionHeader}>
          <div className={styles.regionHeading}>
            {title ? (
              <h2 id={headingId} className={styles.regionTitle}>
                {title}
              </h2>
            ) : null}
            {description ? <p className={styles.regionDescription}>{description}</p> : null}
          </div>
          {actions ? <div className={styles.regionActions}>{actions}</div> : null}
        </header>
      ) : null}
      {children ? <div className={styles.regionBody}>{children}</div> : null}
    </section>
  )
}

export interface SettingRowProps {
  label: ReactNode
  description?: ReactNode
  /** 右侧控件（开关、按钮等） */
  control?: ReactNode
  /** 控件打开后显示在下方的细节 */
  children?: ReactNode
  htmlFor?: string
  className?: string
  'data-testid'?: string
}

/** 设置行：标签与说明在左，控件在右 */
export function SettingRow({ label, description, control, children, htmlFor, className, 'data-testid': testId }: SettingRowProps) {
  return (
    <div className={cx(styles.row, className)} data-testid={testId}>
      <div className={styles.rowHead}>
        <div className={styles.rowText}>
          {htmlFor ? (
            <label className={styles.rowLabel} htmlFor={htmlFor}>
              {label}
            </label>
          ) : (
            <span className={styles.rowLabel}>{label}</span>
          )}
          {description ? <p className={styles.rowDescription}>{description}</p> : null}
        </div>
        {control ? <div className={styles.rowControl}>{control}</div> : null}
      </div>
      {children ? <div className={styles.rowBody}>{children}</div> : null}
    </div>
  )
}

export interface SettingSwitchProps {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  id?: string
  'aria-label'?: string
  'data-testid'?: string
}

/** Arc 开关（role="switch"），可直接挂 data-testid */
export function SettingSwitch({ checked, onChange, disabled, id, 'aria-label': ariaLabel, 'data-testid': testId }: SettingSwitchProps) {
  return (
    <Switch
      id={id}
      checked={checked}
      onCheckedChange={(next) => onChange(next)}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={testId}
    />
  )
}

export interface ToggleRowProps extends Omit<SettingRowProps, 'control' | 'htmlFor'> {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  /** 开关元素上的 data-testid */
  switchTestId?: string
}

/** 开关行：label 同时作为开关的无障碍名称 */
export function ToggleRow({ checked, onChange, disabled, switchTestId, label, ...rest }: ToggleRowProps) {
  const id = useId()
  return (
    <SettingRow
      {...rest}
      label={label}
      htmlFor={id}
      control={<SettingSwitch id={id} checked={checked} onChange={onChange} disabled={disabled} data-testid={switchTestId} />}
    />
  )
}

export interface FieldProps {
  label?: ReactNode
  htmlFor?: string
  hint?: ReactNode
  error?: ReactNode
  /** 标签行右侧内容 */
  labelExtra?: ReactNode
  children?: ReactNode
  className?: string
  'data-testid'?: string
}

/** 纵向字段：标签、控件、提示 */
export function Field({ label, htmlFor, hint, error, labelExtra, children, className, 'data-testid': testId }: FieldProps) {
  return (
    <div className={cx(styles.field, className)} data-testid={testId}>
      {label || labelExtra ? (
        <div className={styles.labelRow}>
          {label ? (
            <label className={styles.label} htmlFor={htmlFor}>
              {label}
            </label>
          ) : (
            <span />
          )}
          {labelExtra}
        </div>
      ) : null}
      {children}
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  )
}

export interface NoticeProps {
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral'
  children?: ReactNode
  className?: string
  role?: string
  'data-testid'?: string
}

/** 提示块（Vue 版的彩色说明框） */
export function Notice({ tone = 'neutral', children, className, role, 'data-testid': testId }: NoticeProps) {
  return (
    <div className={cx(styles.notice, className)} data-tone={tone} role={role} data-testid={testId}>
      {children}
    </div>
  )
}
