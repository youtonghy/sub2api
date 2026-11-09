import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'

import { adminAPI } from '@/api/admin'
import type {
  PrivacyFilterCategory,
  PrivacyFilterConfig,
  PrivacyFilterMode,
  PrivacyFilterStatus
} from '@/api/admin/riskControl'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import Toggle from '@/components/common/Toggle'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminGroup } from '@/types'
import { extractApiErrorMessage } from '@/utils/apiError'
import styles from '../RiskControlView.module.css'

const CATEGORIES: PrivacyFilterCategory[] = [
  'private_key',
  'public_key',
  'credential',
  'financial',
  'identity',
  'proxy',
  'email',
  'ip'
]

interface PrivacyFilterPanelProps {
  groups: AdminGroup[]
}

/** 隐私过滤有独立配置和保存动作，不进入内容审计的设置抽屉。 */
export default function PrivacyFilterPanel({ groups }: PrivacyFilterPanelProps) {
  const { t } = useI18n()
  const [config, setConfig] = useState<PrivacyFilterConfig | null>(null)
  const [status, setStatus] = useState<PrivacyFilterStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [groupSearch, setGroupSearch] = useState('')

  const load = useCallback(async () => {
    try {
      const [nextConfig, nextStatus] = await Promise.all([
        adminAPI.riskControl.getPrivacyFilterConfig(),
        adminAPI.riskControl.getPrivacyFilterStatus()
      ])
      setConfig(nextConfig)
      setStatus(nextStatus)
    } catch (err) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('admin.riskControl.privacyFilter.loadFailed')))
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
      setConfig(await adminAPI.riskControl.updatePrivacyFilterConfig(config))
      setStatus(await adminAPI.riskControl.getPrivacyFilterStatus())
      appStore.showSuccess(t('admin.riskControl.privacyFilter.saved'))
    } catch (err) {
      appStore.showError(extractApiErrorMessage(err, t('admin.riskControl.privacyFilter.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={styles.region} data-test="privacy-filter-panel">
      <div className={styles.regionHeader}>
        <div>
          <h2 className={styles.h2}>{t('admin.riskControl.privacyFilter.title')}</h2>
          <p className={styles.hint}>{t('admin.riskControl.privacyFilter.hint')}</p>
        </div>
        <Button type="button" variant="primary" disabled={saving} loading={saving} onClick={() => void save()}>
          {saving ? null : <Check size={16} aria-hidden="true" />}
          {saving ? t('common.saving') : t('admin.riskControl.privacyFilter.save')}
        </Button>
      </div>

      <div className={styles.subRegionBody}>
        <div className={styles.sectionHead}>
          <div>
            <h3 className={styles.h3}>{t('admin.riskControl.privacyFilter.mode')}</h3>
            <p className={styles.hint}>{t(`admin.riskControl.privacyFilter.modeHint.${config.mode}`)}</p>
          </div>
          <SegmentedControl
            options={[
              { value: 'off', label: t('admin.riskControl.privacyFilter.modes.off') },
              { value: 'observe', label: t('admin.riskControl.privacyFilter.modes.observe') },
              { value: 'redact', label: t('admin.riskControl.privacyFilter.modes.redact') }
            ]}
            value={config.mode}
            onValueChange={(value) => patch({ mode: value as PrivacyFilterMode })}
            label={t('admin.riskControl.privacyFilter.mode')}
          />
        </div>

        {config.mode === 'redact' ? (
          <Alert tone="warning" title={t('admin.riskControl.privacyFilter.redactWarning')} role="status" />
        ) : null}

        {status ? (
          <div className={styles.chips}>
            <span className={styles.chip}>
              {t('admin.riskControl.privacyFilter.stats.scanned', { count: status.scanned_requests })}
            </span>
            <span className={styles.chip}>
              {t('admin.riskControl.privacyFilter.stats.hit', { count: status.hit_requests })}
            </span>
            <span className={styles.chip}>
              {t('admin.riskControl.privacyFilter.stats.redacted', { count: status.redacted_requests })}
            </span>
            <span className={status.failed_requests > 0 ? `${styles.chip} ${styles.chipDanger}` : styles.chip}>
              {t('admin.riskControl.privacyFilter.stats.failed', { count: status.failed_requests })}
            </span>
          </div>
        ) : null}

        <div className={styles.stackGap2}>
          <h3 className={styles.h3}>{t('admin.riskControl.privacyFilter.categoriesTitle')}</h3>
          {CATEGORIES.map((category) => (
            <div key={category} className={styles.toggleRow}>
              <div className={styles.minW0}>
                <span className={styles.h3}>{t(`admin.riskControl.privacyFilter.categories.${category}.label`)}</span>
                <p className={styles.hint}>
                  {t(`admin.riskControl.privacyFilter.categories.${category}.description`)}
                  {status && status.category_counts[category]
                    ? ` ${t('admin.riskControl.privacyFilter.stats.category', { count: status.category_counts[category] })}`
                    : ''}
                </p>
              </div>
              <Toggle
                value={config.categories.includes(category)}
                onChange={(enabled) => toggleCategory(category, enabled)}
                aria-label={t(`admin.riskControl.privacyFilter.categories.${category}.label`)}
              />
            </div>
          ))}
        </div>

        <div className={styles.stackGap3}>
          <div>
            <h3 className={styles.h3}>{t('admin.riskControl.privacyFilter.groups')}</h3>
            <p className={styles.hint}>{t('admin.riskControl.privacyFilter.groupsHint')}</p>
          </div>
          <div className={styles.searchWrap}>
            <Search size={16} aria-hidden="true" className={styles.searchIcon} />
            <input
              type="search"
              className={`${styles.input} ${styles.searchInput}`}
              value={groupSearch}
              placeholder={t('admin.riskControl.searchGroups')}
              aria-label={t('admin.riskControl.searchGroups')}
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
            {filteredGroups.length === 0 ? <p className={styles.hint}>{t('admin.riskControl.noGroups')}</p> : null}
          </div>
        </div>
      </div>
    </section>
  )
}
