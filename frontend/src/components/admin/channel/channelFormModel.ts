/**
 * 渠道表单的数据模型与纯函数（对应 Vue 版 ChannelsView.vue 脚本中的表单 ↔ API 转换与提交前校验）。
 * 平台列表来自平台清单（后端 domain/platforms.go），组合分组覆盖全部具体平台。
 */
import type {
  AccountStatsPricingRule,
  Channel,
  ChannelModelPricing
} from '@/api/admin/channels'
import type { AdminGroup, GroupPlatform } from '@/types'
import { platformLabel as catalogPlatformLabel } from '@/utils/platformColors'
import type { PricingFormEntry } from './types'
import {
  apiIntervalsToForm,
  apiTimePricingToForm,
  createDefaultTimePricingForm,
  findModelConflict,
  formIntervalsToAPI,
  formReasoningEffortMultipliersToAPI,
  formTimePricingToAPI,
  isValidPositiveMultiplier,
  mTokToPerToken,
  perTokenToMTok,
  validateIntervals,
  validateReasoningEffortMultipliers,
  validateTimePricing
} from './types'

type TranslateFn = (key: string, params?: Record<string, unknown>) => string
type HasKeyFn = (key: string) => boolean

// ── Form-level pricing rule type (per-platform) ──
export interface FormPricingRule {
  name: string
  group_ids: number[]
  account_ids: number[]
  pricing: PricingFormEntry[]
}

// ── Platform Section type ──
export interface PlatformSection {
  platform: GroupPlatform
  enabled: boolean
  collapsed: boolean
  group_ids: number[]
  model_mapping: Record<string, string>
  model_pricing: PricingFormEntry[]
  web_search_emulation: boolean
  codex_image_generation_bridge: boolean
  bedrock_cc_compat: boolean
  account_stats_pricing_rules: FormPricingRule[]
}

export interface ChannelFormState {
  name: string
  description: string
  status: string
  restrict_models: boolean
  billing_model_source: string
  platforms: PlatformSection[]
  apply_pricing_to_account_stats: boolean
}

export function emptyChannelForm(): ChannelFormState {
  return {
    name: '',
    description: '',
    status: 'active',
    restrict_models: false,
    billing_model_source: 'channel_mapped',
    platforms: [],
    apply_pricing_to_account_stats: false
  }
}

export function newPlatformSection(platform: GroupPlatform): PlatformSection {
  return {
    platform,
    enabled: true,
    collapsed: false,
    group_ids: [],
    model_mapping: {},
    model_pricing: [],
    web_search_emulation: false,
    codex_image_generation_bridge: false,
    bedrock_cc_compat: false,
    account_stats_pricing_rules: []
  }
}

/** 渠道定价新条目（含 Fast/Flex 与思考等级倍率字段） */
export function newChannelPricingEntry(models: string[] = []): PricingFormEntry {
  return {
    models,
    billing_mode: 'token',
    input_price: null,
    output_price: null,
    cache_write_price: null,
    cache_write_1h_price: null,
    cache_read_price: null,
    fast_multiplier: null,
    flex_multiplier: null,
    reasoning_effort_multipliers: null,
    image_input_price: null,
    image_output_price: null,
    per_request_price: null,
    intervals: [],
    time_pricing: createDefaultTimePricingForm()
  }
}

/** 账号统计规则的新定价条目（与 Vue 版一致，不带 Fast/Flex 字段） */
export function newRulePricingEntry(): PricingFormEntry {
  return {
    models: [],
    billing_mode: 'token',
    input_price: null,
    output_price: null,
    cache_write_price: null,
    cache_write_1h_price: null,
    cache_read_price: null,
    image_input_price: null,
    image_output_price: null,
    per_request_price: null,
    intervals: [],
    time_pricing: createDefaultTimePricingForm()
  }
}

/** 平台显示名：优先 admin.groups.platforms.*，缺失时回退到平台清单的展示名（Vue 版 t(key, 默认值)） */
export function platformDisplayLabel(t: TranslateFn, te: HasKeyFn, platform: string): string {
  const key = 'admin.groups.platforms.' + platform
  return te(key) ? t(key) : catalogPlatformLabel(platform)
}

