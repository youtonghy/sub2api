/**
 * 用户属性配置弹窗，对应 Vue 版 UserAttributesConfigModal.vue：
 * 打开时加载全部属性定义，可新增、编辑（独立表单弹窗）与删除（确认框）。
 */
import { GripVertical, Pencil, Plus, Tag, Trash2, X } from 'lucide-react'
import { useEffect, useEffectEvent, useState, type FormEvent } from 'react'

import { adminAPI } from '@/api/admin'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import EmptyState from '@/components/common/EmptyState'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'
import Skeleton from '@/components/common/Skeleton'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { UserAttributeDefinition, UserAttributeOption, UserAttributeType } from '@/types'
import styles from './UserAttributesConfigModal.module.css'

export interface UserAttributesConfigModalProps {
  show: boolean
  onClose?: () => void
}

const attributeTypes: UserAttributeType[] = ['text', 'textarea', 'number', 'email', 'url', 'date', 'select', 'multi_select']

interface AttributeForm {
  key: string
  name: string
  type: UserAttributeType
  description: string
  placeholder: string
  required: boolean
  enabled: boolean
  options: UserAttributeOption[]
  /** 与 options 一一对应的稳定 key（Vue 版用 createStableObjectKeyResolver 按对象身份生成） */
  optionKeys: string[]
}

let optionKeySeed = 0
const nextOptionKey = () => `user-attr-option-${++optionKeySeed}`

const emptyForm = (): AttributeForm => ({
  key: '',
  name: '',
  type: 'text',
  description: '',
  placeholder: '',
  required: false,
  enabled: true,
  options: [],
  optionKeys: []
})

