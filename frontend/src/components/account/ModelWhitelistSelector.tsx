import { Check, ChevronDown, Copy, X } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'

import { accountsAPI } from '@/api/admin/accounts'
import type { SyncUpstreamPreviewParams } from '@/api/admin/accounts'
import { Button } from '@/components/arc/button/button'
import ModelIcon from '@/components/common/ModelIcon'
import { useClipboard } from '@/composables/useClipboard'
import { allModels, getModelsByPlatform } from '@/composables/useModelWhitelist'
import { getPlatformCatalog, subscribePlatformCatalog, supportsUpstreamModelSync } from '@/constants/platformCatalog'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { extractApiErrorMessage } from '@/utils/apiError'
import styles from './AccountForm.module.css'
import own from './ModelWhitelistSelector.module.css'

export interface ModelWhitelistSyncCredentials {
  platform: string
  type: string
  base_url?: string
  api_key: string
}

export interface ModelWhitelistSelectorProps {
  /** Vue 版 modelValue */
  value: string[]
  onChange: (value: string[]) => void
  modelMappings?: { from: string; to: string }[]
  platform?: string
  platforms?: string[]
  accountId?: number
  syncCredentials?: ModelWhitelistSyncCredentials
  /** Vue 版 upstream-synced */
  onUpstreamSynced?: () => void
}

