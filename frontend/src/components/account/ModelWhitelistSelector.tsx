import { Check, ChevronDown, Copy, X } from 'lucide-react'
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore, type Ref } from 'react'

import { accountsAPI } from '@/api/admin/accounts'
import type { SyncUpstreamPreviewParams } from '@/api/admin/accounts'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
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
  /** 是否显示内置的“同步上游模型”按钮；隐藏后父组件仍可通过 ref 触发同步 */
  showSyncButton?: boolean
  /** Vue 版 upstream-synced（仅创建预览成功时） */
  onUpstreamSynced?: () => void
  /** Vue 版 upstream-sync-finished：已保存账号的同步结束（含失败），用于刷新诊断 */
  onUpstreamSyncFinished?: () => void
  /** 同步状态变化，供父组件合并展示忙碌状态（Vue 版通过 defineExpose 暴露的响应式 isSyncingUpstream） */
  onSyncingChange?: (syncing: boolean) => void
  /** Vue 版 defineExpose({ syncUpstreamModels, isSyncingUpstream }) */
  ref?: Ref<ModelWhitelistSelectorHandle | null>
}

export interface ModelWhitelistSelectorHandle {
  syncUpstreamModels: () => Promise<void>
  readonly isSyncingUpstream: boolean
}

interface UpstreamSyncReview {
  /** 上游返回的模型（去重、保持上游顺序） */
  models: string[]
  /** 默认勾选：白名单中已有的上游模型 */
  initial: string[]
}

