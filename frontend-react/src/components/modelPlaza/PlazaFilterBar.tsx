/**
 * 模型广场筛选区，对应 Vue 版 components/modelPlaza/PlazaFilterBar.vue。
 * 平台 → 分组 → 倍率三级 faceted 筛选 + 模型名搜索（纯前端过滤）。
 */
import type { CSSProperties, ReactNode } from 'react'

import PlatformIcon from '@/components/common/PlatformIcon'
import SearchInput from '@/components/common/SearchInput'
import { useI18n } from '@/i18n/useI18n'
import type { GroupPlatform } from '@/types'
import { platformAccentColor } from '@/utils/platformColors'
import styles from './PlazaFilterBar.module.css'

export interface PlazaFilterGroupOption {
  id: number
  name: string
  platform: string
  rate: number
}

export interface PlazaFilterBarProps {
  /** 数据中出现的平台（去重排序后）。 */
  platforms: string[]
  /** 全量分组（含平台与生效倍率），三个维度的置灰联动由此推导。 */
  groups: PlazaFilterGroupOption[]
  /** 全量生效倍率去重升序。 */
  rates: number[]
  platform: string
  groupId: number | 'all'
  rate: number | 'all'
  /** 模型名搜索词（纯前端过滤）。 */
  search: string
  onPlatformChange: (value: string) => void
  onGroupIdChange: (value: number | 'all') => void
  onRateChange: (value: number | 'all') => void
  onSearchChange: (value: string) => void
}

interface ChipProps {
  active: boolean
  disabled?: boolean
  /** 平台主色；缺省为中性 chip（「全部」与倍率） */
  accent?: string
  mono?: boolean
  onClick: () => void
  children: ReactNode
}

function Chip({ active, disabled = false, accent, mono = false, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      className={[styles.chip, accent ? styles.tinted : styles.neutral, mono ? styles.mono : ''].filter(Boolean).join(' ')}
      style={accent ? ({ '--chip-accent': accent } as CSSProperties) : undefined}
      data-active={active || undefined}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default function PlazaFilterBar({
  platforms,
  groups,
  rates,
  platform,
  groupId,
  rate,
  search,
  onPlatformChange,
  onGroupIdChange,
  onRateChange,
  onSearchChange
}: PlazaFilterBarProps) {
  const { t } = useI18n()

  /**
   * 三个维度互为约束（faceted）：某选项可点 ⟺ 在「其他两维」当前选择下仍有分组命中。
   * 「全部」永远可点，作为解除本维约束的出口；可点项组合恒有结果，无需选择修正。
   */
  function platformEnabled(p: string): boolean {
    return groups.some(
      (g) =>
        g.platform === p &&
        (groupId === 'all' || g.id === groupId) &&
        (rate === 'all' || g.rate === rate)
    )
  }

  function groupEnabled(g: { platform: string; rate: number }): boolean {
    return (platform === 'all' || g.platform === platform) && (rate === 'all' || g.rate === rate)
  }

  function rateEnabled(r: number): boolean {
    return groups.some(
      (g) =>
        g.rate === r &&
        (platform === 'all' || g.platform === platform) &&
        (groupId === 'all' || g.id === groupId)
    )
  }

  return (
    <div className={styles.bar}>
      {/* 一级：平台 */}
      <div className={styles.row} role="group" aria-label={t('modelPlaza.filters.platformLabel')}>
        <span className={styles.label}>{t('modelPlaza.filters.platformLabel')}</span>
        <div className={styles.chips}>
          <Chip active={platform === 'all'} onClick={() => onPlatformChange('all')}>
            {t('modelPlaza.filters.all')}
          </Chip>
          {platforms.map((p) => (
            <Chip
              key={`platform-${p}`}
              active={platform === p}
              accent={platformAccentColor(p)}
              disabled={!platformEnabled(p)}
              onClick={() => onPlatformChange(p)}
            >
              <PlatformIcon platform={p as GroupPlatform} size="xs" />
              {p}
            </Chip>
          ))}
        </div>
      </div>

      {/* 二级：分组（按所属平台着色，当前组合下无结果的置灰） */}
      <div className={styles.row} role="group" aria-label={t('modelPlaza.filters.groupLabel')}>
        <span className={styles.label}>{t('modelPlaza.filters.groupLabel')}</span>
        <div className={styles.chips}>
          <Chip active={groupId === 'all'} onClick={() => onGroupIdChange('all')}>
            {t('modelPlaza.filters.all')}
          </Chip>
          {groups.map((g) => (
            <Chip
              key={`group-${g.id}`}
              active={groupId === g.id}
              accent={platformAccentColor(g.platform)}
              disabled={!groupEnabled(g)}
              onClick={() => onGroupIdChange(g.id)}
            >
              {g.name}
            </Chip>
          ))}
        </div>
      </div>

      {/* 三级：倍率（当前组合下不存在的置灰） */}
      <div className={styles.row} role="group" aria-label={t('modelPlaza.filters.rateLabel')}>
        <span className={styles.label}>{t('modelPlaza.filters.rateLabel')}</span>
        <div className={styles.chips}>
          <Chip active={rate === 'all'} onClick={() => onRateChange('all')}>
            {t('modelPlaza.filters.all')}
          </Chip>
          {rates.map((r) => (
            <Chip key={`rate-${r}`} active={rate === r} mono disabled={!rateEnabled(r)} onClick={() => onRateChange(r)}>
              {r}x
            </Chip>
          ))}
        </div>
      </div>

      {/* 四级：模型名搜索（纯前端过滤） */}
      <div className={styles.row}>
        <span className={styles.label}>{t('modelPlaza.filters.modelLabel')}</span>
        <div className={styles.search}>
          <SearchInput
            value={search}
            placeholder={t('modelPlaza.filters.searchPlaceholder')}
            onChange={onSearchChange}
          />
        </div>
      </div>
    </div>
  )
}
