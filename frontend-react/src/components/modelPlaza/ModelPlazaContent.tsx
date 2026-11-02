/**
 * 模型广场主体，对应 Vue 版 components/modelPlaza/ModelPlazaContent.vue。
 * 价格说明（管理员 Markdown）+ 未登录提示 + 筛选区 + 按分组分节的模型清单。
 */
import DOMPurify from 'dompurify'
import { Info } from 'lucide-react'
import { marked } from 'marked'
import { useMemo, useState } from 'react'

import { Alert } from '@/components/arc/alert/alert'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import type { ModelPlazaGroup, ModelPlazaResponse } from '@/api/modelPlaza'
import { useI18n } from '@/i18n/useI18n'
import { useAuthStore } from '@/stores/auth'
import PlazaFilterBar from './PlazaFilterBar'
import PlazaGroupSection from './PlazaGroupSection'
import styles from './ModelPlazaContent.module.css'

export interface ModelPlazaContentProps {
  response: ModelPlazaResponse | null
  loading: boolean
  error?: boolean
  /** 后台内嵌形态（AppLayout 内）：隐藏页头。 */
  embedded?: boolean
}

/** 生效倍率 = 用户专属倍率 ?? 分组默认倍率。 */
function effectiveRate(g: ModelPlazaGroup): number {
  return g.user_rate_multiplier ?? g.rate_multiplier
}

export default function ModelPlazaContent({ response, loading, error = false, embedded = false }: ModelPlazaContentProps) {
  const { t } = useI18n()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)

  const [selectedPlatform, setSelectedPlatform] = useState<string>('all')
  const [selectedGroupId, setSelectedGroupId] = useState<number | 'all'>('all')
  const [selectedRate, setSelectedRate] = useState<number | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const searchActive = searchQuery.trim() !== ''

  const descriptionHtml = useMemo(() => {
    const md = response?.description?.trim()
    if (!md) return ''
    return DOMPurify.sanitize(marked.parse(md, { async: false }))
  }, [response])

  const allGroups = useMemo(() => response?.groups ?? [], [response])

  const platforms = useMemo(
    () => [...new Set(allGroups.map((g) => g.platform).filter(Boolean))].sort(),
    [allGroups]
  )

  const groupOptions = useMemo(
    () => allGroups.map((g) => ({ id: g.id, name: g.name, platform: g.platform, rate: effectiveRate(g) })),
    [allGroups]
  )

  /** 全量生效倍率；当前组合下不可用的项由 FilterBar 置灰而非隐藏。 */
  const rates = useMemo(() => [...new Set(allGroups.map(effectiveRate))].sort((a, b) => a - b), [allGroups])

  /** 数据刷新后选中的倍率可能不复存在，重置为全部。 */
  const [ratesSeen, setRatesSeen] = useState(rates)
  if (ratesSeen !== rates) {
    setRatesSeen(rates)
    if (selectedRate !== 'all' && !rates.includes(selectedRate)) {
      setSelectedRate('all')
    }
  }

  const filteredGroups = useMemo(() => {
    let groups = allGroups
    if (selectedPlatform !== 'all') {
      groups = groups.filter((g) => g.platform === selectedPlatform)
    }
    if (selectedGroupId !== 'all') {
      groups = groups.filter((g) => g.id === selectedGroupId)
    }
    if (selectedRate !== 'all') {
      groups = groups.filter((g) => effectiveRate(g) === selectedRate)
    }
    // 模型名搜索：分组内只留命中的模型，整组无命中则隐藏该分组。
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      groups = groups
        .map((g) => ({ ...g, models: g.models.filter((m) => m.name.toLowerCase().includes(q)) }))
        .filter((g) => g.models.length > 0)
    }
    // 专属倍率会改变生效值，不能只依赖后端按默认倍率的排序。
    return [...groups].sort((a, b) => effectiveRate(a) - effectiveRate(b) || a.name.localeCompare(b.name))
  }, [allGroups, selectedPlatform, selectedGroupId, selectedRate, searchQuery])

  let body
  if (loading) {
    body = (
      <div className={styles.loading}>
        <Skeleton label={t('common.loading')} lines={3} />
        <Skeleton label={t('common.loading')} lines={5} />
      </div>
    )
  } else if (error) {
    body = <Alert tone="danger" title={t('modelPlaza.loadFailed')} />
  } else {
    body = (
      <>
        {/* 筛选区：平台 → 分组 → 倍率 */}
        <PlazaFilterBar
          platforms={platforms}
          groups={groupOptions}
          rates={rates}
          platform={selectedPlatform}
          groupId={selectedGroupId}
          rate={selectedRate}
          search={searchQuery}
          onPlatformChange={setSelectedPlatform}
          onGroupIdChange={setSelectedGroupId}
          onRateChange={setSelectedRate}
          onSearchChange={setSearchQuery}
        />

        {/* 分组分节的模型清单（默认按生效倍率升序） */}
        {filteredGroups.length > 0 ? (
          <div className={styles.groups}>
            {filteredGroups.map((g) => (
              <PlazaGroupSection key={g.id} group={g} />
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            {searchActive ? t('modelPlaza.noSearchResult') : t('modelPlaza.empty')}
          </div>
        )}
      </>
    )
  }

  return (
    <div className={styles.root}>
      {/* 页头（独立形态下展示标题；后台形态顶栏已有页面标题） */}
      {!embedded && (
        <div>
          <h1 className={styles.title}>{t('modelPlaza.title')}</h1>
          <p className={styles.subtitle}>{t('modelPlaza.description')}</p>
        </div>
      )}

      {/* 全局价格说明（管理员配置，Markdown） */}
      {descriptionHtml && (
        <div className={styles.description} dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
      )}

      {/* 未登录提示 */}
      {!isAuthenticated && (
        <p className={styles.hint}>
          <Info size={14} strokeWidth={2} aria-hidden="true" />
          {t('modelPlaza.anonymousHint')}
        </p>
      )}

      {/* 加载/错误/空 */}
      {body}
    </div>
  )
}
