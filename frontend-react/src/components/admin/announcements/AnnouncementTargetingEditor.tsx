import { Plus, Trash2 } from 'lucide-react'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { RadioGroup } from '@/components/arc/radio-group/radio-group'
import GroupSelector from '@/components/common/GroupSelector'
import Select from '@/components/common/Select'
import { useI18n } from '@/i18n/useI18n'
import type {
  AdminGroup,
  AnnouncementCondition,
  AnnouncementConditionGroup,
  AnnouncementConditionType,
  AnnouncementOperator,
  AnnouncementTargeting
} from '@/types'
import styles from './AnnouncementTargetingEditor.module.css'

export interface AnnouncementTargetingEditorProps {
  /** 当前定向规则（Vue 版 v-model） */
  value: AnnouncementTargeting
  onChange: (value: AnnouncementTargeting) => void
  groups: AdminGroup[]
}

type Mode = 'all' | 'custom'

type TargetingDraft = {
  any_of: AnnouncementConditionGroup[]
}

function defaultSubscriptionCondition(): AnnouncementCondition {
  return {
    type: 'subscription' as AnnouncementConditionType,
    operator: 'in' as AnnouncementOperator,
    group_ids: []
  }
}

function defaultBalanceCondition(): AnnouncementCondition {
  return {
    type: 'balance' as AnnouncementConditionType,
    operator: 'gte' as AnnouncementOperator,
    value: 0
  }
}

