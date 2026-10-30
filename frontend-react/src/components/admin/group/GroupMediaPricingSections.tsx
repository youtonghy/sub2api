/**
 * 分组表单：图片生成计费与视频生成计费（含按模型的视频单价覆盖）。
 */
import { FormSection } from '@/components/account/AccountFormLayout'
import arcInput from '@/components/arc/input/input.module.css'
import { useI18n } from '@/i18n/useI18n'
import {
  getImagePricePlaceholder,
  getVideoPricePlaceholder,
  imagePricingI18nKey,
  supportsImagePricingPlatform,
  supportsVideoPricingPlatform,
  videoPricingI18nKey
} from '@/views/admin/groupsImagePricing'
import { grokVideoPriceResolutions, videoModelPriceFamilyRows } from '@/views/admin/groupsVideoModelPricing'
import {
  buildImageFinalPricePreview,
  buildVideoFinalPricePreview,
  formNumberValue,
  toModelNumber,
  type PricePreviewItem
} from './groupForm'
import { CheckField, NumberField } from './GroupFormControls'
import styles from './GroupForm.module.css'
import type { GroupFormController } from './useGroupForm'

function PricePreview({ title, items }: { title: string; items: PricePreviewItem[] }) {
  return (
    <div className={styles.preview}>
      <div className={styles.previewTitle}>{title}</div>
      <div className={styles.previewGrid}>
        {items.map((item) => (
          <div key={item.label}>
            {item.label}: {item.value}
          </div>
        ))}
      </div>
    </div>
  )
}

// 图片生成计费配置
export function GroupImagePricingSection({ ctl }: { ctl: GroupFormController }) {
  const { t } = useI18n()
  const { form, update } = ctl
  if (!supportsImagePricingPlatform(form.platform)) return null
  const key = (name: string) => imagePricingI18nKey(form.platform, name)

  return (
    <FormSection title={t(key('title'))} description={t(key('description'))}>
      <div className={styles.checks}>
        <CheckField
          label={t(key('allowImageGeneration'))}
          checked={form.allow_image_generation}
          onChange={(allow_image_generation) => update({ allow_image_generation })}
        />
        <CheckField
          label={t(key('independentMultiplier'))}
          checked={form.image_rate_independent}
          onChange={(image_rate_independent) => update({ image_rate_independent })}
        />
        {form.allow_image_generation ? (
          <CheckField
            label={t('admin.groups.imagePricing.perImageBilling')}
            checked={form.image_count_billing}
            onChange={(image_count_billing) => update({ image_count_billing })}
          />
        ) : null}
      </div>
      {form.image_rate_independent ? (
        <NumberField
          label={t(key('imageMultiplier'))}
          value={form.image_rate_multiplier}
          onChange={(image_rate_multiplier) => update({ image_rate_multiplier })}
          step="0.0001"
          min="0"
          placeholder="1"
        />
      ) : null}
      <div className={styles.grid3}>
        <NumberField
          label="1K ($)"
          value={form.image_price_1k}
          onChange={(image_price_1k) => update({ image_price_1k })}
          step="0.001"
          min="0"
          placeholder={getImagePricePlaceholder(form.platform, 'image_price_1k')}
        />
        <NumberField
          label="2K ($)"
          value={form.image_price_2k}
          onChange={(image_price_2k) => update({ image_price_2k })}
          step="0.001"
          min="0"
          placeholder={getImagePricePlaceholder(form.platform, 'image_price_2k')}
        />
        <NumberField
          label="4K ($)"
          value={form.image_price_4k}
          onChange={(image_price_4k) => update({ image_price_4k })}
          step="0.001"
          min="0"
          placeholder={getImagePricePlaceholder(form.platform, 'image_price_4k')}
        />
      </div>
      <p className={styles.hint}>{t(key('modeHint'))}</p>
      <PricePreview title={t(key('finalPricePreview'))} items={buildImageFinalPricePreview(form, t)} />
      {form.allow_image_generation ? (
        <div className={styles.subBlock}>
          <CheckField
            label={t('admin.groups.imagePricing.allowBatchImageGeneration')}
            checked={form.allow_batch_image_generation}
            onChange={(allow_batch_image_generation) => update({ allow_batch_image_generation })}
          />
          <p className={styles.hint}>{t('admin.groups.imagePricing.batchSectionHint')}</p>
          {form.allow_batch_image_generation ? (
            <div className={styles.grid2}>
              <NumberField
                label={t('admin.groups.imagePricing.batchDiscountMultiplier')}
                value={form.batch_image_discount_multiplier}
                onChange={(batch_image_discount_multiplier) => update({ batch_image_discount_multiplier })}
                step="0.0001"
                min="0"
                placeholder="0.5"
              />
              <NumberField
                label={t('admin.groups.imagePricing.batchHoldMultiplier')}
                value={form.batch_image_hold_multiplier}
                onChange={(batch_image_hold_multiplier) => update({ batch_image_hold_multiplier })}
                step="0.0001"
                min="0"
                placeholder="0.6"
              />
            </div>
          ) : null}
        </div>
      ) : (
        <p className={`${styles.subBlock} ${styles.hint}`}>{t('admin.groups.imagePricing.batchGeminiOnlyHint')}</p>
      )}
    </FormSection>
  )
}

