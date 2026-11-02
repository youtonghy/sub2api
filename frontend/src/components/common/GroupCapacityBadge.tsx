import { Clock, LayoutGrid, Users } from 'lucide-react'
import type { ReactNode } from 'react'

import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import styles from './GroupCapacityBadge.module.css'

export interface GroupCapacityBadgeProps {
  concurrencyUsed?: number
  concurrencyMax?: number
  sessionsUsed?: number
  sessionsMax?: number
  rpmUsed?: number
  rpmMax?: number
}

/** 已满红色，使用中黄色，空闲灰色 */
function capacityTone(used: number, max: number): BadgeTone {
  if (max > 0 && used >= max) return 'danger'
  if (used > 0) return 'warning'
  return 'neutral'
}

function CapacityRow({ icon, used, max }: { icon: ReactNode; used: number; max: number }) {
  return (
    <div className={styles.row}>
      <Badge size="sm" tone={capacityTone(used, max)} icon={icon}>
        <span className={styles.value}>
          <span>{used}</span>
          <span className={styles.slash}>/</span>
          <span>{max}</span>
        </span>
      </Badge>
    </div>
  )
}

/** 分组容量：并发槽位，以及配置了上限时的会话数与 RPM */
export default function GroupCapacityBadge({
  concurrencyUsed = 0,
  concurrencyMax = 0,
  sessionsUsed = 0,
  sessionsMax = 0,
  rpmUsed = 0,
  rpmMax = 0
}: GroupCapacityBadgeProps) {
  return (
    <div className={styles.root}>
      {/* 并发槽位 */}
      <CapacityRow icon={<LayoutGrid size={10} strokeWidth={2} />} used={concurrencyUsed} max={concurrencyMax} />
      {/* 会话数 */}
      {sessionsMax > 0 && <CapacityRow icon={<Users size={10} strokeWidth={2} />} used={sessionsUsed} max={sessionsMax} />}
      {/* RPM */}
      {rpmMax > 0 && <CapacityRow icon={<Clock size={10} strokeWidth={2} />} used={rpmUsed} max={rpmMax} />}
    </div>
  )
}
