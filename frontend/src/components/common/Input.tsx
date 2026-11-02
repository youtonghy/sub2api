/**
 * 文本输入框，对应 Vue 版 Input.vue。外观直接使用 Arc input 的样式类；
 * 额外支持前后缀插槽（prefix/suffix）、必填星号与 hint/error 文案，Arc input 本身不提供这些。
 * 通过 ref 拿到原生 input（Vue 版 defineExpose 的 focus/select）。
 */
import { useId, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from 'react'

import arcStyles from '@/components/arc/input/input.module.css'
import styles from './Input.module.css'

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'prefix' | 'type'> {
  value: string | number | null | undefined
  /** 输入时回调（Vue 版 update:modelValue） */
  onChange?: (value: string) => void
  /** 失焦提交时回调（对应 Vue 版 change 事件；这里每次失焦都会触发） */
  onCommit?: (value: string) => void
  /** 回车时回调（Vue 版 enter 事件） */
  onEnter?: (event: KeyboardEvent<HTMLInputElement>) => void
  type?: string
  label?: string
  required?: boolean
  error?: string
  hint?: string
  /** 输入框左侧图标（Vue 版 #prefix 插槽） */
  prefix?: ReactNode
  /** 输入框右侧内容，例如密码可见切换（Vue 版 #suffix 插槽） */
  suffix?: ReactNode
  ref?: Ref<HTMLInputElement>
}

export default function Input({
  value,
  onChange,
  onCommit,
  onEnter,
  type = 'text',
  label,
  required = false,
  error,
  hint,
  prefix,
  suffix,
  id,
  className,
  placeholder,
  onKeyUp,
  ref,
  ...rest
}: InputProps) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  const messageId = error || hint ? `${controlId}-message` : undefined

  return (
    <div className={[arcStyles.field, styles.field].join(' ')}>
      {label && (
        <label className={arcStyles.label} htmlFor={controlId}>
          {label}
          {required && <span className={styles.required}> *</span>}
        </label>
      )}
      <div className={styles.control}>
        {prefix && <span className={styles.prefix}>{prefix}</span>}
        <input
          {...rest}
          ref={ref}
          id={controlId}
          type={type}
          value={value ?? ''}
          required={required}
          placeholder={placeholder || ''}
          aria-invalid={error ? true : undefined}
          aria-describedby={messageId}
          data-prefix={prefix ? '' : undefined}
          data-suffix={suffix ? '' : undefined}
          className={[arcStyles.input, styles.input, className].filter(Boolean).join(' ')}
          onChange={(event) => onChange?.(event.target.value)}
          onBlur={(event) => {
            rest.onBlur?.(event)
            onCommit?.(event.target.value)
          }}
          onKeyUp={(event) => {
            onKeyUp?.(event)
            if (event.key === 'Enter') onEnter?.(event)
          }}
        />
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
      {/* Hint / Error Text */}
      {error ? (
        <p id={messageId} className={[arcStyles.error, styles.message].join(' ')} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className={[arcStyles.description, styles.message].join(' ')}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
