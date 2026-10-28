/**
 * 多行输入框，对应 Vue 版 TextArea.vue。外观直接使用 Arc textarea 的样式类，
 * 额外支持可选标签、必填星号与 hint/error 文案。通过 ref 拿到原生 textarea。
 */
import { useId, type Ref, type TextareaHTMLAttributes } from 'react'

import arcStyles from '@/components/arc/textarea/textarea.module.css'
import styles from './Input.module.css'

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string | null | undefined
  /** 输入时回调（Vue 版 update:modelValue） */
  onChange?: (value: string) => void
  /** 失焦提交时回调（对应 Vue 版 change 事件） */
  onCommit?: (value: string) => void
  label?: string
  required?: boolean
  error?: string
  hint?: string
  /** 默认 3 */
  rows?: number
  ref?: Ref<HTMLTextAreaElement>
}

export default function TextArea({
  value,
  onChange,
  onCommit,
  label,
  required = false,
  error,
  hint,
  rows = 3,
  id,
  className,
  placeholder,
  ref,
  ...rest
}: TextAreaProps) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  const messageId = error || hint ? `${controlId}-message` : undefined

  return (
    <div className={[arcStyles.field, styles.field].join(' ')}>
      {label && (
        <label htmlFor={controlId}>
          {label}
          {required && <span className={styles.required}> *</span>}
        </label>
      )}
      <textarea
        {...rest}
        ref={ref}
        id={controlId}
        value={value ?? ''}
        rows={rows}
        required={required}
        placeholder={placeholder || ''}
        aria-invalid={error ? true : undefined}
        aria-describedby={messageId}
        className={[arcStyles.control, className].filter(Boolean).join(' ')}
        style={{ minHeight: 80, ...rest.style }}
        onChange={(event) => onChange?.(event.target.value)}
        onBlur={(event) => {
          rest.onBlur?.(event)
          onCommit?.(event.target.value)
        }}
      />
      {/* Hint / Error Text */}
      {error ? (
        <p id={messageId} className={[arcStyles.error, styles.message].join(' ')} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className={[arcStyles.hint, styles.message].join(' ')}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
