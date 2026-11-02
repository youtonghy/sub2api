/**
 * 监控列表工具栏，对应 Vue 版 MonitorFiltersBar.vue：搜索、服务商与启用状态筛选；右侧刷新、模板管理、新建。
 * v-model:search / provider / enabled 对应受控值 + onXChange；搜索输入时回调 onSearchInput 由页面防抖。
 */
import { Plus, RefreshCw, Settings } from 'lucide-react'

import type { Provider } from '@/api/admin/channelMonitor'
import { Button } from '@/components/arc/button/button'
import SearchInput from '@/components/common/SearchInput'
import Select from '@/components/common/Select'
import {
  PROVIDER_ANTHROPIC,
  PROVIDER_ANTIGRAVITY,
  PROVIDER_DEEPSEEK,
  PROVIDER_GEMINI,
  PROVIDER_GROK,
  PROVIDER_KIMI,
  PROVIDER_MINIMAX,
  PROVIDER_OPENAI,
  PROVIDER_OPENCODE_GO,
  PROVIDER_ZHIPU
} from '@/constants/channelMonitor'
import { useI18n } from '@/i18n/useI18n'
import monitorStyles from './monitor.module.css'
import styles from './MonitorFiltersBar.module.css'

export type MonitorEnabledFilter = '' | 'true' | 'false'

export interface MonitorFiltersBarProps {
  loading: boolean
  search: string
  onSearchChange?: (value: string) => void
  provider: Provider | ''
  onProviderChange?: (value: Provider | '') => void
  enabled: MonitorEnabledFilter
  onEnabledChange?: (value: MonitorEnabledFilter) => void
  onReload?: () => void
  onCreate?: () => void
  onManageTemplates?: () => void
  onSearchInput?: () => void
}

export default function MonitorFiltersBar({
  loading,
  search,
  onSearchChange,
  provider,
  onProviderChange,
  enabled,
  onEnabledChange,
  onReload,
  onCreate,
  onManageTemplates,
  onSearchInput
}: MonitorFiltersBarProps) {
  const { t } = useI18n()

  const providerFilterOptions = [
    { value: '', label: t('admin.channelMonitor.allProviders') },
    { value: PROVIDER_OPENAI, label: t('monitorCommon.providers.openai') },
    { value: PROVIDER_ANTHROPIC, label: t('monitorCommon.providers.anthropic') },
    { value: PROVIDER_GEMINI, label: t('monitorCommon.providers.gemini') },
    { value: PROVIDER_GROK, label: t('monitorCommon.providers.grok') },
    { value: PROVIDER_ANTIGRAVITY, label: t('monitorCommon.providers.antigravity') },
    { value: PROVIDER_KIMI, label: t('monitorCommon.providers.kimi') },
    { value: PROVIDER_ZHIPU, label: t('monitorCommon.providers.zhipu') },
    { value: PROVIDER_DEEPSEEK, label: t('monitorCommon.providers.deepseek') },
    { value: PROVIDER_MINIMAX, label: t('monitorCommon.providers.minimax') },
    { value: PROVIDER_OPENCODE_GO, label: t('monitorCommon.providers.opencode_go') }
  ]

  const enabledFilterOptions = [
    { value: '', label: t('admin.channelMonitor.allStatus') },
    { value: 'true', label: t('admin.channelMonitor.onlyEnabled') },
    { value: 'false', label: t('admin.channelMonitor.onlyDisabled') }
  ]

  return (
    <div className={styles.toolbar}>
      {/* Left: Search + Filters */}
      <div className={styles.filters}>
        <SearchInput
          className={styles.search}
          value={search}
          placeholder={t('admin.channelMonitor.searchPlaceholder')}
          onChange={(value) => {
            onSearchChange?.(value)
            onSearchInput?.()
          }}
        />
        <div className={styles.provider}>
          <Select
            value={provider}
            options={providerFilterOptions}
            placeholder={t('admin.channelMonitor.allProviders')}
            aria-label={t('admin.channelMonitor.allProviders')}
            onChange={(value) => {
              onProviderChange?.(String(value ?? '') as Provider | '')
              onReload?.()
            }}
          />
        </div>
        <div className={styles.enabled}>
          <Select
            value={enabled}
            options={enabledFilterOptions}
            placeholder={t('admin.channelMonitor.enabledFilter')}
            aria-label={t('admin.channelMonitor.enabledFilter')}
            onChange={(value) => {
              onEnabledChange?.(String(value ?? '') as MonitorEnabledFilter)
              onReload?.()
            }}
          />
        </div>
      </div>

      {/* Right: Actions */}
      <div className={styles.actions}>
        <Button
          type="button"
          variant="secondary"
          disabled={loading}
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
          onClick={() => onReload?.()}
        >
          <RefreshCw size={16} strokeWidth={1.75} className={loading ? monitorStyles.spinning : undefined} aria-hidden="true" />
        </Button>
        <Button type="button" variant="secondary" title={t('admin.channelMonitor.template.manageButton')} onClick={() => onManageTemplates?.()}>
          <Settings size={16} strokeWidth={1.75} aria-hidden="true" />
          {t('admin.channelMonitor.template.manageButton')}
        </Button>
        <Button type="button" variant="primary" onClick={() => onCreate?.()}>
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          {t('admin.channelMonitor.createButton')}
        </Button>
      </div>
    </div>
  )
}
