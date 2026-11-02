/**
 * TLS 指纹模板管理弹窗，对应 Vue 版 TLSFingerprintProfilesModal.vue：
 * 模板列表 + 新建 / 编辑表单（支持粘贴 tls-fingerprint-web 的 YAML 自动填充）+ 删除确认。
 */
import { Check, Lock, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { adminAPI } from '@/api/admin'
import type { TLSFingerprintProfile } from '@/api/admin/tlsFingerprintProfile'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import Input from '@/components/common/Input'
import Skeleton from '@/components/common/Skeleton'
import TextArea from '@/components/common/TextArea'
import Toggle from '@/components/common/Toggle'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import styles from './TLSFingerprintProfilesModal.module.css'

export interface TLSFingerprintProfilesModalProps {
  show: boolean
  onClose?: () => void
}

// Raw string inputs for array fields
interface FieldInputs {
  cipher_suites: string
  curves: string
  point_formats: string
  signature_algorithms: string
  alpn_protocols: string
  supported_versions: string
  key_share_groups: string
  psk_modes: string
  extensions: string
}

interface ProfileForm {
  name: string
  description: string | null
  enable_grease: boolean
}

const emptyFieldInputs = (): FieldInputs => ({
  cipher_suites: '',
  curves: '',
  point_formats: '',
  signature_algorithms: '',
  alpn_protocols: '',
  supported_versions: '',
  key_share_groups: '',
  psk_modes: '',
  extensions: ''
})

const emptyForm = (): ProfileForm => ({ name: '', description: null, enable_grease: false })

const NUMERIC_YAML_KEYS = [
  'cipher_suites',
  'curves',
  'point_formats',
  'signature_algorithms',
  'supported_versions',
  'key_share_groups',
  'psk_modes',
  'extensions'
] as const

/**
 * Parse YAML output from tls-fingerprint-web and fill form fields.
 * Expected format:
 *   # comment lines
 *   profile_key:
 *     name: "Profile Name"
 *     enable_grease: false
 *     cipher_suites: [4866, 4867, ...]
 *     alpn_protocols: ["h2", "http/1.1"]
 *     ...
 */
function parseProfileYaml(text: string): { form: Partial<ProfileForm>; fields: Partial<FieldInputs>; foundName: boolean } {
  const form: Partial<ProfileForm> = {}
  const fields: Partial<FieldInputs> = {}
  let foundName = false

  // Simple YAML parser for flat key-value structure
  // Extracts "key: value" lines, handling arrays like [1, 2, 3] and ["h2", "http/1.1"]
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue

    // Match "key: value" pattern (must have at least 2 leading spaces to be a property)
    const match = trimmed.match(/^(\w+):\s*(.+)$/)
    if (!match) continue

    const [, key, rawValue] = match
    const value = rawValue.trim()

    if (key === 'name') {
      // Remove surrounding quotes
      const unquoted = value.replace(/^["']|["']$/g, '')
      if (unquoted) {
        form.name = unquoted
        foundName = true
      }
    } else if (key === 'enable_grease') {
      form.enable_grease = value === 'true'
    } else if ((NUMERIC_YAML_KEYS as readonly string[]).includes(key)) {
      // Parse YAML array: [1, 2, 3] — values are decimal integers from tls-fingerprint-web
      const arrMatch = value.match(/^\[(.*)?\]$/)
      if (arrMatch) {
        const inner = arrMatch[1] || ''
        fields[key as (typeof NUMERIC_YAML_KEYS)[number]] = inner
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .join(', ')
      }
    } else if (key === 'alpn_protocols') {
      // Parse string array: ["h2", "http/1.1"]
      const arrMatch = value.match(/^\[(.*)?\]$/)
      if (arrMatch) {
        const inner = arrMatch[1] || ''
        fields.alpn_protocols = inner
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter((s) => s.length > 0)
          .join(', ')
      }
    }
  }

  return { form, fields, foundName }
}

// Parse a comma-separated string of numbers supporting both hex (0x...) and decimal
const parseNumericArray = (input: string): number[] => {
  if (!input.trim()) return []
  return input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => (s.startsWith('0x') || s.startsWith('0X') ? parseInt(s, 16) : parseInt(s, 10)))
    .filter((n) => !isNaN(n))
}

// Parse a comma-separated string of string values
const parseStringArray = (input: string): string[] => {
  if (!input.trim()) return []
  return input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// Format a number as hex with 0x prefix and 4-digit padding
const formatHex = (n: number): string => '0x' + n.toString(16).padStart(4, '0')

// Format numeric arrays for display in textarea (null-safe)
const formatNumericArray = (arr: number[] | null | undefined): string => (arr ?? []).map(formatHex).join(', ')

// For point_formats and psk_modes (uint8), show as plain numbers (null-safe)
const formatPlainNumericArray = (arr: number[] | null | undefined): string => (arr ?? []).join(', ')

export default function TLSFingerprintProfilesModal({ show, onClose }: TLSFingerprintProfilesModalProps) {
  const { t } = useI18n()

  const [profiles, setProfiles] = useState<TLSFingerprintProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [editingProfile, setEditingProfile] = useState<TLSFingerprintProfile | null>(null)
  const [deletingProfile, setDeletingProfile] = useState<TLSFingerprintProfile | null>(null)
  const [yamlInput, setYamlInput] = useState('')
  // 粘贴后延迟解析时读取最新输入（Vue 版依赖 v-model 已更新）
  const yamlInputRef = useRef('')
  const [fieldInputs, setFieldInputs] = useState<FieldInputs>(emptyFieldInputs)
  const [form, setForm] = useState<ProfileForm>(emptyForm)

  const updateYamlInput = (value: string) => {
    yamlInputRef.current = value
    setYamlInput(value)
  }
  const updateField = (key: keyof FieldInputs, value: string) =>
    setFieldInputs((prev) => ({ ...prev, [key]: value }))

  const loadProfiles = async () => {
    setLoading(true)
    try {
      setProfiles(await adminAPI.tlsFingerprintProfiles.list())
    } catch (error) {
      useAppStore.getState().showError(t('admin.tlsFingerprintProfiles.loadFailed'))
      console.error('Error loading TLS fingerprint profiles:', error)
    } finally {
      setLoading(false)
    }
  }

  // Load profiles when dialog opens
  useEffect(() => {
    if (!show) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 打开时拉取模板，属于与后端同步的副作用
    void loadProfiles()
  }, [show]) // eslint-disable-line react-hooks/exhaustive-deps

  const resetForm = () => {
    setForm(emptyForm())
    setFieldInputs(emptyFieldInputs())
    updateYamlInput('')
  }

  const parseYamlInput = (raw: string) => {
    const text = raw.trim()
    if (!text) return

    const parsed = parseProfileYaml(text)
    setForm((prev) => ({ ...prev, ...parsed.form }))
    setFieldInputs((prev) => ({ ...prev, ...parsed.fields }))

    if (parsed.foundName) {
      useAppStore.getState().showSuccess(t('admin.tlsFingerprintProfiles.form.yamlParsed'))
    } else {
      useAppStore.getState().showError(t('admin.tlsFingerprintProfiles.form.yamlParseFailed'))
    }
  }

  // Auto-parse on paste event
  const handleYamlPaste = () => {
    // 等受控输入更新后再解析
    setTimeout(() => parseYamlInput(yamlInputRef.current), 50)
  }

  const closeFormModal = () => {
    setShowCreateModal(false)
    setShowEditModal(false)
    setEditingProfile(null)
    resetForm()
  }

  const handleEdit = (profile: TLSFingerprintProfile) => {
    setEditingProfile(profile)
    setForm({ name: profile.name, description: profile.description, enable_grease: profile.enable_grease })
    setFieldInputs({
      cipher_suites: formatNumericArray(profile.cipher_suites),
      curves: formatPlainNumericArray(profile.curves),
      point_formats: formatPlainNumericArray(profile.point_formats),
      signature_algorithms: formatNumericArray(profile.signature_algorithms),
      alpn_protocols: (profile.alpn_protocols ?? []).join(', '),
      supported_versions: formatNumericArray(profile.supported_versions),
      key_share_groups: formatPlainNumericArray(profile.key_share_groups),
      psk_modes: formatPlainNumericArray(profile.psk_modes),
      extensions: formatNumericArray(profile.extensions)
    })
    setShowEditModal(true)
  }

  const handleDelete = (profile: TLSFingerprintProfile) => {
    setDeletingProfile(profile)
    setShowDeleteDialog(true)
  }

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault()
    const appStore = useAppStore.getState()
    if (!form.name.trim()) {
      appStore.showError(t('admin.tlsFingerprintProfiles.form.name') + ' ' + t('common.required'))
      return
    }

    setSubmitting(true)
    try {
      const data = {
        name: form.name.trim(),
        description: form.description?.trim() || null,
        enable_grease: form.enable_grease,
        cipher_suites: parseNumericArray(fieldInputs.cipher_suites),
        curves: parseNumericArray(fieldInputs.curves),
        point_formats: parseNumericArray(fieldInputs.point_formats),
        signature_algorithms: parseNumericArray(fieldInputs.signature_algorithms),
        alpn_protocols: parseStringArray(fieldInputs.alpn_protocols),
        supported_versions: parseNumericArray(fieldInputs.supported_versions),
        key_share_groups: parseNumericArray(fieldInputs.key_share_groups),
        psk_modes: parseNumericArray(fieldInputs.psk_modes),
        extensions: parseNumericArray(fieldInputs.extensions)
      }

      if (showEditModal && editingProfile) {
        await adminAPI.tlsFingerprintProfiles.update(editingProfile.id, data)
        appStore.showSuccess(t('admin.tlsFingerprintProfiles.updateSuccess'))
      } else {
        await adminAPI.tlsFingerprintProfiles.create(data)
        appStore.showSuccess(t('admin.tlsFingerprintProfiles.createSuccess'))
      }

      closeFormModal()
      void loadProfiles()
    } catch (error: any) {
      appStore.showError(error.response?.data?.detail || t('admin.tlsFingerprintProfiles.saveFailed'))
      console.error('Error saving TLS fingerprint profile:', error)
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async () => {
    if (!deletingProfile) return

    try {
      await adminAPI.tlsFingerprintProfiles.delete(deletingProfile.id)
      useAppStore.getState().showSuccess(t('admin.tlsFingerprintProfiles.deleteSuccess'))
      setShowDeleteDialog(false)
      setDeletingProfile(null)
      void loadProfiles()
    } catch (error: any) {
      useAppStore.getState().showError(
        error.response?.data?.detail || t('admin.tlsFingerprintProfiles.deleteFailed')
      )
      console.error('Error deleting TLS fingerprint profile:', error)
    }
  }

  const arrayFields: Array<{ key: keyof FieldInputs; label: string; placeholder: string; hint?: string }> = [
    {
      key: 'cipher_suites',
      label: t('admin.tlsFingerprintProfiles.form.cipherSuites'),
      placeholder: '0x1301, 0x1302, 0xc02c',
      hint: t('admin.tlsFingerprintProfiles.form.cipherSuitesHint')
    },
    {
      key: 'curves',
      label: t('admin.tlsFingerprintProfiles.form.curves'),
      placeholder: '29, 23, 24',
      hint: t('admin.tlsFingerprintProfiles.form.curvesHint')
    },
    {
      key: 'signature_algorithms',
      label: t('admin.tlsFingerprintProfiles.form.signatureAlgorithms'),
      placeholder: '0x0403, 0x0804, 0x0401'
    },
    { key: 'supported_versions', label: t('admin.tlsFingerprintProfiles.form.supportedVersions'), placeholder: '0x0304, 0x0303' },
    { key: 'key_share_groups', label: t('admin.tlsFingerprintProfiles.form.keyShareGroups'), placeholder: '29, 23' },
    { key: 'extensions', label: t('admin.tlsFingerprintProfiles.form.extensions'), placeholder: '0x0000, 0x0005, 0x000a' },
    { key: 'point_formats', label: t('admin.tlsFingerprintProfiles.form.pointFormats'), placeholder: '0' },
    { key: 'psk_modes', label: t('admin.tlsFingerprintProfiles.form.pskModes'), placeholder: '1' }
  ]

  let content
  if (loading) {
    content = (
      <div className={styles.loading} aria-busy="true">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} height={40} />
        ))}
      </div>
    )
  } else if (profiles.length === 0) {
    content = (
      <EmptyState
        icon={<ShieldCheck />}
        title={t('admin.tlsFingerprintProfiles.noProfiles')}
        description={t('admin.tlsFingerprintProfiles.createFirstProfile')}
      />
    )
  } else {
    content = (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('admin.tlsFingerprintProfiles.columns.name')}</th>
              <th>{t('admin.tlsFingerprintProfiles.columns.description')}</th>
              <th>{t('admin.tlsFingerprintProfiles.columns.grease')}</th>
              <th>{t('admin.tlsFingerprintProfiles.columns.alpn')}</th>
              <th>{t('admin.tlsFingerprintProfiles.columns.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => (
              <tr key={profile.id}>
                <td>
                  <div className={styles.name}>{profile.name}</div>
                </td>
                <td>
                  {profile.description ? (
                    <div className={styles.descriptionCell}>{profile.description}</div>
                  ) : (
                    <div className={styles.dash}>—</div>
                  )}
                </td>
                <td>
                  {profile.enable_grease ? (
                    <Check className={`${styles.cellIcon} ${styles.on}`} aria-label={t('common.yes')} />
                  ) : (
                    <Lock className={`${styles.cellIcon} ${styles.off}`} aria-label={t('common.no')} />
                  )}
                </td>
                <td>
                  {profile.alpn_protocols?.length ? (
                    <div className={styles.chips}>
                      {profile.alpn_protocols.slice(0, 3).map((proto) => (
                        <Badge key={proto} size="sm" tone="info">
                          {proto}
                        </Badge>
                      ))}
                      {profile.alpn_protocols.length > 3 ? (
                        <span className={styles.more}>+{profile.alpn_protocols.length - 3}</span>
                      ) : null}
                    </div>
                  ) : (
                    <div className={styles.dash}>—</div>
                  )}
                </td>
                <td>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => handleEdit(profile)}
                      title={t('common.edit')}
                      aria-label={t('common.edit')}
                    >
                      <Pencil aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={`${styles.iconButton} ${styles.danger}`}
                      onClick={() => handleDelete(profile)}
                      title={t('common.delete')}
                      aria-label={t('common.delete')}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <>
      <BaseDialog
        show={show}
        title={t('admin.tlsFingerprintProfiles.title')}
        width="wide"
        onClose={() => onClose?.()}
        footer={
          <Button variant="secondary" type="button" onClick={() => onClose?.()}>
            {t('common.close')}
          </Button>
        }
      >
        <div className={styles.stack}>
          {/* Header */}
          <div className={styles.header}>
            <p className={styles.description}>{t('admin.tlsFingerprintProfiles.description')}</p>
            <Button type="button" size="sm" onClick={() => setShowCreateModal(true)}>
              <Plus aria-hidden="true" />
              {t('admin.tlsFingerprintProfiles.createProfile')}
            </Button>
          </div>
          {content}
        </div>
      </BaseDialog>

      {/* Create/Edit Modal */}
      <BaseDialog
        show={showCreateModal || showEditModal}
        title={
          showEditModal ? t('admin.tlsFingerprintProfiles.editProfile') : t('admin.tlsFingerprintProfiles.createProfile')
        }
        width="wide"
        zIndex={60}
        onClose={closeFormModal}
        footer={
          <>
            <Button variant="secondary" type="button" onClick={closeFormModal}>
              {t('common.cancel')}
            </Button>
            <Button type="button" loading={submitting} onClick={() => void handleSubmit()}>
              {showEditModal ? t('common.update') : t('common.create')}
            </Button>
          </>
        }
      >
        <form className={styles.form} onSubmit={handleSubmit}>
          {/* Paste YAML */}
          <div className={styles.field}>
            <TextArea
              label={t('admin.tlsFingerprintProfiles.form.pasteYaml')}
              value={yamlInput}
              onChange={updateYamlInput}
              rows={4}
              className={styles.mono}
              placeholder={t('admin.tlsFingerprintProfiles.form.pasteYamlPlaceholder')}
              onPaste={handleYamlPaste}
            />
            <div className={styles.yamlActions}>
              <Button type="button" variant="secondary" size="sm" onClick={() => parseYamlInput(yamlInput)}>
                {t('admin.tlsFingerprintProfiles.form.parseYaml')}
              </Button>
              <p className={styles.hint}>
                {t('admin.tlsFingerprintProfiles.form.pasteYamlHint')}{' '}
                <a href="https://tls.sub2api.org" target="_blank" rel="noopener noreferrer" className={styles.link}>
                  {t('admin.tlsFingerprintProfiles.form.openCollector')}
                </a>
              </p>
            </div>
          </div>

          <hr className={styles.divider} />

          {/* Basic Info */}
          <div className={styles.pair}>
            <Input
              label={t('admin.tlsFingerprintProfiles.form.name')}
              value={form.name}
              onChange={(value) => setForm((prev) => ({ ...prev, name: value }))}
              required
              placeholder={t('admin.tlsFingerprintProfiles.form.namePlaceholder')}
            />
            <Input
              label={t('admin.tlsFingerprintProfiles.form.description')}
              value={form.description}
              onChange={(value) => setForm((prev) => ({ ...prev, description: value }))}
              placeholder={t('admin.tlsFingerprintProfiles.form.descriptionPlaceholder')}
            />
          </div>

          {/* GREASE Toggle */}
          <div className={styles.toggleRow}>
            <div>
              <span className={styles.toggleLabel}>{t('admin.tlsFingerprintProfiles.form.enableGrease')}</span>
              <p className={styles.hint}>{t('admin.tlsFingerprintProfiles.form.enableGreaseHint')}</p>
            </div>
            <Toggle
              value={form.enable_grease}
              onChange={(value) => setForm((prev) => ({ ...prev, enable_grease: value }))}
              aria-label={t('admin.tlsFingerprintProfiles.form.enableGrease')}
            />
          </div>

          {/* TLS Array Fields - 2 column grid */}
          <div className={styles.pair}>
            {arrayFields.map((field) => (
              <TextArea
                key={field.key}
                label={field.label}
                value={fieldInputs[field.key]}
                onChange={(value) => updateField(field.key, value)}
                rows={2}
                className={styles.mono}
                placeholder={field.placeholder}
                hint={field.hint}
              />
            ))}
          </div>

          {/* ALPN Protocols - full width */}
          <TextArea
            label={t('admin.tlsFingerprintProfiles.form.alpnProtocols')}
            value={fieldInputs.alpn_protocols}
            onChange={(value) => updateField('alpn_protocols', value)}
            rows={2}
            className={styles.mono}
            placeholder="h2, http/1.1"
          />
        </form>
      </BaseDialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        show={showDeleteDialog}
        title={t('admin.tlsFingerprintProfiles.deleteProfile')}
        message={t('admin.tlsFingerprintProfiles.deleteConfirmMessage', { name: deletingProfile?.name })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setShowDeleteDialog(false)}
      />
    </>
  )
}
