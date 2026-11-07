/**
 * OpenAI 图片尺寸档位多选，对应 Vue 版 OpenAIImageSizeTiersField.vue。
 * 至少保留一个档位；三档全选等于不限，由 openaiImageSizeTiers.ts 负责写回 extra。
 */
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { useI18n } from '@/i18n/useI18n'
import { FormField } from './AccountFormLayout'
import { OPENAI_IMAGE_SIZE_TIERS, normalizeOpenAIImageSizeTiers, type OpenAIImageSizeTier } from './openaiImageSizeTiers'
import styles from './OpenAIImageSizeTiersField.module.css'

export interface OpenAIImageSizeTiersFieldProps {
  /** Vue 版 modelValue */
  value: OpenAIImageSizeTier[]
  onChange: (value: OpenAIImageSizeTier[]) => void
  disabled?: boolean
  hideLabel?: boolean
  testIdPrefix?: string
}

export default function OpenAIImageSizeTiersField({
  value,
  onChange,
  disabled = false,
  hideLabel = false,
  testIdPrefix = 'openai-image-size-tier'
}: OpenAIImageSizeTiersFieldProps) {
  const { t } = useI18n()

  const isLastSelected = (tier: OpenAIImageSizeTier) => value.length === 1 && value[0] === tier

  const toggleTier = (tier: OpenAIImageSizeTier, checked: boolean) => {
    // 最后一个已选档位不能取消：受控复选框保持勾选
    if (!checked && isLastSelected(tier)) return
    const next = checked ? [...value, tier] : value.filter((item) => item !== tier)
    onChange(normalizeOpenAIImageSizeTiers(next))
  }

  return (
    <FormField label={hideLabel ? undefined : t('admin.accounts.openai.imageSizeTiers')} hint={t('admin.accounts.openai.imageSizeTiersDesc')}>
      <div className={styles.grid}>
        {OPENAI_IMAGE_SIZE_TIERS.map((tier) => (
          <div key={tier} className={styles.tier} title={isLastSelected(tier) ? t('admin.accounts.openai.imageSizeTiersAtLeastOne') : undefined}>
            <Checkbox
              data-testid={`${testIdPrefix}-${tier}`}
              label={tier}
              checked={value.includes(tier)}
              disabled={disabled}
              onCheckedChange={(checked) => toggleTier(tier, checked === true)}
            />
          </div>
        ))}
      </div>
    </FormField>
  )
}