export function groupsForPlatform(groups: AdminGroup[], platform: GroupPlatform, compositePlatforms: string[]): AdminGroup[] {
  return groups.filter(
    (g) => g.platform === platform || (g.platform === 'composite' && compositePlatforms.includes(platform))
  )
}

export function accountStatsRulesToAPI(platforms: PlatformSection[]): AccountStatsPricingRule[] {
  const rules: AccountStatsPricingRule[] = []
  for (const section of platforms) {
    if (!section.enabled) continue
    for (const rule of section.account_stats_pricing_rules) {
      rules.push({
        name: rule.name,
        group_ids: rule.group_ids,
        account_ids: rule.account_ids,
        pricing: rule.pricing
          .filter((p) => p.models.length > 0)
          .map((p) => ({
            platform: section.platform,
            models: p.models,
            billing_mode: p.billing_mode,
            input_price: mTokToPerToken(p.input_price),
            output_price: mTokToPerToken(p.output_price),
            cache_write_price: mTokToPerToken(p.cache_write_price),
            cache_write_1h_price: mTokToPerToken(p.cache_write_1h_price),
            cache_read_price: mTokToPerToken(p.cache_read_price),
            reasoning_effort_multipliers: formReasoningEffortMultipliersToAPI(p.reasoning_effort_multipliers),
            image_input_price: mTokToPerToken(p.image_input_price),
            image_output_price: mTokToPerToken(p.image_output_price),
            per_request_price: p.per_request_price != null && p.per_request_price !== '' ? Number(p.per_request_price) : null,
            intervals: formIntervalsToAPI(p.intervals || []),
            time_pricing: null
          }))
      })
    }
  }
  return rules
}

// ── Form ↔ API conversion ──
export function formToAPI(
  platforms: PlatformSection[],
  editingChannel: Channel | null
): {
  group_ids: number[]
  model_pricing: ChannelModelPricing[]
  model_mapping: Record<string, Record<string, string>>
  features_config: Record<string, unknown>
} {
  const group_ids: number[] = []
  const model_pricing: ChannelModelPricing[] = []
  const model_mapping: Record<string, Record<string, string>> = {}
  // Preserve existing features_config fields not managed by the form
  const featuresConfig: Record<string, unknown> = editingChannel?.features_config ? { ...editingChannel.features_config } : {}

  for (const section of platforms) {
    if (!section.enabled) continue
    group_ids.push(...section.group_ids)

    // Model mapping per platform
    if (Object.keys(section.model_mapping).length > 0) {
      model_mapping[section.platform] = { ...section.model_mapping }
    }

    // Model pricing with platform tag
    for (const entry of section.model_pricing) {
      if (entry.models.length === 0) continue
      model_pricing.push({
        platform: section.platform,
        models: entry.models,
        billing_mode: entry.billing_mode,
        input_price: mTokToPerToken(entry.input_price),
        output_price: mTokToPerToken(entry.output_price),
        cache_write_price: mTokToPerToken(entry.cache_write_price),
        cache_write_1h_price: mTokToPerToken(entry.cache_write_1h_price),
        cache_read_price: mTokToPerToken(entry.cache_read_price),
        fast_multiplier: entry.fast_multiplier != null && entry.fast_multiplier !== '' ? Number(entry.fast_multiplier) : null,
        flex_multiplier: entry.flex_multiplier != null && entry.flex_multiplier !== '' ? Number(entry.flex_multiplier) : null,
        reasoning_effort_multipliers: formReasoningEffortMultipliersToAPI(entry.reasoning_effort_multipliers),
        image_input_price: mTokToPerToken(entry.image_input_price),
        image_output_price: mTokToPerToken(entry.image_output_price),
        per_request_price: entry.per_request_price != null && entry.per_request_price !== '' ? Number(entry.per_request_price) : null,
        intervals: formIntervalsToAPI(entry.intervals || []),
        time_pricing: formTimePricingToAPI(entry.time_pricing)
      })
    }
  }
  const uniqueGroupIds = Array.from(new Set(group_ids))

  // Collect web_search_emulation (only anthropic platform supports it)
  // Always write the key so that disabling in the UI correctly sets platform to false,
  // rather than leaving a stale true value from the cloned features_config.
  const wsEmulation: Record<string, boolean> = {}
  for (const section of platforms) {
    if (!section.enabled) continue
    if (section.platform === 'anthropic') {
      wsEmulation[section.platform] = !!section.web_search_emulation
    }
  }
  if (Object.keys(wsEmulation).length > 0) {
    featuresConfig.web_search_emulation = wsEmulation
  } else {
    delete featuresConfig.web_search_emulation
  }

  const codexImageGenerationBridge: Record<string, boolean> = {}
  for (const section of platforms) {
    if (!section.enabled) continue
    if (section.platform === 'openai') {
      codexImageGenerationBridge[section.platform] = !!section.codex_image_generation_bridge
    }
  }
  if (Object.keys(codexImageGenerationBridge).length > 0) {
    featuresConfig.codex_image_generation_bridge = codexImageGenerationBridge
  } else {
    delete featuresConfig.codex_image_generation_bridge
  }

  const bedrockCCCompat: Record<string, boolean> = {}
  for (const section of platforms) {
    if (!section.enabled) continue
    if (section.platform === 'anthropic') {
      bedrockCCCompat[section.platform] = !!section.bedrock_cc_compat
    }
  }
  if (Object.keys(bedrockCCCompat).length > 0) {
    featuresConfig.bedrock_cc_compat = bedrockCCCompat
  } else {
    delete featuresConfig.bedrock_cc_compat
  }

  return { group_ids: uniqueGroupIds, model_pricing, model_mapping, features_config: featuresConfig }
}