/** 模型白名单多选：下拉选择、填充相关模型、同步上游模型、自定义模型 */
export default function ModelWhitelistSelector({
  value,
  onChange,
  modelMappings,
  platform,
  platforms,
  accountId,
  syncCredentials,
  onUpstreamSynced
}: ModelWhitelistSelectorProps) {
  const { t } = useI18n()
  const { copyToClipboard } = useClipboard()
  // 平台清单可能在运行时更新（新登记平台），订阅后重新计算是否支持上游同步
  useSyncExternalStore(subscribePlatformCatalog, getPlatformCatalog, getPlatformCatalog)

  const [showDropdown, setShowDropdown] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [isSyncingUpstream, setIsSyncingUpstream] = useState(false)

  const rawPlatforms = platforms && platforms.length > 0 ? platforms : platform ? [platform] : []
  const normalizedPlatforms = Array.from(
    new Set(rawPlatforms.map((item) => item?.trim()).filter((item): item is string => Boolean(item)))
  )

  const canSyncUpstream = (() => {
    if (accountId) {
      if (normalizedPlatforms.length === 0) return true
      return normalizedPlatforms.some(supportsUpstreamModelSync)
    }
    if (syncCredentials) {
      return supportsUpstreamModelSync(syncCredentials.platform)
    }
    return false
  })()

  const availableOptions = (() => {
    if (normalizedPlatforms.length === 0) {
      return allModels
    }
    const allowedModels = new Set<string>()
    for (const item of normalizedPlatforms) {
      for (const model of getModelsByPlatform(item)) {
        allowedModels.add(model)
      }
    }
    return allModels.filter((model) => allowedModels.has(model.value))
  })()

  const query = searchQuery.toLowerCase().trim()
  const filteredModels = query
    ? availableOptions.filter((m) => m.value.toLowerCase().includes(query) || m.label.toLowerCase().includes(query))
    : availableOptions

  const toggleDropdown = () => {
    const next = !showDropdown
    setShowDropdown(next)
    if (!next) setSearchQuery('')
  }

  const removeModel = (model: string) => {
    onChange(value.filter((m) => m !== model))
  }

  const toggleModel = (model: string) => {
    if (value.includes(model)) {
      removeModel(model)
    } else {
      onChange([...value, model])
    }
  }

  const copyModelId = async (model: string) => {
    await copyToClipboard(model)
  }

  const addCustom = () => {
    const model = customModel.trim()
    if (!model) return
    const appStore = useAppStore.getState()
    if (value.includes(model)) {
      appStore.showInfo(t('admin.accounts.modelExists'))
      return
    }
    const conflict = modelMappings?.find(
      (mapping) => mapping.from.trim() === model && mapping.to.trim() && mapping.to.trim() !== model
    )
    if (conflict) {
      appStore.showInfo(t('admin.accounts.modelMappingConflict', { from: model, to: conflict.to.trim() }))
      return
    }
    onChange([...value, model])
    setCustomModel('')
  }

  const handleEnter = () => {
    if (!isComposing) addCustom()
  }

  const fillRelated = () => {
    const newModels = [...value]
    for (const item of normalizedPlatforms) {
      for (const model of getModelsByPlatform(item)) {
        if (!newModels.includes(model)) {
          newModels.push(model)
        }
      }
    }
    onChange(newModels)
  }

  const syncUpstreamModels = async () => {
    if (isSyncingUpstream || !canSyncUpstream) return

    const appStore = useAppStore.getState()
    setIsSyncingUpstream(true)
    try {
      let result
      if (accountId) {
        result = await accountsAPI.syncUpstreamModels(accountId)
      } else if (syncCredentials) {
        result = await accountsAPI.syncUpstreamModelsPreview(syncCredentials as SyncUpstreamPreviewParams)
      } else {
        return
      }

      const upstreamModels = result.models.map((model) => model.trim()).filter(Boolean)
      if (upstreamModels.length === 0) {
        appStore.showInfo(t('admin.accounts.syncUpstreamModelsEmpty'))
        return
      }

      if (!accountId) {
        onUpstreamSynced?.()
      }

      const newModels = [...value]
      let addedCount = 0
      for (const model of upstreamModels) {
        if (!newModels.includes(model)) {
          newModels.push(model)
          addedCount += 1
        }
      }

      onChange(newModels)
      const warnings = result.warnings ?? []
      const hasPartialMetadata = warnings.some((warning) => warning.code === 'upstream_model_metadata_partial')
      const hasIncompleteMetadata = warnings.some((warning) => warning.code === 'upstream_model_metadata_incomplete')
      if (hasIncompleteMetadata) {
        appStore.showWarning(t('admin.accounts.syncUpstreamModelsMetadataIncomplete'))
        return
      }
      if (addedCount > 0) {
        appStore.showSuccess(
          t('admin.accounts.syncUpstreamModelsSuccess', { count: addedCount, total: upstreamModels.length })
        )
      } else {
        appStore.showInfo(t('admin.accounts.syncUpstreamModelsNoChanges', { count: upstreamModels.length }))
      }
      if (hasPartialMetadata) {
        appStore.showWarning(t('admin.accounts.syncUpstreamModelsMetadataPartial'))
      }
    } catch (error) {
      const message = extractApiErrorMessage(error, t('admin.accounts.syncUpstreamModelsFailed'))
      appStore.showError(t('admin.accounts.syncUpstreamModelsError', { message }))
    } finally {
      setIsSyncingUpstream(false)
    }
  }

  const clearAll = () => {
    onChange([])
  }

  return (
    <div className={own.root}>
      {/* Multi-select Dropdown */}
      <div className={own.picker}>
        <div
          className={own.trigger}
          role="button"
          tabIndex={0}
          aria-expanded={showDropdown}
          data-testid="model-whitelist-trigger"
          onClick={toggleDropdown}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggleDropdown()
            }
          }}
        >
          <div className={own.selected}>
            {value.map((model) => (
              <span key={model} className={own.selectedItem}>
                <span className={own.selectedName}>
                  <ModelIcon model={model} size="14px" />
                  <span className={own.truncate}>{model}</span>
                </span>
                <button
                  type="button"
                  className={own.remove}
                  aria-label={`${t('common.delete')} ${model}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    removeModel(model)
                  }}
                >
                  <X size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
          <div className={own.summary}>
            <span className={styles.hint}>{t('admin.accounts.modelCount', { count: value.length })}</span>
            <ChevronDown size={18} aria-hidden="true" className={own.chevron} />
          </div>
        </div>
        {/* Dropdown List */}
        {showDropdown ? (
          <div className={own.dropdown}>
            <div className={own.searchBar}>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                type="text"
                className={styles.input}
                placeholder={t('admin.accounts.searchModels')}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div className={own.options}>
              {filteredModels.map((model) => {
                const selected = value.includes(model.value)
                return (
                  <div key={model.value} data-testid="model-option" className={own.option}>
                    <button
                      type="button"
                      data-testid="select-model"
                      className={own.optionSelect}
                      aria-pressed={selected}
                      onClick={() => toggleModel(model.value)}
                    >
                      <span className={own.checkbox} data-checked={selected ? 'true' : undefined}>
                        {selected ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : null}
                      </span>
                      <ModelIcon model={model.value} size="18px" />
                      <span className={own.truncate}>{model.value}</span>
                    </button>
                    <button
                      type="button"
                      data-testid="copy-model-id"
                      className={own.copy}
                      title={`${t('common.copy')} ${model.value}`}
                      aria-label={`${t('common.copy')} ${model.value}`}
                      onClick={() => void copyModelId(model.value)}
                    >
                      <Copy size={16} aria-hidden="true" />
                    </button>
                  </div>
                )
              })}
              {filteredModels.length === 0 ? <div className={own.empty}>{t('admin.accounts.noMatchingModels')}</div> : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* Quick Actions */}
      <div className={styles.row}>
        <Button type="button" size="sm" variant="secondary" onClick={fillRelated}>
          {t('admin.accounts.fillRelatedModels')}
        </Button>
        {canSyncUpstream ? (
          <Button type="button" size="sm" variant="secondary" disabled={isSyncingUpstream} onClick={() => void syncUpstreamModels()}>
            {isSyncingUpstream ? t('admin.accounts.syncUpstreamModelsLoading') : t('admin.accounts.syncUpstreamModels')}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="secondary" className={own.dangerText} onClick={clearAll}>
          {t('admin.accounts.clearAllModels')}
        </Button>
      </div>

      {/* Custom Model Input */}
      <div className={styles.field}>
        <label className={styles.label}>{t('admin.accounts.customModelName')}</label>
        <div className={own.customRow}>
          <input
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            type="text"
            className={styles.input}
            placeholder={t('admin.accounts.enterCustomModelName')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleEnter()
              }
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
          />
          <Button type="button" variant="secondary" onClick={addCustom}>
            {t('admin.accounts.addModel')}
          </Button>
        </div>
      </div>
    </div>
  )
}
