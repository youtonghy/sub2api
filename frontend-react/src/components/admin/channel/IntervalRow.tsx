/**
 * 定价区间行，对应 Vue 版 IntervalRow.vue。
 * token 模式：上下文范围 + 各项单价（$/MTok）与可选倍率；按次 / 图片 / 视频模式：档位标签 + 范围 + 单次价格。
 * 所有价格都为空时整行标红并给价格加星号。
 */
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

import type { BillingMode } from '@/api/admin/channels'
import arcInput from '@/components/arc/input/input.module.css'
import { useI18n } from '@/i18n/useI18n'
import type { IntervalFormEntry } from './types'
import form from './channelForm.module.css'
import styles from './IntervalRow.module.css'

export interface IntervalRowProps {
  interval: IntervalFormEntry
  mode: BillingMode
  enableMultipliers?: boolean
  onUpdate?: (interval: IntervalFormEntry) => void
  onRemove?: () => void
}

const inputClass = [arcInput.input, form.compact].join(' ')

function toInt(val: string): number {
  const n = Math.trunc(Number(val))
  return isNaN(n) ? 0 : n
}

function toIntOrNull(val: string): number | null {
  if (val === '') return null
  const n = Math.trunc(Number(val))
  return isNaN(n) ? null : n
}

const isBlank = (value: unknown) => value == null || value === ''

export default function IntervalRow({ interval, mode, enableMultipliers = false, onUpdate, onRemove }: IntervalRowProps) {
  const { t } = useI18n()

  // 检测所有价格字段是否都为空
  const isEmpty =
    isBlank(interval.input_price) &&
    isBlank(interval.output_price) &&
    isBlank(interval.cache_write_price) &&
    isBlank(interval.cache_write_1h_price) &&
    isBlank(interval.cache_read_price) &&
    isBlank(interval.input_multiplier) &&
    isBlank(interval.output_multiplier) &&
    isBlank(interval.cache_write_multiplier) &&
    isBlank(interval.cache_read_multiplier) &&
    isBlank(interval.per_request_price)

  const emitField = (field: keyof IntervalFormEntry, value: string | number | null) => {
    onUpdate?.({ ...interval, [field]: value === '' ? null : value })
  }

  const star = isEmpty ? <span className={form.required}>*</span> : null
  const unit = (text: string) => <span className={form.subLabel}>{text}</span>

  const field = (
    label: ReactNode,
    key: keyof IntervalFormEntry,
    props: { step?: string; min?: string; type?: string; placeholder?: string; parse?: (value: string) => string | number | null } = {},
    className?: string
  ) => {
    const value = interval[key]
    return (
      <label className={[form.field, className].filter(Boolean).join(' ')}>
        <span className={form.subLabel}>{label}</span>
        <input
          className={inputClass}
          type={props.type ?? 'number'}
          step={props.step}
          min={props.min}
          placeholder={props.placeholder}
          value={value == null ? '' : String(value)}
          onChange={(event) => emitField(key, props.parse ? props.parse(event.target.value) : event.target.value)}
        />
      </label>
    )
  }

  const maxLabel = (
    <>
      {t('admin.channels.form.maxTokens')} {unit(t('admin.channels.form.inclusive'))}
    </>
  )

  return (
    <div className={styles.row} data-empty={isEmpty ? '' : undefined}>
      {mode === 'token' ? (
        <div className={styles.tokenGrid}>
          {field(t('admin.channels.form.minTokens'), 'min_tokens', { min: '0', parse: toInt })}
          {field(maxLabel, 'max_tokens', { min: '0', placeholder: '∞', parse: toIntOrNull })}
          {field(<>{t('admin.channels.form.inputPrice')} {star} {unit('$/M')}</>, 'input_price', { step: 'any', min: '0' })}
          {field(<>{t('admin.channels.form.outputPrice')} {star} {unit('$/M')}</>, 'output_price', { step: 'any', min: '0' })}
          {field(<>{t('admin.channels.form.cacheWrite5mPriceShort')} {unit('$/M')}</>, 'cache_write_price', { step: 'any', min: '0' })}
          {field(<>{t('admin.channels.form.cacheWrite1hPriceShort')} {unit('$/M')}</>, 'cache_write_1h_price', { step: 'any', min: '0' })}
          {field(<>{t('admin.channels.form.cacheReadPriceShort')} {unit('$/M')}</>, 'cache_read_price', { step: 'any', min: '0' })}
          {enableMultipliers && (
            <>
              {field(t('admin.channels.form.inputMultiplier'), 'input_multiplier', { step: 'any', min: '0.000001' })}
              {field(t('admin.channels.form.outputMultiplier'), 'output_multiplier', { step: 'any', min: '0.000001' })}
              {field(t('admin.channels.form.cacheWriteMultiplier'), 'cache_write_multiplier', { step: 'any', min: '0.000001' })}
              {field(t('admin.channels.form.cacheReadMultiplier'), 'cache_read_multiplier', { step: 'any', min: '0.000001' })}
            </>
          )}
        </div>
      ) : (
        <div className={styles.tierRow}>
          {field(
            mode === 'image' ? t('admin.channels.form.resolution') : t('admin.channels.form.tierLabel'),
            'tier_label',
            { type: 'text', placeholder: mode === 'image' ? '1K / 2K / 4K' : '' },
            styles.tierLabel
          )}
          {field(t('admin.channels.form.minTokens'), 'min_tokens', { min: '0', parse: toInt }, styles.tierRange)}
          {field(maxLabel, 'max_tokens', { min: '0', placeholder: '∞', parse: toIntOrNull }, styles.tierRange)}
          {field(
            <>{t('admin.channels.form.perRequestPrice')} {star} {unit('$')}</>,
            'per_request_price',
            { step: 'any', min: '0' },
            styles.tierPrice
          )}
        </div>
      )}

      <button
        type="button"
        className={[form.iconButton, styles.remove].join(' ')}
        aria-label={t('common.delete')}
        onClick={() => onRemove?.()}
      >
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  )
}
