/**
 * 邮件模板编辑器（对应 Vue 版 EmailTemplateEditor.vue），位于系统设置“邮件”Tab。
 * 预览仍用 sandbox iframe 渲染服务端返回的 HTML。
 */
import { useState } from 'react'

import { adminAPI } from '@/api'
import type { EmailTemplateEventOption, EmailTemplateOption } from '@/api/admin/settings'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { Field, Notice, SettingsRegion } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { cx } from '@/components/admin/settings/settingsUtils'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores'
import { extractApiErrorMessage } from '@/utils/apiError'
import { eventDisplayMeta, eventDisplayMetaEn, fallbackPlaceholders } from './emailTemplateMeta'
import styles from './EmailTemplateEditor.module.css'

interface TemplatePayload {
  subject: string
  html: string
  is_custom?: boolean
  placeholders?: string[]
}

function normalizeEventOption(option: EmailTemplateEventOption): EmailTemplateOption {
  if (typeof option === 'string') return { value: option }
  return option
}

function formatPlaceholder(placeholder: string): string {
  const trimmed = placeholder.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) return trimmed
  return `{{${trimmed}}}`
}

export default function EmailTemplateEditor() {
  const { t, locale } = useI18n()
  const [loadingList, setLoadingList] = useState(true)
  const [loadingTemplate, setLoadingTemplate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [eventOptions, setEventOptions] = useState<EmailTemplateOption[]>([])
  const [localeOptions, setLocaleOptions] = useState<string[]>([])
  const [selectedEvent, setSelectedEvent] = useState('')
  const [selectedLocale, setSelectedLocale] = useState('')
  const [subject, setSubject] = useState('')
  const [html, setHtml] = useState('')
  const [isCustomTemplate, setIsCustomTemplate] = useState(false)
  const [placeholders, setPlaceholders] = useState<string[]>([])
  const [previewSubject, setPreviewSubject] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')

  const isZh = locale.toLowerCase().startsWith('zh')
  const localText = (zh: string, en: string) => (isZh ? zh : en)

  function formatCategory(category: string): string {
    const normalized = category.trim().toLowerCase()
    if (!normalized) return localText('通知', 'Notification')
    const labels: Record<string, { zh: string; en: string }> = {
      auth: { zh: '认证安全', en: 'Auth' },
      subscription: { zh: '订阅', en: 'Subscription' },
      billing: { zh: '计费', en: 'Billing' },
      admin: { zh: '管理告警', en: 'Admin' },
      risk_control: { zh: '风控', en: 'Risk Control' },
      ops: { zh: '运维', en: 'Ops' }
    }
    const item = labels[normalized]
    return item ? localText(item.zh, item.en) : category
  }

  function eventMetaFor(option?: EmailTemplateOption | null) {
    if (!option) return null
    const displayMeta = (isZh ? eventDisplayMeta : eventDisplayMetaEn)[option.value]
    return {
      label: displayMeta?.label || option.label || option.value,
      timing: displayMeta?.timing || option.description || '',
      categoryLabel: displayMeta?.categoryLabel || formatCategory(option.category || ''),
      optional: option.optional === true
    }
  }

  function formatEventOptionLabel(option: EmailTemplateOption): string {
    const meta = eventMetaFor(option)
    if (!meta) return option.label || option.value
    return meta.label
  }

  function formatLocale(value: string): string {
    const lower = value.toLowerCase()
    if (lower === 'zh' || lower.startsWith('zh-')) return t('admin.settings.emailTemplates.localeZh')
    if (lower === 'en' || lower.startsWith('en-')) return t('admin.settings.emailTemplates.localeEn')
    return value
  }

  function selectInitialLocale(locales: string[]): string {
    const currentLocale = locale.toLowerCase()
    const exactMatch = locales.find((available) => available.toLowerCase() === currentLocale)
    if (exactMatch) return exactMatch
    const currentLanguage = currentLocale.split('-')[0]
    const languageMatch = locales.find((available) => available.toLowerCase().split('-')[0] === currentLanguage)
    if (languageMatch) return languageMatch
    return locales[0] || ''
  }

  const selectedEventOption = eventOptions.find((option) => option.value === selectedEvent) || null
  const selectedEventMeta = eventMetaFor(selectedEventOption)
  const selectedEventDescription = selectedEventOption?.description || ''
  const placeholderList = Array.from(
    new Set((placeholders.length ? placeholders : fallbackPlaceholders).map(formatPlaceholder).filter((item) => item.length > 0))
  )
  const canSave = Boolean(selectedEvent && selectedLocale) && subject.trim().length > 0 && html.trim().length > 0
  const canPreview = Boolean(selectedEvent && selectedLocale) && html.trim().length > 0

  function applyTemplate(template: TemplatePayload) {
    setSubject(template.subject)
    setHtml(template.html)
    setIsCustomTemplate(template.is_custom === true)
    setPlaceholders(template.placeholders || [])
  }

  async function refreshPreview(eventValue: string, localeValue: string, subjectValue: string, htmlValue: string) {
    if (!(eventValue && localeValue) || htmlValue.trim().length === 0) {
      setPreviewSubject('')
      setPreviewHtml('')
      return
    }
    setPreviewing(true)
    try {
      const preview = await adminAPI.settings.previewEmailTemplate({
        event: eventValue,
        locale: localeValue,
        subject: subjectValue,
        html: htmlValue
      })
      setPreviewSubject(preview.subject)
      setPreviewHtml(preview.html)
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      setPreviewing(false)
    }
  }

  async function loadTemplate(eventValue: string, localeValue: string) {
    if (!eventValue || !localeValue) return
    setLoadingTemplate(true)
    try {
      const template = await adminAPI.settings.getEmailTemplate(eventValue, localeValue)
      applyTemplate(template)
      await refreshPreview(eventValue, localeValue, template.subject, template.html)
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      setLoadingTemplate(false)
    }
  }

  useMountOnce(async () => {
    setLoadingList(true)
    try {
      const response = await adminAPI.settings.getEmailTemplates()
      const events = response.events.map(normalizeEventOption)
      setEventOptions(events)
      setLocaleOptions(response.locales)
      setPlaceholders(response.placeholders || [])
      const initialEvent = events[0]?.value || ''
      const initialLocale = selectInitialLocale(response.locales)
      setSelectedEvent(initialEvent)
      setSelectedLocale(initialLocale)
      await loadTemplate(initialEvent, initialLocale)
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      setLoadingList(false)
    }
  })

  // 对应 Vue 版 watch([selectedEvent, selectedLocale])：选择变化时重新加载模板
  function changeSelection(eventValue: string, localeValue: string) {
    const changed = eventValue !== selectedEvent || localeValue !== selectedLocale
    setSelectedEvent(eventValue)
    setSelectedLocale(localeValue)
    if (!eventValue || !localeValue || !changed) return
    void loadTemplate(eventValue, localeValue)
  }

  async function saveTemplate() {
    if (!canSave) {
      useAppStore.getState().showError(t('admin.settings.emailTemplates.validationRequired'))
      return
    }
    setSaving(true)
    try {
      const template = await adminAPI.settings.updateEmailTemplate(selectedEvent, selectedLocale, { subject, html })
      applyTemplate(template)
      await refreshPreview(selectedEvent, selectedLocale, template.subject, template.html)
      useAppStore.getState().showSuccess(t('admin.settings.emailTemplates.saveSuccess'))
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      setSaving(false)
    }
  }

  async function restoreOfficial() {
    if (!selectedEvent || !selectedLocale) return
    if (!window.confirm(t('admin.settings.emailTemplates.restoreConfirm'))) return
    setRestoring(true)
    try {
      const template = await adminAPI.settings.restoreOfficialEmailTemplate(selectedEvent, selectedLocale)
      applyTemplate(template)
      await refreshPreview(selectedEvent, selectedLocale, template.subject, template.html)
      useAppStore.getState().showSuccess(t('admin.settings.emailTemplates.restoreSuccess'))
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      setRestoring(false)
    }
  }

  async function copyPlaceholder(placeholder: string) {
    try {
      await navigator.clipboard.writeText(placeholder)
      useAppStore.getState().showSuccess(t('admin.settings.emailTemplates.placeholderCopied'))
    } catch {
      useAppStore.getState().showError(t('common.error'))
    }
  }

  return (
    <SettingsRegion
      title={t('admin.settings.emailTemplates.title')}
      description={t('admin.settings.emailTemplates.description')}
      actions={
        <>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loadingTemplate || previewing || !canPreview}
            onClick={() => void refreshPreview(selectedEvent, selectedLocale, subject, html)}
          >
            {previewing ? t('admin.settings.emailTemplates.previewing') : t('admin.settings.emailTemplates.preview')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loadingTemplate || restoring || !selectedEvent || !selectedLocale}
            onClick={() => void restoreOfficial()}
          >
            {restoring ? t('admin.settings.emailTemplates.restoring') : t('admin.settings.emailTemplates.restoreOfficial')}
          </Button>
          <Button type="button" size="sm" disabled={loadingTemplate || saving || !canSave} onClick={() => void saveTemplate()}>
            {saving ? t('admin.settings.emailTemplates.saving') : t('admin.settings.emailTemplates.save')}
          </Button>
        </>
      }
    >
      {loadingList ? (
        <Skeleton label={t('common.loading')} lines={4} />
      ) : (
        <div className={s.column}>
          <div className={s.grid2}>
            <Field label={t('admin.settings.emailTemplates.event')} htmlFor="email-template-event">
              <select
                id="email-template-event"
                className={s.select}
                value={selectedEvent}
                disabled={loadingTemplate || eventOptions.length === 0}
                onChange={(e) => changeSelection(e.target.value, selectedLocale)}
              >
                {eventOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {formatEventOptionLabel(option)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('admin.settings.emailTemplates.locale')} htmlFor="email-template-locale">
              <select
                id="email-template-locale"
                className={s.select}
                value={selectedLocale}
                disabled={loadingTemplate || localeOptions.length === 0}
                onChange={(e) => changeSelection(selectedEvent, e.target.value)}
              >
                {localeOptions.map((localeOption) => (
                  <option key={localeOption} value={localeOption}>
                    {formatLocale(localeOption)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {selectedEventMeta ? (
            <Notice tone="info">
              <div className={s.inline}>
                <span className={s.label}>{selectedEventMeta.label}</span>
                <Badge tone="neutral" size="sm">
                  {selectedEventMeta.categoryLabel}
                </Badge>
                <Badge tone={selectedEventMeta.optional ? 'warning' : 'success'} size="sm">
                  {selectedEventMeta.optional ? localText('可退订通知', 'Optional') : localText('事务邮件', 'Transactional')}
                </Badge>
              </div>
              <p>{selectedEventMeta.timing}</p>
              {selectedEventDescription ? <p className={s.hint}>{selectedEventDescription}</p> : null}
            </Notice>
          ) : null}

          {!eventOptions.length || !localeOptions.length ? (
            <Notice tone="warning">
              <p>{t('admin.settings.emailTemplates.empty')}</p>
            </Notice>
          ) : (
            <div className={styles.editorGrid}>
              <div className={s.column}>
                <Field label={t('admin.settings.emailTemplates.subject')} htmlFor="email-template-subject">
                  <input
                    id="email-template-subject"
                    type="text"
                    className={s.input}
                    value={subject}
                    disabled={loadingTemplate}
                    placeholder={t('admin.settings.emailTemplates.subjectPlaceholder')}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </Field>
                <Field label={t('admin.settings.emailTemplates.html')} htmlFor="email-template-html">
                  <textarea
                    id="email-template-html"
                    rows={18}
                    className={cx(s.textarea, s.mono, styles.htmlInput)}
                    value={html}
                    disabled={loadingTemplate}
                    placeholder={t('admin.settings.emailTemplates.htmlPlaceholder')}
                    onChange={(e) => setHtml(e.target.value)}
                  />
                </Field>
                <div className={styles.placeholders}>
                  <span className={s.label}>{t('admin.settings.emailTemplates.placeholders')}</span>
                  <p className={s.hint}>{t('admin.settings.emailTemplates.placeholdersHelp')}</p>
                  <div className={s.chips}>
                    {placeholderList.map((placeholder) => (
                      <button
                        key={placeholder}
                        type="button"
                        className={cx(s.chip, s.chipButton, s.mono)}
                        onClick={() => void copyPlaceholder(placeholder)}
                      >
                        {placeholder}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className={s.column}>
                <div className={styles.preview}>
                  <div className={styles.previewHead}>
                    <div className={s.columnTight}>
                      <span className={s.label}>{t('admin.settings.emailTemplates.livePreview')}</span>
                      <span className={s.hint}>{previewSubject || t('admin.settings.emailTemplates.noPreview')}</span>
                    </div>
                    {isCustomTemplate ? (
                      <Badge tone="info" size="sm">
                        {t('admin.settings.emailTemplates.customized')}
                      </Badge>
                    ) : null}
                  </div>
                  <div className={styles.previewBody}>
                    <iframe
                      className={styles.previewFrame}
                      sandbox=""
                      srcDoc={previewHtml}
                      title={t('admin.settings.emailTemplates.livePreview')}
                    />
                  </div>
                </div>
                <p className={s.hint}>{t('admin.settings.emailTemplates.previewSecurityHint')}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </SettingsRegion>
  )
}
