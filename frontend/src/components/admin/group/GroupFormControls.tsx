/**
 * 分组表单内的小型控件：数字字段（v-model.number 语义）、复选项、开关行与带帮助提示的标签。
 */
import { useId, type ReactNode } from 'react'

import { Checkbox } from '@/components/arc/checkbox/checkbox'
import arcInput from '@/components/arc/input/input.module.css'
import { Switch } from '@/components/arc/switch/switch'
import HelpTooltip from '@/components/common/HelpTooltip'
import { formNumberValue, toModelNumber, type FormNumber } from './groupForm'
import styles from './GroupForm.module.css'

export interface NumberFieldProps {
  label?: ReactNode
  value: FormNumber | undefined
  onChange: (value: number | string) => void
  step?: string
  min?: string
  max?: string
  placeholder?: string
  title?: string
  hint?: ReactNode
  required?: boolean
  'data-tour'?: string
  'data-testid'?: string
  'aria-label'?: string
}

/** 数字输入：可解析时写入数字，清空时写入 ""，与 Vue v-model.number 一致 */
export function NumberField({
  label,
  value,
  onChange,
  step,
  min,
  max,
  placeholder,
  title,
  hint,
  required,
  'data-tour': dataTour,
  'data-testid': testId,
  'aria-label': ariaLabel
}: NumberFieldProps) {
  const id = useId()
  return (
    <div className={styles.field}>
      {label ? (
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
      ) : null}
      <input
        id={id}
        type="number"
        className={arcInput.input}
        value={formNumberValue(value)}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        title={title}
        required={required}
        data-tour={dataTour}
        data-testid={testId}
        aria-label={ariaLabel}
        onChange={(event) => onChange(toModelNumber(event.target.value))}
      />
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  )
}

export interface TextFieldProps {
  label?: ReactNode
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'time'
  hint?: ReactNode
}

export function TextField({ label, value, onChange, placeholder, type = 'text', hint }: TextFieldProps) {
  const id = useId()
  return (
    <div className={styles.field}>
      {label ? (
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
      ) : null}
      <input
        id={id}
        type={type}
        className={arcInput.input}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  )
}

export function CheckField({
  label,
  description,
  checked,
  onChange
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <Checkbox
      label={label}
      description={description}
      checked={checked}
      onCheckedChange={(next) => onChange(next === true)}
    />
  )
}

/** 标签 + 帮助提示（Vue 版问号图标悬浮提示） */
export function HelpLabel({ label, help, htmlFor }: { label: ReactNode; help?: ReactNode; htmlFor?: string }) {
  return (
    <div className={styles.labelRow}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      {help ? <HelpTooltip width="18rem">{help}</HelpTooltip> : null}
    </div>
  )
}

export interface SwitchRowProps {
  label: ReactNode
  /** 标签旁的帮助提示 */
  help?: ReactNode
  description?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel?: string
  'data-testid'?: string
  children?: ReactNode
}

/** 开关行：标签与说明在左，开关在右；打开后的从属内容缩进显示 */
export function SwitchRow({
  label,
  help,
  description,
  checked,
  onChange,
  ariaLabel,
  'data-testid': testId,
  children
}: SwitchRowProps) {
  return (
    <div className={styles.block}>
      <div className={styles.toggleHead}>
        <div className={styles.toggleText}>
          <div className={styles.labelRow}>
            <span className={styles.label}>{label}</span>
            {help ? <HelpTooltip width="18rem">{help}</HelpTooltip> : null}
          </div>
          {description ? <p className={styles.hint}>{description}</p> : null}
        </div>
        <Switch
          data-testid={testId}
          aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
          checked={checked}
          onCheckedChange={onChange}
        />
      </div>
      {children}
    </div>
  )
}
