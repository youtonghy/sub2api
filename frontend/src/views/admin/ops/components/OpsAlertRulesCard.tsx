/**
 * 告警规则列表与编辑（对应 Vue 版 OpsAlertRulesCard.vue）。
 * OpsDashboard 已用 BaseDialog（标题 admin.ops.alertRules.title）包裹本组件，
 * 因此这里不再重复标题，只保留说明、工具栏与列表；规则编辑仍使用嵌套的 BaseDialog。
 */
import { useCallback, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import DataTable from '@/components/common/DataTable'
import Input from '@/components/common/Input'
import Select, { type SelectOption, type SelectValue } from '@/components/common/Select'
import type { Column } from '@/components/common/types'
import { adminAPI } from '@/api'
import { opsAPI, type OpsSeverity } from '@/api/admin/ops'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AlertRule, MetricType, Operator } from '../types'
import { formatDateTime } from '../utils/opsFormatters'
import panel from './OpsPanel.module.css'
import form from './OpsSettingsForm.module.css'
import styles from './OpsAlertRulesCard.module.css'

type MetricGroup = 'system' | 'group' | 'account'

interface MetricDefinition {
  type: MetricType
  group: MetricGroup
  label: string
  description: string
  recommendedOperator: Operator
  recommendedThreshold: number
  unit?: string
}

const groupMetricTypes = new Set<MetricType>([
  'group_available_accounts',
  'group_available_ratio',
  'group_rate_limit_ratio'
])

function parsePositiveInt(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'boolean') return null
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 等价于 Vue 的 v-model.number：空串保持空串，其余按 parseFloat 解析。 */
function toNumberModel(raw: string): number {
  if (raw === '') return '' as unknown as number
  const n = Number.parseFloat(raw)
  return (Number.isNaN(n) ? raw : n) as number
}

function newRuleDraft(): AlertRule {
  return {
    name: '',
    description: '',
    enabled: true,
    metric_type: 'error_rate',
    operator: '>',
    threshold: 1,
    window_minutes: 1,
    sustained_minutes: 2,
    severity: 'P1',
    cooldown_minutes: 10,
    notify_email: true
  }
}

