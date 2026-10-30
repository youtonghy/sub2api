/**
 * 渠道监控创建 / 编辑表单，对应 Vue 版 MonitorFormDialog.vue，改为右侧抽屉（长表单）。
 * - 检测模式：probe（探活）/ quota（仅配额）/ quota_probe（探活+配额）；antigravity 只支持配额
 * - 配额模式需关联账号（服务端搜索、已绑定账号回填为固定选项）
 * - 探活模式需 endpoint / API Key / 主模型；高级设置可套用请求模板并自定义 headers / body
 * Vue 版里 provider / api_mode 的 sync watcher 在 React 版改为在对应的修改入口里直接执行，
 * 加载监控、重置表单与应用模板时不触发这些清理（对应 suppressFormWatchers）。
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { adminAPI } from '@/api/admin'
import type {
  APIMode,
  BodyOverrideMode,
  ChannelMonitor,
  CheckMode,
  CreateParams,
  Provider,
  UpdateParams
} from '@/api/admin/channelMonitor'
import type { ChannelMonitorTemplate } from '@/api/admin/channelMonitorTemplate'
import { userGroupsAPI } from '@/api/groups'
import { keysAPI } from '@/api/keys'
import { AccountFormDrawer, FormField, FormSection, ToggleRow } from '@/components/account/AccountFormLayout'
import ModelTagInput from '@/components/admin/channel/ModelTagInput'
import { platformTone } from '@/components/admin/channel/platformTone'
import { Button } from '@/components/arc/button/button'
import arcInput from '@/components/arc/input/input.module.css'
import PlatformIcon from '@/components/common/PlatformIcon'
import Select from '@/components/common/Select'
import {
  API_MODE_CHAT_COMPLETIONS,
  API_MODE_RESPONSES,
  CHECK_MODE_PROBE,
  CHECK_MODE_QUOTA,
  CHECK_MODE_QUOTA_PROBE,
  DEFAULT_DEEPSEEK_ENDPOINT,
  DEFAULT_GROK_ENDPOINT,
  DEFAULT_GROK_MODEL,
  DEFAULT_INTERVAL_SECONDS,
  DEFAULT_KIMI_ENDPOINT,
  DEFAULT_MINIMAX_ENDPOINT,
  DEFAULT_OPENCODE_GO_ENDPOINT,
  DEFAULT_ZHIPU_ENDPOINT,
  PROVIDER_ANTHROPIC,
  PROVIDER_ANTIGRAVITY,
  PROVIDER_DEEPSEEK,
  PROVIDER_GEMINI,
  PROVIDER_GROK,
  PROVIDER_KIMI,
  PROVIDER_MINIMAX,
  PROVIDER_OPENAI,
  PROVIDER_OPENCODE_GO,
  PROVIDER_ZHIPU
} from '@/constants/channelMonitor'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { ApiKey, GroupPlatform } from '@/types'
import { extractApiErrorMessage } from '@/utils/apiError'
import MonitorAdvancedRequestConfig from './MonitorAdvancedRequestConfig'
import MonitorKeyPickerDialog from './MonitorKeyPickerDialog'
import monitor from './monitor.module.css'
import styles from './MonitorFormDialog.module.css'

export interface MonitorFormDialogProps {
  show: boolean
  monitor: ChannelMonitor | null
  onClose?: () => void
  onSaved?: () => void
}

interface MonitorForm {
  name: string
  provider: Provider
  api_mode: APIMode
  check_mode: CheckMode
  account_id: number | null
  endpoint: string
  api_key: string
  primary_model: string
  extra_models: string[]
  group_name: string
  interval_seconds: number
  jitter_seconds: number
  enabled: boolean
  // 高级设置快照
  template_id: number | null
  extra_headers: Record<string, string>
  body_override_mode: BodyOverrideMode
  body_override: Record<string, unknown> | null
}

interface LinkedAccount {
  id: number
  name: string
}

// 国产 provider 预填的官方 endpoint（仅探活侧；配额模式 endpoint 可留空）。
const PROVIDER_DEFAULT_ENDPOINTS: Partial<Record<Provider, string>> = {
  [PROVIDER_KIMI]: DEFAULT_KIMI_ENDPOINT,
  [PROVIDER_ZHIPU]: DEFAULT_ZHIPU_ENDPOINT,
  [PROVIDER_DEEPSEEK]: DEFAULT_DEEPSEEK_ENDPOINT,
  [PROVIDER_MINIMAX]: DEFAULT_MINIMAX_ENDPOINT,
  [PROVIDER_OPENCODE_GO]: DEFAULT_OPENCODE_GO_ENDPOINT
}

function normalizeAPIMode(mode: APIMode | undefined | null): APIMode {
  return mode === API_MODE_RESPONSES ? API_MODE_RESPONSES : API_MODE_CHAT_COMPLETIONS
}

function emptyForm(interval: number): MonitorForm {
  return {
    name: '',
    provider: PROVIDER_ANTHROPIC,
    api_mode: API_MODE_CHAT_COMPLETIONS,
    check_mode: CHECK_MODE_PROBE,
    account_id: null,
    endpoint: '',
    api_key: '',
    primary_model: '',
    extra_models: [],
    group_name: '',
    interval_seconds: interval,
    jitter_seconds: 0,
    enabled: true,
    template_id: null,
    extra_headers: {},
    body_override_mode: 'off',
    body_override: null
  }
}

function formFromMonitor(m: ChannelMonitor, interval: number): MonitorForm {
  return {
    name: m.name,
    provider: m.provider,
    api_mode: normalizeAPIMode(m.api_mode),
    check_mode: m.check_mode || CHECK_MODE_PROBE,
    account_id: m.account_id ?? null,
    endpoint: m.endpoint,
    api_key: '',
    primary_model: m.primary_model,
    extra_models: [...(m.extra_models || [])],
    group_name: m.group_name || '',
    interval_seconds: m.interval_seconds || interval,
    jitter_seconds: m.jitter_seconds || 0,
    enabled: m.enabled,
    template_id: m.template_id ?? null,
    extra_headers: { ...(m.extra_headers || {}) },
    body_override_mode: m.body_override_mode || 'off',
    body_override: m.body_override ? { ...m.body_override } : null
  }
}

/** 清空请求快照（模板有 provider / api mode 归属，跨平台不通用） */
const clearRequestSnapshot = (form: MonitorForm): MonitorForm => ({
  ...form,
  template_id: null,
  extra_headers: {},
  body_override_mode: 'off',
  body_override: null
})

