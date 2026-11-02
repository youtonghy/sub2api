import { useEffect, useId, useState } from 'react'

import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { SearchField } from '@/components/arc/search-field/search-field'
import { useI18n } from '@/i18n/useI18n'
import { useAuthStore } from '@/stores/auth'
import type { Group, GroupPlatform } from '@/types'
import GroupBadge from './GroupBadge'
import styles from './GroupSelector.module.css'

export type GroupSelectorGroup = Group & { account_count?: number }

export interface GroupSelectorProps {
  /** 已选分组 ID（Vue 版 v-model） */
  value: number[]
  onChange: (value: number[]) => void
  groups: GroupSelectorGroup[]
  /** Optional platform filter */
  platform?: GroupPlatform
  /** For antigravity accounts: allow anthropic/gemini groups */
  mixedScheduling?: boolean
  /** 'auto'：分组多于 5 个时显示搜索框 */
  searchable?: boolean | 'auto'
}

/** 多选分组：按平台过滤，简单模式隐藏组合分组并清理已隐藏的历史选择 */
export default function GroupSelector({
  value,
  onChange,
  groups,
  platform,
  mixedScheduling,
  searchable = 'auto'
}: GroupSelectorProps) {
  const { t } = useI18n()
  const isSimpleMode = useAuthStore((state) => state.isSimpleMode)
  const [searchText, setSearchText] = useState('')
  const idPrefix = useId()

  const isSearchable = searchable === 'auto' ? groups.length > 5 : searchable

  // Filter groups by platform if specified
  let filteredGroups = isSimpleMode ? groups.filter((g) => g.platform !== 'composite') : groups
  if (platform) {
    if (platform === 'antigravity' && mixedScheduling) {
      // antigravity 账户启用混合调度后，可选择 anthropic/gemini 分组
      filteredGroups = filteredGroups.filter(
        (g) => g.platform === 'antigravity' || g.platform === 'anthropic' || g.platform === 'gemini' || g.platform === 'composite'
      )
    } else {
      // 默认：只能选择同 platform 的分组；composite 分组可接收任意具体平台账号
      filteredGroups = filteredGroups.filter((g) => g.platform === platform || g.platform === 'composite')
    }
  }
  if (isSearchable && searchText) {
    const q = searchText.toLowerCase()
    filteredGroups = filteredGroups.filter(
      (g) => g.name.toLowerCase().includes(q) || g.description?.toLowerCase().includes(q)
    )
  }

  // 简单模式下组合分组不可见：清理掉历史上绑定的组合分组 ID，保留可见分组的选择
  useEffect(() => {
    if (!isSimpleMode || groups.length === 0) return
    const visibleIDs = new Set(groups.filter((group) => group.platform !== 'composite').map((group) => group.id))
    const cleaned = value.filter((id) => visibleIDs.has(id))
    if (cleaned.length !== value.length) onChange(cleaned)
  }, [isSimpleMode, groups, value, onChange])

  const handleChange = (groupId: number, checked: boolean) => {
    onChange(checked ? [...value, groupId] : value.filter((id) => id !== groupId))
  }

  return (
    <div className={styles.root}>
      <span className={styles.label}>
        {t('admin.users.groups')}{' '}
        <span className={styles.count}>{t('common.selectedCount', { count: value.length })}</span>
      </span>
      {isSearchable && (
        <SearchField
          label={t('common.search')}
          value={searchText}
          onValueChange={setSearchText}
          placeholder={t('common.searchPlaceholder')}
        />
      )}
      <div className={styles.grid}>
        {filteredGroups.map((group) => {
          const controlId = `${idPrefix}-group-${group.id}`
          return (
            <div
              key={group.id}
              className={styles.item}
              title={
                group.rate_multiplier == null
                  ? group.name
                  : t('admin.groups.rateAndAccounts', { rate: group.rate_multiplier, count: group.account_count || 0 })
              }
            >
              <Checkbox
                id={controlId}
                aria-label={group.name}
                checked={value.includes(group.id)}
                onCheckedChange={(checked) => handleChange(group.id, checked === true)}
              />
              <label htmlFor={controlId} className={styles.itemLabel}>
                <GroupBadge
                  name={group.name}
                  platform={group.platform}
                  subscriptionType={group.subscription_type || undefined}
                  rateMultiplier={group.rate_multiplier == null ? undefined : group.rate_multiplier}
                  className={styles.badge}
                />
                <span className={styles.accounts}>{group.account_count || 0}</span>
              </label>
            </div>
          )
        })}
        {filteredGroups.length === 0 && <div className={styles.empty}>{t('common.noGroupsAvailable')}</div>}
      </div>
    </div>
  )
}
