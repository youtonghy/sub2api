/**
 * 分组名称 / 描述的多语言输入，对应 Vue 版 GroupI18nField.vue。
 * 标签行右侧是版本切换菜单（默认内容 + 每种界面语言），下方只有一个输入控件，切换后编辑对应版本。
 */
import { Check, ChevronDown, Globe } from 'lucide-react'
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'

import arcInput from '@/components/arc/input/input.module.css'
import arcTextarea from '@/components/arc/textarea/textarea.module.css'
import { availableLocales } from '@/i18n'
import { useI18n } from '@/i18n/useI18n'
import type { GroupI18n } from '@/types'
import styles from './GroupI18nField.module.css'

type ControlAttrs = Omit<
  InputHTMLAttributes<HTMLInputElement> & TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange' | 'required' | 'placeholder'
> & { 'data-tour'?: string }

export interface GroupI18nFieldProps extends ControlAttrs {
  label: string
  /** 默认内容，即分组自身的 name / description（Vue 版 modelValue） */
  modelValue: string
  onModelValueChange: (value: string) => void
  /** 全部语言的译文；本组件只读写其中的 field 字段 */
  i18n: GroupI18n
  onI18nChange: (value: GroupI18n) => void
  field: 'name' | 'description'
  multiline?: boolean
  /** 仅约束默认内容，译文始终可留空 */
  required?: boolean
  placeholder?: string
}

export default function GroupI18nField({
  label,
  modelValue,
  onModelValueChange,
  i18n,
  onI18nChange,
  field,
  multiline = false,
  required = false,
  placeholder = '',
  // 透传的属性（rows、data-tour 等）落在输入控件上，而不是外层容器
  ...controlAttrs
}: GroupI18nFieldProps) {
  const { t } = useI18n()
  const generatedId = useId()
  const controlId = controlAttrs.id ?? generatedId
  // 输入控件当前编辑的版本：空串为默认内容，其余为界面语言代码
  const [activeLocale, setActiveLocale] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const controlRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const focusAfterSwitch = useRef(false)

  const options = [
    { code: '', label: t('admin.groups.i18nField.default'), active: activeLocale === '' },
    ...availableLocales.map((locale) => ({
      code: locale.code as string,
      label: t(i18n[locale.code]?.[field] ? 'admin.groups.i18nField.edit' : 'admin.groups.i18nField.add', {
        language: locale.name
      }),
      active: activeLocale === locale.code
    }))
  ]

  const activeLocaleName = availableLocales.find((locale) => locale.code === activeLocale)?.name ?? ''
  const activeLabel = activeLocaleName || t('admin.groups.i18nField.default')
  const currentValue = activeLocale ? (i18n[activeLocale]?.[field] ?? '') : modelValue
  const currentPlaceholder = activeLocale
    ? t('admin.groups.i18nField.placeholder', { language: activeLocaleName })
    : placeholder

  const onInput = (value: string) => {
    if (!activeLocale) {
      onModelValueChange(value)
      return
    }
    onI18nChange({
      ...i18n,
      [activeLocale]: { ...i18n[activeLocale], [field]: value }
    })
  }

  const selectLocale = (code: string) => {
    setMenuOpen(false)
    setActiveLocale(code)
    focusAfterSwitch.current = true
  }

  // 切换版本后聚焦输入控件（Vue 版 nextTick 后 focus）
  useEffect(() => {
    if (!focusAfterSwitch.current) return
    focusAfterSwitch.current = false
    controlRef.current?.focus()
  }, [activeLocale])

  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [menuOpen])

  const controlProps = {
    ...controlAttrs,
    id: controlId,
    ref: controlRef,
    value: currentValue,
    required: required && !activeLocale,
    placeholder: currentPlaceholder
  }

  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={controlId}>
          {label}
        </label>
        <div ref={menuRef} className={styles.menuAnchor}>
          <button
            type="button"
            data-testid="group-i18n-menu"
            className={styles.trigger}
            data-active={activeLocale ? 'true' : undefined}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Globe size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>{activeLabel}</span>
            <ChevronDown
              size={12}
              strokeWidth={1.75}
              aria-hidden="true"
              className={styles.chevron}
              data-open={menuOpen ? 'true' : undefined}
            />
          </button>
          {menuOpen ? (
            <div className={styles.menu} role="menu">
              {options.map((option) => (
                <button
                  key={option.code || 'default'}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.active}
                  data-locale={option.code || 'default'}
                  className={styles.menuItem}
                  onClick={() => selectLocale(option.code)}
                >
                  <span>{option.label}</span>
                  {option.active ? <Check size={14} strokeWidth={1.75} className={styles.check} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {multiline ? (
        <textarea
          {...controlProps}
          className={arcTextarea.control}
          onChange={(event) => onInput(event.target.value)}
        />
      ) : (
        <input
          {...controlProps}
          type="text"
          className={arcInput.input}
          onChange={(event) => onInput(event.target.value)}
        />
      )}
    </div>
  )
}
