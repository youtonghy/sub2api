/**
 * 用户 API Key 列表弹窗，对应 Vue 版 UserApiKeysModal.vue：
 * 打开或切换用户时加载该用户的 Key（迟到的旧请求结果与错误被丢弃），
 * 点击分组可在 Arc popover 中改绑分组或解绑。
 */
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { adminAPI } from '@/api/admin'
import { Badge } from '@/components/arc/badge/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover'
import BaseDialog from '@/components/common/BaseDialog'
import GroupBadge from '@/components/common/GroupBadge'
import GroupOptionItem from '@/components/common/GroupOptionItem'
import Skeleton from '@/components/common/Skeleton'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminGroup, AdminUser, ApiKey } from '@/types'
import { formatDateTime } from '@/utils/format'
import { UserAvatar } from './UserAvatar'
import styles from './UserApiKeysModal.module.css'

export interface UserApiKeysModalProps {
  show: boolean
  user: AdminUser | null
  onClose?: () => void
}

export default function UserApiKeysModal({ show, user, onClose }: UserApiKeysModalProps) {
  const { t } = useI18n()

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [allGroups, setAllGroups] = useState<AdminGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [updatingKeyIds, setUpdatingKeyIds] = useState<Set<number>>(() => new Set())
  const [groupSelectorKeyId, setGroupSelectorKeyId] = useState<number | null>(null)
  const userId = user?.id

  // 可见性或用户变化时作废进行中的请求（Vue 版 requestVersion）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 对应 Vue 版 watch([show, user.id])：先关闭分组选择
    setGroupSelectorKeyId(null)
    if (!show || userId == null) return
    let active = true

    setApiKeys([])
    setLoading(true)
    adminAPI.users
      .getUserApiKeys(userId)
      .then((res) => {
        if (active) setApiKeys(res.items || [])
      })
      .catch((error) => {
        if (!active) return
        console.error('Failed to load API keys:', error)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    adminAPI.groups
      .getAll()
      .then((groups) => setAllGroups(groups))
      .catch((error) => console.error('Failed to load groups:', error))

    return () => {
      active = false
    }
  }, [show, userId])

  const closeGroupSelector = () => setGroupSelectorKeyId(null)

  const setUpdating = (keyId: number, updating: boolean) =>
    setUpdatingKeyIds((prev) => {
      const next = new Set(prev)
      if (updating) next.add(keyId)
      else next.delete(keyId)
      return next
    })

  const changeGroup = async (key: ApiKey, newGroupId: number | null) => {
    closeGroupSelector()
    if (key.group_id === newGroupId || (!key.group_id && newGroupId === null)) return

    const appStore = useAppStore.getState()
    setUpdating(key.id, true)
    try {
      const result = await adminAPI.apiKeys.updateApiKeyGroup(key.id, newGroupId)
      // Update local data
      setApiKeys((prev) => prev.map((k) => (k.id === key.id ? result.api_key : k)))
      if (result.auto_granted_group_access && result.granted_group_name) {
        appStore.showSuccess(t('admin.users.groupChangedWithGrant', { group: result.granted_group_name }))
      } else {
        appStore.showSuccess(t('admin.users.groupChangedSuccess'))
      }
    } catch (error: any) {
      appStore.showError(error?.message || t('admin.users.groupChangeFailed'))
    } finally {
      setUpdating(key.id, false)
    }
  }

  const handleClose = () => {
    closeGroupSelector()
    onClose?.()
  }

  return (
    <BaseDialog show={show} title={t('admin.users.userApiKeys')} width="wide" onClose={handleClose}>
      {user && (
        <div className={styles.content}>
          <div className={styles.header}>
            <UserAvatar email={user.email} />
            <div className={styles.identity}>
              <p className={styles.email}>{user.email}</p>
              <p className={styles.username}>{user.username}</p>
            </div>
          </div>

          {loading ? (
            <div className={styles.loading} aria-busy="true" data-testid="api-keys-loading">
              <Skeleton height={76} />
              <Skeleton height={76} />
            </div>
          ) : apiKeys.length === 0 ? (
            <p className={styles.empty}>{t('admin.users.noApiKeys')}</p>
          ) : (
            <ul className={styles.list} onScroll={closeGroupSelector}>
              {apiKeys.map((key) => {
                const updating = updatingKeyIds.has(key.id)
                return (
                  <li key={key.id} className={styles.item}>
                    <div className={styles.itemHead}>
                      <span className={styles.name}>{key.name}</span>
                      <Badge size="sm" tone={key.status === 'active' ? 'success' : 'danger'}>
                        {key.status}
                      </Badge>
                    </div>
                    <p className={styles.key}>
                      {key.key.substring(0, 20)}...{key.key.substring(key.key.length - 8)}
                    </p>
                    <div className={styles.meta}>
                      <div className={styles.metaItem}>
                        <span>{t('admin.users.group')}:</span>
                        <Popover
                          open={groupSelectorKeyId === key.id}
                          onOpenChange={(open) => setGroupSelectorKeyId(open ? key.id : null)}
                        >
                          <PopoverTrigger asChild>
                            <button type="button" className={styles.groupTrigger} disabled={updating}>
                              {key.group_id && key.group ? (
                                <GroupBadge
                                  name={key.group.name}
                                  platform={key.group.platform}
                                  subscriptionType={key.group.subscription_type}
                                  rateMultiplier={key.group.rate_multiplier}
                                  peakRateEnabled={key.group.peak_rate_enabled}
                                  peakStart={key.group.peak_start}
                                  peakEnd={key.group.peak_end}
                                  peakRateMultiplier={key.group.peak_rate_multiplier}
                                />
                              ) : (
                                <span className={styles.none}>{t('admin.users.none')}</span>
                              )}
                              {updating ? (
                                <Loader2 size={12} strokeWidth={2} className={styles.spin} aria-hidden="true" />
                              ) : (
                                <ChevronsUpDown size={12} strokeWidth={2} className={styles.chevron} aria-hidden="true" />
                              )}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className={styles.menu}>
                            <div className={styles.menuList} role="listbox" aria-label={t('admin.users.group')}>
                              {/* Unbind option */}
                              <button
                                type="button"
                                role="option"
                                aria-selected={!key.group_id}
                                className={styles.menuItem}
                                data-selected={!key.group_id || undefined}
                                onClick={() => void changeGroup(key, null)}
                              >
                                <span className={styles.none}>{t('admin.users.none')}</span>
                                {!key.group_id && <Check size={16} strokeWidth={2} className={styles.check} aria-hidden="true" />}
                              </button>
                              {/* Group options */}
                              {allGroups.map((group) => (
                                <button
                                  key={group.id}
                                  type="button"
                                  role="option"
                                  aria-selected={key.group_id === group.id}
                                  className={styles.menuItem}
                                  data-selected={key.group_id === group.id || undefined}
                                  onClick={() => void changeGroup(key, group.id)}
                                >
                                  <GroupOptionItem
                                    name={group.name}
                                    platform={group.platform}
                                    subscriptionType={group.subscription_type}
                                    rateMultiplier={group.rate_multiplier}
                                    peakRateEnabled={group.peak_rate_enabled}
                                    peakStart={group.peak_start}
                                    peakEnd={group.peak_end}
                                    peakRateMultiplier={group.peak_rate_multiplier}
                                    description={group.description}
                                    selected={key.group_id === group.id}
                                  />
                                </button>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                      <span>
                        {t('admin.users.columns.created')}: {formatDateTime(key.created_at)}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </BaseDialog>
  )
}