export default function MonitorFormDialog({ show, monitor: monitorProp, onClose, onSaved }: MonitorFormDialogProps) {
  const { t } = useI18n()
  // System-configured default interval for new monitors. Falls back to the static
  // constant when public settings haven't loaded yet or store the legacy 0 value.
  const configuredInterval = useAppStore((s) => s.cachedPublicSettings?.channel_monitor_default_interval_seconds)
  const systemDefaultInterval = configuredInterval && configuredInterval > 0 ? configuredInterval : DEFAULT_INTERVAL_SECONDS

  // editing is true when we have an existing monitor
  const editing = monitorProp

  const [form, setForm] = useState<MonitorForm>(() => (monitorProp ? formFromMonitor(monitorProp, systemDefaultInterval) : emptyForm(systemDefaultInterval)))
  const formRef = useRef(form)
  useEffect(() => {
    formRef.current = form
  }, [form])
  const patchForm = (patch: Partial<MonitorForm>) => setForm((prev) => ({ ...prev, ...patch }))

  const [submitting, setSubmitting] = useState(false)

  // API key picker
  const [showKeyPicker, setShowKeyPicker] = useState(false)
  const [myKeysLoading, setMyKeysLoading] = useState(false)
  const [myActiveKeys, setMyActiveKeys] = useState<ApiKey[]>([])
  const [userGroupRates, setUserGroupRates] = useState<Record<number, number>>({})

  // 可用模板列表（进入 dialog 时一次性拉取 cache；按 provider / api mode 过滤）。
  const [templatesCache, setTemplatesCache] = useState<ChannelMonitorTemplate[]>([])
  const templatesLoaded = useRef(false)

  // --- 关联账号选择器 ---
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  // 当前搜索词（用于空态文案区分「平台无账号」与「搜索无命中」）。
  const [accountSearchQuery, setAccountSearchQuery] = useState('')
  // 已绑定账号回填失败（getById 失败或平台失配）时提示用户重新选择。
  const [accountHydrationFailed, setAccountHydrationFailed] = useState(false)
  // 固定选项：已绑定/已选中但不在当前结果页里的账号，保证搜索后 label 仍可见。
  const [pinnedAccount, setPinnedAccount] = useState<LinkedAccount | null>(null)
  const pinnedRef = useRef(pinnedAccount)
  useEffect(() => {
    pinnedRef.current = pinnedAccount
  }, [pinnedAccount])
  const accountSearchSeq = useRef(0)
  const accountSearchAbort = useRef<AbortController | null>(null)
  const hydrationAttempted = useRef(new Set<number>())

  // quota / quota_probe 需要关联账号；probe / quota_probe 需要探活字段。
  const usesQuotaMode = form.check_mode !== CHECK_MODE_PROBE
  const usesProbePart = form.check_mode !== CHECK_MODE_QUOTA

  // jitter 上限与后端校验一致：interval - jitter 不得低于最小检测间隔 15 秒。
  const maxJitterSeconds = Math.max(0, (form.interval_seconds || 0) - 15)

  // Re-sync form whenever the dialog is opened or the target monitor changes.
  const [lastSync, setLastSync] = useState({ show, monitor: monitorProp })
  if (lastSync.show !== show || lastSync.monitor !== monitorProp) {
    setLastSync({ show, monitor: monitorProp })
    if (show) setForm(monitorProp ? formFromMonitor(monitorProp, systemDefaultInterval) : emptyForm(systemDefaultInterval))
  }

  // 同时拉取模板列表（cache 过的话一次性返回）。
  useEffect(() => {
    if (!show || templatesLoaded.current) return
    let cancelled = false
    const loadTemplates = async () => {
      try {
        const { items } = await adminAPI.channelMonitorTemplate.list()
        if (cancelled) return
        templatesLoaded.current = items.length > 0
        setTemplatesCache(items)
      } catch (err: unknown) {
        // 模板拉取失败不阻塞监控表单，用户可以不选模板
        console.warn('load monitor templates failed', err)
      }
    }
    void loadTemplates()
    return () => {
      cancelled = true
    }
  }, [show])

  // 编辑已有 quota 监控时，已绑定账号可能不在搜索结果第一页：用 getById
  // 回填为固定选项，绑定不因分页截断而丢失。仅当账号确实无法加载或平台
  // 失配时才清空绑定（带可见提示），否则绑定只在用户显式切换 provider 时清空。
  const ensureSelectedAccountHydrated = async (accounts: LinkedAccount[]) => {
    const current = formRef.current
    const id = current.account_id
    if (id == null || current.check_mode === CHECK_MODE_PROBE) return
    if (accounts.some((a) => a.id === id) || pinnedRef.current?.id === id) return
    if (hydrationAttempted.current.has(id)) return
    hydrationAttempted.current.add(id)
    try {
      const account = await adminAPI.accounts.getById(id)
      if (formRef.current.account_id !== id) return
      if (String(account.platform) !== formRef.current.provider) {
        setForm((prev) => ({ ...prev, account_id: null }))
        formRef.current = { ...formRef.current, account_id: null }
        setPinnedAccount(null)
        setAccountHydrationFailed(true)
        return
      }
      setPinnedAccount({ id: account.id, name: account.name })
    } catch {
      if (formRef.current.account_id === id) {
        setForm((prev) => ({ ...prev, account_id: null }))
        formRef.current = { ...formRef.current, account_id: null }
        setPinnedAccount(null)
        setAccountHydrationFailed(true)
      }
    }
  }

  // 服务端搜索当前 provider 平台的账号（支持关键字，避免大分页截断取不齐）。
  // seq + abort 防止快速切换 provider / 连续输入时乱序响应覆盖新结果。
  // 失败不阻塞表单：下拉为空 + 空态提示。
  const loadLinkedAccounts = async (search = '') => {
    const current = formRef.current
    if (current.check_mode === CHECK_MODE_PROBE) return
    setAccountSearchQuery(search)
    const seq = ++accountSearchSeq.current
    accountSearchAbort.current?.abort()
    const controller = new AbortController()
    accountSearchAbort.current = controller
    setAccountsLoading(true)
    try {
      const res = await adminAPI.accounts.list(
        1,
        50,
        { platform: current.provider, ...(search ? { search } : {}) },
        { signal: controller.signal }
      )
      if (seq !== accountSearchSeq.current) return
      const accounts = (res.items || []).map((a) => ({ id: a.id, name: a.name }))
      setLinkedAccounts(accounts)
      await ensureSelectedAccountHydrated(accounts)
    } catch (err: unknown) {
      if (controller.signal.aborted) return
      console.warn('load linked accounts failed', err)
      if (!search) setLinkedAccounts([])
    } finally {
      if (seq === accountSearchSeq.current) setAccountsLoading(false)
    }
  }

  const prevAccountWatch = useRef<{ show: boolean; provider: Provider } | null>(null)
  useEffect(() => {
    const prev = prevAccountWatch.current
    prevAccountWatch.current = { show, provider: form.provider }
    if (!show) {
      accountSearchAbort.current?.abort()
      return
    }
    // 弹窗重开 / provider 真正变化时重置回填状态（check_mode 变化不重置，
    // 避免 probe↔quota 切换时无谓地重拉列表）。
    if (!prev || show !== prev.show || form.provider !== prev.provider) {
      hydrationAttempted.current.clear()
      setAccountHydrationFailed(false)
      setPinnedAccount(null)
      pinnedRef.current = null
    }
    void loadLinkedAccounts()
  }, [show, form.provider, form.check_mode]) // eslint-disable-line react-hooks/exhaustive-deps -- 对应 Vue 版 watch([show, provider, check_mode])

  useEffect(() => () => accountSearchAbort.current?.abort(), [])

  const accountOptions = linkedAccounts.map((a) => ({ value: String(a.id), label: `${a.name} (#${a.id})` }))
  if (pinnedAccount && !linkedAccounts.some((a) => a.id === pinnedAccount.id)) {
    accountOptions.unshift({ value: String(pinnedAccount.id), label: `${pinnedAccount.name} (#${pinnedAccount.id})` })
  }

  // Select 组件绑定 string，与 number | null 互转。
  const setAccountSelectValue = (raw: string) => {
    if (raw === '') {
      patchForm({ account_id: null })
      setPinnedAccount(null)
      setAccountHydrationFailed(false)
      return
    }
    const id = Number(raw)
    if (Number.isFinite(id)) {
      patchForm({ account_id: id })
      setPinnedAccount((prev) => linkedAccounts.find((a) => a.id === id) ?? prev)
    }
  }

  // --- templates ---
  const templateOptions = [
    { value: '', label: t('admin.channelMonitor.templateField.none') },
    ...templatesCache
      .filter((tpl) => {
        if (tpl.provider !== form.provider) return false
        if (form.provider !== PROVIDER_OPENAI) return true
        return normalizeAPIMode(tpl.api_mode) === form.api_mode
      })
      .map((tpl) => ({ value: String(tpl.id), label: templateOptionLabel(tpl) }))
  ]

  function templateOptionLabel(tpl: ChannelMonitorTemplate): string {
    if (tpl.provider !== PROVIDER_OPENAI) return tpl.name
    const labelKey =
      normalizeAPIMode(tpl.api_mode) === API_MODE_RESPONSES
        ? 'admin.channelMonitor.form.apiModeResponses'
        : 'admin.channelMonitor.form.apiModeChatCompletions'
    return `${tpl.name} · ${t(labelKey)}`
  }

  // 模板下拉绑定：value 是 string（Select 组件约束），需要与 number | null 互转。
  // 应用模板 = 拷贝快照（不触发 provider / api_mode 的清理逻辑）
  const setTemplateSelectValue = (raw: string) => {
    if (raw === '') {
      patchForm({ template_id: null })
      return
    }
    const id = Number(raw)
    if (!Number.isFinite(id)) return
    const tpl = templatesCache.find((item) => item.id === id)
    if (!tpl) {
      patchForm({ template_id: id })
      return
    }
    patchForm({
      api_mode: normalizeAPIMode(tpl.api_mode),
      template_id: id,
      extra_headers: { ...(tpl.extra_headers || {}) },
      body_override_mode: tpl.body_override_mode,
      body_override: tpl.body_override ? { ...tpl.body_override } : null
    })
  }

  // OpenAI 下切换 API 模式时清空请求快照（Vue 版 api_mode watcher）
  const setApiMode = (mode: APIMode) =>
    setForm((prev) => {
      if (prev.api_mode === mode) return prev
      const next = { ...prev, api_mode: mode }
      return prev.provider === PROVIDER_OPENAI ? clearRequestSnapshot(next) : next
    })

  const apiModeOptions: { value: APIMode; label: string; hint: string }[] = [
    {
      value: API_MODE_CHAT_COMPLETIONS,
      label: t('admin.channelMonitor.form.apiModeChatCompletions'),
      hint: t('admin.channelMonitor.form.apiModeChatCompletionsHint')
    },
    {
      value: API_MODE_RESPONSES,
      label: t('admin.channelMonitor.form.apiModeResponses'),
      hint: t('admin.channelMonitor.form.apiModeResponsesHint')
    }
  ]

  const providerOptions: { value: Provider; label: string }[] = [
    { value: PROVIDER_ANTHROPIC, label: t('monitorCommon.providers.anthropic') },
    { value: PROVIDER_OPENAI, label: t('monitorCommon.providers.openai') },
    { value: PROVIDER_GEMINI, label: t('monitorCommon.providers.gemini') },
    { value: PROVIDER_GROK, label: t('monitorCommon.providers.grok') },
    { value: PROVIDER_ANTIGRAVITY, label: t('monitorCommon.providers.antigravity') },
    { value: PROVIDER_KIMI, label: t('monitorCommon.providers.kimi') },
    { value: PROVIDER_ZHIPU, label: t('monitorCommon.providers.zhipu') },
    { value: PROVIDER_DEEPSEEK, label: t('monitorCommon.providers.deepseek') },
    { value: PROVIDER_MINIMAX, label: t('monitorCommon.providers.minimax') },
    { value: PROVIDER_OPENCODE_GO, label: t('monitorCommon.providers.opencode_go') }
  ]

  const checkModeOptions: { value: CheckMode; label: string; hint: string; disabled: boolean }[] = [
    {
      value: CHECK_MODE_PROBE,
      label: t('admin.channelMonitor.form.checkModeProbe'),
      hint: t('admin.channelMonitor.form.checkModeProbeHint'),
      // antigravity 无探活 adapter，仅配额模式。
      disabled: form.provider === PROVIDER_ANTIGRAVITY
    },
    {
      value: CHECK_MODE_QUOTA,
      label: t('admin.channelMonitor.form.checkModeQuota'),
      hint: t('admin.channelMonitor.form.checkModeQuotaHint'),
      disabled: false
    },
    {
      value: CHECK_MODE_QUOTA_PROBE,
      label: t('admin.channelMonitor.form.checkModeQuotaProbe'),
      hint: t('admin.channelMonitor.form.checkModeQuotaProbeHint'),
      // antigravity 无探活 adapter，只支持配额模式。
      disabled: form.provider === PROVIDER_ANTIGRAVITY
    }
  ]

  const selectCheckMode = (mode: CheckMode) => {
    if (checkModeOptions.find((opt) => opt.value === mode)?.disabled) return
    setForm((prev) => ({ ...prev, check_mode: mode, account_id: mode === CHECK_MODE_PROBE ? null : prev.account_id }))
  }

  const selectProvider = (provider: Provider) => {
    if (form.provider === provider) return
    setForm((prev) => {
      const previousProvider = prev.provider
      const clearGrokEndpoint = previousProvider === PROVIDER_GROK && prev.endpoint === DEFAULT_GROK_ENDPOINT
      const clearGrokModel = previousProvider === PROVIDER_GROK && prev.primary_model === DEFAULT_GROK_MODEL
      const prevDefault = PROVIDER_DEFAULT_ENDPOINTS[previousProvider]
      const clearPrevDefaultEndpoint = !!prevDefault && prev.endpoint === prevDefault
      // Clear api_key whenever provider changes to avoid cross-provider key mismatch.
      // 同时清空 template_id（模板有 provider 归属，跨平台不通用）。
      let next: MonitorForm = clearRequestSnapshot({
        ...prev,
        provider,
        api_key: '',
        api_mode: provider !== PROVIDER_OPENAI ? API_MODE_CHAT_COMPLETIONS : prev.api_mode,
        // 关联账号与平台绑定：切换 provider 时显式清空（这是唯一主动清空的入口）。
        account_id: null
      })
      // antigravity 仅配额模式：切到它时强制 quota（checkModeOptions 同步禁用其余项）。
      if (provider === PROVIDER_ANTIGRAVITY && next.check_mode !== CHECK_MODE_QUOTA) {
        next.check_mode = CHECK_MODE_QUOTA
      }
      // 对称还原：从 antigravity 切走时撤掉强制 quota，否则编辑存量 antigravity
      // 监控换平台后仍停留在 quota（目标平台未必支持），update 会携带残留配置。
      // 同步清掉 quota 占位模型（loadFromMonitor 回填的 'quota'），否则切回
      // probe 后拿 'quota' 当探活模型（与离开 grok 清 DEFAULT_GROK_MODEL 同理）。
      if (previousProvider === PROVIDER_ANTIGRAVITY && next.check_mode === CHECK_MODE_QUOTA) {
        next.check_mode = CHECK_MODE_PROBE
        if (next.primary_model.trim() === 'quota') next.primary_model = ''
      }
      if (provider === PROVIDER_GROK) {
        if (!next.endpoint.trim()) next.endpoint = DEFAULT_GROK_ENDPOINT
        if (!next.primary_model.trim()) next.primary_model = DEFAULT_GROK_MODEL
        return next
      }
      if (clearGrokEndpoint || clearPrevDefaultEndpoint) next = { ...next, endpoint: '' }
      if (clearGrokModel) next = { ...next, primary_model: '' }
      const defaultEndpoint = PROVIDER_DEFAULT_ENDPOINTS[provider]
      if (defaultEndpoint && !next.endpoint.trim()) next = { ...next, endpoint: defaultEndpoint }
      return next
    })
    setPinnedAccount(null)
    pinnedRef.current = null
    setAccountHydrationFailed(false)
  }

  const openMyKeyPicker = async () => {
    setShowKeyPicker(true)
    if (myActiveKeys.length > 0) return
    setMyKeysLoading(true)
    try {
      const [res, rates] = await Promise.all([keysAPI.list(1, 100, { status: 'active' }), userGroupsAPI.getUserGroupRates()])
      const items = res.items || []
      const now = Date.now()
      setMyActiveKeys(
        items.filter((k) => {
          if (k.status !== 'active') return false
          if (!k.expires_at) return true
          return new Date(k.expires_at).getTime() > now
        })
      )
      setUserGroupRates(rates)
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('admin.channelMonitor.form.noActiveKey')))
    } finally {
      setMyKeysLoading(false)
    }
  }

  const buildPayload = (current: MonitorForm): CreateParams => {
    const quota = current.check_mode !== CHECK_MODE_PROBE
    const probe = current.check_mode !== CHECK_MODE_QUOTA
    return {
      name: current.name.trim(),
      provider: current.provider,
      api_mode: current.provider === PROVIDER_OPENAI ? current.api_mode : API_MODE_CHAT_COMPLETIONS,
      check_mode: current.check_mode,
      account_id: quota ? current.account_id : null,
      endpoint: probe ? current.endpoint.trim() : '',
      api_key: probe ? current.api_key.trim() : '',
      primary_model: probe ? current.primary_model.trim() : 'quota',
      extra_models: probe ? current.extra_models : [],
      group_name: current.group_name.trim(),
      enabled: current.enabled,
      interval_seconds: current.interval_seconds,
      jitter_seconds: current.jitter_seconds || 0,
      template_id: probe ? current.template_id : null,
      extra_headers: current.extra_headers,
      body_override_mode: current.body_override_mode,
      body_override: current.body_override
    }
  }

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (submitting) return
    const current = formRef.current
    const quota = current.check_mode !== CHECK_MODE_PROBE
    const probe = current.check_mode !== CHECK_MODE_QUOTA
    if (!current.name.trim()) {
      useAppStore.getState().showError(t('admin.channelMonitor.nameRequired'))
      return
    }
    if (quota && current.account_id == null) {
      useAppStore.getState().showError(t('admin.channelMonitor.linkedAccountRequired'))
      return
    }
    if (probe && !current.primary_model.trim()) {
      useAppStore.getState().showError(t('admin.channelMonitor.primaryModelRequired'))
      return
    }

    setSubmitting(true)
    try {
      if (editing) {
        const { api_key, ...rest } = buildPayload(current)
        const req: UpdateParams = { ...rest }
        // Only send api_key if user typed a new value
        if (api_key) req.api_key = api_key
        // template_id=null 用 clear_template=true 明确告诉后端清空（pointer 语义）
        if (probe && current.template_id == null) {
          req.clear_template = true
          delete req.template_id
        }
        // account_id 同理：probe 模式不带账号，update 发 0 显式解绑存量关联
        // （后端 0=清空、null=不动）。仅 update——create 发 0 会落 &0 触发 FK 违约。
        if (!quota) req.account_id = 0
        await adminAPI.channelMonitor.update(editing.id, req)
        useAppStore.getState().showSuccess(t('admin.channelMonitor.updateSuccess'))
      } else {
        await adminAPI.channelMonitor.create(buildPayload(current))
        useAppStore.getState().showSuccess(t('admin.channelMonitor.createSuccess'))
      }
      onSaved?.()
      onClose?.()
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass = arcInput.input
  const numberValue = (value: number) => (Number.isFinite(value) ? String(value) : '')
  const toNumber = (raw: string) => (raw === '' ? ('' as unknown as number) : Number(raw))

  return (
    <>
      <AccountFormDrawer
        show={show}
        title={editing ? t('admin.channelMonitor.editTitle') : t('admin.channelMonitor.createTitle')}
        width="wide"
        onClose={() => onClose?.()}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => onClose?.()}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="channel-monitor-form" variant="primary" disabled={submitting}>
              {submitting ? t('common.submitting') : editing ? t('common.update') : t('common.create')}
            </Button>
          </>
        }
      >
        <form id="channel-monitor-form" className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
          <FormSection>
            <FormField label={t('admin.channelMonitor.form.name')} required htmlFor="monitor-name">
              <input
                id="monitor-name"
                type="text"
                required
                className={inputClass}
                value={form.name}
                placeholder={t('admin.channelMonitor.form.namePlaceholder')}
                onChange={(event) => patchForm({ name: event.target.value })}
              />
            </FormField>

            {/* 检测模式：probe（探活）/ quota（仅配额）/ quota_probe（探活+配额） */}
            <FormField label={t('admin.channelMonitor.form.checkMode')}>
              <div className={monitor.choiceGrid} data-cols="3" data-testid="monitor-check-mode">
                {checkModeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    data-testid={`monitor-check-mode-${opt.value}`}
                    aria-pressed={form.check_mode === opt.value}
                    disabled={opt.disabled}
                    className={monitor.choice}
                    onClick={() => selectCheckMode(opt.value)}
                  >
                    <span className={monitor.choiceTitle}>{opt.label}</span>
                    <span className={monitor.choiceHint}>{opt.hint}</span>
                  </button>
                ))}
              </div>
            </FormField>

            <FormField label={t('admin.channelMonitor.form.provider')} required>
              <div className={monitor.providerGrid} data-testid="monitor-provider-grid">
                {providerOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    data-testid={`monitor-provider-${opt.value}`}
                    aria-pressed={form.provider === opt.value}
                    {...platformTone(opt.value, form.provider === opt.value ? ['text', 'selected'] : [], monitor.provider)}
                    onClick={() => selectProvider(opt.value)}
                  >
                    <PlatformIcon platform={opt.value as GroupPlatform} size="lg" />
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </FormField>

            {/* 配额模式数据源：关联账号（复用账号侧用量/余额服务） */}
            {usesQuotaMode ? (
              <FormField label={t('admin.channelMonitor.form.linkedAccount')} required>
                <div data-testid="monitor-linked-account">
                  <Select
                    value={form.account_id == null ? '' : String(form.account_id)}
                    options={accountOptions}
                    placeholder={t('admin.channelMonitor.form.linkedAccountPlaceholder')}
                    aria-label={t('admin.channelMonitor.form.linkedAccount')}
                    remote
                    loading={accountsLoading}
                    onSearch={(query) => void loadLinkedAccounts(query)}
                    onChange={(value) => setAccountSelectValue(value == null ? '' : String(value))}
                  />
                </div>
                <p className={monitor.mutedHint}>{t('admin.channelMonitor.form.linkedAccountHint')}</p>
                {form.provider === PROVIDER_OPENAI ? (
                  <p className={monitor.warningHint}>{t('admin.channelMonitor.form.openAIQuotaProbeHint')}</p>
                ) : null}
                {accountHydrationFailed ? <p className={monitor.warningHint}>{t('admin.channelMonitor.form.linkedAccountMissing')}</p> : null}
                {accountOptions.length === 0 && !accountsLoading && !accountSearchQuery ? (
                  <p className={monitor.warningHint}>{t('admin.channelMonitor.form.linkedAccountEmpty')}</p>
                ) : null}
              </FormField>
            ) : null}

            {form.provider === PROVIDER_OPENAI && usesProbePart ? (
              <div className={monitor.inset}>
                <FormField label={t('admin.channelMonitor.form.apiMode')}>
                  <div className={monitor.choiceGrid} data-cols="2">
                    {apiModeOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={form.api_mode === opt.value}
                        className={monitor.choice}
                        onClick={() => setApiMode(opt.value)}
                      >
                        <span className={monitor.choiceTitle}>{opt.label}</span>
                        <span className={monitor.choiceHint}>{opt.hint}</span>
                      </button>
                    ))}
                  </div>
                </FormField>
              </div>
            ) : null}

            {usesProbePart ? (
              <>
                <FormField label={t('admin.channelMonitor.form.endpoint')} required htmlFor="monitor-endpoint">
                  <div className={monitor.inline}>
                    <input
                      id="monitor-endpoint"
                      data-testid="monitor-endpoint"
                      type="text"
                      required
                      className={inputClass}
                      value={form.endpoint}
                      placeholder={t('admin.channelMonitor.form.endpointPlaceholder')}
                      onChange={(event) => patchForm({ endpoint: event.target.value })}
                    />
                    <Button type="button" variant="secondary" onClick={() => patchForm({ endpoint: window.location.origin })}>
                      {t('admin.channelMonitor.form.useCurrentDomain')}
                    </Button>
                  </div>
                </FormField>

                <FormField label={t('admin.channelMonitor.form.apiKey')} required={!editing} htmlFor="monitor-api-key">
                  <div className={monitor.inline}>
                    <input
                      id="monitor-api-key"
                      type="password"
                      required={!editing}
                      autoComplete="off"
                      className={inputClass}
                      value={form.api_key}
                      placeholder={
                        editing ? t('admin.channelMonitor.form.apiKeyEditPlaceholder') : t('admin.channelMonitor.form.apiKeyPlaceholder')
                      }
                      onChange={(event) => patchForm({ api_key: event.target.value })}
                    />
                    <Button type="button" variant="secondary" onClick={() => void openMyKeyPicker()}>
                      {t('admin.channelMonitor.form.useMyKey')}
                    </Button>
                  </div>
                  {editing && editing.api_key_masked ? <p className={monitor.mutedHint}>{editing.api_key_masked}</p> : null}
                </FormField>

                <FormField label={t('admin.channelMonitor.form.primaryModel')} required htmlFor="monitor-primary-model">
                  <input
                    id="monitor-primary-model"
                    data-testid="monitor-primary-model"
                    type="text"
                    required
                    {...platformTone(form.provider, 'text', inputClass)}
                    value={form.primary_model}
                    placeholder={t('admin.channelMonitor.form.primaryModelPlaceholder')}
                    onChange={(event) => patchForm({ primary_model: event.target.value })}
                  />
                </FormField>

                <FormField label={t('admin.channelMonitor.form.extraModels')}>
                  <ModelTagInput
                    models={form.extra_models}
                    platform={form.provider}
                    placeholder={t('admin.channelMonitor.form.extraModelsPlaceholder')}
                    onModelsChange={(models) => patchForm({ extra_models: models })}
                  />
                </FormField>
              </>
            ) : null}

            <FormField label={t('admin.channelMonitor.form.groupName')} htmlFor="monitor-group-name">
              <input
                id="monitor-group-name"
                type="text"
                className={inputClass}
                value={form.group_name}
                placeholder={t('admin.channelMonitor.form.groupNamePlaceholder')}
                onChange={(event) => patchForm({ group_name: event.target.value })}
              />
            </FormField>

            <div className={styles.grid2}>
              <FormField
                label={t('admin.channelMonitor.form.intervalSeconds')}
                required
                htmlFor="monitor-interval"
                hint={t('admin.channelMonitor.form.intervalSecondsHint')}
              >
                <input
                  id="monitor-interval"
                  type="number"
                  min="15"
                  max="3600"
                  required
                  className={inputClass}
                  value={numberValue(form.interval_seconds)}
                  onChange={(event) => patchForm({ interval_seconds: toNumber(event.target.value) })}
                />
              </FormField>

              <FormField
                label={t('admin.channelMonitor.form.jitterSeconds')}
                htmlFor="monitor-jitter"
                hint={t('admin.channelMonitor.form.jitterSecondsHint')}
              >
                <input
                  id="monitor-jitter"
                  type="number"
                  min="0"
                  max={maxJitterSeconds}
                  className={inputClass}
                  value={numberValue(form.jitter_seconds)}
                  onChange={(event) => patchForm({ jitter_seconds: toNumber(event.target.value) })}
                />
              </FormField>
            </div>

            <ToggleRow
              label={t('admin.channelMonitor.form.enabled')}
              checked={form.enabled}
              onChange={(value) => patchForm({ enabled: value })}
            />
          </FormSection>

          {/* 高级设置区：请求模板 + 自定义 headers/body（仅探活模式有意义） */}
          {usesProbePart ? (
            <details className={styles.advanced}>
              <summary className={styles.summary}>{t('admin.channelMonitor.advanced.section')}</summary>
              <p className={monitor.mutedHint}>{t('admin.channelMonitor.advanced.sectionHint')}</p>

              <div className={styles.advancedBody}>
                <FormField label={t('admin.channelMonitor.templateField.label')} hint={t('admin.channelMonitor.templateField.applyHint')}>
                  <Select
                    value={form.template_id == null ? '' : String(form.template_id)}
                    options={templateOptions}
                    placeholder={t('admin.channelMonitor.templateField.placeholder')}
                    aria-label={t('admin.channelMonitor.templateField.label')}
                    onChange={(value) => setTemplateSelectValue(value == null ? '' : String(value))}
                  />
                </FormField>

                <MonitorAdvancedRequestConfig
                  provider={form.provider}
                  apiMode={form.api_mode}
                  extraHeaders={form.extra_headers}
                  bodyOverrideMode={form.body_override_mode}
                  bodyOverride={form.body_override}
                  onExtraHeadersChange={(value) => patchForm({ extra_headers: value })}
                  onBodyOverrideModeChange={(value) => patchForm({ body_override_mode: value })}
                  onBodyOverrideChange={(value) => patchForm({ body_override: value })}
                />
              </div>
            </details>
          ) : null}
        </form>
      </AccountFormDrawer>

      <MonitorKeyPickerDialog
        show={showKeyPicker}
        loading={myKeysLoading}
        keys={myActiveKeys}
        provider={form.provider}
        userGroupRates={userGroupRates}
        onClose={() => setShowKeyPicker(false)}
        onPick={(k) => {
          patchForm({ api_key: k.key })
          setShowKeyPicker(false)
        }}
      />
    </>
  )
}
