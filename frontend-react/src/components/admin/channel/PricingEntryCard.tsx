/**
 * 单条模型定价，对应 Vue 版 PricingEntryCard.vue（渠道与分组的模型定价共用）。
 * 折叠时显示前 3 个模型与计费模式；展开后编辑模型、计费模式、默认价格、区间 / 档位、
 * 可选的 Fast/Flex 倍率与时间段定价，以及各思考等级倍率。
 * 所有修改都通过 onUpdate 回传新的条目对象，不修改传入的 entry。
 */
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { BillingMode } from '@/api/admin/channels'
import channelsAPI from '@/api/admin/channels'
import arcInput from '@/components/arc/input/input.module.css'
import Select from '@/components/common/Select'
import { REASONING_EFFORT_LEVELS, type ReasoningEffortLevel } from '@/constants/channel'
import { useI18n } from '@/i18n/useI18n'
import IntervalRow from './IntervalRow'
import ModelTagInput from './ModelTagInput'
import { platformTone } from './platformTone'
import TimePricingSection from './TimePricingSection'
import type { IntervalFormEntry, PricingFormEntry } from './types'
import { isValidPositiveMultiplier, perTokenToMTok, validateReasoningEffortMultipliers } from './types'
import form from './channelForm.module.css'
import styles from './PricingEntryCard.module.css'

export interface PricingEntryCardProps {
  entry: PricingFormEntry
  platform?: string
  /** 默认 false */
  hideTokenIntervals?: boolean
  /** 默认 false */
  enableTimePricing?: boolean
  /** 默认 false */
  enableTierMultipliers?: boolean
  /** Vue 版 update 事件 */
  onUpdate?: (entry: PricingFormEntry) => void
  /** Vue 版 remove 事件 */
  onRemove?: () => void
}

const inputClass = [arcInput.input, form.small].join(' ')

const emptyInterval = (sortOrder: number, tierLabel = ''): IntervalFormEntry => ({
  min_tokens: 0,
  max_tokens: null,
  tier_label: tierLabel,
  input_price: null,
  output_price: null,
  cache_write_price: null,
  cache_write_1h_price: null,
  cache_read_price: null,
  per_request_price: null,
  input_multiplier: null,
  output_multiplier: null,
  cache_write_multiplier: null,
  cache_read_multiplier: null,
  sort_order: sortOrder
})

const displayValue = (value: number | string | null | undefined) => (value == null ? '' : String(value))

