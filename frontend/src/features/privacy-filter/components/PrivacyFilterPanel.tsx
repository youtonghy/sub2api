import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import Toggle from '@/components/common/Toggle'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminGroup } from '@/types'
import { extractApiErrorMessage } from '@/utils/apiError'
import { adminPrivacyFilterAPI } from '../api'
import styles from '../privacyFilter.module.css'
import {
  PRIVACY_FILTER_CATEGORIES,
  type PrivacyFilterCategory,
  type PrivacyFilterConfig,
  type PrivacyFilterMode,
  type PrivacyFilterStatus
} from '../types'

interface PrivacyFilterPanelProps {
  groups: AdminGroup[]
}

/** 隐私过滤的模式、类别与生效分组设置，带独立的保存动作。 */
export default function PrivacyFilterPanel({ groups }: PrivacyFilterPanelProps) {
  const { t } = useI18n()
  const [config, setConfig] = useState<PrivacyFilterConfig | null>(null)
  const [status, setStatus] = useState<PrivacyFilterStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [groupSearch, setGroupSearch] = useState('')

  const load = useCallback(async () => {
    try {
      const [nextConfig, nextStatus] = await Promise.all([
        adminPrivacyFilterAPI.getConfig(),
        adminPrivacyFilterAPI.getStatus()
      ])
      setConfig(nextConfig)
      setStatus(nextStatus)
    } catch (err) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('privacyFilter.loadFailed')))
    }
  }, [t])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时拉取配置，属于与后端同步的副作用
    void load()
  }, [load])

  const filteredGroups = useMemo(() => {
    const keyword = groupSearch.trim().toLowerCase()
    if (!keyword) return groups
    return groups.filter((group) => group.name.toLowerCase().includes(keyword))
  }, [groups, groupSearch])

  if (!config) return null

  const patch = (next: Partial<PrivacyFilterConfig>) => setConfig((prev) => (prev ? { ...prev, ...next } : prev))

  const toggleCategory = (category: PrivacyFilterCategory, enabled: boolean) => {
    patch({
      categories: enabled
        ? [...config.categories, category]
        : config.categories.filter((item) => item !== category)
    })
  }

  const toggleGroup = (groupID: number) => {
    patch({
      group_ids: config.group_ids.includes(groupID)
        ? config.group_ids.filter((id) => id !== groupID)
        : [...config.group_ids, groupID]
    })
  }

  const save = async () => {
    setSaving(true)
    const appStore = useAppStore.getState()
    try {
      setConfig(await adminPrivacyFilterAPI.updateConfig(config))
      setStatus(await adminPrivacyFilterAPI.getStatus())
      appStore.showSuccess(t('privacyFilter.saved'))
    } catch (err) {
      appStore.showError(extractApiErrorMessage(err, t('privacyFilter.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={styles.region} data-test="privacy-filter-panel">
      <div className={styles.regionHeader}>
        <div>
          <h2 className={styles.h2}>{t('privacyFilter.title')}</h2>
          <p className={styles.hint}>{t('privacyFilter.hint')}</p>
        </div>
        <Button type="button" variant="primary" disabled={saving} loading={saving} onClick={() => void save()}>
          {saving ? null : <Check size={16} aria-hidden="true" />}
          {saving ? t('common.saving') : t('privacyFilter.save')}
        </Button>
      </div>

      <div className={styles.subRegionBody}>
        <div className={styles.sectionHead}>
          <div>
            <h3 className={styles.h3}>{t('privacyFilter.mode')}</h3>
            <p className={styles.hint}>{t(`privacyFilter.modeHint.${config.mode}`)}</p>
          </div>
          <SegmentedControl
            options={[
              { value: 'off', label: t('privacyFilter.modes.off') },
              { value: 'observe', label: t('privacyFilter.modes.observe') },
              { value: 'redact', label: t('privacyFilter.modes.redact') },
              { value: 'restore', label: t('privacyFilter.modes.restore') }
            ]}
            value={config.mode}
            onValueChange={(value) => patch({ mode: value as PrivacyFilterMode })}
            label={t('privacyFilter.mode')}
          />
        </div>

        {config.mode === 'restore' ? (
          <Alert tone="info" title={t('privacyFilter.restoreNotice')} role="status" />
        ) : null}

        {config.mode === 'redact' ? (
          <Alert tone="warning" title={t('privacyFilter.redactWarning')} role="status" />
        ) : null}

        {status ? (
          <div className={styles.chips}>
            <span className={styles.chip}>
              {t('privacyFilter.stats.scanned', { count: status.scanned_requests })}
            </span>
            <span className={styles.chip}>
              {t('privacyFilter.stats.hit', { count: status.hit_requests })}
            </span>
            <span className={styles.chip}>
              {t('privacyFilter.stats.redacted', { count: status.redacted_requests })}
            </span>
            {status.restored_tokens > 0 || status.unresolved_tokens > 0 ? (
              <span className={styles.chip}>
                {t('privacyFilter.stats.restored', {
                  restored: status.restored_tokens,
                  unresolved: status.unresolved_tokens
                })}
              </span>
            ) : null}
            <span className={status.failed_requests > 0 ? `${styles.chip} ${styles.chipDanger}` : styles.chip}>
              {t('privacyFilter.stats.failed', { count: status.failed_requests })}
            </span>
            {status.dropped_events + status.failed_event_writes > 0 ? (
              <span className={`${styles.chip} ${styles.chipDanger}`}>
                {t('privacyFilter.stats.dropped', { count: status.dropped_events + status.failed_event_writes })}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className={styles.stackGap2}>
          <h3 className={styles.h3}>{t('privacyFilter.categoriesTitle')}</h3>
          {PRIVACY_FILTER_CATEGORIES.map((category) => (
            <div key={category} className={styles.toggleRow}>
              <div className={styles.minW0}>
                <span className={styles.h3}>{t(`privacyFilter.categories.${category}.label`)}</span>
                <p className={styles.hint}>
                  {t(`privacyFilter.categories.${category}.description`)}
                  {status && status.category_counts[category]
                    ? ` ${t('privacyFilter.stats.category', { count: status.category_counts[category] })}`
                    : ''}
                </p>
              </div>
              <Toggle
                value={config.categories.includes(category)}
                onChange={(enabled) => toggleCategory(category, enabled)}
                aria-label={t(`privacyFilter.categories.${category}.label`)}
              />
            </div>
          ))}
        </div>

        <div className={styles.stackGap3}>
          <div>
            <h3 className={styles.h3}>{t('privacyFilter.groups')}</h3>
            <p className={styles.hint}>{t('privacyFilter.groupsHint')}</p>
          </div>
          <div className={styles.searchWrap}>
            <Search size={16} aria-hidden="true" className={styles.searchIcon} />
            <input
              type="search"
              className={`${styles.input} ${styles.searchInput}`}
              value={groupSearch}
              placeholder={t('privacyFilter.searchGroups')}
              aria-label={t('privacyFilter.searchGroups')}
              onChange={(event) => setGroupSearch(event.target.value)}
            />
          </div>
          <div className={styles.groupGrid}>
            {filteredGroups.map((group) => {
              const selected = config.group_ids.includes(group.id)
              return (
                <button
                  key={group.id}
                  type="button"
                  className={styles.groupCard}
                  aria-pressed={selected}
                  onClick={() => toggleGroup(group.id)}
                >
                  <span className={styles.minW0}>
                    <span className={styles.groupName}>{group.name}</span>
                    <span className={styles.chip}>{group.platform}</span>
                  </span>
                  <span className={styles.checkCircle} data-checked={selected ? 'true' : undefined}>
                    <Check size={12} aria-hidden="true" />
                  </span>
                </button>
              )
            })}
            {filteredGroups.length === 0 ? <p className={styles.hint}>{t('privacyFilter.noGroups')}</p> : null}
          </div>
        </div>
      </div>
    </section>
  )
}
