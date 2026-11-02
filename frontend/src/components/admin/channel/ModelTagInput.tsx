/**
 * 模型标签输入，对应 Vue 版 ModelTagInput.vue：
 * 回车 / Tab 提交、退格删除最后一个标签、粘贴按逗号 / 换行 / 分号批量导入、失焦提交。
 * 输入法组字期间的按键交给输入法处理。
 */
import { X } from 'lucide-react'
import { useState, type ClipboardEvent, type KeyboardEvent } from 'react'

import { useI18n } from '@/i18n/useI18n'
import { platformTone } from './platformTone'
import styles from './ModelTagInput.module.css'

export interface ModelTagInputProps {
  models: string[]
  placeholder?: string
  platform?: string
  /** Vue 版 update:models */
  onModelsChange?: (models: string[]) => void
  className?: string
  'aria-label'?: string
}

export default function ModelTagInput({
  models,
  placeholder,
  platform,
  onModelsChange,
  className,
  'aria-label': ariaLabel
}: ModelTagInputProps) {
  const { t } = useI18n()
  const [inputValue, setInputValue] = useState('')

  // 读 DOM 当前值，避免同一事件循环内连续按键读到旧的 state
  const addModel = (raw: string) => {
    const val = raw.trim()
    if (!val) return
    if (!models.includes(val)) {
      onModelsChange?.([...models, val])
    }
    setInputValue('')
  }

  const removeModel = (idx: number) => {
    const newModels = [...models]
    newModels.splice(idx, 1)
    onModelsChange?.(newModels)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    const current = event.currentTarget.value
    if (event.key === 'Enter') {
      event.preventDefault()
      addModel(current)
      return
    }
    if (event.key === 'Tab') {
      if (!current.trim()) return
      event.preventDefault()
      addModel(current)
      return
    }
    if (event.key === 'Backspace') {
      if (current === '' && models.length > 0) {
        removeModel(models.length - 1)
      }
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    const text = event.clipboardData?.getData('text') || ''
    const items = text.split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean)
    if (items.length === 0) return
    const unique = [...new Set([...models, ...items])]
    onModelsChange?.(unique)
    setInputValue('')
  }

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      <div className={styles.box}>
        {models.map((model, idx) => (
          <span key={idx} {...platformTone(platform, 'tag', styles.tag)}>
            {model}
            <button
              type="button"
              className={styles.remove}
              aria-label={`${t('common.delete')} ${model}`}
              onClick={() => removeModel(idx)}
            >
              <X size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          type="text"
          className={styles.input}
          value={inputValue}
          placeholder={models.length === 0 ? placeholder : ''}
          aria-label={ariaLabel ?? placeholder}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={(event) => addModel(event.currentTarget.value)}
        />
      </div>
      <p className={styles.hint}>{t('admin.channels.form.modelInputHint')}</p>
    </div>
  )
}
