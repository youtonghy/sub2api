/**
 * 渠道创建 / 编辑表单（Vue 版 ChannelsView.vue 内的 BaseDialog），改为右侧宽抽屉。
 * 标签页：基础设置 + 每个已启用平台；平台页内含关联分组、平台开关、模型映射、模型定价与账号统计定价规则。
 * 每次打开由父组件换 key 重新挂载，初始表单与账号名缓存由父组件按 Vue 版的顺序准备好后传入。
 */
import { Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { adminAPI } from '@/api/admin'
import type { Channel, CreateChannelRequest, UpdateChannelRequest } from '@/api/admin/channels'
import { AccountFormDrawer, FormField, FormSection, ToggleRow } from '@/components/account/AccountFormLayout'
import arcInput from '@/components/arc/input/input.module.css'
import { Button } from '@/components/arc/button/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs'
import Input from '@/components/common/Input'
import PlatformIcon from '@/components/common/PlatformIcon'
import Select from '@/components/common/Select'
import TextArea from '@/components/common/TextArea'
import { useKeyedDebouncedSearch } from '@/composables/useKeyedDebouncedSearch'
import { supportsPricingModelSync } from '@/constants/platformCatalog'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminGroup, GroupPlatform } from '@/types'
import { extractApiErrorMessage } from '@/utils/apiError'
import {
  accountStatsRulesToAPI,
  formToAPI,
  groupsForPlatform,
  newChannelPricingEntry,
  newPlatformSection,
  newRulePricingEntry,
  platformDisplayLabel,
  validateChannelForm,
  type ChannelFormState,
  type FormPricingRule,
  type PlatformSection
} from './channelFormModel'
import PricingEntryCard from './PricingEntryCard'
import { platformTone } from './platformTone'
import type { PricingFormEntry } from './types'
import form from './channelForm.module.css'
import styles from './ChannelFormDrawer.module.css'

export interface ChannelFormDrawerProps {
  show: boolean
  /** 编辑中的渠道；新建时为 null */
  editingChannel: Channel | null
  initialForm: ChannelFormState
  /** 账号统计规则中已有账号的名称缓存（id → name） */
  initialAccountNames: Record<number, string>
  /** 平台清单中的全部具体平台（展示顺序） */
  platformOrder: GroupPlatform[]
  allGroups: AdminGroup[]
  groupsLoading: boolean
  /** 全部渠道（用于分组冲突检测，与当前分页无关） */
  allChannelsForConflict: Channel[]
  webSearchGlobalEnabled: boolean
  onClose: () => void
  /** 保存成功（父组件关闭抽屉并刷新列表） */
  onSaved: () => void
}

interface SimpleAccount {
  id: number
  name: string
  platform: string
}

const BASIC_TAB = 'basic'

