/**
 * 错误透传规则管理弹窗，对应 Vue 版 ErrorPassthroughRulesModal.vue：
 * 规则列表（启停开关、编辑、删除）+ 新建 / 编辑表单子弹窗 + 删除确认。
 */
import { CircleCheck, CircleX, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { adminAPI } from '@/api/admin'
import type { ErrorPassthroughRule } from '@/api/admin/errorPassthrough'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { RadioGroup } from '@/components/arc/radio-group/radio-group'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import Input from '@/components/common/Input'
import Skeleton from '@/components/common/Skeleton'
import TextArea from '@/components/common/TextArea'
import Toggle from '@/components/common/Toggle'
import { CONCRETE_PLATFORM_OPTIONS } from '@/constants/platforms'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import styles from './ErrorPassthroughRulesModal.module.css'

export interface ErrorPassthroughRulesModalProps {
  show: boolean
  onClose?: () => void
}

interface RuleForm {
  name: string
  enabled: boolean
  priority: number
  match_mode: 'any' | 'all'
  platforms: string[]
  passthrough_code: boolean
  response_code: number | null
  passthrough_body: boolean
  custom_message: string | null
  skip_monitoring: boolean
  description: string | null
}

const emptyForm = (): RuleForm => ({
  name: '',
  enabled: true,
  priority: 0,
  match_mode: 'any',
  platforms: [],
  passthrough_code: true,
  response_code: null,
  passthrough_body: true,
  custom_message: null,
  skip_monitoring: false,
  description: null
})

const toNumberOrNull = (value: string) => {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export default function ErrorPassthroughRulesModal({ show, onClose }: ErrorPassthroughRulesModalProps) {
  const { t } = useI18n()

  const [rules, setRules] = useState<ErrorPassthroughRule[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [editingRule, setEditingRule] = useState<ErrorPassthroughRule | null>(null)
  const [deletingRule, setDeletingRule] = useState<ErrorPassthroughRule | null>(null)

  // Form inputs for arrays
  const [errorCodesInput, setErrorCodesInput] = useState('')
  const [keywordsInput, setKeywordsInput] = useState('')
  const [form, setForm] = useState<RuleForm>(emptyForm)

  const updateForm = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const matchModeOptions = [
    { value: 'any', label: t('admin.errorPassthrough.matchMode.any'), description: t('admin.errorPassthrough.matchMode.anyHint') },
    { value: 'all', label: t('admin.errorPassthrough.matchMode.all'), description: t('admin.errorPassthrough.matchMode.allHint') }
  ]

  const platformOptions = CONCRETE_PLATFORM_OPTIONS

  const loadRules = async () => {
    setLoading(true)
    try {
      setRules(await adminAPI.errorPassthrough.list())
    } catch (error) {
      useAppStore.getState().showError(t('admin.errorPassthrough.failedToLoad'))
      console.error('Error loading rules:', error)
    } finally {
      setLoading(false)
    }
  }

  // Load rules when dialog opens
  useEffect(() => {
    if (!show) return
    // 只在打开时加载（Vue 版 watch(show)）
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 打开时拉取规则，属于与后端同步的副作用
    void loadRules()
  }, [show]) // eslint-disable-line react-hooks/exhaustive-deps

  const resetForm = () => {
    setForm(emptyForm())
    setErrorCodesInput('')
    setKeywordsInput('')
  }

  const closeFormModal = () => {
    setShowCreateModal(false)
    setShowEditModal(false)
    setEditingRule(null)
    resetForm()
  }

  const handleEdit = (rule: ErrorPassthroughRule) => {
    setEditingRule(rule)
    setForm({
      name: rule.name,
      enabled: rule.enabled,
      priority: rule.priority,
      match_mode: rule.match_mode,
      platforms: [...rule.platforms],
      passthrough_code: rule.passthrough_code,
      response_code: rule.response_code,
      passthrough_body: rule.passthrough_body,
      custom_message: rule.custom_message,
      skip_monitoring: rule.skip_monitoring,
      description: rule.description
    })
    setErrorCodesInput(rule.error_codes.join(', '))
    setKeywordsInput(rule.keywords.join('\n'))
    setShowEditModal(true)
  }

  const handleDelete = (rule: ErrorPassthroughRule) => {
    setDeletingRule(rule)
    setShowDeleteDialog(true)
  }

  const parseErrorCodes = (): number[] => {
    if (!errorCodesInput.trim()) return []
    return errorCodesInput
      .split(/[,\s]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0)
  }

  const parseKeywords = (): string[] => {
    if (!keywordsInput.trim()) return []
    return keywordsInput
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault()
    const appStore = useAppStore.getState()
    if (!form.name.trim()) {
      appStore.showError(t('admin.errorPassthrough.nameRequired'))
      return
    }

    const errorCodes = parseErrorCodes()
    const keywords = parseKeywords()

    if (errorCodes.length === 0 && keywords.length === 0) {
      appStore.showError(t('admin.errorPassthrough.conditionsRequired'))
      return
    }

    setSubmitting(true)
    try {
      const data = {
        name: form.name.trim(),
        enabled: form.enabled,
        priority: form.priority,
        error_codes: errorCodes,
        keywords: keywords,
        match_mode: form.match_mode,
        platforms: form.platforms,
        passthrough_code: form.passthrough_code,
        response_code: form.passthrough_code ? null : form.response_code,
        passthrough_body: form.passthrough_body,
        custom_message: form.passthrough_body ? null : form.custom_message,
        skip_monitoring: form.skip_monitoring,
        description: form.description?.trim() || null
      }

      if (showEditModal && editingRule) {
        await adminAPI.errorPassthrough.update(editingRule.id, data)
        appStore.showSuccess(t('admin.errorPassthrough.ruleUpdated'))
      } else {
        await adminAPI.errorPassthrough.create(data)
        appStore.showSuccess(t('admin.errorPassthrough.ruleCreated'))
      }

      closeFormModal()
      void loadRules()
    } catch (error: any) {
      appStore.showError(error.response?.data?.detail || t('admin.errorPassthrough.failedToSave'))
      console.error('Error saving rule:', error)
    } finally {
      setSubmitting(false)
    }
  }

  const toggleEnabled = async (rule: ErrorPassthroughRule) => {
    try {
      const updated = await adminAPI.errorPassthrough.toggleEnabled(rule.id, !rule.enabled)
      setRules((prev) => prev.map((item) => (item.id === rule.id ? { ...item, enabled: updated.enabled } : item)))
    } catch (error: any) {
      useAppStore.getState().showError(error.response?.data?.detail || t('admin.errorPassthrough.failedToToggle'))
      console.error('Error toggling rule:', error)
    }
  }

  const confirmDelete = async () => {
    if (!deletingRule) return

    try {
      await adminAPI.errorPassthrough.delete(deletingRule.id)
      useAppStore.getState().showSuccess(t('admin.errorPassthrough.ruleDeleted'))
      setShowDeleteDialog(false)
      setDeletingRule(null)
      void loadRules()
    } catch (error: any) {
      useAppStore.getState().showError(error.response?.data?.detail || t('admin.errorPassthrough.failedToDelete'))
      console.error('Error deleting rule:', error)
    }
  }

  const togglePlatform = (value: string, checked: boolean) =>
    setForm((prev) => ({
      ...prev,
      platforms: checked ? [...prev.platforms, value] : prev.platforms.filter((item) => item !== value)
    }))

  let content
  if (loading) {
    content = (
      <div className={styles.loading} aria-busy="true">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} height={44} />
        ))}
      </div>
    )
  } else if (rules.length === 0) {
    content = (
      <EmptyState
        icon={<ShieldCheck />}
        title={t('admin.errorPassthrough.noRules')}
        description={t('admin.errorPassthrough.createFirstRule')}
      />
    )
  } else {
    content = (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('admin.errorPassthrough.columns.priority')}</th>
              <th>{t('admin.errorPassthrough.columns.name')}</th>
              <th>{t('admin.errorPassthrough.columns.conditions')}</th>
              <th>{t('admin.errorPassthrough.columns.platforms')}</th>
              <th>{t('admin.errorPassthrough.columns.behavior')}</th>
              <th>{t('admin.errorPassthrough.columns.status')}</th>
              <th>{t('admin.errorPassthrough.columns.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td className={styles.nowrap}>
                  <span className={styles.priority}>{rule.priority}</span>
                </td>
                <td>
                  <div className={styles.ruleName}>{rule.name}</div>
                  {rule.description ? <div className={styles.ruleDescription}>{rule.description}</div> : null}
                </td>
                <td>
                  <div className={styles.chips}>
                    {rule.error_codes.slice(0, 3).map((code) => (
                      <Badge key={code} size="sm" tone="danger">
                        {String(code)}
                      </Badge>
                    ))}
                    {rule.error_codes.length > 3 ? (
                      <span className={styles.more}>+{rule.error_codes.length - 3}</span>
                    ) : null}
                    {rule.keywords.slice(0, 1).map((keyword) => (
                      <Badge key={keyword} size="sm" tone="neutral">
                        {`"${keyword.length > 10 ? keyword.substring(0, 10) + '...' : keyword}"`}
                      </Badge>
                    ))}
                    {rule.keywords.length > 1 ? <span className={styles.more}>+{rule.keywords.length - 1}</span> : null}
                  </div>
                  <div className={styles.subtle}>{t('admin.errorPassthrough.matchMode.' + rule.match_mode)}</div>
                </td>
                <td>
                  {rule.platforms.length === 0 ? (
                    <div className={styles.subtle}>{t('admin.errorPassthrough.allPlatforms')}</div>
                  ) : (
                    <div className={styles.chips}>
                      {rule.platforms.slice(0, 2).map((platform) => (
                        <Badge key={platform} size="sm" tone="info">
                          {platform}
                        </Badge>
                      ))}
                      {rule.platforms.length > 2 ? <span className={styles.more}>+{rule.platforms.length - 2}</span> : null}
                    </div>
                  )}
                </td>
                <td>
                  <div className={styles.behavior}>
                    <div className={styles.behaviorRow}>
                      {rule.passthrough_code ? (
                        <CircleCheck className={styles.on} aria-hidden="true" />
                      ) : (
                        <CircleX className={styles.off} aria-hidden="true" />
                      )}
                      <span>
                        {t('admin.errorPassthrough.code')}:{' '}
                        {rule.passthrough_code ? t('admin.errorPassthrough.passthrough') : rule.response_code || '-'}
                      </span>
                    </div>
                    <div className={styles.behaviorRow}>
                      {rule.passthrough_body ? (
                        <CircleCheck className={styles.on} aria-hidden="true" />
                      ) : (
                        <CircleX className={styles.off} aria-hidden="true" />
                      )}
                      <span>
                        {t('admin.errorPassthrough.body')}:{' '}
                        {rule.passthrough_body ? t('admin.errorPassthrough.passthrough') : t('admin.errorPassthrough.custom')}
                      </span>
                    </div>
                    {rule.skip_monitoring ? (
                      <div className={styles.behaviorRow}>
                        <CircleCheck className={styles.warn} aria-hidden="true" />
                        <span>{t('admin.errorPassthrough.skipMonitoring')}</span>
                      </div>
                    ) : null}
                  </div>
                </td>
                <td>
                  <Toggle
                    value={rule.enabled}
                    onChange={() => void toggleEnabled(rule)}
                    aria-label={t('admin.errorPassthrough.columns.status')}
                  />
                </td>
                <td>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => handleEdit(rule)}
                      title={t('common.edit')}
                      aria-label={t('common.edit')}
                    >
                      <Pencil aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={`${styles.iconButton} ${styles.danger}`}
                      onClick={() => handleDelete(rule)}
                      title={t('common.delete')}
                      aria-label={t('common.delete')}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <>
      <BaseDialog
        show={show}
        title={t('admin.errorPassthrough.title')}
        width="extra-wide"
        onClose={() => onClose?.()}
        footer={
          <Button variant="secondary" type="button" onClick={() => onClose?.()}>
            {t('common.close')}
          </Button>
        }
      >
        <div className={styles.stack}>
          {/* Header */}
          <div className={styles.header}>
            <p className={styles.description}>{t('admin.errorPassthrough.description')}</p>
            <Button type="button" size="sm" onClick={() => setShowCreateModal(true)}>
              <Plus aria-hidden="true" />
              {t('admin.errorPassthrough.createRule')}
            </Button>
          </div>
          {content}
        </div>
      </BaseDialog>

      {/* Create/Edit Modal */}
      <BaseDialog
        show={showCreateModal || showEditModal}
        title={showEditModal ? t('admin.errorPassthrough.editRule') : t('admin.errorPassthrough.createRule')}
        width="wide"
        onClose={closeFormModal}
        footer={
          <>
            <Button variant="secondary" type="button" onClick={closeFormModal}>
              {t('common.cancel')}
            </Button>
            <Button type="button" loading={submitting} onClick={() => void handleSubmit()}>
              {showEditModal ? t('common.update') : t('common.create')}
            </Button>
          </>
        }
      >
        <form className={styles.form} onSubmit={handleSubmit}>
          {/* Basic Info */}
          <div className={styles.pair}>
            <Input
              label={t('admin.errorPassthrough.form.name')}
              value={form.name}
              onChange={(value) => updateForm('name', value)}
              required
              placeholder={t('admin.errorPassthrough.form.namePlaceholder')}
            />
            <Input
              label={t('admin.errorPassthrough.form.priority')}
              type="number"
              min={0}
              value={form.priority}
              onChange={(value) => updateForm('priority', toNumberOrNull(value) ?? 0)}
              hint={t('admin.errorPassthrough.form.priorityHint')}
            />
          </div>

          <Input
            label={t('admin.errorPassthrough.form.description')}
            value={form.description}
            onChange={(value) => updateForm('description', value)}
            placeholder={t('admin.errorPassthrough.form.descriptionPlaceholder')}
          />

          {/* Match Conditions */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('admin.errorPassthrough.form.matchConditions')}</h3>
            <div className={styles.pair}>
              <Input
                label={t('admin.errorPassthrough.form.errorCodes')}
                value={errorCodesInput}
                onChange={setErrorCodesInput}
                placeholder={t('admin.errorPassthrough.form.errorCodesPlaceholder')}
                hint={t('admin.errorPassthrough.form.errorCodesHint')}
              />
              <TextArea
                label={t('admin.errorPassthrough.form.keywords')}
                value={keywordsInput}
                onChange={setKeywordsInput}
                rows={2}
                className={styles.mono}
                placeholder={t('admin.errorPassthrough.form.keywordsPlaceholder')}
                hint={t('admin.errorPassthrough.form.keywordsHint')}
              />
            </div>

            <RadioGroup
              label={t('admin.errorPassthrough.form.matchMode')}
              options={matchModeOptions}
              value={form.match_mode}
              onValueChange={(value) => updateForm('match_mode', value as RuleForm['match_mode'])}
            />

            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('admin.errorPassthrough.form.platforms')}</span>
              <div className={styles.platforms}>
                {platformOptions.map((platform) => (
                  <Checkbox
                    key={platform.value}
                    label={platform.label}
                    checked={form.platforms.includes(platform.value)}
                    onCheckedChange={(checked) => togglePlatform(platform.value, checked === true)}
                  />
                ))}
              </div>
              <p className={styles.hint}>{t('admin.errorPassthrough.form.platformsHint')}</p>
            </div>
          </section>

          {/* Response Behavior */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('admin.errorPassthrough.form.responseBehavior')}</h3>
            <div className={styles.pair}>
              <div className={styles.field}>
                <Checkbox
                  label={t('admin.errorPassthrough.form.passthroughCode')}
                  checked={form.passthrough_code}
                  onCheckedChange={(checked) => updateForm('passthrough_code', checked === true)}
                />
                {!form.passthrough_code ? (
                  <Input
                    label={t('admin.errorPassthrough.form.responseCode')}
                    type="number"
                    min={100}
                    max={599}
                    value={form.response_code}
                    onChange={(value) => updateForm('response_code', toNumberOrNull(value))}
                    placeholder="422"
                  />
                ) : null}
              </div>
              <div className={styles.field}>
                <Checkbox
                  label={t('admin.errorPassthrough.form.passthroughBody')}
                  checked={form.passthrough_body}
                  onCheckedChange={(checked) => updateForm('passthrough_body', checked === true)}
                />
                {!form.passthrough_body ? (
                  <Input
                    label={t('admin.errorPassthrough.form.customMessage')}
                    value={form.custom_message}
                    onChange={(value) => updateForm('custom_message', value)}
                    placeholder={t('admin.errorPassthrough.form.customMessagePlaceholder')}
                  />
                ) : null}
              </div>
            </div>
          </section>

          {/* Skip Monitoring */}
          <Checkbox
            label={t('admin.errorPassthrough.form.skipMonitoring')}
            description={t('admin.errorPassthrough.form.skipMonitoringHint')}
            checked={form.skip_monitoring}
            onCheckedChange={(checked) => updateForm('skip_monitoring', checked === true)}
          />

          {/* Enabled */}
          <Checkbox
            label={t('admin.errorPassthrough.form.enabled')}
            checked={form.enabled}
            onCheckedChange={(checked) => updateForm('enabled', checked === true)}
          />
        </form>
      </BaseDialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        show={showDeleteDialog}
        title={t('admin.errorPassthrough.deleteRule')}
        message={t('admin.errorPassthrough.deleteConfirm', { name: deletingRule?.name })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setShowDeleteDialog(false)}
      />
    </>
  )
}
