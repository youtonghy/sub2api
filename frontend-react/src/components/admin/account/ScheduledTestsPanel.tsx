/**
 * 账号定时测试计划弹窗，对应 Vue 版 ScheduledTestsPanel.vue。
 * 打开时加载账号的测试计划，支持新增、编辑、启停、删除，展开计划查看最近 20 条结果。
 * 切换展开的计划时使旧的结果请求失效（Vue 版 watch(expandedPlanId, flush: 'sync')）。
 */
import { CalendarDays, ChevronDown, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import HelpTooltip from '@/components/common/HelpTooltip'
import Input from '@/components/common/Input'
import Select, { type SelectOption } from '@/components/common/Select'
import Toggle from '@/components/common/Toggle'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { ScheduledTestPlan, ScheduledTestResult } from '@/types'
import { formatDateTime } from '@/utils/format'
import styles from './ScheduledTestsPanel.module.css'

export interface ScheduledTestsPanelProps {
  show: boolean
  accountId: number | null
  modelOptions: SelectOption[]
  onClose: () => void
}

interface PlanForm {
  model_id: string
  cron_expression: string
  max_results: string
  enabled: boolean
  auto_recover: boolean
}

const emptyPlan = (): PlanForm => ({
  model_id: '',
  cron_expression: '',
  max_results: '100',
  enabled: true,
  auto_recover: false
})

interface PlanFieldsProps {
  form: PlanForm
  modelOptions: SelectOption[]
  onChange: (patch: Partial<PlanForm>) => void
}

function PlanFields({ form, modelOptions, onChange }: PlanFieldsProps) {
  const { t } = useI18n()
  return (
    <div className={styles.formGrid}>
      <div>
        <span className={styles.fieldLabel}>{t('admin.scheduledTests.model')}</span>
        <Select
          value={form.model_id}
          options={modelOptions}
          placeholder={t('admin.scheduledTests.model')}
          searchable={modelOptions.length > 5}
          aria-label={t('admin.scheduledTests.model')}
          onChange={(value) => onChange({ model_id: value == null ? '' : String(value) })}
        />
      </div>
      <div>
        <span className={styles.fieldLabel}>
          {t('admin.scheduledTests.cronExpression')}
          <HelpTooltip>
            <div className={styles.tooltipBody}>
              <p className={styles.tooltipTitle}>{t('admin.scheduledTests.cronTooltipTitle')}</p>
              <p>{t('admin.scheduledTests.cronTooltipMeaning')}</p>
              <p>{t('admin.scheduledTests.cronTooltipExampleEvery30Min')}</p>
              <p>{t('admin.scheduledTests.cronTooltipExampleHourly')}</p>
              <p>{t('admin.scheduledTests.cronTooltipExampleDaily')}</p>
              <p>{t('admin.scheduledTests.cronTooltipExampleWeekly')}</p>
              <p>{t('admin.scheduledTests.cronTooltipRange')}</p>
            </div>
          </HelpTooltip>
        </span>
        <Input
          value={form.cron_expression}
          placeholder="*/30 * * * *"
          hint={t('admin.scheduledTests.cronHelp')}
          aria-label={t('admin.scheduledTests.cronExpression')}
          onChange={(value) => onChange({ cron_expression: value })}
        />
      </div>
      <div>
        <span className={styles.fieldLabel}>
          {t('admin.scheduledTests.maxResults')}
          <HelpTooltip>
            <div className={styles.tooltipBody}>
              <p className={styles.tooltipTitle}>{t('admin.scheduledTests.maxResultsTooltipTitle')}</p>
              <p>{t('admin.scheduledTests.maxResultsTooltipMeaning')}</p>
              <p>{t('admin.scheduledTests.maxResultsTooltipBody')}</p>
              <p>{t('admin.scheduledTests.maxResultsTooltipExample')}</p>
              <p>{t('admin.scheduledTests.maxResultsTooltipRange')}</p>
            </div>
          </HelpTooltip>
        </span>
        <Input
          value={form.max_results}
          type="number"
          placeholder="100"
          aria-label={t('admin.scheduledTests.maxResults')}
          onChange={(value) => onChange({ max_results: value })}
        />
      </div>
      <div className={styles.alignEnd}>
        <Toggle
          value={form.enabled}
          label={t('admin.scheduledTests.enabled')}
          onChange={(value) => onChange({ enabled: value })}
        />
      </div>
      <div className={styles.alignEnd}>
        <div>
          <Toggle
            value={form.auto_recover}
            label={t('admin.scheduledTests.autoRecover')}
            onChange={(value) => onChange({ auto_recover: value })}
          />
          <p className={styles.help}>{t('admin.scheduledTests.autoRecoverHelp')}</p>
        </div>
      </div>
    </div>
  )
}

export default function ScheduledTestsPanel({ show, accountId, modelOptions, onClose }: ScheduledTestsPanelProps) {
  const { t } = useI18n()

  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [loadingResults, setLoadingResults] = useState(false)
  const [plans, setPlans] = useState<ScheduledTestPlan[]>([])
  const [results, setResults] = useState<ScheduledTestResult[]>([])
  const [expandedPlanId, setExpandedPlanIdState] = useState<number | null>(null)
  const [expandedResultIds, setExpandedResultIds] = useState<Set<number>>(() => new Set())
  const [showAddForm, setShowAddForm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingPlan, setDeletingPlan] = useState<ScheduledTestPlan | null>(null)
  const [editingPlanId, setEditingPlanId] = useState<number | null>(null)
  const [updating, setUpdating] = useState(false)
  const [editForm, setEditForm] = useState<PlanForm>(emptyPlan)
  const [newPlan, setNewPlan] = useState<PlanForm>(emptyPlan)

  const resultsRequestId = useRef(0)
  const expandedPlanIdRef = useRef<number | null>(null)
  const accountIdRef = useRef(accountId)
  useEffect(() => {
    accountIdRef.current = accountId
  })

  // 展开的计划变化时同步使旧的结果请求失效并清空结果（Vue 版 watch flush: 'sync'）
  const setExpandedPlanId = (planId: number | null) => {
    if (expandedPlanIdRef.current === planId) return
    expandedPlanIdRef.current = planId
    resultsRequestId.current++
    setExpandedPlanIdState(planId)
    setResults([])
    setLoadingResults(false)
  }

  useEffect(
    () => () => {
      resultsRequestId.current++
    },
    []
  )

  const resetNewPlan = () => setNewPlan(emptyPlan())

  const loadPlans = async () => {
    const currentAccountId = accountIdRef.current
    if (!currentAccountId) return
    setLoading(true)
    try {
      setPlans(await adminAPI.scheduledTests.listByAccount(currentAccountId))
    } catch (error: any) {
      useAppStore.getState().showError(error?.message || 'Failed to load plans')
    } finally {
      setLoading(false)
    }
  }

  // Load plans when dialog opens
  useEffect(() => {
    if (show && accountIdRef.current) {
      void loadPlans()
    } else {
      setPlans([])
      setResults([])
      setExpandedPlanId(null)
      setExpandedResultIds(new Set())
      setShowAddForm(false)
      setShowDeleteConfirm(false)
    }
    // 与 Vue 版一致，只跟随 show 变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  const handleCreate = async () => {
    if (!accountId || !newPlan.model_id || !newPlan.cron_expression) return
    setCreating(true)
    try {
      const maxResults = Number(newPlan.max_results) || 100
      await adminAPI.scheduledTests.create({
        account_id: accountId,
        model_id: newPlan.model_id,
        cron_expression: newPlan.cron_expression,
        enabled: newPlan.enabled,
        max_results: maxResults,
        auto_recover: newPlan.auto_recover
      })
      useAppStore.getState().showSuccess(t('admin.scheduledTests.createSuccess'))
      setShowAddForm(false)
      resetNewPlan()
      await loadPlans()
    } catch (error: any) {
      useAppStore.getState().showError(error?.message || 'Failed to create plan')
    } finally {
      setCreating(false)
    }
  }

  const replacePlan = (planId: number, updated: ScheduledTestPlan) =>
    setPlans((current) => {
      const index = current.findIndex((p) => p.id === planId)
      if (index === -1) return current
      const next = [...current]
      next[index] = updated
      return next
    })

  const handleToggleEnabled = async (plan: ScheduledTestPlan, enabled: boolean) => {
    try {
      const updated = await adminAPI.scheduledTests.update(plan.id, { enabled })
      replacePlan(plan.id, updated)
      useAppStore.getState().showSuccess(t('admin.scheduledTests.updateSuccess'))
    } catch (error: any) {
      useAppStore.getState().showError(error?.message || 'Failed to update plan')
    }
  }

  const startEdit = (plan: ScheduledTestPlan) => {
    setEditingPlanId(plan.id)
    setEditForm({
      model_id: plan.model_id,
      cron_expression: plan.cron_expression,
      max_results: String(plan.max_results),
      enabled: plan.enabled,
      auto_recover: plan.auto_recover
    })
  }

  const cancelEdit = () => setEditingPlanId(null)

  const handleEdit = async () => {
    if (!editingPlanId || !editForm.model_id || !editForm.cron_expression) return
    const planId = editingPlanId
    setUpdating(true)
    try {
      const updated = await adminAPI.scheduledTests.update(planId, {
        model_id: editForm.model_id,
        cron_expression: editForm.cron_expression,
        max_results: Number(editForm.max_results) || 100,
        enabled: editForm.enabled,
        auto_recover: editForm.auto_recover
      })
      replacePlan(planId, updated)
      useAppStore.getState().showSuccess(t('admin.scheduledTests.updateSuccess'))
      setEditingPlanId(null)
    } catch (error: any) {
      useAppStore.getState().showError(error?.message || 'Failed to update plan')
    } finally {
      setUpdating(false)
    }
  }

  const confirmDeletePlan = (plan: ScheduledTestPlan) => {
    setDeletingPlan(plan)
    setShowDeleteConfirm(true)
  }

  const handleDelete = async () => {
    if (!deletingPlan) return
    const plan = deletingPlan
    try {
      await adminAPI.scheduledTests.delete(plan.id)
      useAppStore.getState().showSuccess(t('admin.scheduledTests.deleteSuccess'))
      setPlans((current) => current.filter((p) => p.id !== plan.id))
      if (expandedPlanIdRef.current === plan.id) {
        setExpandedPlanId(null)
        setResults([])
      }
    } catch (error: any) {
      useAppStore.getState().showError(error?.message || 'Failed to delete plan')
    } finally {
      setShowDeleteConfirm(false)
      setDeletingPlan(null)
    }
  }

  const toggleExpand = async (planId: number) => {
    if (expandedPlanIdRef.current === planId) {
      setExpandedPlanId(null)
      setResults([])
      setExpandedResultIds(new Set())
      return
    }

    setExpandedPlanId(planId)
    setExpandedResultIds(new Set())
    setLoadingResults(true)
    const requestId = resultsRequestId.current
    try {
      const data = await adminAPI.scheduledTests.listResults(planId, 20)
      if (requestId !== resultsRequestId.current) return
      setResults(data)
    } catch (error: any) {
      if (requestId !== resultsRequestId.current) return
      useAppStore.getState().showError(error?.message || 'Failed to load results')
      setResults([])
    } finally {
      if (requestId === resultsRequestId.current) setLoadingResults(false)
    }
  }

  const toggleResultDetail = (resultId: number) =>
    setExpandedResultIds((current) => {
      const next = new Set(current)
      if (next.has(resultId)) next.delete(resultId)
      else next.add(resultId)
      return next
    })

  const resultTone = (status: string) => (status === 'success' ? 'success' : status === 'running' ? 'info' : 'danger')
  const resultLabel = (status: string) =>
    status === 'success'
      ? t('admin.scheduledTests.success')
      : status === 'running'
        ? t('admin.scheduledTests.running')
        : t('admin.scheduledTests.failed')

  return (
    <BaseDialog show={show} title={t('admin.scheduledTests.title')} width="wide" onClose={onClose}>
      <div className={styles.root}>
        {/* Add Plan Button */}
        <div className={styles.topBar}>
          <p className={styles.muted}>{t('admin.scheduledTests.title')}</p>
          <Button type="button" variant="primary" size="sm" onClick={() => setShowAddForm((value) => !value)}>
            <Plus size={14} aria-hidden="true" />
            {t('admin.scheduledTests.addPlan')}
          </Button>
        </div>

        {/* Add Plan Form */}
        {showAddForm ? (
          <div className={styles.addForm}>
            <div className={styles.formTitle}>{t('admin.scheduledTests.addPlan')}</div>
            <PlanFields
              form={newPlan}
              modelOptions={modelOptions}
              onChange={(patch) => setNewPlan((current) => ({ ...current, ...patch }))}
            />
            <div className={styles.formActions}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setShowAddForm(false)
                  resetNewPlan()
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!newPlan.model_id || !newPlan.cron_expression || creating}
                onClick={() => void handleCreate()}
              >
                {creating ? <RefreshCw size={14} className={styles.spin} aria-hidden="true" /> : null}
                {t('common.save')}
              </Button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className={styles.loading}>
            <RefreshCw size={16} className={styles.spin} aria-hidden="true" />
            <span>{t('common.loading')}...</span>
          </div>
        ) : plans.length === 0 ? (
          <div className={styles.empty}>
            <CalendarDays size={28} className={styles.emptyIcon} aria-hidden="true" />
            <p>{t('admin.scheduledTests.noPlans')}</p>
          </div>
        ) : (
          <div className={styles.plans}>
            {plans.map((plan) => (
              <div key={plan.id} className={styles.plan}>
                {/* Plan Header */}
                <div
                  className={styles.planHeader}
                  data-testid="scheduled-plan-header"
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandedPlanId === plan.id}
                  onClick={() => void toggleExpand(plan.id)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      void toggleExpand(plan.id)
                    }
                  }}
                >
                  <div className={styles.planMain}>
                    <div className={styles.planModel}>
                      <div className={styles.modelId}>{plan.model_id}</div>
                      <div className={styles.cron}>{plan.cron_expression}</div>
                    </div>

                    <div
                      className={styles.inlineToggle}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <Toggle
                        value={plan.enabled}
                        aria-label={t('admin.scheduledTests.enabled')}
                        onChange={(value) => void handleToggleEnabled(plan, value)}
                      />
                      <span className={styles.small}>{plan.enabled ? t('admin.scheduledTests.enabled') : ''}</span>
                    </div>

                    {plan.auto_recover ? (
                      <Badge tone="success" size="sm">
                        {t('admin.scheduledTests.autoRecover')}
                      </Badge>
                    ) : null}
                  </div>

                  <div className={styles.planSide}>
                    {plan.last_run_at ? (
                      <div className={styles.runInfo}>
                        <div>{t('admin.scheduledTests.lastRun')}</div>
                        <div>{formatDateTime(plan.last_run_at)}</div>
                      </div>
                    ) : null}
                    {plan.next_run_at ? (
                      <div className={styles.runInfo}>
                        <div>{t('admin.scheduledTests.nextRun')}</div>
                        <div>{formatDateTime(plan.next_run_at)}</div>
                      </div>
                    ) : null}

                    <div
                      className={styles.actions}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        className={styles.iconButton}
                        title={t('admin.scheduledTests.editPlan')}
                        aria-label={t('admin.scheduledTests.editPlan')}
                        onClick={() => startEdit(plan)}
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        data-tone="danger"
                        title={t('admin.scheduledTests.deletePlan')}
                        aria-label={t('admin.scheduledTests.deletePlan')}
                        onClick={() => confirmDeletePlan(plan)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>

                    <ChevronDown
                      size={16}
                      className={styles.chevron}
                      data-open={expandedPlanId === plan.id ? 'true' : 'false'}
                      aria-hidden="true"
                    />
                  </div>
                </div>

                {/* Edit Form */}
                {editingPlanId === plan.id ? (
                  <div className={styles.editForm} onClick={(event) => event.stopPropagation()}>
                    <div className={styles.sectionLabel}>{t('admin.scheduledTests.editPlan')}</div>
                    <PlanFields
                      form={editForm}
                      modelOptions={modelOptions}
                      onChange={(patch) => setEditForm((current) => ({ ...current, ...patch }))}
                    />
                    <div className={styles.formActions}>
                      <Button type="button" variant="secondary" size="sm" onClick={cancelEdit}>
                        {t('common.cancel')}
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={!editForm.model_id || !editForm.cron_expression || updating}
                        onClick={() => void handleEdit()}
                      >
                        {updating ? <RefreshCw size={14} className={styles.spin} aria-hidden="true" /> : null}
                        {t('common.save')}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {/* Expanded Results Section */}
                {expandedPlanId === plan.id ? (
                  <div className={styles.resultsSection}>
                    <div className={styles.sectionLabel}>{t('admin.scheduledTests.results')}</div>

                    {loadingResults ? (
                      <div className={styles.resultsLoading}>
                        <RefreshCw size={14} className={styles.spin} aria-hidden="true" />
                        <span>{t('common.loading')}...</span>
                      </div>
                    ) : results.length === 0 ? (
                      <div className={styles.noResults}>{t('admin.scheduledTests.noResults')}</div>
                    ) : (
                      <div className={styles.results}>
                        {results.map((result) => {
                          const open = expandedResultIds.has(result.id)
                          return (
                            <div key={result.id} className={styles.result}>
                              <div className={styles.resultHead}>
                                <div className={styles.resultMeta}>
                                  <Badge tone={resultTone(result.status)} size="sm">
                                    {resultLabel(result.status)}
                                  </Badge>
                                  {result.latency_ms > 0 ? <span className={styles.small}>{result.latency_ms}ms</span> : null}
                                </div>
                                <span className={styles.small}>{formatDateTime(result.started_at)}</span>
                              </div>

                              {result.error_message ? (
                                <div className={styles.detail}>
                                  <button
                                    type="button"
                                    className={styles.detailToggle}
                                    data-tone="danger"
                                    aria-expanded={open}
                                    onClick={() => toggleResultDetail(result.id)}
                                  >
                                    {t('admin.scheduledTests.errorMessage')}
                                    <ChevronDown size={14} className={styles.chevron} data-open={open ? 'true' : 'false'} aria-hidden="true" />
                                  </button>
                                  {open ? (
                                    <pre className={styles.pre} data-tone="danger">
                                      {result.error_message}
                                    </pre>
                                  ) : null}
                                </div>
                              ) : result.response_text ? (
                                <div className={styles.detail}>
                                  <button
                                    type="button"
                                    className={styles.detailToggle}
                                    aria-expanded={open}
                                    onClick={() => toggleResultDetail(result.id)}
                                  >
                                    {t('admin.scheduledTests.responseText')}
                                    <ChevronDown size={14} className={styles.chevron} data-open={open ? 'true' : 'false'} aria-hidden="true" />
                                  </button>
                                  {open ? <pre className={styles.pre}>{result.response_text}</pre> : null}
                                </div>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation */}
      <ConfirmDialog
        show={showDeleteConfirm}
        title={t('admin.scheduledTests.deletePlan')}
        message={t('admin.scheduledTests.confirmDelete')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </BaseDialog>
  )
}