export function apiToForm(
  channel: Channel,
  allGroups: AdminGroup[],
  platformOrder: GroupPlatform[],
  compositePlatforms: string[]
): PlatformSection[] {
  // Build a map: groupID → platform
  const groupPlatformMap = new Map<number, GroupPlatform>()
  for (const g of allGroups) {
    groupPlatformMap.set(g.id, g.platform)
  }

  // Determine which platforms are active (from groups + pricing + mapping)
  const activePlatforms = new Set<GroupPlatform>()
  for (const gid of channel.group_ids || []) {
    const p = groupPlatformMap.get(gid)
    if (p === 'composite') {
      compositePlatforms.forEach((platform) => activePlatforms.add(platform as GroupPlatform))
    } else if (p) {
      activePlatforms.add(p)
    }
  }
  for (const p of channel.model_pricing || []) {
    if (p.platform) activePlatforms.add(p.platform as GroupPlatform)
  }
  for (const p of Object.keys(channel.model_mapping || {})) {
    if (platformOrder.includes(p as GroupPlatform)) activePlatforms.add(p as GroupPlatform)
  }

  // Build sections in platform order
  const sections: PlatformSection[] = []
  for (const platform of platformOrder) {
    if (!activePlatforms.has(platform)) continue

    const groupIds = (channel.group_ids || []).filter((gid) => {
      const groupPlatform = groupPlatformMap.get(gid)
      return groupPlatform === platform || (groupPlatform === 'composite' && compositePlatforms.includes(platform))
    })
    const mapping = (channel.model_mapping || {})[platform] || {}
    const pricing = (channel.model_pricing || [])
      .filter((p) => (p.platform || 'anthropic') === platform)
      .map(
        (p) =>
          ({
            models: p.models || [],
            billing_mode: p.billing_mode,
            input_price: perTokenToMTok(p.input_price),
            output_price: perTokenToMTok(p.output_price),
            cache_write_price: perTokenToMTok(p.cache_write_price),
            cache_write_1h_price: perTokenToMTok(p.cache_write_1h_price),
            cache_read_price: perTokenToMTok(p.cache_read_price),
            fast_multiplier: p.fast_multiplier,
            flex_multiplier: p.flex_multiplier,
            reasoning_effort_multipliers: p.reasoning_effort_multipliers ? { ...p.reasoning_effort_multipliers } : null,
            image_input_price: perTokenToMTok(p.image_input_price),
            image_output_price: perTokenToMTok(p.image_output_price),
            per_request_price: p.per_request_price,
            intervals: apiIntervalsToForm(p.intervals || []),
            time_pricing: apiTimePricingToForm(p.time_pricing)
          }) as PricingFormEntry
      )

    // Read web_search_emulation from features_config
    const fc = channel.features_config
    const wsEmulation = fc?.web_search_emulation as Record<string, boolean> | undefined
    const webSearchEnabled = wsEmulation?.[platform] === true
    const codexImageGenerationBridge = fc?.codex_image_generation_bridge as Record<string, boolean> | undefined
    const codexImageGenerationBridgeEnabled = codexImageGenerationBridge?.[platform] === true
    const bedrockCCCompatEnabled = fc?.bedrock_cc_compat === true

    sections.push({
      platform,
      enabled: true,
      collapsed: false,
      group_ids: groupIds,
      model_mapping: { ...mapping },
      model_pricing: pricing,
      web_search_emulation: webSearchEnabled,
      codex_image_generation_bridge: codexImageGenerationBridgeEnabled,
      bedrock_cc_compat: bedrockCCCompatEnabled,
      account_stats_pricing_rules: []
    })
  }

  return sections
}

