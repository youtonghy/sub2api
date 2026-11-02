/**
 * 分组推理强度策略字段，对应 Vue 版 ReasoningEffortPolicyFields.vue：
 * 最大推理强度、超限处理方式，以及按模型范围配置的推理强度映射（每组可有多对 from → to）。
 * 通过 ref 暴露 validate / resetValidation；校验错误只在调用 validate 之后展示。
 */
import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { useImperativeHandle, useMemo, useRef, useState, useEffect, type Ref } from 'react'

import arcInput from '@/components/arc/input/input.module.css'
import Select, { type SelectValue } from '@/components/common/Select'
import { useI18n } from '@/i18n/useI18n'
import type { GroupPlatform } from '@/types'
import {
  createReasoningEffortMappingPair,
  createReasoningEffortMappingRow,
  normalizeReasoningEffortMatchType,
  reasoningEffortMappingDeny,
  reasoningEffortOptionsForPlatform,
  reasoningEffortOverLimitDeny,
  reasoningEffortOverLimitDowngrade,
  reasoningEffortSourceOptionsForPlatform,
  reasoningEffortTargetOptionsForPlatform,
  validateReasoningEffortMappings,
  type ReasoningEffortMappingErrorCode,
  type ReasoningEffortMappingRow
} from '@/views/admin/groupsReasoningEffort'
import styles from './ReasoningEffortPolicyFields.module.css'

export interface ReasoningEffortPolicyFieldsHandle {
  validate: () => boolean
  resetValidation: () => void
}

export interface ReasoningEffortPolicyFieldsProps {
  idPrefix: string
  platform: GroupPlatform
  maxEffort: string
  onMaxEffortChange: (value: string) => void
  overLimit: string
  onOverLimitChange: (value: string) => void
  mappings: ReasoningEffortMappingRow[]
  onMappingsChange: (value: ReasoningEffortMappingRow[]) => void
  ref?: Ref<ReasoningEffortPolicyFieldsHandle | null>
}

const asString = (value: SelectValue | undefined): string => (value == null ? '' : String(value))

