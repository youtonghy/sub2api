/** Prompt Audit 按条件删除（时间范围预设、预览、确认），对应 Vue 版 components/FilterDeleteDialog.vue */
import { useState } from 'react'

import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import { useI18n } from '@/i18n/useI18n'
import type { PromptDeletePreview, PromptEventFilters } from '../types'
import {
  DELETE_RANGE_PRESETS,
  cloneData,
  emptyEventFilters,
  hasExplicitDeleteRange,
  resolveDeleteRangeFilters,
  type DeleteRangePreset
} from '../viewModel'
import styles from './promptAudit.module.css'

export interface FilterDeleteDialogProps {
  show: boolean
  initialFilters: PromptEventFilters
  preview: PromptDeletePreview | null
  previewing: boolean
  deleting: boolean
  onClose?: () => void
  onPreview?: (value: PromptEventFilters) => void
  onConfirm?: (value: PromptEventFilters) => void
  onCriteriaChange?: () => void
}

export default function FilterDeleteDialog({
  show,
  initialFilters,
  preview,
  previewing,
  deleting,
  onClose,
  onPreview,
  onConfirm,
  onCriteriaChange
}: FilterDeleteDialogProps) {
  const { t, locale } = useI18n()
  const [preset, setPreset] = useState<DeleteRangePreset>('7d')
  const [local, setLocal] = useState<PromptEventFilters>(emptyEventFilters)

  // 与 Vue 版 watch(show, immediate) 一致：每次打开时按列表筛选重置
  const [lastShow, setLastShow] = useState(false)
  if (show !== lastShow) {
    setLastShow(show)
    if (show) {
      const initial = cloneData(initialFilters)
      // Only inherit an explicit list-filter range; otherwise default to the
      // seven-day preset so a careless click can never target everything.
      setPreset(hasExplicitDeleteRange(initial) ? 'custom' : '7d')
      setLocal({ ...emptyEventFilters(), ...initial })
    }
  }

  const canPreview = preset !== 'custom' || hasExplicitDeleteRange(local)

  // One-click flow: a valid criteria selection is enough to confirm — the parent
  // mints the server-side confirmation token on the fly. The button stays
  // disabled only when the range is invalid, work is in flight, or a fresh
  // preview already proved there is nothing to delete.
  const confirmDisabled = !canPreview || previewing || deleting || (preview !== null && preview.matched_count === 0)
  const confirmDisabledReason = (() => {
    if (previewing || deleting) return ''
    if (!canPreview) return 'admin.promptAudit.events.filterDeleteConfirmInvalidRange'
    if (preview && preview.matched_count === 0) return 'admin.promptAudit.events.filterDeleteConfirmNoMatches'
    return ''
  })()

  const setField = (key: keyof PromptEventFilters, value: string) => {
    setLocal((prev) => ({ ...prev, [key]: value }))
    onCriteriaChange?.()
  }
  const requestPreview = () => {
    if (!canPreview) return
    onPreview?.(resolveDeleteRangeFilters(local, preset))
  }
  const requestConfirm = () => {
    if (confirmDisabled) return
    onConfirm?.(resolveDeleteRangeFilters(local, preset))
  }
  const formatDate = (value: string): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value))

  return (
    <BaseDialog
      show={show}
      title={t('admin.promptAudit.events.filterDeleteDialogTitle')}
      width="wide"
      onClose={() => onClose?.()}
      footer={
        <div className={styles.footer}>
          {confirmDisabledReason ? (
            <p className={styles.footerReason} data-test="confirm-disabled-reason">
              {t(confirmDisabledReason)}
            </p>
          ) : null}
          <Button type="button" variant="secondary" onClick={() => onClose?.()}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!canPreview || previewing || deleting}
            data-test="run-delete-preview"
            onClick={requestPreview}
          >
            {previewing ? t('admin.promptAudit.events.filterDeletePreviewing') : t('admin.promptAudit.events.filterDeletePreviewAction')}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={confirmDisabled}
            title={confirmDisabledReason ? t(confirmDisabledReason) : undefined}
            data-test="confirm-filter-delete"
            onClick={requestConfirm}
          >
            {deleting ? t('common.submitting') : t('admin.promptAudit.events.confirmFilterDelete')}
          </Button>
        </div>
      }
    >
      <div className={styles.dialogBody}>
        <p className={styles.description}>{t('admin.promptAudit.events.filterDeleteDialogDesc')}</p>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{t('admin.promptAudit.events.filterTimeRange')}</legend>
          <div className={styles.presetRow} role="radiogroup" aria-label={t('admin.promptAudit.events.filterTimeRange')}>
            {DELETE_RANGE_PRESETS.map((option) => (
              <label key={option.id}>
                <input
                  type="radio"
                  name="prompt-delete-range"
                  className={styles.presetInput}
                  value={option.id}
                  checked={preset === option.id}
                  data-test={`range-preset-${option.id}`}
                  onChange={() => {
                    setPreset(option.id)
                    onCriteriaChange?.()
                  }}
                />
                <span className={styles.presetPill}>{t(`admin.promptAudit.events.timePresets.${option.id}`)}</span>
              </label>
            ))}
          </div>
          <p className={styles.subText}>{t('admin.promptAudit.events.filterTimeRangeHint')}</p>
          {preset === 'custom' ? (
            <div className={`${styles.formGrid} ${styles.subText}`} data-test="custom-range">
              <label className={styles.field}>
                <span>{t('admin.promptAudit.events.startAt')}</span>
                <input
                  type="datetime-local"
                  className={styles.input}
                  value={local.start_at}
                  aria-label={t('admin.promptAudit.events.startAt')}
                  onChange={(event) => setField('start_at', event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span>{t('admin.promptAudit.events.endAt')}</span>
                <input
                  type="datetime-local"
                  className={styles.input}
                  value={local.end_at}
                  aria-label={t('admin.promptAudit.events.endAt')}
                  onChange={(event) => setField('end_at', event.target.value)}
                />
              </label>
              {!canPreview ? (
                <p className={`${styles.hint} ${styles.dangerText} ${styles.span2}`}>{t('admin.promptAudit.events.customRangeInvalid')}</p>
              ) : null}
            </div>
          ) : null}
        </fieldset>

        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>{t('admin.promptAudit.events.decision')}</span>
            <select
              className={styles.select}
              value={local.decision}
              aria-label={t('admin.promptAudit.events.decision')}
              data-test="delete-decision"
              onChange={(event) => setField('decision', event.target.value)}
            >
              <option value="">{t('common.all')}</option>
              <option value="pass">{t('admin.promptAudit.decisions.pass')}</option>
              <option value="flag">{t('admin.promptAudit.decisions.flag')}</option>
              <option value="critical">{t('admin.promptAudit.decisions.critical')}</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>{t('admin.promptAudit.events.risk')}</span>
            <select
              className={styles.select}
              value={local.risk_level}
              aria-label={t('admin.promptAudit.events.risk')}
              data-test="delete-risk"
              onChange={(event) => setField('risk_level', event.target.value)}
            >
              <option value="">{t('common.all')}</option>
              <option value="low">{t('admin.promptAudit.riskLevels.low')}</option>
              <option value="medium">{t('admin.promptAudit.riskLevels.medium')}</option>
              <option value="high">{t('admin.promptAudit.riskLevels.high')}</option>
              <option value="critical">{t('admin.promptAudit.riskLevels.critical')}</option>
            </select>
          </label>
        </div>

        <details className={styles.details} data-test="more-conditions">
          <summary className={styles.summary}>{t('admin.promptAudit.events.moreConditions')}</summary>
          <div className={`${styles.formGrid} ${styles.subText}`}>
            {(
              [
                ['endpoint', 'text', t('admin.promptAudit.events.endpoint')],
                ['keyword', 'text', t('admin.promptAudit.events.keyword')],
                ['group_id', 'number', t('admin.promptAudit.events.groupId')],
                ['user_id', 'number', t('admin.promptAudit.events.userId')]
              ] as const
            ).map(([key, type, label]) => (
              <label key={key} className={styles.field}>
                <span>{label}</span>
                <input
                  type={type}
                  className={styles.input}
                  value={local[key]}
                  aria-label={label}
                  onChange={(event) => setField(key, event.target.value)}
                />
              </label>
            ))}
          </div>
        </details>

        {preview ? (
          <div className={styles.previewResult} data-test="delete-preview-result">
            <p className={styles.previewCount}>{t('admin.promptAudit.events.filterDeleteCount', { count: preview.matched_count })}</p>
            <dl className={styles.previewDl}>
              <dt>{t('admin.promptAudit.events.snapshotMax')}</dt>
              <dd>{preview.snapshot_max_id}</dd>
              <dt>Filter SHA-256</dt>
              <dd className={`${styles.mono} ${styles.breakAll}`}>{preview.filter_hash}</dd>
              <dt>{t('admin.promptAudit.events.expiresAt')}</dt>
              <dd>{formatDate(preview.expires_at)}</dd>
            </dl>
            <p className={`${styles.warningBox} ${styles.subText}`}>{t('admin.promptAudit.events.filterDeleteWarning')}</p>
          </div>
        ) : (
          <p className={styles.previewEmpty} data-test="delete-preview-empty">
            {t('admin.promptAudit.events.filterDeleteNeedPreview')}
          </p>
        )}
      </div>
    </BaseDialog>
  )
}