/** Distribute flat channel-level rules into the matching platform section based on group_ids */
export function distributeRulesToPlatforms(
  sections: PlatformSection[],
  apiRules: AccountStatsPricingRule[],
  allGroups: AdminGroup[]
): PlatformSection[] {
  // Build groupID → platform lookup
  const groupPlatformMap = new Map<number, GroupPlatform>()
  for (const g of allGroups) {
    groupPlatformMap.set(g.id, g.platform)
  }

  const result = sections.map((section) => ({ ...section, account_stats_pricing_rules: [...section.account_stats_pricing_rules] }))
  for (const apiRule of apiRules) {
    // Infer platform from group_ids
    const platforms = new Set<GroupPlatform>()
    for (const gid of apiRule.group_ids || []) {
      const p = groupPlatformMap.get(gid)
      if (p && p !== 'composite') platforms.add(p)
    }
    // If pricing has a platform field, use that as fallback
    if (platforms.size === 0 && apiRule.pricing?.length > 0) {
      const p = apiRule.pricing[0].platform as GroupPlatform | undefined
      if (p) platforms.add(p)
    }
    const targetPlatform = platforms.size >= 1 ? [...platforms][0] : null
    if (!targetPlatform) continue

    const section = result.find((s) => s.platform === targetPlatform)
    if (!section) continue

    const formRule: FormPricingRule = {
      name: apiRule.name || '',
      group_ids: [...(apiRule.group_ids || [])],
      account_ids: [...(apiRule.account_ids || [])],
      pricing: (apiRule.pricing || []).map(
        (p) =>
          ({
            models: [...(p.models || [])],
            billing_mode: p.billing_mode,
            input_price: perTokenToMTok(p.input_price),
            output_price: perTokenToMTok(p.output_price),
            cache_write_price: perTokenToMTok(p.cache_write_price),
            cache_write_1h_price: perTokenToMTok(p.cache_write_1h_price),
            cache_read_price: perTokenToMTok(p.cache_read_price),
            reasoning_effort_multipliers: p.reasoning_effort_multipliers ? { ...p.reasoning_effort_multipliers } : null,
            image_input_price: perTokenToMTok(p.image_input_price),
            image_output_price: perTokenToMTok(p.image_output_price),
            per_request_price: p.per_request_price,
            intervals: apiIntervalsToForm(p.intervals || []),
            time_pricing: createDefaultTimePricingForm()
          }) as PricingFormEntry
      )
    }
    section.account_stats_pricing_rules.push(formRule)
  }
  return result
}

export interface ChannelFormError {
  message: string
  /** 出错时切换到的平台标签页（Vue 版 activeTab = section.platform） */
  platform?: GroupPlatform
}