export default function UserAttributesConfigModal({ show, onClose }: UserAttributesConfigModalProps) {
  const { t } = useI18n()

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [attributes, setAttributes] = useState<UserAttributeDefinition[]>([])
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [editingAttribute, setEditingAttribute] = useState<UserAttributeDefinition | null>(null)
  const [deletingAttribute, setDeletingAttribute] = useState<UserAttributeDefinition | null>(null)
  const [form, setForm] = useState<AttributeForm>(emptyForm)

  const patchForm = (patch: Partial<AttributeForm>) => setForm((prev) => ({ ...prev, ...patch }))

  const loadAttributes = async () => {
    setLoading(true)
    try {
      setAttributes(await adminAPI.userAttributes.listDefinitions())
    } catch (error: any) {
      useAppStore.getState().showError(error.response?.data?.detail || t('admin.users.attributes.failedToLoad'))
    } finally {
      setLoading(false)
    }
  }

  const onShow = useEffectEvent(() => {
    void loadAttributes()
  })
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 对应 Vue 版 watch(show)：打开时加载
    if (show) onShow()
  }, [show])

  const openCreateModal = () => {
    setEditingAttribute(null)
    setForm(emptyForm())
    setShowEditModal(true)
  }

  const openEditModal = (attr: UserAttributeDefinition) => {
    setEditingAttribute(attr)
    setForm({
      key: attr.key,
      name: attr.name,
      type: attr.type,
      description: attr.description || '',
      placeholder: attr.placeholder || '',
      required: attr.required,
      enabled: attr.enabled,
      options: attr.options ? attr.options.map((opt) => ({ ...opt })) : [],
      optionKeys: (attr.options ?? []).map(nextOptionKey)
    })
    setShowEditModal(true)
  }

  const closeEditModal = () => {
    setShowEditModal(false)
    setEditingAttribute(null)
  }

  const addOption = () =>
    setForm((prev) => ({
      ...prev,
      options: [...prev.options, { value: '', label: '' }],
      optionKeys: [...prev.optionKeys, nextOptionKey()]
    }))

  const removeOption = (index: number) =>
    setForm((prev) => ({
      ...prev,
      options: prev.options.filter((_, i) => i !== index),
      optionKeys: prev.optionKeys.filter((_, i) => i !== index)
    }))

  const updateOption = (index: number, patch: Partial<UserAttributeOption>) =>
    setForm((prev) => ({
      ...prev,
      options: prev.options.map((option, i) => (i === index ? { ...option, ...patch } : option))
    }))

  const isSelectType = form.type === 'select' || form.type === 'multi_select'

  const handleSave = async (event?: FormEvent) => {
    event?.preventDefault()
    const appStore = useAppStore.getState()
    if (!form.key.trim()) {
      appStore.showError(t('admin.users.attributes.keyRequired'))
      return
    }
    if (!form.name.trim()) {
      appStore.showError(t('admin.users.attributes.nameRequired'))
      return
    }
    if (isSelectType && form.options.length === 0) {
      appStore.showError(t('admin.users.attributes.optionsRequired'))
      return
    }
    setSaving(true)
    try {
      const data = {
        key: form.key,
        name: form.name,
        type: form.type,
        description: form.description,
        placeholder: form.placeholder,
        required: form.required,
        enabled: form.enabled,
        options: isSelectType ? form.options : undefined
      }

      if (editingAttribute) {
        await adminAPI.userAttributes.updateDefinition(editingAttribute.id, data)
        appStore.showSuccess(t('admin.users.attributes.updated'))
      } else {
        await adminAPI.userAttributes.createDefinition(data)
        appStore.showSuccess(t('admin.users.attributes.created'))
      }

      closeEditModal()
      void loadAttributes()
    } catch (error: any) {
      const msg = editingAttribute ? t('admin.users.attributes.failedToUpdate') : t('admin.users.attributes.failedToCreate')
      appStore.showError(error.response?.data?.detail || msg)
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = (attr: UserAttributeDefinition) => {
    setDeletingAttribute(attr)
    setShowDeleteDialog(true)
  }

  const handleDelete = async () => {
    if (!deletingAttribute) return
    const appStore = useAppStore.getState()
    try {
      await adminAPI.userAttributes.deleteDefinition(deletingAttribute.id)
      appStore.showSuccess(t('admin.users.attributes.deleted'))
      setShowDeleteDialog(false)
      setDeletingAttribute(null)
      void loadAttributes()
    } catch (error: any) {
      appStore.showError(error.response?.data?.detail || t('admin.users.attributes.failedToDelete'))
    }
  }

  const typeOptions = attributeTypes.map((type) => ({ value: type, label: t(`admin.users.attributes.types.${type}`) }))

  return (
    <>
      <BaseDialog
        show={show}
        title={t('admin.users.attributes.title')}
        width="wide"
        onClose={() => onClose?.()}
        footer={
          <Button type="button" variant="secondary" onClick={() => onClose?.()}>
            {t('common.close')}
          </Button>
        }
      >
        <div className={styles.content}>
          {/* Header with Add Button */}
          <div className={styles.header}>
            <p className={styles.description}>{t('admin.users.attributes.description')}</p>
            <Button type="button" variant="primary" size="sm" onClick={openCreateModal}>
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              {t('admin.users.attributes.addAttribute')}
            </Button>
          </div>

          {loading ? (
            // Loading State
            <div className={styles.loading} aria-busy="true" data-testid="user-attributes-loading">
              <Skeleton height={52} />
              <Skeleton height={52} />
              <Skeleton height={52} />
            </div>
          ) : attributes.length === 0 ? (
            // Empty State
            <EmptyState icon={Tag} title={t('admin.users.attributes.noAttributes')} description={t('admin.users.attributes.noAttributesHint')} />
          ) : (
            // Attributes List
            <ul className={styles.list}>
              {attributes.map((attr) => (
                <li key={attr.id} className={styles.item}>
                  {/* Drag Handle */}
                  <span className={styles.handle} title={t('admin.users.attributes.dragToReorder')}>
                    <GripVertical size={18} strokeWidth={1.75} aria-hidden="true" />
                  </span>

                  {/* Attribute Info */}
                  <div className={styles.info}>
                    <div className={styles.titleRow}>
                      <span className={styles.name}>{attr.name}</span>
                      <code className={styles.key}>{attr.key}</code>
                      {attr.required && (
                        <Badge size="sm" tone="danger">
                          {t('admin.users.attributes.required')}
                        </Badge>
                      )}
                      {!attr.enabled && (
                        <Badge size="sm" tone="neutral">
                          {t('common.disabled')}
                        </Badge>
                      )}
                    </div>
                    <div className={styles.metaRow}>
                      <Badge size="sm" tone="neutral">
                        {t(`admin.users.attributes.types.${attr.type}`)}
                      </Badge>
                      {attr.description && <span className={styles.truncate}>{attr.description}</span>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      title={t('common.edit')}
                      aria-label={t('common.edit')}
                      onClick={() => openEditModal(attr)}
                    >
                      <Pencil size={16} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      data-tone="danger"
                      title={t('common.delete')}
                      aria-label={t('common.delete')}
                      onClick={() => confirmDelete(attr)}
                    >
                      <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </BaseDialog>

      {/* Create/Edit Attribute Modal */}
      <BaseDialog
        show={showEditModal}
        title={editingAttribute ? t('admin.users.attributes.editAttribute') : t('admin.users.attributes.addAttribute')}
        width="normal"
        onClose={closeEditModal}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeEditModal}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="attribute-form" variant="primary" disabled={saving} loading={saving}>
              {saving ? t('common.saving') : editingAttribute ? t('common.update') : t('common.create')}
            </Button>
          </>
        }
      >
        <form id="attribute-form" className={styles.form} onSubmit={(event) => void handleSave(event)}>
          {/* Key */}
          <Input
            label={t('admin.users.attributes.key')}
            value={form.key}
            onChange={(key) => patchForm({ key })}
            required
            pattern="^[a-zA-Z][a-zA-Z0-9_]*$"
            className={styles.monoInput}
            placeholder={t('admin.users.attributes.keyHint')}
            hint={t('admin.users.attributes.keyHint')}
            disabled={!!editingAttribute}
          />

          {/* Name */}
          <Input
            label={t('admin.users.attributes.name')}
            value={form.name}
            onChange={(name) => patchForm({ name })}
            required
            placeholder={t('admin.users.attributes.nameHint')}
          />

          {/* Type */}
          <div className={styles.field}>
            <span className={styles.label}>{t('admin.users.attributes.type')}</span>
            <Select
              value={form.type}
              options={typeOptions}
              aria-label={t('admin.users.attributes.type')}
              onChange={(type) => patchForm({ type: type as UserAttributeType })}
            />
          </div>

          {/* Options (for select/multi_select) */}
          {isSelectType && (
            <div className={styles.field}>
              <span className={styles.label}>{t('admin.users.attributes.options')}</span>
              {form.options.map((option, index) => (
                <div key={form.optionKeys[index]} className={styles.optionRow}>
                  <Input
                    value={option.value}
                    onChange={(value) => updateOption(index, { value })}
                    className={styles.monoInput}
                    placeholder={t('admin.users.attributes.optionValue')}
                    aria-label={t('admin.users.attributes.optionValue')}
                    required
                  />
                  <Input
                    value={option.label}
                    onChange={(label) => updateOption(index, { label })}
                    placeholder={t('admin.users.attributes.optionLabel')}
                    aria-label={t('admin.users.attributes.optionLabel')}
                    required
                  />
                  <button
                    type="button"
                    className={styles.iconButton}
                    data-tone="danger"
                    aria-label={t('common.delete')}
                    onClick={() => removeOption(index)}
                  >
                    <X size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <div>
                <Button type="button" variant="secondary" size="sm" onClick={addOption}>
                  <Plus size={16} strokeWidth={2} aria-hidden="true" />
                  {t('admin.users.attributes.addOption')}
                </Button>
              </div>
            </div>
          )}

          {/* Description */}
          <Input
            label={t('admin.users.attributes.fieldDescription')}
            value={form.description}
            onChange={(description) => patchForm({ description })}
            placeholder={t('admin.users.attributes.fieldDescriptionHint')}
          />

          {/* Placeholder */}
          <Input
            label={t('admin.users.attributes.placeholder')}
            value={form.placeholder}
            onChange={(placeholder) => patchForm({ placeholder })}
            placeholder={t('admin.users.attributes.placeholderHint')}
          />

          {/* Required & Enabled */}
          <div className={styles.checks}>
            <Checkbox
              checked={form.required}
              onCheckedChange={(checked) => patchForm({ required: checked === true })}
              label={t('admin.users.attributes.required')}
            />
            <Checkbox
              checked={form.enabled}
              onCheckedChange={(checked) => patchForm({ enabled: checked === true })}
              label={t('admin.users.attributes.enabled')}
            />
          </div>
        </form>
      </BaseDialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        show={showDeleteDialog}
        title={t('admin.users.attributes.deleteAttribute')}
        message={t('admin.users.attributes.deleteConfirm', { name: deletingAttribute?.name })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setShowDeleteDialog(false)}
      />
    </>
  )
}