export default function ChannelFormDrawer({
  show,
  editingChannel,
  initialForm,
  initialAccountNames,
  platformOrder,
  allGroups,
  groupsLoading,
  allChannelsForConflict,
  webSearchGlobalEnabled,
  onClose,
  onSaved
}: ChannelFormDrawerProps) {
  const { t, te } = useI18n()
  const [formState, setFormState] = useState<ChannelFormState>(initialForm)
  const [activeTab, setActiveTab] = useState<string>(BASIC_TAB)
  const [submitting, setSubmitting] = useState(false)
  const [syncingPlatform, setSyncingPlatform] = useState<string | null>(null)
  const syncingRef = useRef<string | null>(null)
  const formRef = useRef(formState)
  useEffect(() => {
    formRef.current = formState
  }, [formState])

  // Composite pricing/mapping may target every concrete schedulable provider.
  const compositePlatforms = platformOrder

  const platformLabel = (platform: string) => platformDisplayLabel(t, te, platform)

  // ── Account search for pricing rules ──
  const [ruleAccountSearchKeyword, setRuleAccountSearchKeyword] = useState<Record<string, string>>({})
  const [ruleAccountSearchResults, setRuleAccountSearchResults] = useState<Record<string, SimpleAccount[]>>({})
  const [showRuleAccountDropdown, setShowRuleAccountDropdown] = useState<Record<string, boolean>>({})
  // Cache: account ID → name, populated when search results are selected
  const [ruleAccountNameCache, setRuleAccountNameCache] = useState<Record<number, string>>(initialAccountNames)

  const ruleAccountSearchRunner = useKeyedDebouncedSearch<SimpleAccount[]>({
    delay: 300,
    search: async (keyword, { key, signal }) => {
      const platform = key.split('-')[0]
      const res = await adminAPI.accounts.list(1, 20, { platform, search: keyword }, { signal })
      return res.items.map((a) => ({ id: a.id, name: a.name, platform: a.platform }))
    },
    onSuccess: (key, result) => setRuleAccountSearchResults((prev) => ({ ...prev, [key]: result })),
    onError: (key) => setRuleAccountSearchResults((prev) => ({ ...prev, [key]: [] }))
  })

  const clearAllRuleAccountSearchState = () => {
    setRuleAccountSearchKeyword({})
    setRuleAccountSearchResults({})
    setShowRuleAccountDropdown({})
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target?.closest('[data-rule-account-search]')) {
        setShowRuleAccountDropdown((prev) => {
          if (!Object.values(prev).some(Boolean)) return prev
          return Object.fromEntries(Object.keys(prev).map((key) => [key, false]))
        })
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  // ── Form helpers ──
  const setField = <K extends keyof ChannelFormState>(key: K, value: ChannelFormState[K]) =>
    setFormState((prev) => ({ ...prev, [key]: value }))

  const updateSection = (sectionIdx: number, updater: (section: PlatformSection) => PlatformSection) =>
    setFormState((prev) => ({
      ...prev,
      platforms: prev.platforms.map((section, idx) => (idx === sectionIdx ? updater(section) : section))
    }))

  const updateRule = (sectionIdx: number, ruleIndex: number, updater: (rule: FormPricingRule) => FormPricingRule) =>
    updateSection(sectionIdx, (section) => ({
      ...section,
      account_stats_pricing_rules: section.account_stats_pricing_rules.map((rule, idx) => (idx === ruleIndex ? updater(rule) : rule))
    }))

  const activePlatforms = formState.platforms.filter((s) => s.enabled).map((s) => s.platform)

  const togglePlatform = (platform: GroupPlatform) => {
    const exists = formState.platforms.some((s) => s.platform === platform)
    if (exists) {
      const section = formState.platforms.find((s) => s.platform === platform)!
      if (section.enabled && activeTab === platform) setActiveTab(BASIC_TAB)
      setFormState((prev) => ({
        ...prev,
        platforms: prev.platforms.map((s) => (s.platform === platform ? { ...s, enabled: !s.enabled } : s))
      }))
    } else {
      setFormState((prev) => ({ ...prev, platforms: [...prev.platforms, newPlatformSection(platform)] }))
    }
  }

  // ── Group helpers ──
  const groupToChannelMap = useMemo(() => {
    const map = new Map<number, Channel>()
    for (const ch of allChannelsForConflict) {
      if (editingChannel && ch.id === editingChannel.id) continue
      for (const gid of ch.group_ids || []) {
        map.set(gid, ch)
      }
    }
    return map
  }, [allChannelsForConflict, editingChannel])

  const isGroupInOtherChannel = (groupId: number) => groupToChannelMap.has(groupId)

  const getGroupInOtherChannelLabel = (groupId: number) => {
    const name = groupToChannelMap.get(groupId)?.name || ''
    return t('admin.channels.form.inOtherChannel', { name })
  }

  const toggleGroupInSection = (sectionIdx: number, groupId: number) =>
    updateSection(sectionIdx, (section) => ({
      ...section,
      group_ids: section.group_ids.includes(groupId)
        ? section.group_ids.filter((id) => id !== groupId)
        : [...section.group_ids, groupId]
    }))

  const getGroupNameById = (groupId: number) => {
    const group = allGroups.find((g) => g.id === groupId)
    return group ? group.name : `#${groupId}`
  }

  // ── Pricing helpers ──
  const addPricingEntry = (sectionIdx: number) =>
    updateSection(sectionIdx, (section) => ({ ...section, model_pricing: [...section.model_pricing, newChannelPricingEntry()] }))

  const updatePricingEntry = (sectionIdx: number, idx: number, updated: PricingFormEntry) =>
    updateSection(sectionIdx, (section) => ({
      ...section,
      model_pricing: section.model_pricing.map((entry, i) => (i === idx ? updated : entry))
    }))

  const removePricingEntry = (sectionIdx: number, idx: number) =>
    updateSection(sectionIdx, (section) => ({
      ...section,
      model_pricing: section.model_pricing.filter((_entry, i) => i !== idx)
    }))

  const syncLatestModels = async (sectionIdx: number) => {
    const section = formRef.current.platforms[sectionIdx]
    if (!section || syncingRef.current || !supportsPricingModelSync(section.platform)) return
    const platform = section.platform
    syncingRef.current = platform
    setSyncingPlatform(platform)
    try {
      const result = await adminAPI.channels.syncPricingModels(platform)
      // Collect all model names already present in this platform's pricing entries
      const latest = formRef.current.platforms.find((s) => s.platform === platform) ?? section
      const existingModels = new Set<string>()
      for (const entry of latest.model_pricing) {
        for (const m of entry.models) existingModels.add(m)
      }
      const newModels = result.models.filter((m) => !existingModels.has(m))
      if (newModels.length === 0) {
        useAppStore.getState().showSuccess(t('admin.channels.form.syncModelsAlreadyUpToDate'))
        return
      }
      // Add new models as a single new pricing entry (user fills in prices)
      setFormState((prev) => ({
        ...prev,
        platforms: prev.platforms.map((s) =>
          s.platform === platform ? { ...s, model_pricing: [...s.model_pricing, newChannelPricingEntry(newModels)] } : s
        )
      }))
      useAppStore.getState().showSuccess(t('admin.channels.form.syncModelsSuccess', { count: newModels.length }))
    } catch (error) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.channels.form.syncModelsError')))
    } finally {
      syncingRef.current = null
      setSyncingPlatform(null)
    }
  }

  // ── Model Mapping helpers ──
  const addMappingEntry = (sectionIdx: number) =>
    updateSection(sectionIdx, (section) => {
      const mapping = section.model_mapping
      let key = ''
      let i = 1
      while (key === '' || key in mapping) {
        key = `model-${i}`
        i++
      }
      return { ...section, model_mapping: { ...mapping, [key]: '' } }
    })

  const removeMappingEntry = (sectionIdx: number, key: string) =>
    updateSection(sectionIdx, (section) => {
      const mapping = { ...section.model_mapping }
      delete mapping[key]
      return { ...section, model_mapping: mapping }
    })

  // 重命名后保持原有顺序之外的行为与 Vue 版一致：删除旧键、在末尾追加新键
  const renameMappingKey = (sectionIdx: number, oldKey: string, rawKey: string) => {
    const newKey = rawKey.trim()
    if (!newKey || newKey === oldKey) return
    updateSection(sectionIdx, (section) => {
      const mapping = { ...section.model_mapping }
      if (newKey in mapping) return section
      const value = mapping[oldKey]
      delete mapping[oldKey]
      mapping[newKey] = value
      return { ...section, model_mapping: mapping }
    })
  }

  const setMappingTarget = (sectionIdx: number, key: string, value: string) =>
    updateSection(sectionIdx, (section) => ({ ...section, model_mapping: { ...section.model_mapping, [key]: value } }))

  // ── Account Stats Pricing helpers ──
  const addAccountStatsRule = (sectionIdx: number) =>
    updateSection(sectionIdx, (section) => ({
      ...section,
      account_stats_pricing_rules: [...section.account_stats_pricing_rules, { name: '', group_ids: [], account_ids: [], pricing: [] }]
    }))

  const removeAccountStatsRule = (sectionIdx: number, ruleIndex: number) => {
    updateSection(sectionIdx, (section) => ({
      ...section,
      account_stats_pricing_rules: section.account_stats_pricing_rules.filter((_rule, idx) => idx !== ruleIndex)
    }))
    // Clear all search state since indices shift after removal
    ruleAccountSearchRunner.clearAll()
    clearAllRuleAccountSearchState()
  }

  const addRulePricingEntry = (sectionIdx: number, ruleIndex: number) =>
    updateRule(sectionIdx, ruleIndex, (rule) => ({ ...rule, pricing: [...rule.pricing, newRulePricingEntry()] }))

  const removeRulePricingEntry = (sectionIdx: number, ruleIndex: number, pricingIndex: number) =>
    updateRule(sectionIdx, ruleIndex, (rule) => ({ ...rule, pricing: rule.pricing.filter((_p, idx) => idx !== pricingIndex) }))

  const toggleRuleGroup = (sectionIdx: number, ruleIndex: number, gid: number) =>
    updateRule(sectionIdx, ruleIndex, (rule) => ({
      ...rule,
      group_ids: rule.group_ids.includes(gid) ? rule.group_ids.filter((id) => id !== gid) : [...rule.group_ids, gid]
    }))

  const onRuleAccountSearchInput = (platform: string, ruleIndex: number, keyword: string) => {
    const key = `${platform}-${ruleIndex}`
    setRuleAccountSearchKeyword((prev) => ({ ...prev, [key]: keyword }))
    setShowRuleAccountDropdown((prev) => ({ ...prev, [key]: true }))
    ruleAccountSearchRunner.trigger(key, keyword)
  }

  const onRuleAccountSearchFocus = (platform: string, ruleIndex: number) => {
    const key = `${platform}-${ruleIndex}`
    setShowRuleAccountDropdown((prev) => ({ ...prev, [key]: true }))
    if (!ruleAccountSearchResults[key]?.length) {
      ruleAccountSearchRunner.trigger(key, ruleAccountSearchKeyword[key] || '')
    }
  }

  const selectRuleAccount = (sectionIdx: number, ruleIndex: number, account: SimpleAccount, platform: string) => {
    updateRule(sectionIdx, ruleIndex, (rule) =>
      rule.account_ids.includes(account.id) ? rule : { ...rule, account_ids: [...rule.account_ids, account.id] }
    )
    setRuleAccountNameCache((prev) => ({ ...prev, [account.id]: account.name }))
    const key = `${platform}-${ruleIndex}`
    setRuleAccountSearchKeyword((prev) => ({ ...prev, [key]: '' }))
    setShowRuleAccountDropdown((prev) => ({ ...prev, [key]: false }))
  }

  const removeRuleAccount = (sectionIdx: number, ruleIndex: number, accountId: number) =>
    updateRule(sectionIdx, ruleIndex, (rule) => ({ ...rule, account_ids: rule.account_ids.filter((id) => id !== accountId) }))

  const getRuleAccountLabel = (accountId: number) => {
    const name = ruleAccountNameCache[accountId]
    return name ? `${name} #${accountId}` : `#${accountId}`
  }

  // ── Submit ──
  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (submitting) return
    const current = formRef.current
    const validationError = validateChannelForm(current, t, te)
    if (validationError) {
      useAppStore.getState().showError(validationError.message)
      if (validationError.platform) setActiveTab(validationError.platform)
      return
    }

    const { group_ids, model_pricing, model_mapping, features_config } = formToAPI(current.platforms, editingChannel)

    setSubmitting(true)
    try {
      if (editingChannel) {
        const req: UpdateChannelRequest = {
          name: current.name.trim(),
          description: current.description.trim() || undefined,
          status: current.status,
          group_ids,
          model_pricing,
          model_mapping: Object.keys(model_mapping).length > 0 ? model_mapping : {},
          billing_model_source: current.billing_model_source,
          restrict_models: current.restrict_models,
          features_config,
          apply_pricing_to_account_stats: current.apply_pricing_to_account_stats,
          account_stats_pricing_rules: accountStatsRulesToAPI(current.platforms)
        }
        await adminAPI.channels.update(editingChannel.id, req)
        useAppStore.getState().showSuccess(t('admin.channels.updateSuccess'))
      } else {
        const req: CreateChannelRequest = {
          name: current.name.trim(),
          description: current.description.trim() || undefined,
          group_ids,
          model_pricing,
          model_mapping: Object.keys(model_mapping).length > 0 ? model_mapping : {},
          billing_model_source: current.billing_model_source,
          restrict_models: current.restrict_models,
          features_config,
          apply_pricing_to_account_stats: current.apply_pricing_to_account_stats,
          account_stats_pricing_rules: accountStatsRulesToAPI(current.platforms)
        }
        await adminAPI.channels.create(req)
        useAppStore.getState().showSuccess(t('admin.channels.createSuccess'))
      }
      onSaved()
    } catch (error: unknown) {
      useAppStore
        .getState()
        .showError(
          extractApiErrorMessage(error, editingChannel ? t('admin.channels.updateError') : t('admin.channels.createError'))
        )
    } finally {
      setSubmitting(false)
    }
  }

  const statusEditOptions = [
    { value: 'active', label: t('admin.channels.statusActive') },
    { value: 'disabled', label: t('admin.channels.statusDisabled') }
  ]

  const billingModelSourceOptions = [
    { value: 'channel_mapped', label: t('admin.channels.form.billingModelSourceChannelMapped') },
    { value: 'requested', label: t('admin.channels.form.billingModelSourceRequested') },
    { value: 'upstream', label: t('admin.channels.form.billingModelSourceUpstream') },
    { value: 'response_model', label: t('admin.channels.form.billingModelSourceResponse') }
  ]

  const inputClass = [arcInput.input, form.small].join(' ')

  const renderBasicTab = () => (
    <>
      <FormSection>
        {/* Name */}
        <Input
          label={t('admin.channels.form.name')}
          required
          value={formState.name}
          placeholder={t('admin.channels.form.namePlaceholder')}
          onChange={(value) => setField('name', value)}
        />

        {/* Description */}
        <TextArea
          label={t('admin.channels.form.description')}
          rows={2}
          value={formState.description}
          placeholder={t('admin.channels.form.descriptionPlaceholder')}
          onChange={(value) => setField('description', value)}
        />

        {/* Status (edit only) */}
        {editingChannel && (
          <FormField label={t('admin.channels.form.status')}>
            <Select
              value={formState.status}
              options={statusEditOptions}
              aria-label={t('admin.channels.form.status')}
              onChange={(value) => setField('status', String(value))}
            />
          </FormField>
        )}

        {/* Model Restriction */}
        <ToggleRow
          label={t('admin.channels.form.restrictModels')}
          description={t('admin.channels.form.restrictModelsHint')}
          checked={formState.restrict_models}
          onChange={(value) => setField('restrict_models', value)}
        />

        {/* Billing Basis */}
        <FormField label={t('admin.channels.form.billingModelSource')} hint={t('admin.channels.form.billingModelSourceHint')}>
          <Select
            value={formState.billing_model_source}
            options={billingModelSourceOptions}
            aria-label={t('admin.channels.form.billingModelSource')}
            onChange={(value) => setField('billing_model_source', String(value))}
          />
        </FormField>
      </FormSection>

      {/* Platform Management */}
      <FormSection title={t('admin.channels.form.platformConfig')}>
        <div className={styles.chips}>
          {platformOrder.map((p) => {
            const active = activePlatforms.includes(p)
            return (
              <button
                key={p}
                type="button"
                role="checkbox"
                aria-checked={active}
                {...platformTone(p, active ? ['text', 'selected'] : 'text', styles.platformChip)}
                onClick={() => togglePlatform(p)}
              >
                <PlatformIcon platform={p} size="xs" />
                <span>{platformLabel(p)}</span>
              </button>
            )
          })}
        </div>
      </FormSection>

      {/* Apply Pricing to Account Stats (toggle only in basic settings) */}
      <FormSection>
        <ToggleRow
          label={t('admin.channels.form.applyPricingToAccountStats')}
          description={t('admin.channels.form.applyPricingToAccountStatsDesc')}
          checked={formState.apply_pricing_to_account_stats}
          onChange={(value) => setField('apply_pricing_to_account_stats', value)}
        />
      </FormSection>
    </>
  )

  const renderRule = (section: PlatformSection, sIdx: number, rule: FormPricingRule, ruleIndex: number) => {
    const key = `${section.platform}-${ruleIndex}`
    const results = ruleAccountSearchResults[key] ?? []
    return (
      <div key={ruleIndex} className={styles.rule}>
        <div className={form.headerRow}>
          <input
            className={styles.ruleName}
            value={rule.name}
            placeholder={t('admin.channels.form.ruleName')}
            aria-label={t('admin.channels.form.ruleName')}
            onChange={(event) => updateRule(sIdx, ruleIndex, (r) => ({ ...r, name: event.target.value }))}
          />
          <button type="button" className={[form.linkButton, form.muted].join(' ')} onClick={() => removeAccountStatsRule(sIdx, ruleIndex)}>
            {t('common.delete')}
          </button>
        </div>

        <div className={form.field}>
          <span className={form.subLabel}>{t('admin.channels.form.ruleGroups')}</span>
          <div className={styles.chips}>
            {section.group_ids.map((gid) => {
              const checked = rule.group_ids.includes(gid)
              return (
                <button
                  key={gid}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  className={[styles.groupChip, checked ? styles.chipSelected : ''].filter(Boolean).join(' ')}
                  onClick={() => toggleRuleGroup(sIdx, ruleIndex, gid)}
                >
                  <span {...platformTone(section.platform, 'text', styles.chipName)}>{getGroupNameById(gid)}</span>
                </button>
              )
            })}
          </div>
          {section.group_ids.length === 0 && <p className={form.hint}>{t('admin.channels.form.noGroupsInChannel')}</p>}
        </div>

        <div className={form.field}>
          <span className={form.subLabel}>{t('admin.channels.form.ruleAccounts')}</span>
          {/* Selected account chips */}
          {rule.account_ids.length > 0 && (
            <div className={styles.chips}>
              {rule.account_ids.map((accountId) => (
                <span key={accountId} className={[styles.groupChip, styles.chipSelected].join(' ')}>
                  <span {...platformTone(section.platform, 'text', styles.chipName)}>{getRuleAccountLabel(accountId)}</span>
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label={`${t('common.delete')} ${getRuleAccountLabel(accountId)}`}
                    onClick={() => removeRuleAccount(sIdx, ruleIndex, accountId)}
                  >
                    <X size={12} strokeWidth={2} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {/* Account search input */}
          <div className={styles.accountSearch} data-rule-account-search="">
            <input
              type="text"
              className={inputClass}
              value={ruleAccountSearchKeyword[key] ?? ''}
              placeholder={t('admin.channels.form.searchAccountPlaceholder')}
              aria-label={t('admin.channels.form.searchAccountPlaceholder')}
              onChange={(event) => onRuleAccountSearchInput(section.platform, ruleIndex, event.target.value)}
              onFocus={() => onRuleAccountSearchFocus(section.platform, ruleIndex)}
            />
            {/* Search results dropdown */}
            {showRuleAccountDropdown[key] && results.length > 0 && (
              <div className={styles.accountDropdown} role="listbox">
                {results.map((account) => {
                  const selected = rule.account_ids.includes(account.id)
                  return (
                    <button
                      key={account.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={styles.accountOption}
                      disabled={selected}
                      onClick={() => selectRuleAccount(sIdx, ruleIndex, account, section.platform)}
                    >
                      <span {...platformTone(account.platform, 'text')}>{account.name}</span>
                      <span className={styles.accountId}>#{account.id}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <p className={form.hint}>{t('admin.channels.form.ruleAccountsHint')}</p>
        </div>

        <div className={form.field}>
          <div className={form.headerRow}>
            <span className={form.subLabel}>{t('admin.channels.form.ruleModelPricing')}</span>
            <button type="button" className={form.linkButton} onClick={() => addRulePricingEntry(sIdx, ruleIndex)}>
              + {t('common.add')}
            </button>
          </div>
          {rule.pricing.length === 0 ? (
            <div className={form.dashedEmpty}>{t('admin.channels.form.noPricingRules')}</div>
          ) : (
            <div className={form.stack}>
              {rule.pricing.map((entry, pIdx) => (
                <PricingEntryCard
                  key={pIdx}
                  entry={entry}
                  platform={section.platform}
                  onUpdate={(updated) =>
                    updateRule(sIdx, ruleIndex, (r) => ({ ...r, pricing: r.pricing.map((p, i) => (i === pIdx ? updated : p)) }))
                  }
                  onRemove={() => removeRulePricingEntry(sIdx, ruleIndex, pIdx)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderPlatformTab = (section: PlatformSection, sIdx: number) => {
    const groups = groupsForPlatform(allGroups, section.platform, compositePlatforms)
    const mappingKeys = Object.keys(section.model_mapping)
    return (
      <>
        {/* Groups */}
        <FormSection>
          <div className={form.field}>
            <span className={form.label}>
              {t('admin.channels.form.groups')} <span className={form.required}>*</span>
              {section.group_ids.length > 0 && (
                <span className={form.unit}>({t('admin.channels.form.selectedCount', { count: section.group_ids.length })})</span>
              )}
            </span>
            <div className={styles.groupBox}>
              {groupsLoading ? (
                <p className={styles.groupBoxHint}>{t('common.loading')}</p>
              ) : groups.length === 0 ? (
                <p className={styles.groupBoxHint}>{t('admin.channels.form.noGroupsAvailable')}</p>
              ) : (
                <div className={styles.chips}>
                  {groups.map((group) => {
                    const checked = section.group_ids.includes(group.id)
                    const inOther = isGroupInOtherChannel(group.id)
                    return (
                      <button
                        key={group.id}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        disabled={inOther}
                        className={[styles.groupChip, checked ? styles.chipSelected : ''].filter(Boolean).join(' ')}
                        onClick={() => toggleGroupInSection(sIdx, group.id)}
                      >
                        <span {...platformTone(group.platform, 'text', styles.chipName)}>{group.name}</span>
                        <span {...platformTone(group.platform, 'tag', styles.rate)}>{group.rate_multiplier}x</span>
                        <span className={styles.chipMeta}>{group.account_count || 0}</span>
                        {inOther && <span className={styles.chipMeta}>{getGroupInOtherChannelLabel(group.id)}</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </FormSection>

        {/* Web Search Emulation (Anthropic only, hidden when global disabled) */}
        {section.platform === 'anthropic' && webSearchGlobalEnabled && (
          <FormSection>
            <ToggleRow
              label={t('admin.channels.form.webSearchEmulation')}
              description={<span className={styles.dangerHint}>{t('admin.channels.form.webSearchEmulationHint')}</span>}
              ariaLabel={t('admin.channels.form.webSearchEmulation')}
              checked={section.web_search_emulation}
              onChange={(value) => updateSection(sIdx, (s) => ({ ...s, web_search_emulation: value }))}
            />
          </FormSection>
        )}

        {/* Codex Image Generation Bridge (OpenAI only) */}
        {section.platform === 'openai' && (
          <FormSection>
            <ToggleRow
              label={t('admin.channels.form.codexImageGenerationBridge')}
              description={<span className={styles.warningHint}>{t('admin.channels.form.codexImageGenerationBridgeHint')}</span>}
              ariaLabel={t('admin.channels.form.codexImageGenerationBridge')}
              checked={section.codex_image_generation_bridge}
              onChange={(value) => updateSection(sIdx, (s) => ({ ...s, codex_image_generation_bridge: value }))}
            />
          </FormSection>
        )}

        {/* Bedrock CC Compatibility (Anthropic only) */}
        {section.platform === 'anthropic' && (
          <FormSection>
            <ToggleRow
              label={t('admin.channels.form.bedrockCCCompat')}
              description={<span className={styles.warningHint}>{t('admin.channels.form.bedrockCCCompatHint')}</span>}
              ariaLabel={t('admin.channels.form.bedrockCCCompat')}
              checked={section.bedrock_cc_compat}
              onChange={(value) => updateSection(sIdx, (s) => ({ ...s, bedrock_cc_compat: value }))}
            />
          </FormSection>
        )}

        {/* Model Mapping */}
        <FormSection>
          <div className={form.field}>
            <div className={form.headerRow}>
              <span className={form.label}>{t('admin.channels.form.modelMapping')}</span>
              <button type="button" className={form.linkButton} onClick={() => addMappingEntry(sIdx)}>
                + {t('common.add')}
              </button>
            </div>
            {mappingKeys.length === 0 ? (
              <div className={form.dashedEmpty}>{t('admin.channels.form.noMappingRules')}</div>
            ) : (
              <div className={form.stack}>
                {mappingKeys.map((srcModel) => (
                  <div key={srcModel} className={styles.mappingRow}>
                    {/* 源模型在失焦时提交重命名（Vue 版 @change） */}
                    <input
                      type="text"
                      defaultValue={srcModel}
                      {...platformTone(section.platform, 'text', inputClass)}
                      placeholder={t('admin.channels.form.mappingSource')}
                      aria-label={t('admin.channels.form.mappingSource')}
                      onBlur={(event) => renameMappingKey(sIdx, srcModel, event.target.value)}
                    />
                    <span className={styles.arrow} aria-hidden="true">
                      →
                    </span>
                    <input
                      type="text"
                      value={section.model_mapping[srcModel]}
                      {...platformTone(section.platform, 'text', inputClass)}
                      placeholder={t('admin.channels.form.mappingTarget')}
                      aria-label={t('admin.channels.form.mappingTarget')}
                      onChange={(event) => setMappingTarget(sIdx, srcModel, event.target.value)}
                    />
                    <button
                      type="button"
                      className={form.iconButton}
                      aria-label={t('common.delete')}
                      onClick={() => removeMappingEntry(sIdx, srcModel)}
                    >
                      <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </FormSection>

        {/* Model Pricing */}
        <FormSection>
          <div className={form.field}>
            <div className={form.headerRow}>
              <span className={form.label}>{t('admin.channels.form.modelPricing')}</span>
              <div className={styles.headerActions}>
                {supportsPricingModelSync(section.platform) && (
                  <button
                    type="button"
                    className={[form.linkButton, form.muted].join(' ')}
                    disabled={!!syncingPlatform}
                    onClick={() => void syncLatestModels(sIdx)}
                  >
                    {syncingPlatform === section.platform
                      ? t('admin.channels.form.syncingModels')
                      : t('admin.channels.form.syncLatestModels')}
                  </button>
                )}
                <button type="button" className={form.linkButton} onClick={() => addPricingEntry(sIdx)}>
                  + {t('common.add')}
                </button>
              </div>
            </div>
            {section.model_pricing.length === 0 ? (
              <div className={form.dashedEmpty}>{t('admin.channels.form.noPricingRules')}</div>
            ) : (
              <div className={form.stack}>
                {section.model_pricing.map((entry, idx) => (
                  <PricingEntryCard
                    key={idx}
                    entry={entry}
                    platform={section.platform}
                    enableTimePricing
                    enableTierMultipliers
                    onUpdate={(updated) => updatePricingEntry(sIdx, idx, updated)}
                    onRemove={() => removePricingEntry(sIdx, idx)}
                  />
                ))}
              </div>
            )}
          </div>
        </FormSection>

        {/* Account Stats Pricing Rules (per-platform, always visible) */}
        <FormSection
          title={t('admin.channels.form.accountStatsPricingRules')}
          action={
            <Button type="button" variant="secondary" size="sm" onClick={() => addAccountStatsRule(sIdx)}>
              + {t('admin.channels.form.addRule')}
            </Button>
          }
        >
          {section.account_stats_pricing_rules.length === 0 && <p className={form.hint}>{t('admin.channels.form.noRulesConfigured')}</p>}
          {section.account_stats_pricing_rules.map((rule, ruleIndex) => renderRule(section, sIdx, rule, ruleIndex))}
        </FormSection>
      </>
    )
  }

  return (
    <AccountFormDrawer
      show={show}
      title={editingChannel ? t('admin.channels.editChannel') : t('admin.channels.createChannel')}
      width="extra-wide"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="channel-form" variant="primary" disabled={submitting}>
            {submitting ? t('common.submitting') : editingChannel ? t('common.update') : t('common.create')}
          </Button>
        </>
      }
    >
      {/* Tab Bar */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className={styles.tabs}>
        <TabsList aria-label={t('admin.channels.form.platformConfig')}>
          <TabsTrigger value={BASIC_TAB}>{t('admin.channels.form.basicSettings')}</TabsTrigger>
          {/* Platform Tabs (only enabled) */}
          {formState.platforms
            .filter((s) => s.enabled)
            .map((section) => (
              <TabsTrigger key={section.platform} value={section.platform}>
                <span {...platformTone(section.platform, 'text', styles.tabLabel)}>
                  <PlatformIcon platform={section.platform} size="xs" />
                  {platformLabel(section.platform)}
                </span>
              </TabsTrigger>
            ))}
        </TabsList>
      </Tabs>

      {/* Tab Content：与 Vue 版 v-show 一致，所有面板保持挂载，仅隐藏非当前页 */}
      <form id="channel-form" className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
        <div role="tabpanel" className={styles.panel} hidden={activeTab !== BASIC_TAB}>
          {renderBasicTab()}
        </div>
        {formState.platforms.map((section, sIdx) => (
          <div
            key={'tab-' + section.platform}
            role="tabpanel"
            className={styles.panel}
            hidden={!(section.enabled && activeTab === section.platform)}
          >
            {renderPlatformTab(section, sIdx)}
          </div>
        ))}
      </form>
    </AccountFormDrawer>
  )
}