export default function AnnouncementTargetingEditor({ value, onChange, groups }: AnnouncementTargetingEditorProps) {
  const { t } = useI18n()

  const anyOf = value?.any_of ?? []
  const mode: Mode = anyOf.length === 0 ? 'all' : 'custom'

  const conditionTypeOptions = [
    { value: 'subscription', label: t('admin.announcements.form.conditionSubscription') },
    { value: 'balance', label: t('admin.announcements.form.conditionBalance') }
  ]

  const balanceOperatorOptions = [
    { value: 'gt', label: t('admin.announcements.operators.gt') },
    { value: 'gte', label: t('admin.announcements.operators.gte') },
    { value: 'lt', label: t('admin.announcements.operators.lt') },
    { value: 'lte', label: t('admin.announcements.operators.lte') },
    { value: 'eq', label: t('admin.announcements.operators.eq') }
  ]

  function setMode(next: Mode) {
    if (next === 'all') {
      onChange({ any_of: [] })
      return
    }
    if (anyOf.length === 0) {
      onChange({ any_of: [{ all_of: [defaultSubscriptionCondition()] }] })
    }
  }

  function updateTargeting(mutator: (draft: TargetingDraft) => void) {
    const draft: TargetingDraft = JSON.parse(JSON.stringify(value ?? { any_of: [] }))
    if (!draft.any_of) draft.any_of = []
    mutator(draft)
    onChange(draft)
  }

  function addOrGroup() {
    updateTargeting((draft) => {
      if (draft.any_of.length >= 50) return
      draft.any_of.push({ all_of: [defaultSubscriptionCondition()] })
    })
  }

  function removeOrGroup(groupIndex: number) {
    updateTargeting((draft) => {
      draft.any_of.splice(groupIndex, 1)
    })
  }

  function addAndCondition(groupIndex: number) {
    updateTargeting((draft) => {
      const group = draft.any_of[groupIndex]
      if (!group.all_of) group.all_of = []
      if (group.all_of.length >= 50) return
      group.all_of.push(defaultSubscriptionCondition())
    })
  }

  function removeAndCondition(groupIndex: number, condIndex: number) {
    updateTargeting((draft) => {
      const group = draft.any_of[groupIndex]
      if (!group?.all_of) return
      group.all_of.splice(condIndex, 1)
    })
  }

  function setConditionType(groupIndex: number, condIndex: number, nextType: AnnouncementConditionType) {
    updateTargeting((draft) => {
      const group = draft.any_of[groupIndex]
      if (!group?.all_of) return

      if (nextType === 'subscription') {
        group.all_of[condIndex] = defaultSubscriptionCondition()
      } else {
        group.all_of[condIndex] = defaultBalanceCondition()
      }
    })
  }

  function setOperator(groupIndex: number, condIndex: number, op: AnnouncementOperator) {
    updateTargeting((draft) => {
      const group = draft.any_of[groupIndex]
      if (!group?.all_of) return

      const cond = group.all_of[condIndex]
      if (!cond) return

      cond.operator = op
    })
  }

  function setBalanceValue(groupIndex: number, condIndex: number, raw: string) {
    const n = raw === '' ? 0 : Number(raw)
    updateTargeting((draft) => {
      const group = draft.any_of[groupIndex]
      if (!group?.all_of) return

      const cond = group.all_of[condIndex]
      if (!cond) return

      cond.value = Number.isFinite(n) ? n : 0
    })
  }

  // Vue 版用并行的 subscriptionSelections 映射再回写 group_ids（并强制 operator 为 in）；
  // React 版 GroupSelector 本身受控，直接回写同样的结果。
  function setSubscriptionGroups(groupIndex: number, condIndex: number, ids: number[]) {
    updateTargeting((draft) => {
      const cond = draft.any_of[groupIndex]?.all_of?.[condIndex]
      if (!cond || cond.type !== 'subscription') return
      cond.operator = 'in' as AnnouncementOperator
      cond.group_ids = ids.slice()
    })
  }

  const validationError = (() => {
    if (mode !== 'custom') return ''

    if (anyOf.length === 0) return t('admin.announcements.form.addOrGroup')

    if (anyOf.length > 50) return 'any_of > 50'

    for (const g of anyOf) {
      const allOf = g?.all_of ?? []
      if (allOf.length === 0) return t('admin.announcements.form.addAndCondition')
      if (allOf.length > 50) return 'all_of > 50'

      for (const c of allOf) {
        if (c.type === 'subscription') {
          if (!c.group_ids || c.group_ids.length === 0) return t('admin.announcements.form.selectPackages')
        }
      }
    }

    return ''
  })()

  return (
    <div className={styles.root}>
      <div className={styles.modeRow}>
        <div className={styles.modeText}>
          <span className={styles.title}>{t('admin.announcements.form.targetingMode')}</span>
          <span className={styles.hint}>
            {mode === 'all' ? t('admin.announcements.form.targetingAll') : t('admin.announcements.form.targetingCustom')}
          </span>
        </div>
        <RadioGroup
          label={t('admin.announcements.form.targetingMode')}
          name="announcement-targeting-mode"
          value={mode}
          onValueChange={(next) => setMode(next as Mode)}
          options={[
            { value: 'all', label: t('admin.announcements.form.targetingAll') },
            { value: 'custom', label: t('admin.announcements.form.targetingCustom') }
          ]}
        />
      </div>

      {mode === 'custom' ? (
        <div className={styles.custom}>
          <div className={styles.orHeader}>
            <span className={styles.title}>
              OR
              <span className={styles.count}>({anyOf.length}/50)</span>
            </span>
            <Button type="button" variant="secondary" size="sm" disabled={anyOf.length >= 50} onClick={addOrGroup}>
              <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
              {t('admin.announcements.form.addOrGroup')}
            </Button>
          </div>

          {anyOf.length === 0 ? (
            <div className={styles.placeholder}>
              {t('admin.announcements.form.targetingCustom')}: {t('admin.announcements.form.addOrGroup')}
            </div>
          ) : null}

          {anyOf.map((group, groupIndex) => (
            <div key={groupIndex} className={styles.group}>
              <div className={styles.groupHeader}>
                <div className={styles.groupTitle}>
                  <span className={styles.title}>
                    {t('admin.announcements.form.targetingCustom')} #{groupIndex + 1}
                    <span className={styles.count}>AND ({group.all_of?.length || 0}/50)</span>
                  </span>
                  <span className={styles.hint}>{t('admin.announcements.form.addAndCondition')}</span>
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={() => removeOrGroup(groupIndex)}>
                  <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                  {t('common.delete')}
                </Button>
              </div>

              <div className={styles.conditions}>
                {(group.all_of || []).map((cond, condIndex) => (
                  <div key={condIndex} className={styles.condition}>
                    <div className={`${styles.field} ${styles.conditionType}`}>
                      <span className={styles.fieldLabel}>{t('admin.announcements.form.conditionType')}</span>
                      <Select
                        value={cond.type}
                        options={conditionTypeOptions}
                        aria-label={t('admin.announcements.form.conditionType')}
                        onChange={(v) => setConditionType(groupIndex, condIndex, v as AnnouncementConditionType)}
                      />
                    </div>

                    {cond.type === 'subscription' ? (
                      <div className={`${styles.field} ${styles.grow}`}>
                        <span className={styles.fieldLabel}>{t('admin.announcements.form.selectPackages')}</span>
                        <GroupSelector
                          value={cond.group_ids ?? []}
                          onChange={(ids) => setSubscriptionGroups(groupIndex, condIndex, ids)}
                          groups={groups}
                        />
                      </div>
                    ) : (
                      <div className={styles.balance}>
                        <div className={`${styles.field} ${styles.operator}`}>
                          <span className={styles.fieldLabel}>{t('admin.announcements.form.operator')}</span>
                          <Select
                            value={cond.operator}
                            options={balanceOperatorOptions}
                            aria-label={t('admin.announcements.form.operator')}
                            onChange={(v) => setOperator(groupIndex, condIndex, v as AnnouncementOperator)}
                          />
                        </div>
                        <div className={`${styles.field} ${styles.grow}`}>
                          <Input
                            label={t('admin.announcements.form.balanceValue')}
                            value={String(cond.value ?? '')}
                            type="number"
                            step="any"
                            onChange={(e) => setBalanceValue(groupIndex, condIndex, e.target.value)}
                          />
                        </div>
                      </div>
                    )}

                    <div className={styles.end}>
                      <Button type="button" variant="secondary" size="sm" onClick={() => removeAndCondition(groupIndex, condIndex)}>
                        <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                        {t('common.delete')}
                      </Button>
                    </div>
                  </div>
                ))}

                <div className={styles.end}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={(group.all_of?.length || 0) >= 50}
                    onClick={() => addAndCondition(groupIndex)}
                  >
                    <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
                    {t('admin.announcements.form.addAndCondition')}
                  </Button>
                </div>
              </div>
            </div>
          ))}

          {validationError ? <Alert tone="danger" title={validationError} /> : null}
        </div>
      ) : null}
    </div>
  )
}
