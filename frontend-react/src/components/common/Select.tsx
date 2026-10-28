/**
 * 通用下拉选择，对应 Vue 版 Select.vue：支持搜索（auto 时选项多于 5 个才显示）、可创建项、
 * 可清除、分组标题（kind: 'group'）、远程搜索（防抖后回调 onSearch）与完整键盘操作。
 * 外观沿用 Arc select / combobox 的 token 与结构；Arc select 只支持字符串值且没有搜索、
 * 自定义渲染与远程模式，因此这里保留自有实现。
 */
import { Check, ChevronDown, Search, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

import { useI18n } from '@/i18n/useI18n'
import { resolvePortalContainer } from './portalContainer'
import styles from './Select.module.css'

export type SelectValue = string | number | boolean | null

export interface SelectOption {
  value: SelectValue
  label: string
  disabled?: boolean
  [key: string]: unknown
}

export interface SelectProps {
  /** 当前值（Vue 版 modelValue） */
  value: SelectValue | undefined
  /** 选中或清除时回调（合并 Vue 版 update:modelValue 与 change） */
  onChange?: (value: SelectValue, option: SelectOption | null) => void
  options: SelectOption[] | Array<Record<string, unknown>>
  placeholder?: string
  disabled?: boolean
  error?: boolean
  searchable?: boolean | 'auto'
  searchPlaceholder?: string
  emptyText?: string
  valueKey?: string
  labelKey?: string
  creatable?: boolean
  creatablePrefix?: string
  clearable?: boolean
  id?: string
  'aria-label'?: string
  'aria-describedby'?: string
  /** 远程搜索模式：输入不在本地过滤 options，而是防抖后调用 onSearch(query)，由父组件请求数据更新 options */
  remote?: boolean
  /** 远程搜索模式下的加载态：options 为空时下拉显示 loading 文案 */
  loading?: boolean
  onSearch?: (query: string) => void
  /** 自定义触发器中的已选内容（Vue 版 #selected 插槽） */
  renderSelected?: (option: SelectOption | null) => ReactNode
  /** 自定义选项内容（Vue 版 #option 插槽） */
  renderOption?: (option: SelectOption, selected: boolean) => ReactNode
  className?: string
}

// 远程搜索的防抖间隔（对齐 OpenAIFastPolicyUserSelector 的 300ms 惯例）。
const REMOTE_SEARCH_DEBOUNCE_MS = 300
const dropdownViewportPadding = 8
const dropdownMinimumWidth = 200

type AnyOption = Record<string, any>

function isObject(option: unknown): option is AnyOption {
  return typeof option === 'object' && option !== null
}

export default function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  error = false,
  searchable = 'auto',
  searchPlaceholder,
  emptyText,
  valueKey = 'value',
  labelKey = 'label',
  creatable = false,
  creatablePrefix = '',
  clearable = false,
  id,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedby,
  remote = false,
  loading = false,
  onSearch,
  renderSelected,
  renderOption,
  className
}: SelectProps) {
  const { t } = useI18n()
  const listboxId = useId()
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null)
  const [dropdownPosition, setDropdownPosition] = useState<'bottom' | 'top'>('bottom')
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const optionsListRef = useRef<HTMLDivElement>(null)
  const remoteSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // i18n placeholders
  const placeholderText = placeholder ?? t('common.selectOption')
  const searchPlaceholderText = searchPlaceholder ?? t('common.searchPlaceholder')
  const emptyTextDisplay = emptyText ?? t('common.noOptionsFound')

  // 远程搜索模式始终显示搜索框（选项只是服务端结果的一页）。
  const isSearchable = remote ? true : searchable === 'auto' ? options.length > 5 : searchable

  const getOptionValue = useCallback(
    (option: unknown): any => (isObject(option) ? option[valueKey] : option),
    [valueKey]
  )
  const getOptionLabel = useCallback(
    (option: unknown): string => (isObject(option) ? String(option[labelKey] ?? '') : String(option ?? '')),
    [labelKey]
  )
  const isOptionDisabled = (option: unknown) => (isObject(option) ? !!option.disabled : false)
  const isGroupHeaderOption = (option: unknown) => (isObject(option) ? option.kind === 'group' : false)
  const isSelected = (option: unknown) => getOptionValue(option) === value

  const selectedOption = (options as AnyOption[]).find((opt) => getOptionValue(opt) === value) ?? null
  // In creatable mode, show the raw value if no matching option
  const selectedLabel = selectedOption
    ? getOptionLabel(selectedOption)
    : creatable && value
      ? String(value)
      : placeholderText
  const hasValue = value !== null && value !== undefined && value !== ''

  const filteredOptions = useMemo(() => {
    let opts = options as AnyOption[]
    // 远程搜索模式不在本地过滤（选项即服务端搜索结果的一页）。
    if (isSearchable && searchQuery && !remote) {
      const query = searchQuery.toLowerCase()
      opts = opts.filter((opt) => {
        // Match label
        if (getOptionLabel(opt).toLowerCase().includes(query)) return true
        // Also match description if present
        if (opt.description && String(opt.description).toLowerCase().includes(query)) return true
        return false
      })
      // In creatable mode, always prepend a fuzzy search option
      if (creatable && searchQuery.trim()) {
        const trimmed = searchQuery.trim()
        const prefix = creatablePrefix || t('common.search')
        opts = [{ [valueKey]: trimmed, [labelKey]: `${prefix} "${trimmed}"`, _creatable: true }, ...opts]
      }
    }
    return opts
  }, [options, isSearchable, searchQuery, remote, creatable, creatablePrefix, valueKey, labelKey, getOptionLabel, t])

  const findNextEnabledIndex = (opts: AnyOption[], startIndex: number): number => {
    if (opts.length === 0) return -1
    for (let offset = 0; offset < opts.length; offset++) {
      const idx = (((startIndex + offset) % opts.length) + opts.length) % opts.length
      if (!isOptionDisabled(opts[idx])) return idx
    }
    return -1
  }

  const findPrevEnabledIndex = (opts: AnyOption[], startIndex: number): number => {
    if (opts.length === 0) return -1
    for (let offset = 0; offset < opts.length; offset++) {
      const idx = (((startIndex - offset) % opts.length) + opts.length) % opts.length
      if (!isOptionDisabled(opts[idx])) return idx
    }
    return -1
  }

  // 结果集变化（搜索或远程选项到达）时把高亮移到第一个可用项；按内容比较，避免父组件每次渲染传入新数组导致重置
  const filteredSignature = filteredOptions
    .map((opt) => `${typeof getOptionValue(opt)}:${String(getOptionValue(opt) ?? '')}:${isOptionDisabled(opt) ? 1 : 0}`)
    .join('|')
  const [lastSignature, setLastSignature] = useState(filteredSignature)
  if (lastSignature !== filteredSignature) {
    setLastSignature(filteredSignature)
    if (isOpen) setFocusedIndex(findNextEnabledIndex(filteredOptions, 0))
  }

  const updateTriggerRect = useCallback(() => {
    if (containerRef.current) setTriggerRect(containerRef.current.getBoundingClientRect())
  }, [])

  const cancelRemoteSearch = () => {
    // 关闭时取消仍在排队的远程搜索（避免关闭后尾随 emit 一次 search(''))。
    if (remoteSearchTimer.current) {
      clearTimeout(remoteSearchTimer.current)
      remoteSearchTimer.current = null
    }
  }

  const openDropdown = () => {
    updateTriggerRect()
    setPortalContainer(resolvePortalContainer(containerRef.current))
    // Reset focused index to current selection or first item
    if (filteredOptions.length === 0) {
      setFocusedIndex(-1)
    } else {
      const selectedIdx = filteredOptions.findIndex(isSelected)
      const initialIdx = selectedIdx >= 0 ? selectedIdx : 0
      setFocusedIndex(
        isOptionDisabled(filteredOptions[initialIdx]) ? findNextEnabledIndex(filteredOptions, initialIdx + 1) : initialIdx
      )
    }
    setIsOpen(true)
  }

  const closeDropdown = () => {
    setIsOpen(false)
    setSearchQuery('')
    setFocusedIndex(-1)
    cancelRemoteSearch()
  }

  // 禁用时关闭已打开的下拉
  if (disabled && isOpen) {
    setIsOpen(false)
    setSearchQuery('')
    setFocusedIndex(-1)
  }

  const toggle = () => {
    if (disabled) return
    if (isOpen) closeDropdown()
    else openDropdown()
  }

  // 打开后：聚焦搜索框或列表，判断向上/向下展开，并跟随滚动与窗口尺寸变化
  useEffect(() => {
    if (!isOpen) return
    if (isSearchable) searchInputRef.current?.focus()
    else dropdownRef.current?.focus()

    const calculateDropdownPosition = () => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      setTriggerRect(rect)
      const dropdownHeight = dropdownRef.current?.offsetHeight || 240
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      setDropdownPosition(spaceBelow < dropdownHeight && spaceAbove > dropdownHeight ? 'top' : 'bottom')
    }
    const frame = requestAnimationFrame(calculateDropdownPosition)
    window.addEventListener('scroll', updateTriggerRect, { capture: true, passive: true })
    window.addEventListener('resize', calculateDropdownPosition)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', updateTriggerRect, { capture: true })
      window.removeEventListener('resize', calculateDropdownPosition)
    }
    // 只在打开状态变化时执行，与 Vue 版 watch(isOpen) 相同
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // 点击组件外部时关闭
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (dropdownRef.current?.contains(target) || containerRef.current?.contains(target)) return
      setIsOpen(false)
      setSearchQuery('')
      setFocusedIndex(-1)
      if (remoteSearchTimer.current) {
        clearTimeout(remoteSearchTimer.current)
        remoteSearchTimer.current = null
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [isOpen])

  // 关闭（包括因禁用而关闭）时取消排队中的远程搜索；卸载时同样清理
  useEffect(() => {
    if (isOpen) return
    if (remoteSearchTimer.current) {
      clearTimeout(remoteSearchTimer.current)
      remoteSearchTimer.current = null
    }
  }, [isOpen])

  useEffect(
    () => () => {
      if (remoteSearchTimer.current) clearTimeout(remoteSearchTimer.current)
    },
    []
  )

  // 高亮项滚动到可见区域
  useEffect(() => {
    if (!isOpen || focusedIndex < 0) return
    const list = optionsListRef.current
    const focusedEl = list?.children[focusedIndex] as HTMLElement | undefined
    if (!list || !focusedEl) return
    if (focusedEl.offsetTop < list.scrollTop) {
      list.scrollTop = focusedEl.offsetTop
    } else if (focusedEl.offsetTop + focusedEl.offsetHeight > list.scrollTop + list.offsetHeight) {
      list.scrollTop = focusedEl.offsetTop + focusedEl.offsetHeight - list.offsetHeight
    }
  }, [focusedIndex, isOpen])

  const handleSearchChange = (query: string) => {
    setSearchQuery(query)
    // 远程搜索：输入防抖后交给父组件请求
    if (!remote) return
    cancelRemoteSearch()
    remoteSearchTimer.current = setTimeout(() => {
      remoteSearchTimer.current = null
      onSearch?.(query.trim())
    }, REMOTE_SEARCH_DEBOUNCE_MS)
  }

  const selectOption = (option: AnyOption) => {
    const next = getOptionValue(option) ?? null
    onChange?.(next, option as SelectOption)
    closeDropdown()
    triggerRef.current?.focus()
  }

  const clearSelection = () => {
    if (disabled) return
    onChange?.(null, null)
  }

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    if (!isOpen) openDropdown()
  }

  const onDropdownKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setFocusedIndex(findNextEnabledIndex(filteredOptions, focusedIndex + 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setFocusedIndex(findPrevEnabledIndex(filteredOptions, focusedIndex - 1))
        break
      case 'Enter':
        event.preventDefault()
        if (focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
          const opt = filteredOptions[focusedIndex]
          if (!isOptionDisabled(opt)) selectOption(opt)
        }
        break
      case 'Escape':
        event.preventDefault()
        closeDropdown()
        triggerRef.current?.focus()
        break
      case 'Tab':
        closeDropdown()
        break
    }
  }

  // Computed style for portaled dropdown
  let dropdownStyle: CSSProperties = {}
  if (triggerRect) {
    const rect = triggerRect
    const viewportRight = Math.max(dropdownViewportPadding, window.innerWidth - dropdownViewportPadding)
    const left = Math.min(Math.max(dropdownViewportPadding, rect.left), viewportRight)
    const availableWidth = Math.max(0, viewportRight - left)
    const preferredMinWidth = Math.max(dropdownMinimumWidth, rect.width)
    const minWidth = Math.min(preferredMinWidth, availableWidth)
    dropdownStyle = {
      position: 'fixed',
      left: `${left}px`,
      minWidth: `${minWidth}px`,
      maxWidth: `${availableWidth}px`,
      zIndex: 100000020
    }
    if (dropdownPosition === 'top') dropdownStyle.bottom = `${window.innerHeight - rect.top + 4}px`
    else dropdownStyle.top = `${rect.bottom + 4}px`
  }

  const triggerClasses = [styles.trigger, className].filter(Boolean).join(' ')

  return (
    <div className={styles.root} ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className={triggerClasses}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={isOpen ? listboxId : undefined}
        aria-label={ariaLabel ?? 'Select option'}
        aria-describedby={ariaDescribedby}
        aria-invalid={error || undefined}
        data-state={isOpen ? 'open' : 'closed'}
        data-error={error ? '' : undefined}
        onClick={toggle}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={styles.value} data-placeholder={!selectedOption && !(creatable && value) ? '' : undefined}>
          {renderSelected ? renderSelected(selectedOption as SelectOption | null) : selectedLabel}
        </span>
        {clearable && hasValue && !disabled && (
          <span
            className={styles.clear}
            role="button"
            tabIndex={-1}
            aria-label="Clear selection"
            onClick={(event) => {
              event.stopPropagation()
              clearSelection()
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.stopPropagation()
              event.preventDefault()
              clearSelection()
            }}
          >
            <X size={14} strokeWidth={1.75} aria-hidden="true" />
          </span>
        )}
        <ChevronDown className={styles.chevron} size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      {/* 下拉层渲染到 body（或所在对话框），避免被父级 overflow/层叠上下文截断 */}
      {isOpen &&
        portalContainer &&
        createPortal(
          <div
            ref={dropdownRef}
            id={listboxId}
            className={styles.dropdown}
            style={dropdownStyle}
            role="listbox"
            tabIndex={-1}
            data-side={dropdownPosition}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={onDropdownKeyDown}
          >
            {isSearchable && (
              <div className={styles.search}>
                <Search className={styles.searchIcon} size={16} strokeWidth={1.75} aria-hidden="true" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  placeholder={searchPlaceholderText}
                  aria-label={searchPlaceholderText}
                  className={styles.searchInput}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                />
              </div>
            )}

            <div className={styles.options} ref={optionsListRef}>
              {filteredOptions.map((option, index) => {
                const optionValue = getOptionValue(option)
                const selected = isSelected(option)
                const optionDisabled = isOptionDisabled(option)
                const groupHeader = isGroupHeaderOption(option)
                return (
                  <div
                    key={`${typeof optionValue}:${String(optionValue ?? '')}`}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={optionDisabled}
                    className={styles.option}
                    data-group={groupHeader ? '' : undefined}
                    data-selected={selected ? '' : undefined}
                    data-disabled={optionDisabled && !groupHeader ? '' : undefined}
                    data-active={focusedIndex === index && !groupHeader ? '' : undefined}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (!optionDisabled) selectOption(option)
                    }}
                    onMouseEnter={() => {
                      if (optionDisabled || groupHeader) return
                      setFocusedIndex(index)
                    }}
                  >
                    {renderOption ? (
                      renderOption(option as SelectOption, selected)
                    ) : (
                      <>
                        {option._creatable ? (
                          <Search className={styles.optionIcon} size={14} strokeWidth={1.75} aria-hidden="true" />
                        ) : null}
                        <span className={styles.optionLabel} data-creatable={option._creatable ? '' : undefined}>
                          {getOptionLabel(option)}
                        </span>
                        {selected && <Check className={styles.check} size={14} strokeWidth={2} aria-hidden="true" />}
                      </>
                    )}
                  </div>
                )
              })}

              {/* Empty state */}
              {filteredOptions.length === 0 && (
                <div className={styles.empty} role="status">
                  {loading ? t('common.loading') : emptyTextDisplay}
                </div>
              )}
            </div>
          </div>,
          portalContainer
        )}
    </div>
  )
}
