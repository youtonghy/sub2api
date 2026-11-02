/** 登录条款 Tab：开关、展示形式、更新日期与 Markdown 文档列表 */
import { CheckCircle, FileText, Globe, Plus, Settings, Shield, Trash2 } from 'lucide-react'

import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Field, SettingsRegion, ToggleRow } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { cx } from '@/components/admin/settings/settingsUtils'
import type { LoginAgreementDocument } from '@/types'
import { useSettings } from './settingsContext'
import { loginAgreementRoutePath } from './settingsHelpers'

const DOC_ICONS = [FileText, Shield, Globe, Settings]

export default function AgreementTab() {
  const { form, updateForm, localText } = useSettings()
  const documents = form.login_agreement_documents
  const updateDoc = (index: number, patch: Partial<LoginAgreementDocument>) =>
    updateForm({ login_agreement_documents: documents.map((doc, i) => (i === index ? { ...doc, ...patch } : doc)) })

  return (
    <SettingsRegion
      title={localText('登录条款确认', 'Login agreement')}
      description={localText(
        '控制登录页是否要求用户先阅读并同意服务条款、隐私政策或其他 Markdown 文档。',
        'Control whether the login page requires users to accept Markdown policy documents first.'
      )}
    >
      <ToggleRow
        label={localText('登录条款确认', 'Login agreement')}
        description={
          <Badge tone={form.login_agreement_enabled ? 'success' : 'neutral'} size="sm">
            {form.login_agreement_enabled ? localText('已启用', 'Enabled') : localText('未启用', 'Disabled')}
          </Badge>
        }
        checked={form.login_agreement_enabled}
        onChange={(value) => updateForm({ login_agreement_enabled: value })}
      />
      <div className={s.grid2}>
        <Field
          label={localText('展示形式', 'Display mode')}
          hint={
            form.login_agreement_mode === 'checkbox'
              ? localText('复选框会显示在登录按钮下方，未勾选前所有登录入口禁用。', 'The checkbox appears below the login button and gates all login actions.')
              : localText('弹窗会在登录页打开，用户拒绝后所有登录入口保持禁用。', 'The modal opens on the login page and gates all login actions until accepted.')
          }
        >
          <div className={s.choiceGroup}>
            <button
              type="button"
              className={s.choice}
              aria-pressed={form.login_agreement_mode === 'modal'}
              onClick={() => updateForm({ login_agreement_mode: 'modal' })}
            >
              <Shield size={14} aria-hidden="true" />
              {localText('弹窗', 'Modal')}
            </button>
            <button
              type="button"
              className={s.choice}
              aria-pressed={form.login_agreement_mode === 'checkbox'}
              onClick={() => updateForm({ login_agreement_mode: 'checkbox' })}
            >
              <CheckCircle size={14} aria-hidden="true" />
              {localText('复选框', 'Checkbox')}
            </button>
          </div>
        </Field>
        <Field
          label={localText('条款更新日期', 'Updated date')}
          hint={localText('日期或文档内容变化后，用户需要重新同意。', 'Changing the date or content requires fresh consent.')}
        >
          <input
            type="date"
            className={s.input}
            value={form.login_agreement_updated_at}
            onChange={(e) => updateForm({ login_agreement_updated_at: e.target.value })}
          />
        </Field>
      </div>
      <div className={s.column}>
        <div className={s.itemHead}>
          <div className={s.columnTight}>
            <h3 className={s.itemTitle}>{localText('协议文档', 'Agreement documents')}</h3>
            <p className={s.hint}>
              {localText(
                '文档名称可自定义，内容按 Markdown 保存。可参考：服务条款、使用政策、支持的国家和地区、服务特定条款。',
                'Document titles are customizable and content is saved as Markdown.'
              )}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              updateForm({
                login_agreement_documents: [...documents, { id: `custom-${Date.now().toString(36)}`, title: '', content_md: '' }]
              })
            }
          >
            <Plus size={14} aria-hidden="true" />
            {localText('添加文档', 'Add document')}
          </Button>
        </div>
        {documents.map((doc, index) => {
          const Icon = DOC_ICONS[index] ?? FileText
          return (
            <div key={index} className={s.item}>
              <div className={s.itemHead}>
                <div className={s.inline}>
                  <Icon size={16} aria-hidden="true" />
                  <div className={s.columnTight}>
                    <span className={s.itemTitle}>{doc.title || localText('未命名文档', 'Untitled document')}</span>
                    <span className={cx(s.hint, s.mono)}>{loginAgreementRoutePath(doc, index)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className={cx(s.iconButton, s.iconButtonDanger)}
                  aria-label={localText('删除文档', 'Remove document')}
                  disabled={form.login_agreement_enabled && documents.length <= 1}
                  onClick={() => updateForm({ login_agreement_documents: documents.filter((_, i) => i !== index) })}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
              <div className={s.grid2}>
                <Field label={localText('文档名称', 'Document title')}>
                  <input
                    type="text"
                    className={s.input}
                    value={doc.title}
                    placeholder={localText('例如：服务条款', 'Example: Terms of Service')}
                    onChange={(e) => updateDoc(index, { title: e.target.value })}
                  />
                </Field>
                <Field label={localText('路由标识', 'Route slug')}>
                  <div className={s.inline} style={{ flexWrap: 'nowrap' }}>
                    <span className={cx(s.hint, s.mono)}>/legal/</span>
                    <input
                      type="text"
                      className={cx(s.input, s.mono)}
                      value={doc.id}
                      placeholder="usage-policy"
                      onChange={(e) => updateDoc(index, { id: e.target.value })}
                    />
                  </div>
                </Field>
              </div>
              <Field label={localText('Markdown 内容', 'Markdown content')}>
                <textarea
                  rows={8}
                  className={cx(s.textarea, s.mono)}
                  value={doc.content_md}
                  placeholder={localText('在这里填写正式 Markdown 内容。', 'Write the final Markdown content here.')}
                  onChange={(e) => updateDoc(index, { content_md: e.target.value })}
                />
              </Field>
            </div>
          )
        })}
      </div>
    </SettingsRegion>
  )
}
