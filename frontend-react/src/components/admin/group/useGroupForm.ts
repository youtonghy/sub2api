/**
 * 分组创建 / 编辑表单的状态（Vue 版 GroupsView.vue 中 createForm / editForm 及其附属状态）。
 * 两种模式共用同一套字段与表单组件；页面各持有一个实例，提交与列表刷新仍由页面负责（与 Vue 版一致）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import type { AdminGroup, CodexModelsManifestConfig, GroupPlatform } from '@/types'
import {
  addCustomModelAllowlistItem,
  createModelAllowlistState,
  setModelAllowlistCandidates,
  type ModelAllowlistConfig,
  type ModelAllowlistState
} from '@/views/admin/groupModelAllowlist'
import { createModelAllowlistCandidatesTracker } from '@/views/admin/modelAllowlistCandidates'
import { createDefaultMessagesDispatchFormState } from '@/views/admin/groupsMessagesDispatch'
import { reasoningEffortOverLimitDowngrade } from '@/views/admin/groupsReasoningEffort'
import { createVideoModelPricesForm } from '@/views/admin/groupsVideoModelPricing'
import type { CodexManifestAccountsFieldHandle } from './CodexManifestAccountsField'
import {
  applyEditHydrationWatchers,
  applySubscriptionTypeChange,
  createCodexManifestDefaults,
  createGroupFormDefaults,
  createModelRoutingRule,
  groupFormFromGroup,
  withBatchImagePricingReset,
  type GroupFormMode,
  type GroupFormState,
  type ModelRoutingRule,
  type SimpleAccount
} from './groupForm'
import type { ReasoningEffortPolicyFieldsHandle } from './ReasoningEffortPolicyFields'

const cloneAllowlist = (state: ModelAllowlistState): ModelAllowlistState => ({
  enabled: state.enabled,
  savedModels: [...state.savedModels],
  items: state.items.map((item) => ({ ...item }))
})

// 将 API 格式的路由规则转换为 UI 格式（需要加载账号名称）
export const convertApiFormatToRoutingRules = async (
  apiFormat: Record<string, number[]> | null | undefined
): Promise<ModelRoutingRule[]> => {
  if (!apiFormat) return []

  const rules: ModelRoutingRule[] = []
  for (const [pattern, accountIds] of Object.entries(apiFormat)) {
    // 加载账号信息
    const accounts: SimpleAccount[] = []
    for (const id of accountIds) {
      try {
        const account = await adminAPI.accounts.getById(id)
        accounts.push({ id: account.id, name: account.name })
      } catch {
        // 如果账号不存在，仍然显示 ID
        accounts.push({ id, name: `#${id}` })
      }
    }
    rules.push(createModelRoutingRule(pattern, accounts))
  }
  return rules
}

export interface UseGroupFormOptions {
  mode: GroupFormMode
  isSimpleMode: boolean
}

export function useGroupForm({ mode, isSimpleMode }: UseGroupFormOptions) {
  const [form, setFormState] = useState<GroupFormState>(() => createGroupFormDefaults(mode))
  const [allowlist, setAllowlist] = useState<ModelAllowlistState>(() => createModelAllowlistState())
  const [allowlistLoading, setAllowlistLoading] = useState(false)
  const [allowlistCustomEntry, setAllowlistCustomEntry] = useState('')
  const [allowlistCustomErrorKey, setAllowlistCustomErrorKey] = useState<string | null>(null)
  const [routingRules, setRoutingRules] = useState<ModelRoutingRule[]>([])
  // 固定账号获取 Codex Model Manifest（仅 openai 分组编辑表单）
  const [codexManifest, setCodexManifest] = useState<CodexModelsManifestConfig>(createCodexManifestDefaults)
  const [codexManifestAccountNames, setCodexManifestAccountNames] = useState<Record<number, string>>({})
  const reasoningRef = useRef<ReasoningEffortPolicyFieldsHandle | null>(null)
  const codexRef = useRef<CodexManifestAccountsFieldHandle | null>(null)
  const [tracker] = useState(createModelAllowlistCandidatesTracker)
  // 子组件句柄通过回调 ref 绑定（ctl 只暴露函数，不直接暴露 ref 对象）
  const bindReasoning = useCallback((handle: ReasoningEffortPolicyFieldsHandle | null) => {
    reasoningRef.current = handle
  }, [])
  const bindCodex = useCallback((handle: CodexManifestAccountsFieldHandle | null) => {
    codexRef.current = handle
  }, [])

  // 提交与回显在异步流程中读取最新状态
  const live = useRef({ form, allowlist, routingRules, codexManifest })
  useEffect(() => {
    live.current = { form, allowlist, routingRules, codexManifest }
  })

  const setForm = (next: GroupFormState) => {
    live.current.form = next
    setFormState(next)
  }

  /** 字段更新，并补跑 Vue 版对 subscription_type 与生图开关的 watch */
  const update = (patch: Partial<GroupFormState>) => {
    const prev = live.current.form
    let next: GroupFormState = { ...prev, ...patch }
    if (patch.subscription_type !== undefined && patch.subscription_type !== prev.subscription_type) {
      next = applySubscriptionTypeChange(next, mode)
    }
    if (
      (patch.allow_image_generation !== undefined && patch.allow_image_generation !== prev.allow_image_generation) ||
      (patch.allow_batch_image_generation !== undefined &&
        patch.allow_batch_image_generation !== prev.allow_batch_image_generation)
    ) {
      next = withBatchImagePricingReset(next)
    }
    setForm(next)
  }

  const updateAllowlist = (mutate: (state: ModelAllowlistState) => void) => {
    const next = cloneAllowlist(live.current.allowlist)
    mutate(next)
    live.current.allowlist = next
    setAllowlist(next)
  }

  const resetAllowlist = (config?: Partial<ModelAllowlistConfig> | null) => {
    const next = createModelAllowlistState(config)
    live.current.allowlist = next
    setAllowlist(next)
  }

  const submitAllowlistCustomEntry = () => {
    let error: ReturnType<typeof addCustomModelAllowlistItem> = null
    updateAllowlist((state) => {
      error = addCustomModelAllowlistItem(state, allowlistCustomEntry)
    })
    if (error === null) {
      setAllowlistCustomEntry('')
      setAllowlistCustomErrorKey(null)
    } else {
      setAllowlistCustomErrorKey(`admin.groups.modelAllowlist.errors.${error}`)
    }
  }

  const loadAllowlistCandidates = async (groupID: number, platform: GroupPlatform) => {
    if (isSimpleMode) return
    const request = { mode, groupID, platform }
    const requestID = tracker.next(request)
    setAllowlistLoading(true)
    try {
      const models = await adminAPI.groups.getModelAllowlistCandidates(groupID, platform)
      if (!tracker.isCurrent(requestID, request)) {
        return
      }
      updateAllowlist((state) => setModelAllowlistCandidates(state, models))
    } catch (error) {
      if (!tracker.isCurrent(requestID, request)) {
        return
      }
      console.error('Error loading group models list candidates:', error)
    } finally {
      if (tracker.isCurrent(requestID, request)) {
        setAllowlistLoading(false)
      }
    }
  }

  const setRules = (rules: ModelRoutingRule[]) => {
    live.current.routingRules = rules
    setRoutingRules(rules)
  }

  const updateCodexManifest = (config: CodexModelsManifestConfig) => {
    live.current.codexManifest = config
    setCodexManifest(config)
  }

  /** 创建表单关闭后的重置（Vue 版 closeCreateModal；与 Vue 版一样保留 model_routing_enabled） */
  const resetCreate = () => {
    const prev = live.current.form
    setForm({ ...createGroupFormDefaults('create'), model_routing_enabled: prev.model_routing_enabled })
    reasoningRef.current?.resetValidation()
    resetAllowlist()
    setRules([])
  }

  /** 编辑：按分组回显（Vue 版 handleEdit），模型路由的账号名称加载完成后才返回 */
  const hydrate = async (group: AdminGroup) => {
    const prev = live.current.form
    const next = applyEditHydrationWatchers(prev, groupFormFromGroup(group))
    setForm(next)
    if (prev.platform !== next.platform) {
      reasoningRef.current?.resetValidation()
    }
    resetAllowlist(group.model_allowlist)
    // 固定账号 manifest 配置：回显配置并异步解析已存账号名称（失败显示 #<id>）
    const saved = group.codex_models_manifest_config ?? createCodexManifestDefaults()
    const config: CodexModelsManifestConfig = {
      enabled: saved.enabled ?? false,
      account_ids: [...(saved.account_ids ?? [])],
      fallback_to_scheduler: saved.fallback_to_scheduler ?? false
    }
    updateCodexManifest(config)
    setCodexManifestAccountNames({})
    for (const id of config.account_ids) {
      adminAPI.accounts
        .getById(id)
        .then((account) => {
          setCodexManifestAccountNames((names) => ({ ...names, [id]: account.name }))
        })
        .catch(() => {
          // 无法解析名称时由组件回退展示 #<id>，提示管理员清理脏 ID。
        })
    }
    // 加载模型路由规则（异步加载账号名称）
    setRules(await convertApiFormatToRoutingRules(group.model_routing))
    void loadAllowlistCandidates(group.id, group.platform)
  }

  /** 编辑表单关闭后的清理（Vue 版 closeEditModal） */
  const clearEdit = () => {
    const prev = live.current.form
    const dispatchDefaults = createDefaultMessagesDispatchFormState()
    setForm({
      ...prev,
      max_reasoning_effort: '',
      max_reasoning_effort_over_limit: reasoningEffortOverLimitDowngrade,
      reasoning_effort_mappings: [],
      copy_accounts_from_group_ids: [],
      peak_rate_enabled: false,
      peak_start: '',
      peak_end: '',
      peak_rate_multiplier: 1.0,
      profit_control_enabled: false,
      profit_min_margin_percent: 0,
      profit_safety_buffer_percent: 0,
      video_rate_independent: false,
      video_rate_multiplier: 1,
      video_price_480p: null,
      video_price_720p: null,
      video_price_1080p: null,
      video_model_prices: createVideoModelPricesForm(),
      long_context_pricing_enabled: true,
      force_openai_fast: false,
      free_openai_fast: false,
      model_pricing: [],
      web_search_price_per_call: null,
      search_price_per_1k: null,
      audio_realtime_price_per_min: null,
      audio_tts_price_per_million_chars: null,
      audio_stt_price_per_hour: null,
      allow_messages_dispatch: dispatchDefaults.allow_messages_dispatch,
      opus_mapped_model: dispatchDefaults.opus_mapped_model,
      sonnet_mapped_model: dispatchDefaults.sonnet_mapped_model,
      haiku_mapped_model: dispatchDefaults.haiku_mapped_model,
      exact_model_mappings: [],
      allow_live: false
    })
    reasoningRef.current?.resetValidation()
    setRules([])
    resetAllowlist()
    updateCodexManifest(createCodexManifestDefaults())
    setCodexManifestAccountNames({})
    codexRef.current?.resetValidation?.()
  }

  return {
    mode,
    form,
    update,
    /** 最新状态（事件处理与异步流程中读取，避免闭包拿到旧值） */
    getLatest: () => live.current,
    allowlist,
    allowlistLoading,
    updateAllowlist,
    allowlistCustomEntry,
    setAllowlistCustomEntry,
    allowlistCustomErrorKey,
    submitAllowlistCustomEntry,
    loadAllowlistCandidates,
    routingRules,
    setRoutingRules: setRules,
    codexManifest,
    setCodexManifest: updateCodexManifest,
    codexManifestAccountNames,
    bindReasoning,
    bindCodex,
    getReasoning: () => reasoningRef.current,
    getCodex: () => codexRef.current,
    resetCreate,
    hydrate,
    clearEdit
  }
}

export type GroupFormController = ReturnType<typeof useGroupForm>
