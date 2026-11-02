/**
 * 分组表单：高峰时段倍率、利润控制、网页搜索按次计费、模型定价与显式定价（搜索 / 语音）。
 */
import { Plus } from 'lucide-react'

import { FormSection } from '@/components/account/AccountFormLayout'
import { Button } from '@/components/arc/button/button'
import PricingEntryCard from '@/components/admin/channel/PricingEntryCard'
import { useI18n } from '@/i18n/useI18n'
import { isProfitControlPlatform } from '@/views/admin/groupsProfitControl'
import { buildWebSearchFinalPricePreview, emptyGroupPricing } from './groupForm'
import { CheckField, NumberField, TextField } from './GroupFormControls'
import styles from './GroupForm.module.css'
import type { GroupFormController } from './useGroupForm'

// 高峰时段倍率配置（仅订阅类型分组）
export function GroupPeakRateSection({ ctl }: { ctl: GroupFormController }) {
  const { t } = useI18n()
  const { form, update } = ctl
  if (form.subscription_type !== 'subscription') return null
  return (
    <FormSection>
      <CheckField
        label={t('admin.groups.peakRate.enable')}
        checked={form.peak_rate_enabled}
        onChange={(peak_rate_enabled) => update({ peak_rate_enabled })}
      />
      {form.peak_rate_enabled ? (
        <div className={styles.grid3}>
          <TextField
            type="time"
            label={t('admin.groups.peakRate.peakStart')}
            value={form.peak_start}
            onChange={(peak_start) => update({ peak_start })}
          />
          <TextField
            type="time"
            label={t('admin.groups.peakRate.peakEnd')}
            value={form.peak_end}
            onChange={(peak_end) => update({ peak_end })}
          />
          <NumberField
            label={t('admin.groups.peakRate.peakMultiplier')}
            value={form.peak_rate_multiplier}
            onChange={(peak_rate_multiplier) => update({ peak_rate_multiplier })}
            step="0.001"
            min="0"
            placeholder="1"
            title={t('admin.groups.peakRate.multiplierHint')}
          />
        </div>
      ) : null}
    </FormSection>
  )
}

// 分组利润控制（五个平台 token 请求）
export function GroupProfitControlSection({ ctl }: { ctl: GroupFormController }) {
  const { t } = useI18n()
  const { form, update } = ctl
  if (!isProfitControlPlatform(form.platform)) return null
  return (
    <FormSection>
      <CheckField
        label={t('admin.groups.profitControl.enable')}
        description={
          form.profit_control_enabled
            ? t('admin.groups.profitControl.enabledHint')
            : t('admin.groups.profitControl.disabledHint')
        }
        checked={form.profit_control_enabled}
        onChange={(profit_control_enabled) => update({ profit_control_enabled })}
      />
      {form.profit_control_enabled ? (
        <div className={styles.grid2}>
          <NumberField
            label={t('admin.groups.profitControl.minMargin')}
            value={form.profit_min_margin_percent}
            onChange={(profit_min_margin_percent) => update({ profit_min_margin_percent })}
            step="0.1"
            min="0"
            max="99.99"
            placeholder="0"
            title={t('admin.groups.profitControl.minMarginHint')}
          />
          <NumberField
            label={t('admin.groups.profitControl.safetyBuffer')}
            value={form.profit_safety_buffer_percent}
            onChange={(profit_safety_buffer_percent) => update({ profit_safety_buffer_percent })}
            step="0.1"
            min="0"
            max="99.99"
            placeholder="0"
            title={t('admin.groups.profitControl.safetyBufferHint')}
          />
        </div>
      ) : null}
    </FormSection>
  )
}