// 视频生成计费配置（仅 Grok 平台）
export function GroupVideoPricingSection({ ctl }: { ctl: GroupFormController }) {
  const { t } = useI18n()
  const { form, update, mode } = ctl
  if (!supportsVideoPricingPlatform(form.platform)) return null

  const setModelPrice = (family: string, resolution: string, raw: string) => {
    update({
      video_model_prices: {
        ...form.video_model_prices,
        [family]: { ...form.video_model_prices[family], [resolution]: toModelNumber(raw) }
      }
    })
  }

  return (
    <FormSection title={t(videoPricingI18nKey('title'))} description={t(videoPricingI18nKey('description'))}>
      <CheckField
        label={t(videoPricingI18nKey('independentMultiplier'))}
        checked={form.video_rate_independent}
        onChange={(video_rate_independent) => update({ video_rate_independent })}
      />
      {form.video_rate_independent ? (
        <NumberField
          label={t(videoPricingI18nKey('videoMultiplier'))}
          value={form.video_rate_multiplier}
          onChange={(video_rate_multiplier) => update({ video_rate_multiplier })}
          step="0.0001"
          min="0"
          placeholder="1"
        />
      ) : null}
      <div className={styles.grid3}>
        <NumberField
          label="480p ($/s)"
          value={form.video_price_480p}
          onChange={(video_price_480p) => update({ video_price_480p })}
          step="0.001"
          min="0"
          placeholder={getVideoPricePlaceholder(form.platform, 'video_price_480p')}
        />
        <NumberField
          label="720p ($/s)"
          value={form.video_price_720p}
          onChange={(video_price_720p) => update({ video_price_720p })}
          step="0.001"
          min="0"
          placeholder={getVideoPricePlaceholder(form.platform, 'video_price_720p')}
        />
        <NumberField
          label="1080p ($/s)"
          value={form.video_price_1080p}
          onChange={(video_price_1080p) => update({ video_price_1080p })}
          step="0.001"
          min="0"
          placeholder={getVideoPricePlaceholder(form.platform, 'video_price_1080p')}
        />
      </div>
      <div className={styles.subBlock} data-testid={`${mode}-grok-video-model-prices`}>
        <div className={styles.toggleText}>
          <span className={styles.label}>{t('admin.groups.videoPricing.modelOverridesTitle')}</span>
          <p className={styles.hint}>{t('admin.groups.videoPricing.modelOverridesDescription')}</p>
        </div>
        {videoModelPriceFamilyRows(form.video_model_prices).map((family) => (
          <div key={family.key} className={styles.familyRow}>
            <div className={`${styles.familyName} ${styles.mono}`}>{family.label}</div>
            {grokVideoPriceResolutions.map((resolution) => (
              <label key={resolution.key} className={styles.field}>
                <span className={styles.subLabel}>{resolution.label} ($/s)</span>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  className={arcInput.input}
                  value={formNumberValue(form.video_model_prices[family.key]?.[resolution.key])}
                  data-testid={`${mode}-grok-video-price-${family.key}-${resolution.key}`}
                  onChange={(event) => setModelPrice(family.key, resolution.key, event.target.value)}
                />
              </label>
            ))}
          </div>
        ))}
      </div>
      <p className={styles.hint}>{t(videoPricingI18nKey('modeHint'))}</p>
      <PricePreview title={t(videoPricingI18nKey('finalPricePreview'))} items={buildVideoFinalPricePreview(form, t)} />
    </FormSection>
  )
}
