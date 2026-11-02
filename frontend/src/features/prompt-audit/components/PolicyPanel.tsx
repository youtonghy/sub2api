/** Prompt Audit 审计策略（分组范围、扫描器、worker 与队列），对应 Vue 版 components/PolicyPanel.vue */
import { useMemo, useState } from 'react'

import { Checkbox } from '@/components/arc/checkbox/checkbox'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { useI18n } from '@/i18n/useI18n'
import type { PromptAuditDraft, PromptAuditGroup } from '../types'
import { cloneData, SCANNER_CATALOG } from '../viewModel'
import styles from './promptAudit.module.css'

export interface PolicyPanelProps {
  draft: PromptAuditDraft
  groups: PromptAuditGroup[]
  /** Vue 版 update:draft */
  onDraftChange?: (value: PromptAuditDraft) => void
}

export default function PolicyPanel({ draft, groups, onDraftChange }: PolicyPanelProps) {
  const { t } = useI18n()
  const [groupSearch, setGroupSearch] = useState('')

  const filteredGroups = useMemo(() => {
    const query = groupSearch.trim().toLowerCase()
    if (!query) return groups
    return groups.filter((group) => `${group.name} ${group.id} ${group.platform}`.toLowerCase().includes(query))
  }, [groupSearch, groups])
  const knownGroupIds = new Set(groups.map((group) => group.id))
  const missingGroupIds = draft.group_ids.filter((id) => !knownGroupIds.has(id))

  const patch = (value: Partial<PromptAuditDraft>) => {
    onDraftChange?.({ ...cloneData(draft), ...value })
  }
  const toggleGroup = (id: number) => {
    const selected = new Set(draft.group_ids)
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
    patch({ group_ids: [...selected].sort((a, b) => a - b) })
  }
  const toggleScanner = (id: string) => {
    const selected = new Set(draft.scanners)
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
    patch({ scanners: SCANNER_CATALOG.map((item) => item.id).filter((item) => selected.has(item)) })
  }
  const scannerLabel = (id: string): string => t(`admin.promptAudit.scanners.${id}`)

  return (
    <section aria-labelledby="prompt-policy-title" className={styles.section}>
      <div>
        <h2 id="prompt-policy-title" className={styles.h2}>
          {t('admin.promptAudit.policy.title')}
        </h2>
        <p className={styles.description}>{t('admin.promptAudit.policy.description')}</p>
      </div>

      <div className={styles.policyLayout}>
        <div className={`${styles.panel} ${styles.stack}`}>
          <div className={styles.stack}>
            <h3 className={styles.h3}>{t('admin.promptAudit.policy.scope')}</h3>
            <SegmentedControl
              options={[
                { value: 'all', label: t('admin.promptAudit.policy.allGroups') },
                { value: 'selected', label: t('admin.promptAudit.policy.selectedGroups') }
              ]}
              value={draft.all_groups ? 'all' : 'selected'}
              onValueChange={(value) => patch(value === 'all' ? { all_groups: true, group_ids: [] } : { all_groups: false })}
              label={t('admin.promptAudit.policy.scope')}
            />
          </div>

          {!draft.all_groups ? (
            <div className={styles.stack}>
              <label className={styles.field}>
                <span className={styles.labelText}>{t('admin.promptAudit.policy.searchGroups')}</span>
                <input
                  type="search"
                  className={styles.input}
                  value={groupSearch}
                  aria-label={t('admin.promptAudit.policy.searchGroups')}
                  onChange={(event) => setGroupSearch(event.target.value)}
                />
              </label>
              <div className={styles.groupList}>
                {filteredGroups.map((group) => (
                  <div key={group.id} className={styles.groupItem}>
                    <Checkbox
                      checked={draft.group_ids.includes(group.id)}
                      label={group.name}
                      onCheckedChange={() => toggleGroup(group.id)}
                    />
                    <span className={styles.hint}>
                      {group.platform} · {group.status}
                    </span>
                  </div>
                ))}
                {filteredGroups.length === 0 ? <p className={styles.centerText}>{t('admin.promptAudit.policy.noGroups')}</p> : null}
              </div>
              {missingGroupIds.length ? (
                <div className={styles.warningBox}>
                  {t('admin.promptAudit.policy.missingGroups')}: {missingGroupIds.join(', ')}
                </div>
              ) : null}
              <p className={styles.hint}>{t('admin.promptAudit.policy.selectedCount', { count: draft.group_ids.length })}</p>
            </div>
          ) : null}

          <fieldset className={`${styles.fieldset} ${styles.divider}`}>
            <legend className={styles.h3}>{t('admin.promptAudit.policy.scanners')}</legend>
            <div className={`${styles.scannerGrid} ${styles.subText}`}>
              {SCANNER_CATALOG.map((scanner) => (
                <Checkbox
                  key={scanner.id}
                  checked={draft.scanners.includes(scanner.id)}
                  label={scannerLabel(scanner.id)}
                  aria-label={scannerLabel(scanner.id)}
                  onCheckedChange={() => toggleScanner(scanner.id)}
                />
              ))}
            </div>
          </fieldset>
        </div>

        <div className={`${styles.panel} ${styles.stack}`}>
          <label className={styles.field}>
            <span className={styles.labelText}>{t('admin.promptAudit.policy.workerCount')}</span>
            <input
              type="number"
              min={1}
              max={32}
              className={styles.input}
              value={draft.worker_count}
              aria-label={t('admin.promptAudit.policy.workerCount')}
              onChange={(event) => patch({ worker_count: Number(event.target.value) })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.labelText}>{t('admin.promptAudit.policy.queueCapacity')}</span>
            <input
              type="number"
              min={1}
              max={100000}
              className={styles.input}
              value={draft.queue_capacity}
              aria-label={t('admin.promptAudit.policy.queueCapacity')}
              onChange={(event) => patch({ queue_capacity: Number(event.target.value) })}
            />
          </label>
          <div className={styles.mutedBox}>
            <p className={styles.h3}>{t('admin.promptAudit.policy.strategy')}</p>
            <p className={styles.subText}>priority · {t('admin.promptAudit.policy.strategyHint')}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
