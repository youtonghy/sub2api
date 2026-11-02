/**
 * 系统设置的共享上下文：SettingsView 持有草稿与加载/保存，各 Tab 通过 useSettings() 读写。
 */
import { createContext, useContext } from 'react'

import type { AdminGroup, Proxy } from '@/types'
import type { SettingsDraft, SettingsForm, SettingsUiState } from './settingsForm'
import type { LocalText } from './settingsHelpers'

export type FormPatch = Partial<SettingsForm> | ((form: SettingsForm) => Partial<SettingsForm>)
export type DraftPatch = Partial<SettingsDraft> | ((draft: SettingsDraft) => Partial<SettingsDraft>)

export interface SettingsContextValue {
  draft: SettingsDraft
  form: SettingsForm
  ui: SettingsUiState
  updateForm: (patch: FormPatch) => void
  updateDraft: (patch: DraftPatch) => void
  updateUi: (patch: Partial<SettingsUiState>) => void
  /** 状态为 active 的订阅分组（默认订阅下拉） */
  subscriptionGroups: AdminGroup[]
  /** 网页搜索模拟服务商可选的代理 */
  webSearchProxies: Proxy[]
  /** 提交整张设置表单（支付服务商保存后也会调用） */
  saveSettings: () => Promise<void>
  localText: LocalText
  /** 设置加载失败（保存与测试按钮禁用） */
  loadFailed: boolean
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext)
  if (!value) throw new Error('useSettings must be used inside SettingsView')
  return value
}