export default function OpsAlertRulesCard() {
  const { t } = useI18n()

  const [loading, setLoading] = useState(false)
  const [rules, setRules] = useState<AlertRule[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRules(await opsAPI.listAlertRules())
    } catch (err: any) {
      console.error('[OpsAlertRulesCard] Failed to load rules', err)
      useAppStore.getState().showError(err?.response?.data?.detail || t('admin.ops.alertRules.loadFailed'))
      setRules([])
    } finally {
      setLoading(false)
    }
  }, [t])

  const [groupOptionsBase, setGroupOptionsBase] = useState<SelectOption[]>([])

  const loadGroups = useCallback(async () => {
    try {
      const list = await adminAPI.groups.getAll()
      setGroupOptionsBase(list.map((g) => ({ value: g.id, label: g.name })))
    } catch (err) {
      console.error('[OpsAlertRulesCard] Failed to load groups', err)
      setGroupOptionsBase([])
    }
  }, [])

  // 仅挂载时加载（Vue 版 onMounted）
  useMountOnce(() => {
    void load()
    void loadGroups()
  })

  const sortedRules = useMemo(() => [...rules].sort((a, b) => (b.id || 0) - (a.id || 0)), [rules])

  const [showEditor, setShowEditor] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<AlertRule | null>(null)

  const updateDraft = (patch: Partial<AlertRule>) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev))

  const isGroupMetricSelected = draft?.metric_type ? groupMetricTypes.has(draft.metric_type) : false
  const draftGroupId = parsePositiveInt(draft?.filters?.group_id)

  function setDraftGroupId(value: number | null) {
    setDraft((prev) => {
      if (!prev) return prev
      if (value == null) {
        if (!prev.filters) return prev
        const filters = { ...prev.filters }
        delete filters.group_id
        const next: AlertRule = { ...prev, filters }
        if (Object.keys(filters).length === 0) delete next.filters
        return next
      }
      return { ...prev, filters: { ...(prev.filters ?? {}), group_id: value } }
    })
  }

  const groupOptions: SelectOption[] = isGroupMetricSelected
    ? groupOptionsBase
    : [{ value: null, label: t('admin.ops.alertRules.form.allGroups') }, ...groupOptionsBase]

  const metricDefinitions = useMemo<MetricDefinition[]>(
    () => [
      // System-level metrics
      {
        type: 'success_rate',
        group: 'system',
        label: t('admin.ops.alertRules.metrics.successRate'),
        description: t('admin.ops.alertRules.metricDescriptions.successRate'),
        recommendedOperator: '<',
        recommendedThreshold: 99,
        unit: '%'
      },
      {
        type: 'error_rate',
        group: 'system',
        label: t('admin.ops.alertRules.metrics.errorRate'),
        description: t('admin.ops.alertRules.metricDescriptions.errorRate'),
        recommendedOperator: '>',
        recommendedThreshold: 1,
        unit: '%'
      },
      {
        type: 'upstream_error_rate',
        group: 'system',
        label: t('admin.ops.alertRules.metrics.upstreamErrorRate'),
        description: t('admin.ops.alertRules.metricDescriptions.upstreamErrorRate'),
        recommendedOperator: '>',
        recommendedThreshold: 1,
        unit: '%'
      },
      {
        type: 'cpu_usage_percent',
        group: 'system',
        label: t('admin.ops.alertRules.metrics.cpu'),
        description: t('admin.ops.alertRules.metricDescriptions.cpu'),
        recommendedOperator: '>',
        recommendedThreshold: 80,
        unit: '%'
      },
      {
        type: 'memory_usage_percent',
        group: 'system',
        label: t('admin.ops.alertRules.metrics.memory'),
        description: t('admin.ops.alertRules.metricDescriptions.memory'),
        recommendedOperator: '>',
        recommendedThreshold: 80,
        unit: '%'
      },
      {
        type: 'concurrency_queue_depth',
        group: 'system',
        label: t('admin.ops.alertRules.metrics.queueDepth'),
        description: t('admin.ops.alertRules.metricDescriptions.queueDepth'),
        recommendedOperator: '>',
        recommendedThreshold: 10
      },

      // Group-level metrics (requires group_id filter)
      {
        type: 'group_available_accounts',
        group: 'group',
        label: t('admin.ops.alertRules.metrics.groupAvailableAccounts'),
        description: t('admin.ops.alertRules.metricDescriptions.groupAvailableAccounts'),
        recommendedOperator: '<',
        recommendedThreshold: 1
      },
      {
        type: 'group_available_ratio',
        group: 'group',
        label: t('admin.ops.alertRules.metrics.groupAvailableRatio'),
        description: t('admin.ops.alertRules.metricDescriptions.groupAvailableRatio'),
        recommendedOperator: '<',
        recommendedThreshold: 50,
        unit: '%'
      },
      {
        type: 'group_rate_limit_ratio',
        group: 'group',
        label: t('admin.ops.alertRules.metrics.groupRateLimitRatio'),
        description: t('admin.ops.alertRules.metricDescriptions.groupRateLimitRatio'),
        recommendedOperator: '>',
        recommendedThreshold: 10,
        unit: '%'
      },

      // Account-level metrics
      {
        type: 'account_rate_limited_count',
        group: 'account',
        label: t('admin.ops.alertRules.metrics.accountRateLimitedCount'),
        description: t('admin.ops.alertRules.metricDescriptions.accountRateLimitedCount'),
        recommendedOperator: '>',
        recommendedThreshold: 0
      },
      {
        type: 'account_error_count',
        group: 'account',
        label: t('admin.ops.alertRules.metrics.accountErrorCount'),
        description: t('admin.ops.alertRules.metricDescriptions.accountErrorCount'),
        recommendedOperator: '>',
        recommendedThreshold: 0
      },
      {
        type: 'account_error_ratio',
        group: 'account',
        label: t('admin.ops.alertRules.metrics.accountErrorRatio'),
        description: t('admin.ops.alertRules.metricDescriptions.accountErrorRatio'),
        recommendedOperator: '>',
        recommendedThreshold: 5,
        unit: '%'
      },
      {
        type: 'account_temp_unscheduled_count',
        group: 'account',
        label: t('admin.ops.alertRules.metrics.accountTempUnscheduledCount'),
        description: t('admin.ops.alertRules.metricDescriptions.accountTempUnscheduledCount'),
        recommendedOperator: '>',
        recommendedThreshold: 0
      },
      {
        type: 'overload_account_count',
        group: 'account',
        label: t('admin.ops.alertRules.metrics.overloadAccountCount'),
        description: t('admin.ops.alertRules.metricDescriptions.overloadAccountCount'),
        recommendedOperator: '>',
        recommendedThreshold: 0
      }
    ],
    [t]
  )

  const selectedMetricDefinition = draft?.metric_type
    ? metricDefinitions.find((m) => m.type === draft.metric_type) ?? null
    : null

  const metricOptions = useMemo<SelectOption[]>(() => {
    const buildGroup = (group: MetricGroup): SelectOption[] => {
      const items = metricDefinitions.filter((m) => m.group === group)
      if (items.length === 0) return []
      const headerValue = `__group__${group}`
      return [
        {
          value: headerValue,
          label: t(`admin.ops.alertRules.metricGroups.${group}`),
          disabled: true,
          kind: 'group'
        },
        ...items.map((m) => ({ value: m.type, label: m.label }))
      ]
    }
    return [...buildGroup('system'), ...buildGroup('group'), ...buildGroup('account')]
  }, [metricDefinitions, t])

  const operatorOptions = (['>', '>=', '<', '<=', '==', '!='] as Operator[]).map((o) => ({ value: o, label: o }))
  const severityOptions = (['P0', 'P1', 'P2', 'P3'] as OpsSeverity[]).map((s) => ({ value: s, label: s }))
  const windowOptions = [1, 5, 60].map((m) => ({ value: m, label: `${m}m` }))

  function openCreate() {
    setEditingId(null)
    setDraft(newRuleDraft())
    setShowEditor(true)
  }

  function openEdit(rule: AlertRule) {
    setEditingId(rule.id ?? null)
    setDraft(JSON.parse(JSON.stringify(rule)))
    setShowEditor(true)
  }

  const editorValidation = useMemo(() => {
    const errors: string[] = []
    const r = draft
    if (!r) return { valid: true, errors }
    if (!r.name || !r.name.trim()) errors.push(t('admin.ops.alertRules.validation.nameRequired'))
    if (!r.metric_type) errors.push(t('admin.ops.alertRules.validation.metricRequired'))
    if (groupMetricTypes.has(r.metric_type) && !parsePositiveInt(r.filters?.group_id)) {
      errors.push(t('admin.ops.alertRules.validation.groupIdRequired'))
    }
    if (!r.operator) errors.push(t('admin.ops.alertRules.validation.operatorRequired'))
    if (!(typeof r.threshold === 'number' && Number.isFinite(r.threshold)))
      errors.push(t('admin.ops.alertRules.validation.thresholdRequired'))
    if (!(typeof r.window_minutes === 'number' && Number.isFinite(r.window_minutes) && [1, 5, 60].includes(r.window_minutes))) {
      errors.push(t('admin.ops.alertRules.validation.windowRange'))
    }
    if (!(typeof r.sustained_minutes === 'number' && Number.isInteger(r.sustained_minutes) && r.sustained_minutes >= 1 && r.sustained_minutes <= 1440)) {
      errors.push(t('admin.ops.alertRules.validation.sustainedRange'))
    }
    if (!(typeof r.cooldown_minutes === 'number' && Number.isInteger(r.cooldown_minutes) && r.cooldown_minutes >= 0 && r.cooldown_minutes <= 1440)) {
      errors.push(t('admin.ops.alertRules.validation.cooldownRange'))
    }
    return { valid: errors.length === 0, errors }
  }, [draft, t])

  async function save() {
    if (!draft) return
    if (!editorValidation.valid) {
      useAppStore.getState().showError(editorValidation.errors[0] || t('admin.ops.alertRules.validation.invalid'))
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        await opsAPI.updateAlertRule(editingId, draft)
      } else {
        await opsAPI.createAlertRule(draft)
      }
      setShowEditor(false)
      setDraft(null)
      setEditingId(null)
      await load()
      useAppStore.getState().showSuccess(t('admin.ops.alertRules.saveSuccess'))
    } catch (err: any) {
      console.error('[OpsAlertRulesCard] Failed to save rule', err)
      useAppStore.getState().showError(err?.response?.data?.detail || t('admin.ops.alertRules.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<AlertRule | null>(null)

  function requestDelete(rule: AlertRule) {
    setPendingDelete(rule)
    setShowDeleteConfirm(true)
  }

  async function confirmDelete() {
    if (!pendingDelete?.id) return
    try {
      await opsAPI.deleteAlertRule(pendingDelete.id)
      setShowDeleteConfirm(false)
      setPendingDelete(null)
      await load()
      useAppStore.getState().showSuccess(t('admin.ops.alertRules.deleteSuccess'))
    } catch (err: any) {
      console.error('[OpsAlertRulesCard] Failed to delete rule', err)
      useAppStore.getState().showError(err?.response?.data?.detail || t('admin.ops.alertRules.deleteFailed'))
    }
  }

  function cancelDelete() {
    setShowDeleteConfirm(false)
    setPendingDelete(null)
  }

  const columns: Column<AlertRule>[] = [
    { key: 'name', label: t('admin.ops.alertRules.table.name') },
    { key: 'metric_type', label: t('admin.ops.alertRules.table.metric') },
    { key: 'severity', label: t('admin.ops.alertRules.table.severity') },
    { key: 'enabled', label: t('admin.ops.alertRules.table.enabled') },
    { key: 'actions', label: t('admin.ops.alertRules.table.actions'), align: 'right' }
  ]

  return (
    <div className={styles.root}>
      <div className={panel.header}>
        <p className={panel.subtitle}>{t('admin.ops.alertRules.description')}</p>
        <div className={panel.toolbar}>
          <Button size="sm" variant="primary" disabled={loading} onClick={openCreate}>
            {t('admin.ops.alertRules.create')}
          </Button>
          <Button size="sm" variant="secondary" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={14} aria-hidden="true" className={loading ? styles.spin : undefined} />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {loading ? (
        <Skeleton label={t('admin.ops.alertRules.loading')} lines={4} />
      ) : sortedRules.length === 0 ? (
        <div className={styles.empty}>{t('admin.ops.alertRules.empty')}</div>
      ) : (
        <div className={styles.tableFrame}>
          <DataTable<AlertRule>
            columns={columns}
            data={sortedRules}
            stickyFirstColumn={false}
            cells={{
              name: ({ row }) => (
                <div className={styles.nameCell}>
                  <div className={styles.name}>{row.name}</div>
                  {row.description && <div className={styles.description}>{row.description}</div>}
                  {row.updated_at && <div className={styles.updated}>{formatDateTime(row.updated_at)}</div>}
                </div>
              ),
              metric_type: ({ row }) => (
                <span className={styles.metric}>
                  <span className={form.mono}>{row.metric_type}</span>
                  <span className={styles.operator}>{row.operator}</span>
                  <span className={form.mono}>{row.threshold}</span>
                </span>
              ),
              severity: ({ row }) => <span className={styles.severity}>{row.severity}</span>,
              enabled: ({ row }) => (row.enabled ? t('common.enabled') : t('common.disabled')),
              actions: ({ row }) => (
                <div className={styles.actions}>
                  <Button size="sm" variant="secondary" onClick={() => openEdit(row)}>
                    {t('common.edit')}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => requestDelete(row)}>
                    {t('common.delete')}
                  </Button>
                </div>
              )
            }}
          />
        </div>
      )}

      <BaseDialog
        show={showEditor}
        title={editingId ? t('admin.ops.alertRules.editTitle') : t('admin.ops.alertRules.createTitle')}
        width="wide"
        onClose={() => setShowEditor(false)}
        footer={
          <>
            <Button type="button" variant="secondary" disabled={saving} onClick={() => setShowEditor(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        {draft && (
          <div className={form.stack}>
            {!editorValidation.valid && (
              <Alert tone="danger" title={t('admin.ops.alertRules.validation.title')}>
                <ul className={form.errorList}>
                  {editorValidation.errors.map((e, index) => (
                    <li key={`${e}-${index}`}>{e}</li>
                  ))}
                </ul>
              </Alert>
            )}

            <div className={form.grid2}>
              <div className={form.span2}>
                <Input
                  type="text"
                  label={t('admin.ops.alertRules.form.name')}
                  value={draft.name}
                  onChange={(v) => updateDraft({ name: v })}
                />
              </div>

              <div className={form.span2}>
                <Input
                  type="text"
                  label={t('admin.ops.alertRules.form.description')}
                  value={draft.description}
                  onChange={(v) => updateDraft({ description: v })}
                />
              </div>

              <div>
                <span className={form.label}>{t('admin.ops.alertRules.form.metric')}</span>
                <Select
                  value={draft.metric_type}
                  options={metricOptions}
                  aria-label={t('admin.ops.alertRules.form.metric')}
                  onChange={(v) => updateDraft({ metric_type: v as MetricType })}
                />
                {selectedMetricDefinition && (
                  <div className={styles.metricHint}>
                    <p className={form.hint}>{selectedMetricDefinition.description}</p>
                    <p className={form.hint}>
                      {t('admin.ops.alertRules.hints.recommended', {
                        operator: selectedMetricDefinition.recommendedOperator,
                        threshold: selectedMetricDefinition.recommendedThreshold,
                        unit: selectedMetricDefinition.unit || ''
                      })}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <span className={form.label}>{t('admin.ops.alertRules.form.operator')}</span>
                <Select
                  value={draft.operator}
                  options={operatorOptions}
                  aria-label={t('admin.ops.alertRules.form.operator')}
                  onChange={(v) => updateDraft({ operator: v as Operator })}
                />
              </div>

              <div className={form.span2}>
                <span className={form.label}>
                  {t('admin.ops.alertRules.form.groupId')}
                  {isGroupMetricSelected && <span className={panel.danger}> *</span>}
                </span>
                <Select
                  value={draftGroupId}
                  options={groupOptions}
                  searchable
                  aria-label={t('admin.ops.alertRules.form.groupId')}
                  placeholder={t('admin.ops.alertRules.form.groupPlaceholder')}
                  error={isGroupMetricSelected && !draftGroupId}
                  onChange={(v: SelectValue) => setDraftGroupId(parsePositiveInt(v))}
                />
                <p className={[form.hint, styles.fieldHint].join(' ')}>
                  {isGroupMetricSelected ? t('admin.ops.alertRules.hints.groupRequired') : t('admin.ops.alertRules.hints.groupOptional')}
                </p>
              </div>

              <Input
                type="number"
                label={t('admin.ops.alertRules.form.threshold')}
                value={draft.threshold}
                onChange={(raw) => updateDraft({ threshold: toNumberModel(raw) })}
              />

              <div>
                <span className={form.label}>{t('admin.ops.alertRules.form.severity')}</span>
                <Select
                  value={draft.severity}
                  options={severityOptions}
                  aria-label={t('admin.ops.alertRules.form.severity')}
                  onChange={(v) => updateDraft({ severity: v as OpsSeverity })}
                />
              </div>

              <div>
                <span className={form.label}>{t('admin.ops.alertRules.form.window')}</span>
                <Select
                  value={draft.window_minutes}
                  options={windowOptions}
                  aria-label={t('admin.ops.alertRules.form.window')}
                  onChange={(v) => updateDraft({ window_minutes: v as number })}
                />
              </div>

              <Input
                type="number"
                label={t('admin.ops.alertRules.form.sustained')}
                value={draft.sustained_minutes}
                min={1}
                max={1440}
                onChange={(raw) => updateDraft({ sustained_minutes: toNumberModel(raw) })}
              />

              <Input
                type="number"
                label={t('admin.ops.alertRules.form.cooldown')}
                value={draft.cooldown_minutes}
                min={0}
                max={1440}
                onChange={(raw) => updateDraft({ cooldown_minutes: toNumberModel(raw) })}
              />

              <div className={[form.span2, styles.checkRow].join(' ')}>
                <Checkbox
                  label={t('admin.ops.alertRules.form.enabled')}
                  checked={draft.enabled}
                  onCheckedChange={(v) => updateDraft({ enabled: v === true })}
                />
              </div>

              <div className={[form.span2, styles.checkRow].join(' ')}>
                <Checkbox
                  label={t('admin.ops.alertRules.form.notifyEmail')}
                  checked={draft.notify_email}
                  onCheckedChange={(v) => updateDraft({ notify_email: v === true })}
                />
              </div>
            </div>
          </div>
        )}
      </BaseDialog>

      <ConfirmDialog
        show={showDeleteConfirm}
        title={t('admin.ops.alertRules.deleteConfirmTitle')}
        message={t('admin.ops.alertRules.deleteConfirmMessage')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        onConfirm={() => void confirmDelete()}
        onCancel={cancelDelete}
      />
    </div>
  )
}
