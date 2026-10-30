/**
 * 请求模板管理，对应 Vue 版 MonitorTemplateManagerDialog.vue：按服务商分页签列出模板，新建 / 编辑 / 删除，
 * 以及把模板应用到关联监控（MonitorTemplateApplyPickerDialog）。
 * 列表请求带序号，关闭或重新打开后过期的响应与错误都被忽略。
 */
import { Plus, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import type { APIMode, BodyOverrideMode, Provider } from '@/api/admin/channelMonitor'
import type { ChannelMonitorTemplate } from '@/api/admin/channelMonitorTemplate'
import { FormField } from '@/components/account/AccountFormLayout'
import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs'
import { platformTone } from '@/components/admin/channel/platformTone'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import Input from '@/components/common/Input'
import {
  API_MODE_CHAT_COMPLETIONS,
  API_MODE_RESPONSES,
  PROVIDER_ANTHROPIC,
  PROVIDER_ANTIGRAVITY,
  PROVIDER_DEEPSEEK,
  PROVIDER_GEMINI,
  PROVIDER_GROK,
  PROVIDER_KIMI,
  PROVIDER_MINIMAX,
  PROVIDER_OPENAI,
  PROVIDER_OPENCODE_GO,
  PROVIDER_ZHIPU,
  PROVIDERS
} from '@/constants/channelMonitor'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { extractApiErrorMessage } from '@/utils/apiError'
import MonitorAdvancedRequestConfig from './MonitorAdvancedRequestConfig'
import MonitorTemplateApplyPickerDialog from './MonitorTemplateApplyPickerDialog'
import monitor from './monitor.module.css'
import styles from './MonitorTemplateManagerDialog.module.css'

export interface MonitorTemplateManagerDialogProps {
  show: boolean
  onClose?: () => void
  /** Fired when any template changed (create / update / delete / apply). */
  onUpdated?: () => void
}

// --- form state ---
interface TemplateForm {
  id: number | null
  name: string
  provider: Provider
  api_mode: APIMode
  description: string
  extra_headers: Record<string, string>
  body_override_mode: BodyOverrideMode
  body_override: Record<string, unknown> | null
}

function emptyForm(provider: Provider): TemplateForm {
  return {
    id: null,
    name: '',
    provider,
    api_mode: API_MODE_CHAT_COMPLETIONS,
    description: '',
    extra_headers: {},
    body_override_mode: 'off',
    body_override: null
  }
}

function normalizeAPIMode(mode: APIMode | undefined | null): APIMode {
  return mode === API_MODE_RESPONSES ? API_MODE_RESPONSES : API_MODE_CHAT_COMPLETIONS
}

function modeTone(mode: BodyOverrideMode): BadgeTone {
  switch (mode) {
    case 'merge':
      return 'warning'
    case 'replace':
      return 'info'
    default:
      return 'neutral'
  }
}

export default function MonitorTemplateManagerDialog({ show, onClose, onUpdated }: MonitorTemplateManagerDialogProps) {
  const { t } = useI18n()

  const providerTabs: { value: Provider; label: string }[] = [
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

  const [activeProvider, setActiveProvider] = useState<Provider>(PROVIDER_ANTHROPIC)
  const [templates, setTemplates] = useState<ChannelMonitorTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const listRequestId = useRef(0)

  // null = list view; 'new' = create; <id> = edit
  const [editing, setEditing] = useState<null | 'new' | number>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<TemplateForm>(() => emptyForm(PROVIDER_ANTHROPIC))

  const [applyPicker, setApplyPicker] = useState<{ show: boolean; tpl: ChannelMonitorTemplate | null }>({ show: false, tpl: null })
  const [confirmDelete, setConfirmDelete] = useState<{ show: boolean; tpl: ChannelMonitorTemplate | null }>({ show: false, tpl: null })

  const templatesForActiveProvider = templates.filter((tpl) => tpl.provider === activeProvider)
  const countByProvider = Object.fromEntries(PROVIDERS.map((p) => [p, 0])) as Record<Provider, number>
  for (const tpl of templates) countByProvider[tpl.provider]++

  const patchForm = (patch: Partial<TemplateForm>) => setForm((prev) => ({ ...prev, ...patch }))

  // provider 非 OpenAI 时 API 模式固定为 chat_completions（Vue 版 watch(form.provider)）
  const setFormProvider = (provider: Provider) =>
    setForm((prev) => ({ ...prev, provider, api_mode: provider !== PROVIDER_OPENAI ? API_MODE_CHAT_COMPLETIONS : prev.api_mode }))

  // --- data fetch ---
  const fetchTemplates = async () => {
    const requestId = ++listRequestId.current
    setLoading(true)
    try {
      const { items } = await adminAPI.channelMonitorTemplate.list()
      if (requestId !== listRequestId.current) return
      setTemplates(items)
    } catch (err: unknown) {
      if (requestId !== listRequestId.current) return
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      if (requestId === listRequestId.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (show) {
      // 打开时回到列表并拉取模板（与后端同步的副作用）
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditing(null)
      void fetchTemplates()
    } else {
      listRequestId.current++
      setLoading(false)
    }
  }, [show]) // eslint-disable-line react-hooks/exhaustive-deps -- 只随打开状态变化

  useEffect(() => () => void listRequestId.current++, [])

  const openCreateForm = () => {
    setForm(emptyForm(activeProvider))
    setEditing('new')
  }

  const openEditForm = (tpl: ChannelMonitorTemplate) => {
    setForm({
      id: tpl.id,
      name: tpl.name,
      provider: tpl.provider,
      api_mode: normalizeAPIMode(tpl.api_mode),
      description: tpl.description,
      extra_headers: { ...(tpl.extra_headers || {}) },
      body_override_mode: tpl.body_override_mode,
      body_override: tpl.body_override ? { ...tpl.body_override } : null
    })
    setEditing(tpl.id)
  }

  // --- submit ---
  const handleSubmit = async () => {
    if (submitting) return
    if (!form.name.trim()) {
      useAppStore.getState().showError(t('admin.channelMonitor.template.missingName'))
      return
    }
    setSubmitting(true)
    try {
      if (editing === 'new') {
        await adminAPI.channelMonitorTemplate.create({
          name: form.name.trim(),
          provider: form.provider,
          api_mode: form.provider === PROVIDER_OPENAI ? form.api_mode : API_MODE_CHAT_COMPLETIONS,
          description: form.description.trim(),
          extra_headers: form.extra_headers,
          body_override_mode: form.body_override_mode,
          body_override: form.body_override
        })
        useAppStore.getState().showSuccess(t('admin.channelMonitor.template.createSuccess'))
      } else if (typeof editing === 'number') {
        await adminAPI.channelMonitorTemplate.update(editing, {
          name: form.name.trim(),
          api_mode: form.provider === PROVIDER_OPENAI ? form.api_mode : API_MODE_CHAT_COMPLETIONS,
          description: form.description.trim(),
          extra_headers: form.extra_headers,
          body_override_mode: form.body_override_mode,
          body_override: form.body_override
        })
        useAppStore.getState().showSuccess(t('admin.channelMonitor.template.updateSuccess'))
      }
      await fetchTemplates()
      onUpdated?.()
      setEditing(null)
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      setSubmitting(false)
    }
  }

  // picker 提交后触发：刷新模板列表（拿最新 associated_monitors）+ 通知父组件
  const onApplied = async () => {
    await fetchTemplates()
    onUpdated?.()
  }

  const doDelete = async () => {
    const tpl = confirmDelete.tpl
    setConfirmDelete((prev) => ({ ...prev, show: false }))
    if (!tpl) return
    try {
      await adminAPI.channelMonitorTemplate.del(tpl.id)
      useAppStore.getState().showSuccess(t('admin.channelMonitor.template.deleteSuccess'))
      await fetchTemplates()
      onUpdated?.()
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    }
  }

  const modeLabel = (mode: BodyOverrideMode) =>
    t(`admin.channelMonitor.advanced.bodyMode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`)

  const apiModeLabel = (mode: APIMode) =>
    normalizeAPIMode(mode) === API_MODE_RESPONSES
      ? t('admin.channelMonitor.form.apiModeResponses')
      : t('admin.channelMonitor.form.apiModeChatCompletions')

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

  const confirmDeleteMessage = confirmDelete.tpl
    ? t('admin.channelMonitor.template.deleteConfirm', { name: confirmDelete.tpl.name, n: confirmDelete.tpl.associated_monitors })
    : ''

  return (
    <>
      <BaseDialog
        show={show}
        title={t('admin.channelMonitor.template.managerTitle')}
        width="wide"
        onClose={onClose}
        footer={
          <div className={styles.footer}>
            {/* Left: back to list / nothing */}
            <div>
              {editing ? (
                <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                  {t('common.back')}
                </Button>
              ) : null}
            </div>
            {/* Right: save or close */}
            <div className={styles.footerActions}>
              <Button type="button" variant="secondary" onClick={() => onClose?.()}>
                {t('common.close')}
              </Button>
              {editing ? (
                <Button type="button" variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
                  {submitting ? t('common.submitting') : editing === 'new' ? t('common.create') : t('common.update')}
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        {/* provider tabs */}
        <Tabs value={activeProvider} onValueChange={(value) => setActiveProvider(value as Provider)} className={styles.tabs}>
          <TabsList aria-label={t('admin.channelMonitor.form.provider')}>
            {providerTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                <span className={styles.tabLabel}>
                  {tab.label}
                  {countByProvider[tab.value] > 0 ? <span className={styles.tabCount}>{countByProvider[tab.value]}</span> : null}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {!editing ? (
          /* active provider list */
          <div className={styles.stack}>
            <div className={styles.listHeader}>
              <Button type="button" variant="primary" size="sm" onClick={openCreateForm}>
                <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
                {t('admin.channelMonitor.template.createButton')}
              </Button>
            </div>

            {loading ? (
              <p className={styles.empty}>{t('common.loading')}</p>
            ) : templatesForActiveProvider.length === 0 ? (
              <p className={styles.empty}>{t('admin.channelMonitor.template.emptyState')}</p>
            ) : (
              <ul className={styles.list}>
                {templatesForActiveProvider.map((tpl) => (
                  <li key={tpl.id} className={styles.item}>
                    <div className={styles.itemMain}>
                      <div className={styles.itemTitle}>
                        <span className={styles.name}>{tpl.name}</span>
                        <Badge size="sm" tone={modeTone(tpl.body_override_mode)}>
                          {modeLabel(tpl.body_override_mode)}
                        </Badge>
                        {tpl.provider === PROVIDER_OPENAI ? (
                          <Badge size="sm" tone={normalizeAPIMode(tpl.api_mode) === API_MODE_RESPONSES ? 'info' : 'success'}>
                            {apiModeLabel(tpl.api_mode)}
                          </Badge>
                        ) : null}
                        {tpl.associated_monitors > 0 ? (
                          <span className={styles.meta}>
                            {t('admin.channelMonitor.template.associatedCount', { n: tpl.associated_monitors })}
                          </span>
                        ) : null}
                      </div>
                      {tpl.description ? <p className={styles.meta}>{tpl.description}</p> : null}
                      <p className={styles.metaMuted}>
                        {t('admin.channelMonitor.template.headersSummary', { n: Object.keys(tpl.extra_headers || {}).length })}
                      </p>
                    </div>
                    <div className={styles.itemActions}>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={tpl.associated_monitors === 0}
                        title={t('admin.channelMonitor.template.applyTooltip')}
                        onClick={() => setApplyPicker({ show: true, tpl })}
                      >
                        <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
                        {t('admin.channelMonitor.template.applyButton')}
                      </Button>
                      <Button type="button" variant="secondary" size="sm" onClick={() => openEditForm(tpl)}>
                        {t('common.edit')}
                      </Button>
                      <Button type="button" variant="danger" size="sm" onClick={() => setConfirmDelete({ show: true, tpl })}>
                        {t('common.delete')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          /* edit / create form */
          <div className={styles.stack}>
            <Input
              label={t('admin.channelMonitor.template.form.name')}
              required
              value={form.name}
              placeholder={t('admin.channelMonitor.template.form.namePlaceholder')}
              onChange={(value) => patchForm({ name: value })}
            />

            {editing === 'new' ? (
              <FormField label={t('admin.channelMonitor.form.provider')} required>
                <div className={monitor.providerGrid}>
                  {providerTabs.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={form.provider === opt.value}
                      {...platformTone(opt.value, form.provider === opt.value ? ['text', 'selected'] : [], monitor.provider)}
                      onClick={() => setFormProvider(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </FormField>
            ) : null}

            {form.provider === PROVIDER_OPENAI ? (
              <div className={monitor.inset}>
                <FormField label={t('admin.channelMonitor.form.apiMode')}>
                  <div className={monitor.choiceGrid} data-cols="2">
                    {apiModeOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={monitor.choice}
                        aria-pressed={form.api_mode === opt.value}
                        onClick={() => patchForm({ api_mode: opt.value })}
                      >
                        <span className={monitor.choiceTitle}>{opt.label}</span>
                        <span className={monitor.choiceHint}>{opt.hint}</span>
                      </button>
                    ))}
                  </div>
                </FormField>
              </div>
            ) : null}

            <Input
              label={t('admin.channelMonitor.template.form.description')}
              value={form.description}
              placeholder={t('admin.channelMonitor.template.form.descriptionPlaceholder')}
              onChange={(value) => patchForm({ description: value })}
            />

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
        )}
      </BaseDialog>

      <MonitorTemplateApplyPickerDialog
        show={applyPicker.show}
        templateId={applyPicker.tpl ? applyPicker.tpl.id : null}
        templateName={applyPicker.tpl ? applyPicker.tpl.name : ''}
        onClose={() => setApplyPicker((prev) => ({ ...prev, show: false }))}
        onApplied={() => void onApplied()}
      />

      <ConfirmDialog
        show={confirmDelete.show}
        title={t('common.delete')}
        message={confirmDeleteMessage}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmDelete((prev) => ({ ...prev, show: false }))}
      />
    </>
  )
}