/** 上游模型二次确认：列出上游模型，管理员勾选后再写入白名单 */
function UpstreamModelReviewDialog({
  review,
  onCancel,
  onConfirm
}: {
  review: UpstreamSyncReview
  onCancel: () => void
  onConfirm: (selected: Set<string>) => void
}) {
  const { t } = useI18n()
  const [selected, setSelected] = useState(() => new Set(review.initial))
  const [search, setSearch] = useState('')
  const initial = new Set(review.initial)
  const query = search.toLowerCase().trim()
  const visible = query ? review.models.filter((model) => model.toLowerCase().includes(query)) : review.models

  const toggle = (model: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(model)) next.delete(model)
      else next.add(model)
      return next
    })
  }
  // 全选/全不选只作用于当前搜索结果
  const setVisible = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const model of visible) {
        if (checked) next.add(model)
        else next.delete(model)
      }
      return next
    })
  }

  return (
    <BaseDialog
      show
      width="normal"
      title={t('admin.accounts.syncUpstreamModelsConfirmTitle')}
      description={t('admin.accounts.syncUpstreamModelsConfirmHint', {
        total: review.models.length,
        selected: review.initial.length
      })}
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="button" data-testid="sync-upstream-models-apply" onClick={() => onConfirm(selected)}>
            {t('admin.accounts.syncUpstreamModelsApply')}
          </Button>
        </>
      }
    >
      <div className={own.review}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          type="text"
          className={styles.input}
          placeholder={t('admin.accounts.searchModels')}
        />
        <div className={own.reviewToolbar}>
          <span className={styles.hint}>
            {t('admin.accounts.syncUpstreamModelsSelectedCount', { selected: selected.size, total: review.models.length })}
          </span>
          <div className={own.reviewActions}>
            <Button type="button" size="sm" variant="ghost" onClick={() => setVisible(true)}>
              {t('common.selectAll')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setVisible(false)}>
              {t('admin.accounts.syncUpstreamModelsDeselectAll')}
            </Button>
          </div>
        </div>
        <div className={own.reviewList} data-testid="sync-upstream-models-review">
          {visible.map((model) => {
            const checked = selected.has(model)
            return (
              <button
                key={model}
                type="button"
                role="checkbox"
                aria-checked={checked}
                data-testid="sync-upstream-model-option"
                className={own.optionSelect}
                onClick={() => toggle(model)}
              >
                <span className={own.checkbox} data-checked={checked ? 'true' : undefined}>
                  {checked ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : null}
                </span>
                <ModelIcon model={model} size="18px" />
                <span className={own.truncate}>{model}</span>
                {initial.has(model) ? (
                  <span className={own.reviewTag}>{t('admin.accounts.syncUpstreamModelsExistingTag')}</span>
                ) : null}
              </button>
            )
          })}
          {visible.length === 0 ? <div className={own.empty}>{t('admin.accounts.noMatchingModels')}</div> : null}
        </div>
      </div>
    </BaseDialog>
  )
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
  showSyncButton = true,
  onUpstreamSynced,
  onUpstreamSyncFinished,
  onSyncingChange,
  ref
}: ModelWhitelistSelectorProps) {
  const { t } = useI18n()
  const { copyToClipboard } = useClipboard()
  // 平台清单可能在运行时更新（新登记平台），订阅后重新计算是否支持上游同步
  useSyncExternalStore(subscribePlatformCatalog, getPlatformCatalog, getPlatformCatalog)

  const [showDropdown, setShowDropdown] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [isSyncingUpstream, setIsSyncingUpstreamState] = useState(false)
  // 上游同步结果的确认窗口数据；为 null 时不显示
  const [syncReview, setSyncReview] = useState<UpstreamSyncReview | null>(null)
  // 同步请求的世代号：切换账号或卸载后，旧请求的结果不再写回当前草稿
  const upstreamSyncVersion = useRef(0)
  const syncingRef = useRef(false)
  // 同步完成时追加到最新的已选列表（Vue 版读取的是响应式 props.modelValue）
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const onSyncingChangeRef = useRef(onSyncingChange)
  useLayoutEffect(() => {
    valueRef.current = value
    onChangeRef.current = onChange
    onSyncingChangeRef.current = onSyncingChange
  })

  const setIsSyncingUpstream = (syncing: boolean) => {
    syncingRef.current = syncing
    setIsSyncingUpstreamState(syncing)
  }

  const previousAccountId = useRef(accountId)
  useEffect(() => {
    if (previousAccountId.current === accountId) return
    previousAccountId.current = accountId
    upstreamSyncVersion.current += 1
    setIsSyncingUpstream(false)
    setSyncReview(null)
  }, [accountId])

  useEffect(() => {
    return () => {
      upstreamSyncVersion.current += 1
    }
  }, [])

  useEffect(() => {
    onSyncingChangeRef.current?.(isSyncingUpstream)
  }, [isSyncingUpstream])

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
    if (syncingRef.current || !canSyncUpstream) return

    const appStore = useAppStore.getState()
    const syncVersion = upstreamSyncVersion.current
    const previewCredentials = syncCredentials
    const isCurrentSync = () => syncVersion === upstreamSyncVersion.current
    setIsSyncingUpstream(true)
    try {
      let result
      if (accountId) {
        result = await accountsAPI.syncUpstreamModels(accountId)
      } else if (previewCredentials) {
        result = await accountsAPI.syncUpstreamModelsPreview(previewCredentials as SyncUpstreamPreviewParams)
      } else {
        return
      }
      if (!isCurrentSync()) return

      // 只拿到已配置的回退模型时不追加，避免把未经上游确认的 ID 写进白名单
      if (result.discovery_source === 'configured_fallback') {
        appStore.showWarning(t('admin.accounts.grokModelDiagnostics.configuredFallback'))
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

      const warnings = result.warnings ?? []
      if (warnings.some((warning) => warning.code === 'upstream_model_metadata_incomplete')) {
        appStore.showWarning(t('admin.accounts.syncUpstreamModelsMetadataIncomplete'))
      } else if (warnings.some((warning) => warning.code === 'upstream_model_metadata_partial')) {
        appStore.showWarning(t('admin.accounts.syncUpstreamModelsMetadataPartial'))
      }

      // 不直接写入白名单：打开确认窗口，默认只勾选白名单里已有的上游模型
      const uniqueModels = Array.from(new Set(upstreamModels))
      const current = new Set(valueRef.current)
      setSyncReview({
        models: uniqueModels,
        initial: uniqueModels.filter((model) => current.has(model))
      })
    } catch (error) {
      if (!isCurrentSync()) return
      const message = extractApiErrorMessage(error, t('admin.accounts.syncUpstreamModelsFailed'))
      appStore.showError(t('admin.accounts.syncUpstreamModelsError', { message }))
    } finally {
      if (isCurrentSync()) {
        setIsSyncingUpstream(false)
        if (accountId) {
          onUpstreamSyncFinished?.()
        }
      }
    }
  }

  useImperativeHandle(ref, () => ({
    syncUpstreamModels,
    get isSyncingUpstream() {
      return syncingRef.current
    }
  }))

  const clearAll = () => {
    onChange([])
  }

  /** 按确认窗口的勾选结果更新白名单：只增删上游列表内的模型，其他已选模型保持不变 */
  const applySyncReview = (selected: Set<string>) => {
    if (!syncReview) return
    const upstream = new Set(syncReview.models)
    const current = valueRef.current
    const kept = current.filter((model) => !upstream.has(model) || selected.has(model))
    const additions = syncReview.models.filter((model) => selected.has(model) && !current.includes(model))
    const removed = current.length - kept.length
    setSyncReview(null)
    const appStore = useAppStore.getState()
    if (additions.length === 0 && removed === 0) {
      appStore.showInfo(t('admin.accounts.syncUpstreamModelsUnchanged'))
      return
    }
    onChangeRef.current([...kept, ...additions])
    appStore.showSuccess(t('admin.accounts.syncUpstreamModelsApplied', { added: additions.length, removed }))
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
        {canSyncUpstream && showSyncButton ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="sync-upstream-models"
            disabled={isSyncingUpstream}
            onClick={() => void syncUpstreamModels()}
          >
            {isSyncingUpstream ? t('admin.accounts.syncUpstreamModelsLoading') : t('admin.accounts.syncUpstreamModels')}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="secondary" className={own.dangerText} onClick={clearAll}>
          {t('admin.accounts.clearAllModels')}
        </Button>
      </div>

      {syncReview ? (
        <UpstreamModelReviewDialog
          review={syncReview}
          onCancel={() => setSyncReview(null)}
          onConfirm={applySyncReview}
        />
      ) : null}

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
