/**
 * 充值优惠阶梯编辑器（对应 Vue 版 RechargeBonusTierEditor.vue）。
 * v-model / v-model:mode / v-model:notice 拆成 value+onChange、mode+onModeChange、notice+onNoticeChange。
 */
import type { ChangeEvent } from 'react'
import { Plus, X } from 'lucide-react'

import { Button } from '@/components/arc/button/button'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { useI18n } from '@/i18n/useI18n'
import {
  MAX_RECHARGE_BONUS_PERCENT,
  MAX_RECHARGE_BONUS_TIERS,
  describeRechargeBonusIntervals,
  formatRechargeBonusNumber,
  isDuplicateRechargeBonusMinAmount,
  isRechargeBonusMinAmountValid,
  isRechargeBonusPercentValidForMode,
  normalizeRechargeBonusMode,
  sanitizeRechargeBonusTiersForSubmit,
  type RechargeBonusInterval,
  type RechargeBonusMode,
  type RechargeBonusTierDraft
} from '@/utils/rechargeBonus'
import { SettingsRegion } from './SettingsLayout'
import { cx } from './settingsUtils'
import s from './SettingsLayout.module.css'
import styles from './RechargeBonusTierEditor.module.css'

export interface RechargeBonusTierEditorProps {
  value?: RechargeBonusTierDraft[] | null
  onChange: (value: RechargeBonusTierDraft[]) => void
  mode?: RechargeBonusMode | string | null
  onModeChange: (value: RechargeBonusMode) => void
  notice?: string | null
  onNoticeChange: (value: string) => void
}

type RowError = '' | 'invalidMinAmount' | 'invalidPercent' | 'invalidDiscountPercent' | 'duplicateMinAmount'

