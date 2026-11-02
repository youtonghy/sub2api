/**
 * 分组专属倍率与 RPM 覆盖弹窗共用的展示片段：分组信息行、用户搜索框、加载占位与用户状态徽标。
 */
import type { ReactNode } from 'react'

import { Badge } from '@/components/arc/badge/badge'
import arcInput from '@/components/arc/input/input.module.css'
import PlatformIcon from '@/components/common/PlatformIcon'
import Skeleton from '@/components/common/Skeleton'
import { useI18n } from '@/i18n/useI18n'
import type { AdminGroup, AdminUser } from '@/types'
import { platformLabel } from '@/utils/platformColors'
import styles from './GroupOverrides.module.css'
import type { useGroupUserSearch } from './useGroupUserSearch'

export function GroupOverridesSummary({ group, extra }: { group: AdminGroup; extra: ReactNode }) {
  const { t } = useI18n()
  return (
    <div className={styles.summary}>
      <span className={styles.summaryPlatform}>
        <PlatformIcon platform={group.platform} size="sm" />
        {t('admin.groups.platforms.' + group.platform, platformLabel(group.platform))}
      </span>
      <span className={styles.summarySep} aria-hidden="true">
        |
      </span>
      <span className={styles.summaryName}>{group.name}</span>
      <span className={styles.summarySep} aria-hidden="true">
        |
      </span>
      <span className={styles.summaryMeta}>{extra}</span>
    </div>
  )
}

export function UserSearchField({ search }: { search: ReturnType<typeof useGroupUserSearch> }) {
  const { t } = useI18n()
  return (
    <div className={styles.searchAnchor}>
      <input
        value={search.searchQuery}
        type="text"
        autoComplete="off"
        className={arcInput.input}
        placeholder={t('admin.groups.searchUserPlaceholder')}
        aria-label={t('admin.groups.searchUserPlaceholder')}
        onChange={(event) => search.handleSearchUsers(event.target.value)}
        onFocus={() => search.setShowDropdown(true)}
      />
      {search.showDropdown && search.searchResults.length > 0 ? (
        <div className={styles.dropdown}>
          {search.searchResults.map((user: AdminUser) => (
            <button key={user.id} type="button" className={styles.dropdownItem} onClick={() => search.selectUser(user)}>
              <span className={styles.muted}>#{user.id}</span>
              <span>{user.username || user.email}</span>
              {user.username ? <span className={styles.mutedSmall}>{user.email}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function OverridesLoading() {
  return (
    <div className={styles.loading} aria-busy="true" data-testid="group-overrides-loading">
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} height={36} />
      ))}
    </div>
  )
}

export function UserStatusBadge({ status }: { status: string }) {
  return (
    <Badge size="sm" tone={status === 'active' ? 'success' : 'neutral'}>
      {status}
    </Badge>
  )
}
