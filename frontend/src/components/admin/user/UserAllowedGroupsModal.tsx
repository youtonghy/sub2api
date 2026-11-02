/**
 * 用户分组配置弹窗，对应 Vue 版 UserAllowedGroupsModal.vue：
 * 勾选可用的专属分组、可选地限制公开分组，并为每个分组设置专属倍率。
 * 分组加载完成前（或加载失败后）不能保存，避免把空配置写回用户。
 */
import { Boxes } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import BaseDialog from '@/components/common/BaseDialog'
import EmptyState from '@/components/common/EmptyState'
import Input from '@/components/common/Input'
import PlatformIcon from '@/components/common/PlatformIcon'
import Skeleton from '@/components/common/Skeleton'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminUser, Group, GroupPlatform } from '@/types'
import { UserAvatar } from './UserAvatar'
import styles from './UserAllowedGroupsModal.module.css'

export interface UserAllowedGroupsModalProps {
  show: boolean
  user: AdminUser | null
  onClose?: () => void
  onSuccess?: () => void
}

interface GroupRateConfig {
  groupId: number
  groupName: string
  platform: GroupPlatform
  isExclusive: boolean
  defaultRate: number
  /** 专属倍率输入框原文；解析结果见 parseRate */
  customRateInput: string
  isSelected: boolean
}

// 与 Vue 版 updateCustomRate 一致：空值或无法解析时为 null
const parseRate = (value: string): number | null => {
  if (value === '') return null
  const numValue = parseFloat(value)
  return Number.isNaN(numValue) ? null : numValue
}

