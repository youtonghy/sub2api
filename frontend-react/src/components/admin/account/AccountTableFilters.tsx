/**
 * 账号列表筛选栏，对应 Vue 版 AccountTableFilters.vue：搜索、平台、模型、类型、状态、隐私模式、分组。
 * 每项变化先回调 onFiltersChange（Vue 版 update:filters）再回调 onChange（Vue 版 change）。
 */
import { useMemo } from 'react'

import SearchInput from '@/components/common/SearchInput'
import Select, { type SelectValue } from '@/components/common/Select'
import { CONCRETE_PLATFORM_OPTIONS } from '@/constants/platforms'
import { useI18n } from '@/i18n/useI18n'
import type { AdminGroup } from '@/types'
import styles from './AccountTableFilters.module.css'

export interface AccountTableFiltersProps {
  searchQuery: string
  filters: Record<string, any>
  groups?: AdminGroup[]
  models?: string[]
  /** 搜索框输入（Vue 版 update:searchQuery） */
  onSearchQueryChange?: (value: string) => void
  /** 筛选项变更后的完整筛选对象（Vue 版 update:filters） */
  onFiltersChange?: (filters: Record<string, any>) => void
  /** 搜索防抖结束或任一筛选项变更（Vue 版 change） */
  onChange?: () => void
}

type FilterKey = 'platform' | 'model' | 'type' | 'status' | 'privacy_mode' | 'group'

export default function AccountTableFilters({
  searchQuery,
  filters,
  groups,
  models,
  onSearchQueryChange,
  onFiltersChange,
  onChange
}: AccountTableFiltersProps) {
  const { t } = useI18n()

  const update = (key: FilterKey) => (value: SelectValue) => {
    onFiltersChange?.({ ...filters, [key]: value })
    onChange?.()
  }

  const pOpts = useMemo(() => [{ value: '', label: t('admin.accounts.allPlatforms') }, ...CONCRETE_PLATFORM_OPTIONS], [t])
  const mOpts = useMemo(
    () => [{ value: '', label: t('admin.accounts.allModels') }, ...(models || []).map((model) => ({ value: model, label: model }))],
    [t, models]
  )
  const tOpts = useMemo(
    () => [
      { value: '', label: t('admin.accounts.allTypes') },
      { value: 'oauth', label: t('admin.accounts.oauthType') },
      { value: 'setup-token', label: t('admin.accounts.setupToken') },
      { value: 'apikey', label: t('admin.accounts.apiKey') },
      { value: 'bedrock', label: 'AWS Bedrock' }
    ],
    [t]
  )
  const sOpts = useMemo(
    () => [
      { value: '', label: t('admin.accounts.allStatus') },
      { value: 'active', label: t('admin.accounts.status.active') },
      { value: 'inactive', label: t('admin.accounts.status.inactive') },
      { value: 'error', label: t('admin.accounts.status.error') },
      { value: 'rate_limited', label: t('admin.accounts.status.rateLimited') },
      { value: 'temp_unschedulable', label: t('admin.accounts.status.tempUnschedulable') },
      { value: 'unschedulable', label: t('admin.accounts.status.unschedulable') }
    ],
    [t]
  )
  const privacyOpts = useMemo(
    () => [
      { value: '', label: t('admin.accounts.allPrivacyModes') },
      { value: '__unset__', label: t('admin.accounts.privacyUnset') },
      { value: 'training_off', label: 'Privacy' },
      { value: 'training_set_cf_blocked', label: 'CF' },
      { value: 'training_set_failed', label: 'Fail' }
    ],
    [t]
  )
  const gOpts = useMemo(
    () => [
      { value: '', label: t('admin.accounts.allGroups') },
      { value: 'ungrouped', label: t('admin.accounts.ungroupedGroup') },
      ...(groups || []).map((g) => ({ value: String(g.id), label: g.name }))
    ],
    [t, groups]
  )

  return (
    // 窄屏两列网格铺满宽度，宽屏恢复单行流式排布
    <div className={styles.root}>
      <SearchInput
        value={searchQuery}
        placeholder={t('admin.accounts.searchAccounts')}
        className={`${styles.wide} ${styles.search}`}
        onChange={(value) => onSearchQueryChange?.(value)}
        onSearch={() => onChange?.()}
      />
      <Select value={filters.platform} className={styles.narrow} options={pOpts} aria-label={t('admin.accounts.allPlatforms')} onChange={update('platform')} />
      <Select
        value={filters.model}
        className={`${styles.wide} ${styles.model}`}
        options={mOpts}
        searchable
        searchPlaceholder={t('admin.accounts.searchModels')}
        aria-label={t('admin.accounts.allModels')}
        onChange={update('model')}
      />
      <Select value={filters.type} className={styles.narrow} options={tOpts} aria-label={t('admin.accounts.allTypes')} onChange={update('type')} />
      <Select value={filters.status} className={styles.narrow} options={sOpts} aria-label={t('admin.accounts.allStatus')} onChange={update('status')} />
      <Select
        value={filters.privacy_mode}
        className={styles.privacy}
        options={privacyOpts}
        aria-label={t('admin.accounts.allPrivacyModes')}
        onChange={update('privacy_mode')}
      />
      <Select value={filters.group} className={`${styles.wide} ${styles.narrow}`} options={gOpts} aria-label={t('admin.accounts.allGroups')} onChange={update('group')} />
    </div>
  )
}