export default function PricingEntryCard({
  entry,
  platform,
  hideTokenIntervals = false,
  enableTimePricing = false,
  enableTierMultipliers = false,
  onUpdate,
  onRemove
}: PricingEntryCardProps) {
  const { t } = useI18n()

  // Collapse state: entries with existing models default to collapsed
  const [collapsed, setCollapsed] = useState(() => entry.models.length > 0)

  // 默认价查询完成时以最新的 entry 为基础（对应 Vue 版 await 之后读取 props.entry）
  const latestEntry = useRef(entry)
  useEffect(() => {
    latestEntry.current = entry
  }, [entry])

  const emit = (next: PricingFormEntry) => onUpdate?.(next)

  const billingModeOptions = [
    { value: 'token', label: t('admin.channels.billingMode.token') },
    { value: 'per_request', label: t('admin.channels.billingMode.perRequest') },
    { value: 'image', label: t('admin.channels.billingMode.image') },
    { value: 'video', label: t('admin.channels.billingMode.video') }
  ]
  const billingModeLabel = billingModeOptions.find((o) => o.value === entry.billing_mode)?.label ?? entry.billing_mode

  const reasoningEffortMultiplierError = validateReasoningEffortMultipliers(entry.reasoning_effort_multipliers, t)

  const updateReasoningEffortMultiplier = (effort: ReasoningEffortLevel, value: string) => {
    const multipliers = { ...entry.reasoning_effort_multipliers }
    if (value === '') delete multipliers[effort]
    else multipliers[effort] = value
    emit({
      ...entry,
      reasoning_effort_multipliers: Object.keys(multipliers).length ? multipliers : null
    })
  }

  const emitField = (field: keyof PricingFormEntry, value: string) => {
    emit({ ...entry, [field]: value === '' ? null : value })
  }

  const addInterval = () => {
    const intervals = [...(entry.intervals || [])]
    intervals.push(emptyInterval(intervals.length))
    emit({ ...entry, intervals })
  }

  const addMediaTier = () => {
    const intervals = [...(entry.intervals || [])]
    const labels = entry.billing_mode === 'video' ? ['480p', '720p', '1080p'] : ['1K', '2K', '4K', 'HD']
    intervals.push(emptyInterval(intervals.length, labels[intervals.length] || ''))
    emit({ ...entry, intervals })
  }

  const updateInterval = (idx: number, updated: IntervalFormEntry) => {
    const intervals = [...(entry.intervals || [])]
    intervals[idx] = updated
    emit({ ...entry, intervals })
  }

  const removeInterval = (idx: number) => {
    const intervals = [...(entry.intervals || [])]
    intervals.splice(idx, 1)
    emit({ ...entry, intervals })
  }

  const onModelsUpdate = async (newModels: string[]) => {
    const oldModels = entry.models
    emit({ ...entry, models: newModels })

    // 仅在「空条目首次加入单个模型」时自动填充默认价：
    // 条目已有模型时（即使价格留空、按各模型的官方默认价回退）追加模型不应改写整条价格，
    // 一次加入多个模型也不应把第一个模型的价格套用到整条，否则条目内所有模型都会被静默改价。
    const addedModels = newModels.filter((m) => !oldModels.includes(m))
    if (oldModels.length !== 0 || addedModels.length !== 1) return

    // 检查是否所有价格字段都为空
    const e = entry
    const hasPrice =
      e.input_price != null ||
      e.output_price != null ||
      e.cache_write_price != null ||
      e.cache_write_1h_price != null ||
      e.cache_read_price != null
    if (hasPrice) return

    // 查询第一个新增模型的默认价格
    try {
      const result = await channelsAPI.getModelDefaultPricing(addedModels[0])
      if (result.found) {
        const current = latestEntry.current
        emit({
          ...current,
          models: newModels,
          input_price: perTokenToMTok(result.input_price ?? null),
          output_price: perTokenToMTok(result.output_price ?? null),
          cache_write_price: perTokenToMTok(result.cache_write_price ?? null),
          cache_write_1h_price: perTokenToMTok(result.cache_write_1h_price ?? null),
          cache_read_price: perTokenToMTok(result.cache_read_price ?? null),
          image_input_price: perTokenToMTok(result.image_input_price ?? null),
          image_output_price: perTokenToMTok(result.image_output_price ?? null),
          reasoning_effort_multipliers: current.reasoning_effort_multipliers ?? result.reasoning_effort_multipliers ?? null
        })
      }
    } catch {
      // 查询失败不影响用户操作
    }
  }

  const priceField = (label: string, field: keyof PricingFormEntry, min = '0', placeholderKey = 'admin.channels.form.pricePlaceholder') => (
    <label className={form.field}>
      <span className={form.subLabel}>{label}</span>
      <input
        className={inputClass}
        type="number"
        step="any"
        min={min}
        placeholder={t(placeholderKey)}
        value={displayValue(entry[field] as number | string | null | undefined)}
        onChange={(event) => emitField(field, event.target.value)}
      />
    </label>
  )

  const sectionLabel = (text: ReactNode, unit?: string) => (
    <span className={form.label}>
      {text}
      {unit ? <span className={form.unit}>{unit}</span> : null}
    </span>
  )

  const intervalRows = (withMultipliers: boolean) =>
    entry.intervals && entry.intervals.length > 0 ? (
      <div className={form.stack}>
        {entry.intervals.map((iv, idx) => (
          <IntervalRow
            key={idx}
            interval={iv}
            mode={entry.billing_mode}
            enableMultipliers={withMultipliers}
            onUpdate={(updated) => updateInterval(idx, updated)}
            onRemove={() => removeInterval(idx)}
          />
        ))}
      </div>
    ) : null

  return (
    <div className={styles.card}>
      {/* Collapsed summary header (clickable) */}
      <div className={styles.header}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? (
            <ChevronRight size={14} strokeWidth={2} className={styles.chevron} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} strokeWidth={2} className={styles.chevron} aria-hidden="true" />
          )}

          {collapsed ? (
            <span className={styles.summary}>
              {/* Compact model tags (show first 3) */}
              <span className={styles.summaryTags}>
                {entry.models.slice(0, 3).map((m, i) => (
                  <span key={i} {...platformTone(platform, 'tag', styles.summaryTag)}>
                    {m}
                  </span>
                ))}
                {entry.models.length > 3 && <span className={styles.more}>+{entry.models.length - 3}</span>}
                {entry.models.length === 0 && <span className={styles.noModels}>{t('admin.channels.form.noModels')}</span>}
              </span>
              {/* Billing mode badge */}
              <span className={styles.modeBadge}>{billingModeLabel}</span>
            </span>
          ) : (
            <span className={styles.expandedLabel}>{t('admin.channels.form.pricingEntry')}</span>
          )}
        </button>

        {/* Remove button (always visible) */}
        <button type="button" className={form.iconButton} aria-label={t('common.delete')} onClick={() => onRemove?.()}>
          <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      {/* Expandable content with transition */}
      <div className={styles.collapsible} data-collapsed={collapsed ? '' : undefined} inert={collapsed}>
        <div className={styles.collapsibleInner}>
          {/* Header: Models + Billing Mode */}
          <div className={styles.topRow}>
            <div className={styles.models}>
              <span className={form.label}>
                {t('admin.channels.form.models')} <span className={form.required}>*</span>
              </span>
              <ModelTagInput
                models={entry.models}
                platform={platform}
                placeholder={t('admin.channels.form.modelsPlaceholder')}
                onModelsChange={(models) => void onModelsUpdate(models)}
              />
            </div>
            <div className={styles.billingMode}>
              <span className={form.label}>{t('admin.channels.form.billingMode')}</span>
              <Select
                value={entry.billing_mode}
                options={billingModeOptions}
                aria-label={t('admin.channels.form.billingMode')}
                onChange={(value) =>
                  emit({
                    ...entry,
                    billing_mode: value as BillingMode,
                    intervals: [],
                    time_pricing: { ...entry.time_pricing, periods: [] }
                  })
                }
              />
            </div>
          </div>

          {entry.billing_mode === 'token' ? (
            <div className={styles.modeBody}>
              {/* Default prices (fallback when no interval matches) */}
              {sectionLabel(t('admin.channels.form.defaultPrices'), '$/MTok')}
              <div className={styles.priceGrid}>
                {priceField(t('admin.channels.form.inputPrice'), 'input_price')}
                {priceField(t('admin.channels.form.outputPrice'), 'output_price')}
                {priceField(t('admin.channels.form.cacheWrite5mPrice'), 'cache_write_price')}
                {priceField(t('admin.channels.form.cacheWrite1hPrice'), 'cache_write_1h_price')}
                {priceField(t('admin.channels.form.cacheReadPrice'), 'cache_read_price')}
                {priceField(t('admin.channels.form.imageInputPrice'), 'image_input_price')}
                {priceField(t('admin.channels.form.imageTokenPrice'), 'image_output_price')}
              </div>

              {enableTierMultipliers && (
                <div className={styles.multiplierGrid}>
                  {priceField(t('admin.channels.form.fastMultiplier'), 'fast_multiplier', '0.000001', 'admin.channels.form.multiplierPlaceholder')}
                  {priceField(t('admin.channels.form.flexMultiplier'), 'flex_multiplier', '0.000001', 'admin.channels.form.multiplierPlaceholder')}
                </div>
              )}

              {/* Channel token intervals; the group long-context toggle controls whether tiers apply. */}
              {!hideTokenIntervals && (
                <div className={styles.block}>
                  <div className={form.headerRow}>
                    {sectionLabel(t('admin.channels.form.intervals'), '(min, max]')}
                    <button type="button" className={form.linkButton} onClick={addInterval}>
                      + {t('admin.channels.form.addInterval')}
                    </button>
                  </div>
                  {intervalRows(enableTierMultipliers)}
                </div>
              )}

              {enableTimePricing && (
                <TimePricingSection value={entry.time_pricing} onChange={(value) => emit({ ...entry, time_pricing: value })} />
              )}
            </div>
          ) : entry.billing_mode === 'per_request' ? (
            <div className={styles.modeBody}>
              {/* Default per-request price */}
              {sectionLabel(t('admin.channels.form.defaultPerRequestPrice'), '$')}
              <div className={styles.singlePrice}>
                <input
                  className={inputClass}
                  type="number"
                  step="any"
                  min="0"
                  aria-label={t('admin.channels.form.defaultPerRequestPrice')}
                  placeholder={t('admin.channels.form.pricePlaceholder')}
                  value={displayValue(entry.per_request_price)}
                  onChange={(event) => emitField('per_request_price', event.target.value)}
                />
              </div>

              {/* Tiers */}
              <div className={[form.headerRow, styles.block].join(' ')}>
                {sectionLabel(t('admin.channels.form.requestTiers'))}
                <button type="button" className={form.linkButton} onClick={addInterval}>
                  + {t('admin.channels.form.addTier')}
                </button>
              </div>
              {intervalRows(false) ?? <div className={form.dashedEmpty}>{t('admin.channels.form.noTiersYet')}</div>}
            </div>
          ) : entry.billing_mode === 'image' || entry.billing_mode === 'video' ? (
            <div className={styles.modeBody}>
              {/* Default image price (per-request, same as per_request mode) */}
              {sectionLabel(
                entry.billing_mode === 'video' ? t('admin.channels.form.defaultVideoPrice') : t('admin.channels.form.defaultImagePrice'),
                '$'
              )}
              <div className={styles.singlePrice}>
                <input
                  className={inputClass}
                  type="number"
                  step="any"
                  min="0"
                  aria-label={
                    entry.billing_mode === 'video' ? t('admin.channels.form.defaultVideoPrice') : t('admin.channels.form.defaultImagePrice')
                  }
                  placeholder={t('admin.channels.form.pricePlaceholder')}
                  value={displayValue(entry.per_request_price)}
                  onChange={(event) => emitField('per_request_price', event.target.value)}
                />
              </div>

              {/* Image tiers */}
              <div className={[form.headerRow, styles.block].join(' ')}>
                {sectionLabel(entry.billing_mode === 'video' ? t('admin.channels.form.videoTiers') : t('admin.channels.form.imageTiers'))}
                <button type="button" className={form.linkButton} onClick={addMediaTier}>
                  + {t('admin.channels.form.addTier')}
                </button>
              </div>
              {intervalRows(false)}
            </div>
          ) : null}

          <div className={styles.reasoning} data-testid="reasoning-effort-multipliers">
            <div className={form.headerRow}>
              {sectionLabel(t('admin.channels.form.reasoningEffortMultipliers'))}
              {Object.keys(entry.reasoning_effort_multipliers || {}).length > 0 && (
                <button
                  type="button"
                  className={[form.linkButton, form.muted].join(' ')}
                  onClick={() => emit({ ...entry, reasoning_effort_multipliers: null })}
                >
                  {t('admin.channels.form.clearReasoningEffortMultipliers')}
                </button>
              )}
            </div>
            <p className={form.hint}>{t('admin.channels.form.reasoningEffortMultipliersHint')}</p>
            <div className={styles.reasoningGrid}>
              {REASONING_EFFORT_LEVELS.map((effort) => (
                <label key={effort} className={form.field}>
                  <span className={form.subLabel}>{effort}</span>
                  <input
                    className={inputClass}
                    type="number"
                    step="any"
                    min="0"
                    value={displayValue(entry.reasoning_effort_multipliers?.[effort])}
                    aria-label={t('admin.channels.form.reasoningEffortMultiplierLabel', { effort })}
                    aria-invalid={!isValidPositiveMultiplier(entry.reasoning_effort_multipliers?.[effort])}
                    data-reasoning-effort={effort}
                    placeholder={t('admin.channels.form.reasoningEffortMultiplierDefault')}
                    onChange={(event) => updateReasoningEffortMultiplier(effort, event.target.value)}
                  />
                </label>
              ))}
            </div>
            {reasoningEffortMultiplierError && (
              <p role="alert" className={form.error}>
                {reasoningEffortMultiplierError}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