/** 提交前校验，顺序与 Vue 版 handleSubmit 一致；返回 null 表示通过 */
export function validateChannelForm(form: ChannelFormState, t: TranslateFn, te: HasKeyFn): ChannelFormError | null {
  if (!form.name.trim()) {
    return { message: t('admin.channels.nameRequired') }
  }
  const enabled = form.platforms.filter((s) => s.enabled)

  // Check for pricing entries with empty models (would be silently skipped)
  for (const section of enabled) {
    if (section.group_ids.length === 0) {
      const platformLabel = platformDisplayLabel(t, te, section.platform)
      return { message: t('admin.channels.noGroupsSelected', { platform: platformLabel }), platform: section.platform }
    }
    for (const entry of section.model_pricing) {
      if (entry.models.length === 0) {
        const platformLabel = platformDisplayLabel(t, te, section.platform)
        return { message: t('admin.channels.emptyModelsInPricing', { platform: platformLabel }), platform: section.platform }
      }
    }
  }

  // Check model pattern conflicts per platform (duplicate / wildcard overlap)
  for (const section of enabled) {
    // Collect all pricing models for this platform
    const allModels: string[] = []
    for (const entry of section.model_pricing) {
      allModels.push(...entry.models)
    }
    const pricingConflict = findModelConflict(allModels)
    if (pricingConflict) {
      return {
        message: t('admin.channels.modelConflict', { model1: pricingConflict[0], model2: pricingConflict[1] }),
        platform: section.platform
      }
    }
    // Check model mapping source pattern conflicts
    const mappingKeys = Object.keys(section.model_mapping)
    if (mappingKeys.length > 0) {
      const mappingConflict = findModelConflict(mappingKeys)
      if (mappingConflict) {
        return {
          message: t('admin.channels.mappingConflict', { model1: mappingConflict[0], model2: mappingConflict[1] }),
          platform: section.platform
        }
      }
    }
  }

  // 校验 per_request/image 模式必须有价格 (只校验启用的平台)
  for (const section of enabled) {
    for (const entry of section.model_pricing) {
      if (entry.models.length === 0) continue
      if (
        (entry.billing_mode === 'per_request' || entry.billing_mode === 'image') &&
        (entry.per_request_price == null || entry.per_request_price === '') &&
        (!entry.intervals || entry.intervals.length === 0)
      ) {
        return { message: t('admin.channels.form.perRequestPriceRequired') }
      }
    }
  }

  const entryLabel = (section: PlatformSection, entry: PricingFormEntry) => {
    const platformLabel = platformDisplayLabel(t, te, section.platform)
    const modelLabel = entry.models.join(', ') || t('admin.channels.form.unnamed')
    return `${platformLabel} - ${modelLabel}`
  }

  // 思考等级倍率同时适用于渠道计价和独立的账号统计计价规则。
  for (const section of enabled) {
    const entries = [...section.model_pricing, ...section.account_stats_pricing_rules.flatMap((rule) => rule.pricing)]
    for (const entry of entries) {
      const error = validateReasoningEffortMultipliers(entry.reasoning_effort_multipliers, t)
      if (!error) continue
      return { message: `${entryLabel(section, entry)}: ${error}`, platform: section.platform }
    }
  }

  // 校验区间合法性（范围、重叠等）
  for (const section of enabled) {
    for (const entry of section.model_pricing) {
      if (!isValidPositiveMultiplier(entry.fast_multiplier) || !isValidPositiveMultiplier(entry.flex_multiplier)) {
        return { message: `${entryLabel(section, entry)}: ${t('admin.channels.form.multiplierPositive')}`, platform: section.platform }
      }
      if (!entry.intervals || entry.intervals.length === 0) continue
      const intervalErr = validateIntervals(entry.intervals, entry.billing_mode, t)
      if (intervalErr) {
        return { message: `${entryLabel(section, entry)}: ${intervalErr}`, platform: section.platform }
      }
    }
  }

  // 校验时间段定价，并切换到对应平台便于修正
  for (const section of enabled) {
    for (const entry of section.model_pricing) {
      const timePricingError = validateTimePricing(entry.time_pricing, t)
      if (timePricingError) {
        return { message: `${entryLabel(section, entry)}: ${timePricingError}`, platform: section.platform }
      }
    }
  }

  return null
}