export default function ReasoningEffortPolicyFields({
  idPrefix,
  platform,
  maxEffort,
  onMaxEffortChange,
  overLimit,
  onOverLimitChange,
  mappings,
  onMappingsChange,
  ref
}: ReasoningEffortPolicyFieldsProps) {
  const { t } = useI18n()
  const [showValidation, setShowValidation] = useState(false)

  const reasoningEffortOptions = reasoningEffortOptionsForPlatform(platform)
  const reasoningEffortSourceOptions = reasoningEffortSourceOptionsForPlatform(platform)
  const reasoningEffortTargetOptions = reasoningEffortTargetOptionsForPlatform(platform).map((option) =>
    option.value === reasoningEffortMappingDeny
      ? { ...option, label: t('admin.groups.form.reasoningEffortToDeny') }
      : option
  )
  const matchTypeOptions = [
    { value: 'exact', label: t('admin.groups.form.reasoningEffortMatchExact') },
    { value: 'prefix', label: t('admin.groups.form.reasoningEffortMatchPrefix') },
    { value: 'suffix', label: t('admin.groups.form.reasoningEffortMatchSuffix') }
  ]
  const overLimitOptions = [
    { value: reasoningEffortOverLimitDowngrade, label: t('admin.groups.form.maxReasoningEffortOverLimitDowngrade') },
    { value: reasoningEffortOverLimitDeny, label: t('admin.groups.form.maxReasoningEffortOverLimitDeny') }
  ]
  const validationErrors = useMemo(() => validateReasoningEffortMappings(mappings, platform), [mappings, platform])

  // validate 在提交时同步调用，读取最新的校验结果
  const latestErrors = useRef(validationErrors)
  useEffect(() => {
    latestErrors.current = validationErrors
  })

  const groupErrors = (id: string) => validationErrors[id] ?? {}
  const pairErrors = (id: string) => validationErrors[id] ?? {}

  const updateGroup = (id: string, field: 'match_type' | 'model', value: SelectValue | undefined) => {
    const nextValue = field === 'match_type' ? normalizeReasoningEffortMatchType(asString(value)) : asString(value)
    onMappingsChange(mappings.map((group) => (group.id === id ? { ...group, [field]: nextValue } : group)))
  }

  const updatePair = (groupId: string, pairId: string, field: 'from' | 'to', value: SelectValue | undefined) => {
    onMappingsChange(
      mappings.map((group) =>
        group.id === groupId
          ? {
              ...group,
              pairs: group.pairs.map((pair) => (pair.id === pairId ? { ...pair, [field]: asString(value) } : pair))
            }
          : group
      )
    )
  }

  const addGroup = () => {
    onMappingsChange([...mappings, createReasoningEffortMappingRow()])
  }

  const removeGroup = (id: string) => {
    onMappingsChange(mappings.filter((group) => group.id !== id))
  }

  const addPair = (groupId: string) => {
    onMappingsChange(
      mappings.map((group) =>
        group.id === groupId ? { ...group, pairs: [...group.pairs, createReasoningEffortMappingPair()] } : group
      )
    )
  }

  const removePair = (groupId: string, pairId: string) => {
    onMappingsChange(
      mappings.flatMap((group) => {
        if (group.id !== groupId) return [group]
        const pairs = group.pairs.filter((pair) => pair.id !== pairId)
        return pairs.length > 0 ? [{ ...group, pairs }] : []
      })
    )
  }

  const mappingErrorText = (code: ReasoningEffortMappingErrorCode | undefined): string =>
    code ? t(`admin.groups.form.${code}`) : ''

  useImperativeHandle(
    ref,
    () => ({
      validate: () => {
        setShowValidation(true)
        return Object.keys(latestErrors.current).length === 0
      },
      resetValidation: () => setShowValidation(false)
    }),
    []
  )

  return (
    <div className={styles.root}>
      <div className={styles.field}>
        <label htmlFor={`${idPrefix}-max-effort`} className={styles.label}>
          {t('admin.groups.form.maxReasoningEffort')}
        </label>
        <Select
          id={`${idPrefix}-max-effort`}
          value={maxEffort}
          options={reasoningEffortOptions}
          placeholder={t('admin.groups.form.maxReasoningEffortUnlimited')}
          aria-label={t('admin.groups.form.maxReasoningEffort')}
          searchable={false}
          clearable
          onChange={(value) => onMaxEffortChange(asString(value))}
        />
        <p className={styles.hint}>{t('admin.groups.form.maxReasoningEffortHint')}</p>
      </div>

      <div className={styles.field}>
        <label htmlFor={`${idPrefix}-over-limit`} className={styles.label}>
          {t('admin.groups.form.maxReasoningEffortOverLimit')}
        </label>
        <Select
          id={`${idPrefix}-over-limit`}
          value={overLimit}
          options={overLimitOptions}
          aria-label={t('admin.groups.form.maxReasoningEffortOverLimit')}
          searchable={false}
          disabled={!maxEffort}
          onChange={(value) => onOverLimitChange(asString(value) || reasoningEffortOverLimitDowngrade)}
        />
        <p className={styles.hint}>{t('admin.groups.form.maxReasoningEffortOverLimitHint')}</p>
      </div>

      <div className={styles.mappings}>
        <div className={styles.mappingsHeader}>
          <div className={styles.mappingsHeading}>
            <span className={styles.label}>{t('admin.groups.form.reasoningEffortMappings')}</span>
            <p className={styles.hint}>{t('admin.groups.form.reasoningEffortMappingsHint')}</p>
          </div>
          <button type="button" className={styles.addButton} onClick={addGroup}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            {t('admin.groups.form.addReasoningEffortMapping')}
          </button>
        </div>

        {mappings.length > 0 ? (
          <div className={styles.groups}>
            {mappings.map((group) => (
              <div key={group.id} className={styles.group}>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label htmlFor={`${idPrefix}-${group.id}-match-type`} className={styles.label}>
                      {t('admin.groups.form.reasoningEffortMatchType')}
                    </label>
                    <Select
                      id={`${idPrefix}-${group.id}-match-type`}
                      value={group.match_type}
                      options={matchTypeOptions}
                      placeholder={t('admin.groups.form.reasoningEffortMatchTypePlaceholder')}
                      error={showValidation && !!groupErrors(group.id).match_type}
                      aria-label={t('admin.groups.form.reasoningEffortMatchType')}
                      searchable={false}
                      clearable
                      onChange={(value) => updateGroup(group.id, 'match_type', value)}
                    />
                    {showValidation && groupErrors(group.id).match_type ? (
                      <p className={styles.error} role="alert">
                        {mappingErrorText(groupErrors(group.id).match_type)}
                      </p>
                    ) : null}
                  </div>

                  <div className={styles.spacer} aria-hidden="true" />

                  <div className={styles.field}>
                    <label htmlFor={`${idPrefix}-${group.id}-model`} className={styles.label}>
                      {t('admin.groups.form.reasoningEffortModel')}
                    </label>
                    <input
                      id={`${idPrefix}-${group.id}-model`}
                      value={group.model}
                      type="text"
                      maxLength={200}
                      autoComplete="off"
                      className={arcInput.input}
                      placeholder={t('admin.groups.form.reasoningEffortModelPlaceholder')}
                      aria-label={t('admin.groups.form.reasoningEffortModel')}
                      onChange={(event) => updateGroup(group.id, 'model', event.target.value)}
                    />
                  </div>

                  <button
                    type="button"
                    className={styles.removeButton}
                    title={t('admin.groups.form.removeReasoningEffortMapping')}
                    aria-label={t('admin.groups.form.removeReasoningEffortMapping')}
                    onClick={() => removeGroup(group.id)}
                  >
                    <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </div>

                {showValidation && groupErrors(group.id).duplicateScope ? (
                  <p className={styles.error} role="alert">
                    {mappingErrorText(groupErrors(group.id).duplicateScope)}
                  </p>
                ) : null}

                {group.pairs.map((pair) => (
                  <div key={pair.id} className={styles.row}>
                    <div className={styles.field}>
                      <label htmlFor={`${idPrefix}-${pair.id}-from`} className={styles.label}>
                        {t('admin.groups.form.reasoningEffortFrom')}
                      </label>
                      <Select
                        id={`${idPrefix}-${pair.id}-from`}
                        value={pair.from}
                        options={reasoningEffortSourceOptions}
                        placeholder={t('admin.groups.form.reasoningEffortFromPlaceholder')}
                        error={showValidation && !!pairErrors(pair.id).from}
                        aria-label={t('admin.groups.form.reasoningEffortFrom')}
                        searchable={false}
                        clearable
                        onChange={(value) => updatePair(group.id, pair.id, 'from', value)}
                      />
                      {showValidation && pairErrors(pair.id).from ? (
                        <p className={styles.error} role="alert">
                          {mappingErrorText(pairErrors(pair.id).from)}
                        </p>
                      ) : null}
                    </div>

                    <div className={styles.arrow} aria-hidden="true">
                      <ArrowRight size={16} strokeWidth={1.75} />
                    </div>

                    <div className={styles.field}>
                      <label htmlFor={`${idPrefix}-${pair.id}-to`} className={styles.label}>
                        {t('admin.groups.form.reasoningEffortTo')}
                      </label>
                      <Select
                        id={`${idPrefix}-${pair.id}-to`}
                        value={pair.to}
                        options={reasoningEffortTargetOptions}
                        placeholder={t('admin.groups.form.reasoningEffortToPlaceholder')}
                        error={showValidation && !!pairErrors(pair.id).to}
                        aria-label={t('admin.groups.form.reasoningEffortTo')}
                        searchable={false}
                        clearable
                        onChange={(value) => updatePair(group.id, pair.id, 'to', value)}
                      />
                      {showValidation && pairErrors(pair.id).to ? (
                        <p className={styles.error} role="alert">
                          {mappingErrorText(pairErrors(pair.id).to)}
                        </p>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      className={styles.removeButton}
                      title={t('admin.groups.form.removeReasoningEffortPair')}
                      aria-label={t('admin.groups.form.removeReasoningEffortPair')}
                      onClick={() => removePair(group.id, pair.id)}
                    >
                      <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                ))}

                <button type="button" className={styles.addPairButton} onClick={() => addPair(group.id)}>
                  <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
                  {t('admin.groups.form.addReasoningEffortPair')}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
