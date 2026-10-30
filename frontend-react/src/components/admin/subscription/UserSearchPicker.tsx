/**
 * 订阅管理页的用户搜索选择框：输入框 + 结果下拉，对应 Vue 版 SubscriptionsView 中工具栏用户筛选
 * 与分配订阅表单里的两处内联实现。搜索、防抖与选中逻辑由页面负责，这里只负责展示与点击外部关闭。
 * pickerAttribute 会以空字符串值挂在根元素上（data-filter-user-search / data-assign-user-search）。
 */
import { Search, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import arcInputStyles from '@/components/arc/input/input.module.css'
import { useI18n } from '@/i18n/useI18n'
import styles from './UserSearchPicker.module.css'

export interface UserSearchOption {
  id: number
  email: string
}

export interface UserSearchPickerProps<U extends UserSearchOption> {
  pickerAttribute: 'data-filter-user-search' | 'data-assign-user-search'
  keyword: string
  onKeywordChange: (value: string) => void
  results: U[]
  loading: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (user: U) => void
  /** 显示清除按钮（已选中用户时） */
  showClear: boolean
  onClear: () => void
  placeholder: string
  /** 左侧显示搜索图标（工具栏筛选） */
  searchIcon?: boolean
  disabled?: boolean
  isOptionDisabled?: (user: U) => boolean
  /** 输入框无障碍名称 */
  ariaLabel?: string
  className?: string
}

export default function UserSearchPicker<U extends UserSearchOption>({
  pickerAttribute,
  keyword,
  onKeywordChange,
  results,
  loading,
  open,
  onOpenChange,
  onSelect,
  showClear,
  onClear,
  placeholder,
  searchIcon = false,
  disabled = false,
  isOptionDisabled,
  ariaLabel,
  className
}: UserSearchPickerProps<U>) {
  const { t } = useI18n()
  const rootRef = useRef<HTMLDivElement>(null)

  // Handle click outside to close dropdowns
  useEffect(() => {
    if (!open) return
    const handleClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onOpenChange(false)
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [open, onOpenChange])

  const showDropdown = open && (results.length > 0 || !!keyword)

  return (
    <div ref={rootRef} className={[styles.picker, className].filter(Boolean).join(' ')} {...{ [pickerAttribute]: '' }}>
      {searchIcon && <Search size={16} strokeWidth={1.75} className={styles.searchIcon} aria-hidden="true" />}
      <input
        type="text"
        value={keyword}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className={[arcInputStyles.input, styles.input].join(' ')}
        data-search-icon={searchIcon ? '' : undefined}
        onChange={(event) => onKeywordChange(event.target.value)}
        onFocus={() => onOpenChange(true)}
      />
      {showClear && (
        <button type="button" className={styles.clear} title={t('common.clear')} aria-label={t('common.clear')} onClick={onClear}>
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      )}

      {showDropdown && (
        <div className={styles.dropdown}>
          {loading ? (
            <div className={styles.status}>{t('common.loading')}</div>
          ) : results.length === 0 && keyword ? (
            <div className={styles.status}>{t('common.noOptionsFound')}</div>
          ) : null}
          {results.map((user) => (
            <button
              key={user.id}
              type="button"
              className={styles.option}
              disabled={isOptionDisabled?.(user) ?? false}
              onClick={() => onSelect(user)}
            >
              <span className={styles.email}>{user.email}</span>
              <span className={styles.id}>#{user.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
