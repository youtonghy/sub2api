/**
 * 独立保存的小设置卡片（过载冷却、429 冷却、流超时等）共用的加载/保存逻辑，
 * 对应 Vue 版每张卡片各自的 xxxLoading / xxxSaving / loadXxx / saveXxx。
 */
import { useCallback, useState } from 'react'

import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores'
import { extractApiErrorMessage } from '@/utils/apiError'

export interface IndependentSettingsOptions<T> {
  defaults: T
  load: () => Promise<Partial<T>>
  save: (form: T) => Promise<Partial<T>>
  /** 加载或保存后对表单的额外规整 */
  normalize?: (form: T) => T
  savedKey: string
  saveFailedKey: string
}

export function useIndependentSettings<T extends object>(options: IndependentSettingsOptions<T>) {
  const { t } = useI18n()
  const [form, setForm] = useState<T>(options.defaults)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { load, save: saveRequest, normalize, savedKey, saveFailedKey } = options

  useMountOnce(async () => {
    setLoading(true)
    try {
      const loaded = await load()
      setForm((prev) => {
        const next = { ...prev, ...loaded }
        return normalize ? normalize(next) : next
      })
    } catch {
      // Silent fail - settings will use defaults
    } finally {
      setLoading(false)
    }
  })

  const patch = useCallback((value: Partial<T>) => setForm((prev) => ({ ...prev, ...value })), [])

  async function save() {
    setSaving(true)
    try {
      const updated = await saveRequest(form)
      setForm((prev) => {
        const next = { ...prev, ...updated }
        return normalize ? normalize(next) : next
      })
      useAppStore.getState().showSuccess(t(savedKey))
    } catch (error: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t(saveFailedKey)))
    } finally {
      setSaving(false)
    }
  }

  return { form, setForm, patch, loading, saving, save }
}
