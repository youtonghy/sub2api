/**
 * 账号分组单元格，对应 Vue 版 AccountGroupsCell.vue：
 * 最多显示 maxDisplay 个分组徽章，超出时最后一个位置显示 +N，点击弹出完整列表（Arc popover，Escape / 点击外部关闭）。
 */
import { X } from 'lucide-react'
import { useState } from 'react'

import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover'
import GroupBadge from '@/components/common/GroupBadge'
import { useI18n } from '@/i18n/useI18n'
import type { Group } from '@/types'
import styles from './AccountGroupsCell.module.css'

export interface AccountGroupsCellProps {
  groups: Group[] | null | undefined
  /** 默认 4 */
  maxDisplay?: number
}

function GroupBadges({ groups }: { groups: Group[] }) {
  return (
    <>
      {groups.map((group) => (
        <GroupBadge
          key={group.id}
          name={group.name}
          platform={group.platform}
          subscriptionType={group.subscription_type}
          rateMultiplier={group.rate_multiplier}
          showRate={false}
          truncate={false}
          className={styles.badge}
        />
      ))}
    </>
  )
}

export default function AccountGroupsCell({ groups, maxDisplay = 4 }: AccountGroupsCellProps) {
  const { t } = useI18n()
  const [showPopover, setShowPopover] = useState(false)

  if (!groups || groups.length === 0) {
    return <span className={styles.empty}>-</span>
  }

  // 显示的分组（最多显示 maxDisplay 个），超出时留一个位置给 +N 按钮
  const displayGroups = groups.length <= maxDisplay ? groups : groups.slice(0, maxDisplay - 1)
  // 隐藏的数量
  const hiddenCount = groups.length <= maxDisplay ? 0 : groups.length - (maxDisplay - 1)

  return (
    <div className={styles.cell}>
      {/* 限制列宽但不裁切行高，完整显示分组名称和 +N 按钮 */}
      <div className={styles.list}>
        <GroupBadges groups={displayGroups} />
        {hiddenCount > 0 ? (
          <Popover open={showPopover} onOpenChange={setShowPopover}>
            <PopoverTrigger className={styles.more} onClick={(event) => event.stopPropagation()}>
              <span>+{hiddenCount}</span>
            </PopoverTrigger>
            <PopoverContent className={styles.popover} onClick={(event) => event.stopPropagation()}>
              <div className={styles.popoverHeader}>
                <span className={styles.popoverTitle}>
                  {t('admin.accounts.groupCountTotal', { count: groups.length })}
                </span>
                <PopoverClose className={styles.close} aria-label={t('common.close')}>
                  <X aria-hidden="true" />
                </PopoverClose>
              </div>
              <div className={styles.popoverList}>
                <GroupBadges groups={groups} />
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </div>
  )
}