// Codex 网页搜索按次计费
export function GroupWebSearchPricingSection({ ctl }: { ctl: GroupFormController }) {
  const { t } = useI18n()
  const { form, update } = ctl
  return (
    <FormSection title={t('admin.groups.webSearchPricing.title')}>
      <NumberField
        label={t('admin.groups.webSearchPricing.pricePerCall')}
        value={form.web_search_price_per_call}
        onChange={(web_search_price_per_call) => update({ web_search_price_per_call })}
        step="0.001"
        min="0"
        placeholder="0.01"
        hint={t('admin.groups.webSearchPricing.pricePerCallHint')}
      />
      <div className={styles.preview}>
        {t('admin.groups.webSearchPricing.finalPricePreview', { price: buildWebSearchFinalPricePreview(form, t) })}
      </div>
    </FormSection>
  )
}

export function GroupModelPricingSection({ ctl }: { ctl: GroupFormController }) {
  const { t } = useI18n()
  const { form, update } = ctl
  return (
    <FormSection
      title={t('admin.groups.modelPricing.title')}
      description={t('admin.groups.modelPricing.description')}
      action={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => update({ model_pricing: [...form.model_pricing, emptyGroupPricing()] })}
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          {t('admin.groups.modelPricing.add')}
        </Button>
      }
    >
      <CheckField
        label={t('admin.groups.modelPricing.longContext')}
        description={t('admin.groups.modelPricing.longContextHint')}
        checked={form.long_context_pricing_enabled}
        onChange={(long_context_pricing_enabled) => update({ long_context_pricing_enabled })}
      />
      {form.model_pricing.length > 0 ? (
        <div className={styles.rows}>
          {form.model_pricing.map((entry, index) => (
            <PricingEntryCard
              key={index}
              entry={entry}
              platform={form.platform}
              hideTokenIntervals
              onUpdate={(next) =>
                update({ model_pricing: ctl.getLatest().form.model_pricing.map((e, i) => (i === index ? next : e)) })
              }
              onRemove={() =>
                update({ model_pricing: ctl.getLatest().form.model_pricing.filter((_, i) => i !== index) })
              }
            />
          ))}
        </div>
      ) : null}
    </FormSection>
  )
}

// 显式定价：搜索与 Grok Voice
export function GroupExplicitPricingSection({ ctl }: { ctl: GroupFormController }) {
  const { t } = useI18n()
  const { form, update, mode } = ctl
  return (
    <FormSection
      title={t('admin.groups.explicitPricing.title')}
      description={t('admin.groups.explicitPricing.description')}
    >
      <div className={styles.grid3}>
        <NumberField
          label={t('admin.groups.explicitPricing.searchPricePer1k')}
          value={form.search_price_per_1k}
          onChange={(search_price_per_1k) => update({ search_price_per_1k })}
          step="0.000001"
          min="0"
          placeholder={t('admin.groups.explicitPricing.pricePlaceholder')}
          data-testid={`${mode}-search-price`}
        />
        <NumberField
          label={t('admin.groups.voicePricing.audioRealtimePerMin')}
          value={form.audio_realtime_price_per_min}
          onChange={(audio_realtime_price_per_min) => update({ audio_realtime_price_per_min })}
          step="0.000001"
          min="0"
          placeholder={t('admin.groups.voicePricing.pricePlaceholder')}
          data-testid={`${mode}-audio-realtime-price`}
        />
        <NumberField
          label={t('admin.groups.voicePricing.audioTtsPerMillionChars')}
          value={form.audio_tts_price_per_million_chars}
          onChange={(audio_tts_price_per_million_chars) => update({ audio_tts_price_per_million_chars })}
          step="0.000001"
          min="0"
          placeholder={t('admin.groups.voicePricing.pricePlaceholder')}
          data-testid={`${mode}-audio-tts-price`}
        />
        <NumberField
          label={t('admin.groups.voicePricing.audioSttPerHour')}
          value={form.audio_stt_price_per_hour}
          onChange={(audio_stt_price_per_hour) => update({ audio_stt_price_per_hour })}
          step="0.000001"
          min="0"
          placeholder={t('admin.groups.voicePricing.pricePlaceholder')}
          data-testid={`${mode}-audio-stt-price`}
        />
      </div>
    </FormSection>
  )
}