function parseNumberInput(event: ChangeEvent<HTMLInputElement>): number | null {
  const raw = event.target.value
  if (raw === '') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export default function RechargeBonusTierEditor({
  value,
  onChange,
  mode,
  onModeChange,
  notice,
  onNoticeChange
}: RechargeBonusTierEditorProps) {
  const { t } = useI18n()
  const tiers = value ?? []
  const currentMode = normalizeRechargeBonusMode(mode)
  const discount = currentMode === 'discount'

  const modeOptions: { value: RechargeBonusMode; label: string }[] = [
    { value: 'bonus', label: t('admin.settings.payment.rechargeBonus.modeBonus') },
    { value: 'discount', label: t('admin.settings.payment.rechargeBonus.modeDiscount') }
  ]

  const intervals = describeRechargeBonusIntervals(sanitizeRechargeBonusTiersForSubmit(tiers))

  function setMode(next: string) {
    const normalized = normalizeRechargeBonusMode(next)
    if (normalized === currentMode) return
    onModeChange(normalized)
  }

  function cloneTiers(): RechargeBonusTierDraft[] {
    return tiers.map((tier) => ({ min_amount: tier.min_amount, bonus_percent: tier.bonus_percent }))
  }

  function addTier() {
    if (tiers.length >= MAX_RECHARGE_BONUS_TIERS) return
    onChange([...cloneTiers(), { min_amount: null, bonus_percent: null }])
  }

  function removeTier(index: number) {
    const next = cloneTiers()
    next.splice(index, 1)
    onChange(next)
  }

  function onMinAmountInput(index: number, event: ChangeEvent<HTMLInputElement>) {
    const next = cloneTiers()
    next[index]!.min_amount = parseNumberInput(event)
    onChange(next)
  }

  function onPercentInput(index: number, event: ChangeEvent<HTMLInputElement>) {
    const next = cloneTiers()
    next[index]!.bonus_percent = parseNumberInput(event)
    onChange(next)
  }

  function rowError(index: number): RowError {
    const tier = tiers[index]
    if (!tier) return ''
    if (tier.min_amount !== null && !isRechargeBonusMinAmountValid(tier.min_amount)) return 'invalidMinAmount'
    if (tier.bonus_percent !== null && !isRechargeBonusPercentValidForMode(tier.bonus_percent, currentMode)) {
      return currentMode === 'discount' && isRechargeBonusPercentValidForMode(tier.bonus_percent, 'bonus')
        ? 'invalidDiscountPercent'
        : 'invalidPercent'
    }
    if (isDuplicateRechargeBonusMinAmount(tiers, index)) return 'duplicateMinAmount'
    return ''
  }

  function rowIncomplete(index: number): boolean {
    const tier = tiers[index]
    return !!tier && (tier.min_amount === null || tier.bonus_percent === null)
  }

  function intervalLabel(interval: RechargeBonusInterval): string {
    const from = formatRechargeBonusNumber(interval.from)
    const percent = formatRechargeBonusNumber(interval.percent)
    if (interval.to === null) {
      if (interval.percent <= 0) return t('admin.settings.payment.rechargeBonus.previewOpenNone', { from })
      return discount
        ? t('admin.settings.payment.rechargeBonus.previewOpenDiscount', { from, percent })
        : t('admin.settings.payment.rechargeBonus.previewOpen', { from, percent })
    }
    const to = formatRechargeBonusNumber(interval.to)
    if (interval.percent <= 0) return t('admin.settings.payment.rechargeBonus.previewRangeNone', { from, to })
    return discount
      ? t('admin.settings.payment.rechargeBonus.previewRangeDiscount', { from, to, percent })
      : t('admin.settings.payment.rechargeBonus.previewRange', { from, to, percent })
  }

  return (
    <SettingsRegion
      data-testid="recharge-bonus-tier-editor"
      title={t('admin.settings.payment.rechargeBonus.label')}
      description={t('admin.settings.payment.rechargeBonus.hint')}
      actions={
        <Button
          type="button"
          size="sm"
          disabled={tiers.length >= MAX_RECHARGE_BONUS_TIERS}
          data-testid="recharge-bonus-tier-add"
          onClick={addTier}
        >
          <Plus size={14} aria-hidden="true" />
          {t('admin.settings.payment.rechargeBonus.addTier')}
        </Button>
      }
    >
      <div className={s.column}>
        {/* 模式：整条阶梯共用 */}
        <div className={s.inline}>
          <span className={s.label}>{t('admin.settings.payment.rechargeBonus.modeLabel')}</span>
          <div className={styles.modeSwitch}>
            <SegmentedControl
              options={modeOptions}
              value={currentMode}
              onValueChange={setMode}
              label={t('admin.settings.payment.rechargeBonus.modeLabel')}
            />
          </div>
          <span className={s.hint}>
            {discount
              ? t('admin.settings.payment.rechargeBonus.modeDiscountHint')
              : t('admin.settings.payment.rechargeBonus.modeBonusHint')}
          </span>
        </div>

        {/* 档位列表：紧凑表格 */}
        {tiers.length === 0 ? (
          <p className={s.empty}>{t('admin.settings.payment.rechargeBonus.empty')}</p>
        ) : (
          <div className={styles.table}>
            <div className={cx(styles.grid, styles.head)}>
              <span>{t('admin.settings.payment.rechargeBonus.minAmountLabel')}</span>
              <span>
                {discount
                  ? t('admin.settings.payment.rechargeBonus.percentLabelDiscount')
                  : t('admin.settings.payment.rechargeBonus.percentLabel')}
              </span>
              <span />
            </div>
            {tiers.map((tier, index) => {
              const error = rowError(index)
              return (
                <div key={index} className={cx(styles.grid, styles.row)} data-testid="recharge-bonus-tier-row">
                  <input
                    value={tier.min_amount ?? ''}
                    type="number"
                    step="0.01"
                    min="0"
                    className={s.input}
                    placeholder="100"
                    aria-label={t('admin.settings.payment.rechargeBonus.minAmountLabel')}
                    data-testid="recharge-bonus-tier-min-input"
                    onChange={(event) => onMinAmountInput(index, event)}
                  />
                  <div className={s.inputWithSuffix}>
                    <input
                      value={tier.bonus_percent ?? ''}
                      type="number"
                      step="0.01"
                      min="0"
                      max={discount ? 99.99 : MAX_RECHARGE_BONUS_PERCENT}
                      className={s.input}
                      placeholder="20"
                      aria-label={
                        discount
                          ? t('admin.settings.payment.rechargeBonus.percentLabelDiscount')
                          : t('admin.settings.payment.rechargeBonus.percentLabel')
                      }
                      data-testid="recharge-bonus-tier-percent-input"
                      onChange={(event) => onPercentInput(index, event)}
                    />
                    <span className={cx(s.inputSuffix, discount && styles.discountSuffix)}>{discount ? '% OFF' : '%'}</span>
                  </div>
                  <button
                    type="button"
                    className={cx(s.iconButton, s.iconButtonDanger)}
                    title={t('admin.settings.payment.rechargeBonus.removeTier')}
                    aria-label={t('admin.settings.payment.rechargeBonus.removeTier')}
                    data-testid="recharge-bonus-tier-remove"
                    onClick={() => removeTier(index)}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                  {error ? (
                    <p className={cx(s.error, styles.rowMessage)} data-testid="recharge-bonus-tier-error">
                      {t(`admin.settings.payment.rechargeBonus.${error}`)}
                    </p>
                  ) : rowIncomplete(index) ? (
                    <p className={cx(s.hint, styles.rowMessage)} data-testid="recharge-bonus-tier-incomplete">
                      {t('admin.settings.payment.rechargeBonus.incompleteRow')}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        {/* 区间预览：单行内联 */}
        {intervals.length > 0 ? (
          <p className={cx(s.chips, styles.preview)} data-testid="recharge-bonus-tier-preview">
            <span className={s.label}>{t('admin.settings.payment.rechargeBonus.previewTitle')}</span>
            {intervals.map((interval, index) => (
              <span key={index} className={s.chip}>
                {intervalLabel(interval)}
              </span>
            ))}
          </p>
        ) : null}
      </div>

      {/* 活动文案 */}
      <label className={s.field}>
        <span className={s.label}>{t('admin.settings.payment.rechargeBonus.noticeLabel')}</span>
        <textarea
          value={notice ?? ''}
          rows={3}
          className={s.textarea}
          placeholder={t('admin.settings.payment.rechargeBonus.noticePlaceholder')}
          data-testid="recharge-bonus-notice-input"
          onChange={(event) => onNoticeChange(event.target.value)}
        />
        <span className={s.hint}>{t('admin.settings.payment.rechargeBonus.noticeHint')}</span>
      </label>
    </SettingsRegion>
  )
}
