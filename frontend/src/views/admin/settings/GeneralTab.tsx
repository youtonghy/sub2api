/** 常规 Tab：站点信息、表格偏好、自定义端点、首页内容与自定义菜单 */
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/arc/button/button'
import { Field, SettingsRegion, ToggleRow } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { cx, numberInputValue } from '@/components/admin/settings/settingsUtils'
import ImageUpload from '@/components/common/ImageUpload'
import { useI18n } from '@/i18n/useI18n'
import { useSettings } from './settingsContext'
import type { CustomEndpoint, CustomMenuItem } from './settingsHelpers'

function SiteSection() {
  const { t } = useI18n()
  const { form, updateForm, draft, updateDraft } = useSettings()
  const endpoints = form.custom_endpoints as CustomEndpoint[]
  const updateEndpoint = (index: number, patch: Partial<CustomEndpoint>) =>
    updateForm({ custom_endpoints: endpoints.map((ep, i) => (i === index ? { ...ep, ...patch } : ep)) })

  return (
    <SettingsRegion title={t('admin.settings.site.title')} description={t('admin.settings.site.description')}>
      <ToggleRow
        label={t('admin.settings.site.backendMode')}
        description={t('admin.settings.site.backendModeDescription')}
        checked={form.backend_mode_enabled}
        onChange={(value) => updateForm({ backend_mode_enabled: value })}
      />
      <div className={s.grid2}>
        <Field label={t('admin.settings.site.siteName')} hint={t('admin.settings.site.siteNameHint')}>
          <input
            type="text"
            className={s.input}
            value={form.site_name}
            placeholder={t('admin.settings.site.siteNamePlaceholder')}
            onChange={(e) => updateForm({ site_name: e.target.value })}
          />
        </Field>
        <Field label={t('admin.settings.site.siteSubtitle')} hint={t('admin.settings.site.siteSubtitleHint')}>
          <input
            type="text"
            className={s.input}
            value={form.site_subtitle}
            placeholder={t('admin.settings.site.siteSubtitlePlaceholder')}
            onChange={(e) => updateForm({ site_subtitle: e.target.value })}
          />
        </Field>
      </div>
      <Field label={t('admin.settings.site.apiBaseUrl')} hint={t('admin.settings.site.apiBaseUrlHint')}>
        <input
          type="text"
          className={cx(s.input, s.mono)}
          value={form.api_base_url}
          placeholder={t('admin.settings.site.apiBaseUrlPlaceholder')}
          onChange={(e) => updateForm({ api_base_url: e.target.value })}
        />
      </Field>

      {/* Global Table Preferences */}
      <div className={s.column}>
        <div className={s.columnTight}>
          <h3 className={s.itemTitle}>{t('admin.settings.site.tablePreferencesTitle')}</h3>
          <p className={s.hint}>{t('admin.settings.site.tablePreferencesDescription')}</p>
        </div>
        <div className={s.grid2}>
          <Field label={t('admin.settings.site.tableDefaultPageSize')} hint={t('admin.settings.site.tableDefaultPageSizeHint')}>
            <input
              type="number"
              min="5"
              max="1000"
              step="1"
              className={s.input}
              value={form.table_default_page_size}
              onChange={(e) => updateForm({ table_default_page_size: numberInputValue(e.target.value) as number })}
            />
          </Field>
          <Field label={t('admin.settings.site.tablePageSizeOptions')} hint={t('admin.settings.site.tablePageSizeOptionsHint')}>
            <input
              type="text"
              className={cx(s.input, s.mono)}
              value={draft.tablePageSizeOptionsInput}
              placeholder={t('admin.settings.site.tablePageSizeOptionsPlaceholder')}
              onChange={(e) => updateDraft({ tablePageSizeOptionsInput: e.target.value })}
            />
          </Field>
        </div>
      </div>

      {/* Custom Endpoints */}
      <Field label={t('admin.settings.site.customEndpoints.title')}>
        <p className={s.hint}>{t('admin.settings.site.customEndpoints.description')}</p>
        <div className={s.columnTight}>
          {endpoints.map((ep, index) => (
            <div key={index} className={s.item}>
              <div className={s.itemHead}>
                <span className={s.itemTitle}>{t('admin.settings.site.customEndpoints.itemLabel', { n: index + 1 })}</span>
                <button
                  type="button"
                  className={cx(s.iconButton, s.iconButtonDanger)}
                  aria-label={t('common.delete')}
                  onClick={() => updateForm({ custom_endpoints: endpoints.filter((_, i) => i !== index) })}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
              <div className={s.grid3}>
                <Field label={t('admin.settings.site.customEndpoints.name')}>
                  <input
                    type="text"
                    className={s.input}
                    value={ep.name}
                    placeholder={t('admin.settings.site.customEndpoints.namePlaceholder')}
                    onChange={(e) => updateEndpoint(index, { name: e.target.value })}
                  />
                </Field>
                <Field label={t('admin.settings.site.customEndpoints.endpointUrl')}>
                  <input
                    type="url"
                    className={s.input}
                    value={ep.endpoint}
                    placeholder={t('admin.settings.site.customEndpoints.endpointUrlPlaceholder')}
                    onChange={(e) => updateEndpoint(index, { endpoint: e.target.value })}
                  />
                </Field>
                <Field label={t('admin.settings.site.customEndpoints.descriptionLabel')}>
                  <input
                    type="text"
                    className={s.input}
                    value={ep.description}
                    placeholder={t('admin.settings.site.customEndpoints.descriptionPlaceholder')}
                    onChange={(e) => updateEndpoint(index, { description: e.target.value })}
                  />
                </Field>
              </div>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => updateForm({ custom_endpoints: [...endpoints, { name: '', endpoint: '', description: '' }] })}
            >
              <Plus size={14} aria-hidden="true" />
              {t('admin.settings.site.customEndpoints.add')}
            </Button>
          </div>
        </div>
      </Field>

      <div className={s.grid2}>
        <Field label={t('admin.settings.site.contactInfo')} hint={t('admin.settings.site.contactInfoHint')}>
          <input
            type="text"
            className={s.input}
            value={form.contact_info}
            placeholder={t('admin.settings.site.contactInfoPlaceholder')}
            onChange={(e) => updateForm({ contact_info: e.target.value })}
          />
        </Field>
        <Field label={t('admin.settings.site.docUrl')} hint={t('admin.settings.site.docUrlHint')}>
          <input
            type="url"
            className={s.input}
            value={form.doc_url}
            placeholder={t('admin.settings.site.docUrlPlaceholder')}
            onChange={(e) => updateForm({ doc_url: e.target.value })}
          />
        </Field>
      </div>

      <Field label={t('admin.settings.site.siteLogo')}>
        <ImageUpload
          value={form.site_logo}
          onChange={(value) => updateForm({ site_logo: value })}
          mode="image"
          uploadLabel={t('admin.settings.site.uploadImage')}
          removeLabel={t('admin.settings.site.remove')}
          hint={t('admin.settings.site.logoHint')}
          maxSize={300 * 1024}
        />
      </Field>

      <Field label={t('admin.settings.site.homeContent')} hint={t('admin.settings.site.homeContentHint')}>
        <textarea
          rows={6}
          className={cx(s.textarea, s.mono)}
          value={form.home_content}
          placeholder={t('admin.settings.site.homeContentPlaceholder')}
          onChange={(e) => updateForm({ home_content: e.target.value })}
        />
        {/* iframe CSP Warning */}
        <p className={s.warningText}>{t('admin.settings.site.homeContentIframeWarning')}</p>
      </Field>

      <ToggleRow
        label={t('admin.settings.site.compactHome')}
        description={t('admin.settings.site.compactHomeHint')}
        checked={form.compact_home_enabled}
        onChange={(value) => updateForm({ compact_home_enabled: value })}
        switchTestId="compact-home-toggle"
      />
      <ToggleRow
        label={t('admin.settings.site.hideCcsImportButton')}
        description={t('admin.settings.site.hideCcsImportButtonHint')}
        checked={form.hide_ccs_import_button}
        onChange={(value) => updateForm({ hide_ccs_import_button: value })}
      />
    </SettingsRegion>
  )
}

function CustomMenuSection() {
  const { t } = useI18n()
  const { form, updateForm } = useSettings()
  const items = form.custom_menu_items as CustomMenuItem[]
  // Re-index sort_order
  const commit = (next: CustomMenuItem[]) => updateForm({ custom_menu_items: next.map((item, i) => ({ ...item, sort_order: i })) })
  const update = (index: number, patch: Partial<CustomMenuItem>) =>
    updateForm({ custom_menu_items: items.map((item, i) => (i === index ? { ...item, ...patch } : item)) })
  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const temp = next[index]!
    next[index] = next[target]!
    next[target] = temp
    commit(next)
  }

  return (
    <SettingsRegion title={t('admin.settings.customMenu.title')} description={t('admin.settings.customMenu.description')}>
      <div className={s.columnTight}>
        {items.map((item, index) => (
          <div key={index} className={s.item}>
            <div className={s.itemHead}>
              <span className={s.itemTitle}>{t('admin.settings.customMenu.itemLabel', { n: index + 1 })}</span>
              <div className={s.inline}>
                {index > 0 ? (
                  <button
                    type="button"
                    className={s.iconButton}
                    title={t('admin.settings.customMenu.moveUp')}
                    aria-label={t('admin.settings.customMenu.moveUp')}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={14} aria-hidden="true" />
                  </button>
                ) : null}
                {index < items.length - 1 ? (
                  <button
                    type="button"
                    className={s.iconButton}
                    title={t('admin.settings.customMenu.moveDown')}
                    aria-label={t('admin.settings.customMenu.moveDown')}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={14} aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  type="button"
                  className={cx(s.iconButton, s.iconButtonDanger)}
                  title={t('admin.settings.customMenu.remove')}
                  aria-label={t('admin.settings.customMenu.remove')}
                  onClick={() => commit(items.filter((_, i) => i !== index))}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className={s.grid2}>
              <Field label={t('admin.settings.customMenu.name')}>
                <input
                  type="text"
                  className={s.input}
                  value={item.label}
                  placeholder={t('admin.settings.customMenu.namePlaceholder')}
                  onChange={(e) => update(index, { label: e.target.value })}
                />
              </Field>
              <Field label={t('admin.settings.customMenu.visibility')}>
                <select
                  className={s.select}
                  value={item.visibility}
                  onChange={(e) => update(index, { visibility: e.target.value as CustomMenuItem['visibility'] })}
                >
                  <option value="user">{t('admin.settings.customMenu.visibilityUser')}</option>
                  <option value="admin">{t('admin.settings.customMenu.visibilityAdmin')}</option>
                </select>
              </Field>
              <Field label={t('admin.settings.customMenu.url')} className={s.full}>
                <input
                  type="url"
                  className={s.input}
                  value={item.url}
                  placeholder={t('admin.settings.customMenu.urlPlaceholder')}
                  onChange={(e) => update(index, { url: e.target.value })}
                />
                <label className={s.checkboxLabel}>
                  <input
                    type="checkbox"
                    data-testid="custom-menu-hide-open-button"
                    checked={Boolean(item.hide_open_button)}
                    onChange={(e) => update(index, { hide_open_button: e.target.checked })}
                  />
                  {t('admin.settings.customMenu.hideOpenButton')}
                </label>
              </Field>
              <Field label={t('admin.settings.customMenu.iconSvg')} className={s.full}>
                <ImageUpload
                  value={item.icon_svg}
                  onChange={(value) => update(index, { icon_svg: value })}
                  mode="svg"
                  size="sm"
                  uploadLabel={t('admin.settings.customMenu.uploadSvg')}
                  removeLabel={t('admin.settings.customMenu.removeSvg')}
                />
              </Field>
            </div>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              updateForm({
                custom_menu_items: [...items, { id: '', label: '', icon_svg: '', url: '', visibility: 'user', sort_order: items.length }]
              })
            }
          >
            <Plus size={14} aria-hidden="true" />
            {t('admin.settings.customMenu.add')}
          </Button>
        </div>
      </div>
    </SettingsRegion>
  )
}

export default function GeneralTab() {
  return (
    <>
      <SiteSection />
      <CustomMenuSection />
    </>
  )
}

