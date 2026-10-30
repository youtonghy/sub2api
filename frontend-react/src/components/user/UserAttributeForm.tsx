/**
 * 用户自定义属性表单，对应 Vue 版 UserAttributeForm.vue（v-model 变为 value + onChange）。
 * 挂载时加载启用的属性定义；userId 变化时清空本地值并加载该用户的属性值，
 * 迟到的旧用户响应被丢弃。数字输入以字符串形式回传，与属性值 API 一致。
 */
import { useEffect, useEffectEvent, useState } from 'react'

import { adminAPI } from '@/api/admin'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'
import Skeleton from '@/components/common/Skeleton'
import TextArea from '@/components/common/TextArea'
import type { UserAttributeDefinition, UserAttributeValuesMap } from '@/types'
import styles from './UserAttributeForm.module.css'

export interface UserAttributeFormProps {
  userId?: number
  /** 属性值（Vue 版 modelValue） */
  value: UserAttributeValuesMap
  /** 值变化（Vue 版 update:modelValue） */
  onChange?: (value: UserAttributeValuesMap) => void
}

function parseMultiValue(value: string | undefined): string[] {
  if (!value) return []
  try {
    const arr = JSON.parse(value)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export default function UserAttributeForm({ userId, value, onChange }: UserAttributeFormProps) {
  const [loading, setLoading] = useState(false)
  const [attributes, setAttributes] = useState<UserAttributeDefinition[]>([])
  const [localValues, setLocalValues] = useState<UserAttributeValuesMap>({})

  const emit = useEffectEvent((next: UserAttributeValuesMap) => onChange?.(next))

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时加载属性定义（Vue 版 onMounted）
    setLoading(true)
    adminAPI.userAttributes
      .listEnabledDefinitions()
      .then((definitions) => {
        if (active) setAttributes(definitions)
      })
      .catch((error) => {
        console.error('Failed to load attributes:', error)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // 父组件传入非空值时同步到本地（Vue 版 watch(modelValue, immediate)）
  useEffect(() => {
    if (value && Object.keys(value).length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 受控值回写到本地编辑副本
      setLocalValues({ ...value })
    }
  }, [value])

  // 切换用户：清空本地值并加载新用户的属性值，旧请求结果丢弃（Vue 版 requestVersion）
  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 对应 Vue 版 watch(userId)：切换用户时先清空
    setLocalValues({})
    if (userId) {
      adminAPI.userAttributes
        .getUserAttributeValues(userId)
        .then((values) => {
          if (!active) return
          const valuesMap: UserAttributeValuesMap = {}
          values.forEach((v) => {
            valuesMap[v.attribute_id] = v.value
          })
          setLocalValues({ ...valuesMap })
          emit({ ...valuesMap })
        })
        .catch((error) => {
          console.error('Failed to load user attribute values:', error)
        })
    }
    return () => {
      active = false
    }
  }, [userId])

  const updateValue = (attrId: number, next: string) => {
    const merged = { ...localValues, [attrId]: next }
    setLocalValues(merged)
    onChange?.({ ...merged })
  }

  const isOptionSelected = (attrId: number, optionValue: string): boolean => parseMultiValue(localValues[attrId]).includes(optionValue)

  const toggleMultiSelectOption = (attrId: number, optionValue: string) => {
    const arr = parseMultiValue(localValues[attrId])
    const index = arr.indexOf(optionValue)
    if (index > -1) arr.splice(index, 1)
    else arr.push(optionValue)
    updateValue(attrId, JSON.stringify(arr))
  }

  if (attributes.length === 0) {
    if (!loading) return null
    // Loading State
    return (
      <div className={styles.loading} aria-busy="true">
        <Skeleton width="40%" height={12} />
        <Skeleton height={36} />
      </div>
    )
  }

  return (
    <div className={styles.fields}>
      {attributes.map((attr) => {
        const label = attr.name
        const current = localValues[attr.id] ?? ''
        const hint = attr.description || undefined
        // Text Input
        if (attr.type === 'text' || attr.type === 'email' || attr.type === 'url') {
          return (
            <Input
              key={attr.id}
              label={label}
              type={attr.type === 'text' ? 'text' : attr.type}
              required={attr.required}
              placeholder={attr.placeholder}
              hint={hint}
              value={current}
              onChange={(next) => updateValue(attr.id, next)}
            />
          )
        }
        // Number Input
        if (attr.type === 'number') {
          return (
            <Input
              key={attr.id}
              label={label}
              type="number"
              required={attr.required}
              placeholder={attr.placeholder}
              min={attr.validation?.min}
              max={attr.validation?.max}
              hint={hint}
              value={current}
              onChange={(next) => updateValue(attr.id, next)}
            />
          )
        }
        // Date Input
        if (attr.type === 'date') {
          return (
            <Input
              key={attr.id}
              label={label}
              type="date"
              required={attr.required}
              hint={hint}
              value={current}
              onChange={(next) => updateValue(attr.id, next)}
            />
          )
        }
        // Textarea
        if (attr.type === 'textarea') {
          return (
            <TextArea
              key={attr.id}
              label={label}
              required={attr.required}
              placeholder={attr.placeholder}
              rows={3}
              hint={hint}
              value={current}
              onChange={(next) => updateValue(attr.id, next)}
            />
          )
        }
        // Select
        if (attr.type === 'select') {
          return (
            <div key={attr.id} className={styles.field}>
              <span className={styles.label}>
                {label}
                {attr.required && <span className={styles.required}> *</span>}
              </span>
              <Select
                value={current}
                options={attr.options || []}
                aria-label={label}
                onChange={(next) => updateValue(attr.id, next == null ? '' : String(next))}
              />
              {hint && <p className={styles.hint}>{hint}</p>}
            </div>
          )
        }
        // Multi-Select (Checkboxes)
        if (attr.type === 'multi_select') {
          return (
            <fieldset key={attr.id} className={styles.field}>
              <legend className={styles.label}>
                {label}
                {attr.required && <span className={styles.required}> *</span>}
              </legend>
              <div className={styles.options}>
                {(attr.options || []).map((opt) => (
                  <Checkbox
                    key={opt.value}
                    checked={isOptionSelected(attr.id, opt.value)}
                    onCheckedChange={() => toggleMultiSelectOption(attr.id, opt.value)}
                    label={opt.label}
                  />
                ))}
              </div>
              {hint && <p className={styles.hint}>{hint}</p>}
            </fieldset>
          )
        }
        return null
      })}
    </div>
  )
}
