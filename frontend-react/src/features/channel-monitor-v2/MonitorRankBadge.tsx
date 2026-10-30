/**
 * 排名徽章，对应 Vue 版 MonitorRankBadge.vue：前三名显示金 / 银 / 铜奖杯，其余显示 #N，未排名显示 —。
 * 奖杯是插画（多色 SVG），三种奖牌的配色以 SVG fill 常量保留 Vue 版原值，不属于界面色板。
 */
import { useI18n } from '@/i18n/useI18n'
import { normalizeRank } from './monitorViewModel'
import styles from './MonitorRankBadge.module.css'

export interface MonitorRankBadgeProps {
  rank: number | null | undefined
}

/** Rank medal palettes: light / mid / dark fills for the multi-path trophy SVG. */
const RANK_PALETTES = {
  1: {
    // gold
    light: '#FFD524',
    mid: '#F5B200',
    dark: '#B45309'
  },
  2: {
    // silver
    light: '#E5E7EB',
    mid: '#9CA3AF',
    dark: '#4B5563'
  },
  3: {
    // bronze
    light: '#E8A86A',
    mid: '#CD7F32',
    dark: '#8B5A2B'
  }
} as const

export default function MonitorRankBadge({ rank }: MonitorRankBadgeProps) {
  const { t } = useI18n()
  const rankNum = normalizeRank(rank)
  const showTrophy = rankNum != null && rankNum >= 1 && rankNum <= 3
  const palette = rankNum === 1 || rankNum === 2 || rankNum === 3 ? RANK_PALETTES[rankNum] : null

  // Rank 0 = present but unranked (no traffic in window / outside top list).
  const label = rankNum == null || rankNum <= 0 ? '—' : `#${rankNum}`

  let ariaLabel: string
  if (rankNum == null || rankNum <= 0) ariaLabel = t('channelMonitorV2.rank.unranked')
  else if (rankNum === 1) ariaLabel = t('channelMonitorV2.rank.gold')
  else if (rankNum === 2) ariaLabel = t('channelMonitorV2.rank.silver')
  else if (rankNum === 3) ariaLabel = t('channelMonitorV2.rank.bronze')
  else ariaLabel = t('channelMonitorV2.rank.place', { n: rankNum })

  const medal = showTrophy ? String(rankNum) : undefined

  return (
    <span className={styles.badge} data-medal={medal} title={ariaLabel}>
      {showTrophy && palette ? (
        <svg className={styles.trophy} viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true">
          {/* stem */}
          <path d="M506.9 750.3c1.5 0 3-0.1 4.6-0.1 4.1 0 8.2 0.1 12.3 0.2V613.8h-16.9v136.5z" fill={palette.mid} />
          {/* base plate highlight */}
          <path d="M585.3 815.7c25.5 17.4 49 44.5 56.8 84.9h98.3c-20.4-36.7-77-71.2-155.1-84.9z" fill={palette.light} />
          {/* main cup / handles / pedestal outline */}
          <path
            d="M922.2 64.2H757.7c-0.2 0-0.4 0.1-0.6 0.1-0.2 0-0.4-0.1-0.6-0.1h-229c-16.3 0-29.6 13.2-29.6 29.6s13.2 29.6 29.6 29.6h199.6l0.9 215.5c0 98.3-66.1 181.4-156.1 207.4-19 5.5-39 8.5-59.8 8.5-119 0-215.9-96.9-215.9-216l-0.9-215.3h48.5c16.3 0 29.6-13.2 29.6-29.6s-13.2-29.6-29.6-29.6H100.9c-16.3 0-29.6 13.2-29.6 29.6V135c0 66.3 33.3 127.3 89.1 163.2 5 3.2 10.5 4.7 16 4.7 9.7 0 19.2-4.8 24.9-13.5 8.8-13.7 4.9-32-8.8-40.9-38.8-25-62-67.4-62-113.5v-11.6H236l0.9 215.5c0 126.7 86.2 233.7 203 265.4v151.3c-11.8 1.7-23.5 3.7-34.9 6.3-15.9 3.6-25.9 19.5-22.3 35.4 3.6 15.9 19.5 25.9 35.4 22.3 29.6-6.7 61-10.1 93.3-10.1 26.3 0 50.9 2.3 73.8 6.4 78.2 13.7 134.8 48.2 155.1 84.9H282.2c10.2-19 29.8-37.1 57.1-52.1 14.3-7.9 19.5-25.9 11.6-40.2-7.9-14.3-25.9-19.5-40.2-11.6-61.7 34-95.7 81.4-95.7 133.5 0 16.3 13.2 29.6 29.6 29.6h533.5c16.3 0 29.6-13.2 29.6-29.6 0-85.9-94.3-155.9-224.9-174.9v-151C700.3 573.1 787 465.9 787 338.7l-0.9-215.3h106.6V135c-0.1-16.3-13.4-29.6-29.7-29.6zM523.8 750.4c-4.1-0.1-8.2-0.2-12.3-0.2-1.5 0-3 0.1-4.6 0.1-2.6 0-5.2 0.1-7.8 0.2V613.8h24.7v136.6z"
            fill={palette.dark}
          />
          {/* cup face highlight */}
          <path d="M727.9 338.8l-0.9-215.5h-92.3l0.9 215.5c0 84.1-19.5 168.1-63.9 207.4 90.1-26 156.2-109.1 156.2-207.4z" fill={palette.light} />
          {/* top bar accent */}
          <path
            d="M433.2 123.3h1.8c16.3 0 29.6-13.2 29.6-29.6S451.4 64.2 435 64.2h-1.8c-16.3 0-29.6 13.2-29.6 29.6s13.3 29.5 29.6 29.5z"
            fill={palette.dark}
          />
        </svg>
      ) : null}
      {showTrophy ? <span className={styles.srOnly}>{ariaLabel}</span> : null}
      <span className={styles.label}>{label}</span>
    </span>
  )
}
