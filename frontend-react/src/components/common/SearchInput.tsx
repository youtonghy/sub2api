/**
 * 搜索输入框，对应 Vue 版 SearchInput.vue：输入立即回调 onChange，onSearch 防抖触发；
 * 输入法组字期间不回调，组字结束后提交（与 Vue v-model 的组字行为一致）。
 * 外观使用 Arc search-field 的样式类；Arc search-field 必须有可见标签，这里用 aria-label 代替。
 */
import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import arcStyles from '@/components/arc/search-field/search-field.module.css'

export interface SearchInputProps {
  value: string
  /** 输入时立即回调（Vue 版 update:modelValue） */
  onChange?: (value: string) => void
  /** 防抖后回调（Vue 版 search 事件） */
  onSearch?: (value: string) => void
  /** 默认 'Search...' */
  placeholder?: string
  /** 默认 300 */
  debounceMs?: number
  /** 无障碍名称，默认使用 placeholder */
  'aria-label'?: string
  className?: string
}

export default function SearchInput({
  value,
  onChange,
  onSearch,
  placeholder = 'Search...',
  debounceMs = 300,
  'aria-label': ariaLabel,
  className
}: SearchInputProps) {
  const [draft, setDraft] = useState(value)
  const [lastValue, setLastValue] = useState(value)
  const composing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 外部值变化时同步显示，不触发搜索
  if (lastValue !== value) {
    setLastValue(value)
    setDraft(value)
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const commit = (next: string) => {
    setLastValue(next)
    onChange?.(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      onSearch?.(next)
    }, debounceMs)
  }

  return (
    <div className={[arcStyles.shell, className].filter(Boolean).join(' ')} data-filled={draft ? 'true' : undefined}>
      <Search width={18} height={18} aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className={arcStyles.input}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={(event) => {
          composing.current = false
          const next = event.currentTarget.value
          setDraft(next)
          commit(next)
        }}
        onChange={(event) => {
          const next = event.target.value
          setDraft(next)
          if (!composing.current) commit(next)
        }}
      />
      <span className={arcStyles.clearSlot}>
        {draft ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setDraft('')
              commit('')
              inputRef.current?.focus()
            }}
          >
            <X width={16} height={16} aria-hidden="true" />
          </button>
        ) : null}
      </span>
    </div>
  )
}