export default function UserAllowedGroupsModal({ show, user, onClose, onSuccess }: UserAllowedGroupsModalProps) {
  const { t } = useI18n()

  const [groups, setGroups] = useState<Group[]>([])
  const [groupConfigs, setGroupConfigs] = useState<GroupRateConfig[]>([])
  const originalGroupRates = useRef<Record<number, number>>({}) // 记录原始专属倍率，用于检测删除
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [restrictPublicGroups, setRestrictPublicGroups] = useState(false)

  // 分离专属分组和公开分组
  const exclusiveGroups = groups.filter((g) => g.is_exclusive)
  const publicGroups = groups.filter((g) => !g.is_exclusive)
  const exclusiveGroupConfigs = groupConfigs.filter((c) => c.isExclusive)
  const publicGroupConfigs = groupConfigs.filter((c) => !c.isExclusive)

  const load = async () => {
    setLoaded(false)
    setLoading(true)
    try {
      const res = await adminAPI.groups.list(1, 1000)
      // 只显示标准类型且活跃的分组
      const nextGroups = res.items.filter((g) => g.subscription_type === 'standard' && g.status === 'active')
      setGroups(nextGroups)

      // 初始化配置
      const userAllowedGroups = user?.allowed_groups || []
      const userGroupRates = user?.group_rates || {}
      const restrict = user?.restrict_public_groups ?? false
      setRestrictPublicGroups(restrict)

      // 保存原始专属倍率，用于检测删除操作
      originalGroupRates.current = { ...userGroupRates }

      setGroupConfigs(
        nextGroups.map((g) => ({
          groupId: g.id,
          groupName: g.name,
          platform: g.platform,
          isExclusive: g.is_exclusive,
          defaultRate: g.rate_multiplier,
          customRateInput: userGroupRates[g.id] == null ? '' : String(userGroupRates[g.id]),
          // 专属分组：检查是否在 allowed_groups 中
          // 公开分组：未开启限制时恒可用；开启后同样以 allowed_groups 为准
          isSelected: g.is_exclusive || restrict ? userAllowedGroups.includes(g.id) : true
        }))
      )
      setLoaded(true)
    } catch (error) {
      console.error('Failed to load groups:', error)
    } finally {
      setLoading(false)
    }
  }

  const onShowChange = useEffectEvent((visible: boolean) => {
    if (visible && user) void load()
  })
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 对应 Vue 版 watch(show)：打开时加载分组
    onShowChange(show)
  }, [show])

  const updateConfig = (groupId: number, patch: (config: GroupRateConfig) => Partial<GroupRateConfig>) =>
    setGroupConfigs((prev) => prev.map((c) => (c.groupId === groupId ? { ...c, ...patch(c) } : c)))

  const toggleExclusiveGroup = (groupId: number) =>
    updateConfig(groupId, (c) => (c.isExclusive ? { isSelected: !c.isSelected } : {}))

  const togglePublicGroup = (groupId: number) =>
    updateConfig(groupId, (c) => (!c.isExclusive ? { isSelected: !c.isSelected } : {}))

  // 关闭限制时把公开分组全部勾回，避免保存出一份"限制已关但只勾了两个"的误导状态。
  const toggleRestrictPublicGroups = () => {
    const next = !restrictPublicGroups
    setRestrictPublicGroups(next)
    if (!next) {
      setGroupConfigs((prev) => prev.map((c) => (c.isExclusive ? c : { ...c, isSelected: true })))
    }
  }

  const updateCustomRate = (groupId: number, value: string) => updateConfig(groupId, () => ({ customRateInput: value }))

  const handleSave = async () => {
    if (!user || !loaded) return
    setSubmitting(true)

    try {
      // 构建 allowed_groups：专属分组中被勾选的，以及开启限制后被勾选的公开分组。
      // 未开启限制时不写入公开分组，保持该表"额外授予"的原有语义。
      const allowedGroups = groupConfigs
        .filter((c) => c.isSelected && (c.isExclusive || restrictPublicGroups))
        .map((c) => c.groupId)

      // 构建 group_rates
      // - 有新专属倍率: 设置为该值
      // - 原本有专属倍率但现在被清空: 设置为 null（表示删除）
      const groupRates: Record<number, number | null> = {}
      for (const c of groupConfigs) {
        const hadOriginalRate = originalGroupRates.current[c.groupId] !== undefined
        const customRate = parseRate(c.customRateInput)

        if (customRate !== null) {
          // 有专属倍率
          groupRates[c.groupId] = customRate
        } else if (hadOriginalRate) {
          // 原本有专属倍率，现在被清空，需要显式删除
          groupRates[c.groupId] = null
        }
      }

      await adminAPI.users.update(user.id, {
        allowed_groups: allowedGroups,
        restrict_public_groups: restrictPublicGroups,
        group_rates: Object.keys(groupRates).length > 0 ? groupRates : undefined
      })

      useAppStore.getState().showSuccess(t('admin.users.groupConfigUpdated'))
      onSuccess?.()
      onClose?.()
    } catch (error) {
      console.error('Failed to update user group config:', error)
    } finally {
      setSubmitting(false)
    }
  }

  const renderGroupInfo = (config: GroupRateConfig) => (
    <div className={styles.groupInfo}>
      <div className={styles.groupTitle}>
        <span className={styles.groupName}>{config.groupName}</span>
        {config.isExclusive && (
          <Badge size="sm" tone="info">
            {t('admin.groups.exclusive')}
          </Badge>
        )}
      </div>
      <div className={styles.groupMeta}>
        <span className={styles.platform}>
          <PlatformIcon platform={config.platform} size="xs" />
          <span>{config.platform}</span>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {t('admin.users.defaultRate')}: <span className={styles.rate}>{config.defaultRate}x</span>
        </span>
      </div>
    </div>
  )

  // 专属倍率输入
  const renderRateInput = (config: GroupRateConfig) => (
    <div className={styles.rateField}>
      <span className={styles.rateLabel}>{t('admin.users.customRate')}</span>
      <Input
        type="number"
        step="0.001"
        min="0.001"
        className={styles.rateInput}
        aria-label={`${config.groupName} ${t('admin.users.customRate')}`}
        placeholder={String(config.defaultRate)}
        value={config.customRateInput}
        onChange={(value) => updateCustomRate(config.groupId, value)}
      />
    </div>
  )

  return (
    <BaseDialog
      show={show}
      title={t('admin.users.groupConfig')}
      width="wide"
      onClose={() => onClose?.()}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onClose?.()}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={submitting || !loaded}
            loading={submitting}
            data-testid="allowed-groups-save"
            onClick={() => void handleSave()}
          >
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      {user && (
        <div className={styles.content}>
          {/* 用户信息头部 */}
          <div className={styles.header}>
            <UserAvatar email={user.email} />
            <div className={styles.headerText}>
              <p className={styles.email}>{user.email}</p>
              <p className={styles.hint}>{t('admin.users.groupConfigHint', { email: user.email })}</p>
            </div>
          </div>

          {loading ? (
            // 加载状态
            <div className={styles.loading} aria-busy="true">
              <Skeleton height={68} />
              <Skeleton height={68} />
              <Skeleton height={68} />
            </div>
          ) : (
            <div className={styles.sections}>
              {/* 专属分组区域 */}
              {exclusiveGroups.length > 0 && (
                <section className={styles.section}>
                  <div className={styles.sectionHead}>
                    <h3 className={styles.sectionTitle}>{t('admin.users.exclusiveGroups')}</h3>
                    <span className={styles.count}>
                      ({exclusiveGroupConfigs.filter((c) => c.isSelected).length}/{exclusiveGroupConfigs.length})
                    </span>
                  </div>
                  <ul className={styles.list}>
                    {exclusiveGroupConfigs.map((config) => (
                      <li key={config.groupId} className={styles.row} data-selected={config.isSelected || undefined}>
                        {/* 复选框 */}
                        <Checkbox
                          checked={config.isSelected}
                          onCheckedChange={() => toggleExclusiveGroup(config.groupId)}
                          aria-label={config.groupName}
                        />
                        {/* 分组信息 */}
                        {renderGroupInfo(config)}
                        {renderRateInput(config)}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* 公开分组区域 */}
              {publicGroups.length > 0 && (
                <section className={styles.section}>
                  <div className={styles.sectionHead}>
                    <h3 className={styles.sectionTitle}>
                      {restrictPublicGroups ? t('admin.users.publicGroupsRestricted') : t('admin.users.publicGroups')}
                    </h3>
                    <span className={styles.count}>({publicGroupConfigs.length})</span>
                    <div className={styles.restrict}>
                      <Checkbox
                        checked={restrictPublicGroups}
                        onCheckedChange={toggleRestrictPublicGroups}
                        label={t('admin.users.restrictPublicGroups')}
                      />
                    </div>
                  </div>
                  <p className={styles.sectionHint}>{t('admin.users.restrictPublicGroupsHint')}</p>
                  <ul className={styles.list}>
                    {publicGroupConfigs.map((config) => (
                      <li key={config.groupId} className={styles.row}>
                        {/* 未开启限制时公开分组恒可用，此处仅作展示；开启后才是真实开关 */}
                        <Checkbox
                          checked={restrictPublicGroups ? config.isSelected : true}
                          disabled={!restrictPublicGroups}
                          onCheckedChange={() => togglePublicGroup(config.groupId)}
                          aria-label={config.groupName}
                        />
                        {/* 分组信息 */}
                        {renderGroupInfo(config)}
                        {renderRateInput(config)}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* 无分组提示 */}
              {groups.length === 0 && <EmptyState icon={Boxes} title={t('common.noGroupsAvailable')} />}
            </div>
          )}
        </div>
      )}
    </BaseDialog>
  )
}
