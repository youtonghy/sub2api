import { RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import userChannelsAPI, { type UserAvailableChannel } from '@/api/channels'
import userGroupsAPI from '@/api/groups'
import { Button } from '@/components/arc/button/button'
import AvailableChannelsTable from '@/components/channels/AvailableChannelsTable'
import SearchInput from '@/components/common/SearchInput'
import TablePageLayout from '@/components/common/TablePageLayout'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { extractApiErrorMessage } from '@/utils/apiError'
import styles from './AvailableChannelsView.module.css'

/** 可用渠道（用户端），对应 Vue 版 AvailableChannelsView.vue */
export default function AvailableChannelsView() {
  const { t } = useI18n()
  const [channels, setChannels] = useState<UserAvailableChannel[]>([])
  const [userGroupRates, setUserGroupRates] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const columnLabels = {
    name: t('availableChannels.columns.name'),
    description: t('availableChannels.columns.description'),
    platform: t('availableChannels.columns.platform'),
    groups: t('availableChannels.columns.groups'),
    supportedModels: t('availableChannels.columns.supportedModels')
  }

  /**
   * 搜索过滤：
   * - 命中渠道名/描述 → 整个渠道（所有 platforms）都保留
   * - 否则按 platform/group/model 维度在 sections 里过滤，保留有匹配的 section
   * - 所有 sections 都不匹配时，渠道本身被过滤掉
   */
  const filteredChannels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return channels
    return channels
      .map((ch) => {
        const nameHit = ch.name.toLowerCase().includes(q)
        const descHit = (ch.description || '').toLowerCase().includes(q)
        if (nameHit || descHit) return ch
        const matchingSections = ch.platforms.filter(
          (p) =>
            p.platform.toLowerCase().includes(q) ||
            p.groups.some((g) => g.name.toLowerCase().includes(q)) ||
            p.supported_models.some((m) => m.name.toLowerCase().includes(q))
        )
        if (matchingSections.length === 0) return null
        return { ...ch, platforms: matchingSections }
      })
      .filter((ch): ch is UserAvailableChannel => ch !== null)
  }, [channels, searchQuery])

  async function loadChannels() {
    setLoading(true)
    try {
      // 渠道列表和用户专属倍率并发拉取。专属倍率失败不阻塞渠道展示——
      // 失败时只是无法渲染专属倍率角标，降级为仅显示默认倍率。
      const [list, rates] = await Promise.all([
        userChannelsAPI.getAvailable(),
        userGroupsAPI.getUserGroupRates().catch((err: unknown) => {
          console.error('Failed to load user group rates:', err)
          return {} as Record<number, number>
        })
      ])
      setChannels(list)
      setUserGroupRates(rates)
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时加载（Vue 版 onMounted）
    void loadChannels()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载时加载（Vue 版 onMounted）
  }, [])

  return (
    <TablePageLayout
      filters={
        <div className={styles.toolbar}>
          <SearchInput
            className={styles.search}
            value={searchQuery}
            onChange={setSearchQuery}
            debounceMs={0}
            placeholder={t('availableChannels.searchPlaceholder')}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={loading}
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            onClick={() => void loadChannels()}
          >
            <RefreshCw size={16} strokeWidth={1.75} className={loading ? styles.spinning : undefined} aria-hidden="true" />
          </Button>
        </div>
      }
      table={
        <AvailableChannelsTable
          columns={columnLabels}
          rows={filteredChannels}
          loading={loading}
          userGroupRates={userGroupRates}
          pricingKeyPrefix="availableChannels.pricing"
          noPricingLabel={t('availableChannels.noPricing')}
          noModelsLabel={t('availableChannels.noModels')}
          emptyLabel={t('availableChannels.empty')}
        />
      }
    />
  )
}
