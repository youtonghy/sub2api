/**
 * 批量编辑 API 密钥，对应 Vue 版 BulkEditKeysModal.vue。
 * - 每个字段需显式勾选才会提交，未勾选的字段保持原值
 * - 部分失败时只保留失败的密钥，可直接重试；提交中禁止关闭与重复提交
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { keysAPI } from '@/api'
import BaseDialog from '@/components/common/BaseDialog'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'
import TextArea from '@/components/common/TextArea'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { ApiKey, Group, UpdateApiKeyRequest } from '@/types'
import styles from './BulkEditKeysModal.module.css'

type SelectedKey = Pick<ApiKey, 'id' | 'name'>
type LimitField = 'quota' | 'rate_limit_5h' | 'rate_limit_1d' | 'rate_limit_7d'
type IPField = 'ip_whitelist' | 'ip_blacklist'
type EditableField = LimitField | IPField | 'group_id' | 'status' | 'expires_at'

export interface BulkEditKeysModalProps {
  show: boolean
  selectedKeys: SelectedKey[]
  groups: Group[]
  onClose?: () => void
  onUpdated?: (succeededIds: number[]) => void
}

const emptyEnabled = (): Record<EditableField, boolean> => ({
  group_id: false,
  status: false,
  quota: false,
  rate_limit_5h: false,
  rate_limit_1d: false,
  rate_limit_7d: false,
  expires_at: false,
  ip_whitelist: false,
  ip_blacklist: false
})
const emptyLimits = (): Record<LimitField, string> => ({
  quota: '', rate_limit_5h: '', rate_limit_1d: '', rate_limit_7d: ''
})
const emptyIpLists = (): Record<IPField, string> => ({ ip_whitelist: '', ip_blacklist: '' })

const limitFields: Array<{ key: LimitField; label: string }> = [
  { key: 'quota', label: 'keys.quotaAmount' },
  { key: 'rate_limit_5h', label: 'keys.rateLimit5h' },
  { key: 'rate_limit_1d', label: 'keys.rateLimit1d' },
  { key: 'rate_limit_7d', label: 'keys.rateLimit7d' }
]
const ipFields: Array<{ key: IPField; label: string }> = [
  { key: 'ip_whitelist', label: 'keys.ipWhitelist' },
  { key: 'ip_blacklist', label: 'keys.ipBlacklist' }
]

export default function BulkEditKeysModal({ show, selectedKeys, groups, onClose, onUpdated }: BulkEditKeysModalProps) {
  const { t } = useI18n()
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [pendingKeys, setPendingKeys] = useState<SelectedKey[]>([])
  const [failures, setFailures] = useState<Array<{ id: number; name: string; message: string }>>([])
  const [enabled, setEnabled] = useState(emptyEnabled)
  const [groupId, setGroupId] = useState<number | null>(null)
  const [status, setStatus] = useState<'active' | 'inactive'>('active')
  const [limits, setLimits] = useState(emptyLimits)
  const [ipLists, setIpLists] = useState(emptyIpLists)
  const [neverExpires, setNeverExpires] = useState(false)
  const [expirationDate, setExpirationDate] = useState('')

  const groupOptions = groups.map((group) => ({ value: group.id, label: group.name }))
  const statusOptions = [
    { value: 'active', label: t('keys.enable') },
    { value: 'inactive', label: t('keys.disable') }
  ]

  const validationError = (() => {
    if (enabled.group_id && !groups.some((group) => group.id === groupId)) {
      return t('keys.groupRequired')
    }
    for (const { key } of limitFields) {
      if (!enabled[key]) continue
      const value = String(limits[key]).trim()
      if (!value || !Number.isFinite(Number(value)) || Number(value) < 0) {
        return t('keys.bulkEdit.invalidLimit')
      }
    }
    if (enabled.expires_at && !neverExpires && !Number.isFinite(Date.parse(expirationDate))) {
      return t('keys.bulkEdit.invalidExpiration')
    }
    return ''
  })()
  const canSubmit = pendingKeys.length > 0 && Object.values(enabled).some(Boolean) &&
    !validationError && !submitting

  // 对应 Vue 版 watch(show, { immediate: true })：每次打开时按新的选择重置所有字段
  useEffect(() => {
    if (!show) return
    /* eslint-disable react-hooks/set-state-in-effect -- 对应 Vue 版 watch(show)：打开时重置 */
    setPendingKeys(selectedKeys.map(({ id, name }) => ({ id, name })))
    setFailures([])
    setEnabled(emptyEnabled())
    setLimits(emptyLimits())
    setIpLists(emptyIpLists())
    setGroupId(null)
    setStatus('active')
    setNeverExpires(false)
    setExpirationDate('')
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 与 Vue 版一致，只在打开时读取选择
  }, [show])

  const toggle = (field: EditableField, value: boolean) => setEnabled((current) => ({ ...current, [field]: value }))

  const close = () => {
    if (!submittingRef.current) onClose?.()
  }

  const errorMessage = (error: unknown): string => {
    const message = (error as { message?: unknown } | null)?.message
    return typeof message === 'string' && message ? message : t('keys.failedToSave')
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSubmit || submittingRef.current) return
    const updates: UpdateApiKeyRequest = {}
    if (enabled.group_id) updates.group_id = groupId
    if (enabled.status) updates.status = status
    for (const { key } of limitFields) {
      if (enabled[key]) updates[key] = Number(limits[key])
    }
    for (const { key } of ipFields) {
      if (enabled[key]) updates[key] = ipLists[key].split('\n').map((ip) => ip.trim()).filter(Boolean)
    }
    if (enabled.expires_at) {
      updates.expires_at = neverExpires ? '' : new Date(expirationDate).toISOString()
    }

    const targets = pendingKeys
    submittingRef.current = true
    setSubmitting(true)
    const appStore = useAppStore.getState()
    try {
      const result = await keysAPI.bulkUpdate(targets.map((key) => key.id), updates)
      setFailures(result.failures.map(({ id, error }) => ({
        id,
        name: targets.find((key) => key.id === id)?.name ?? '',
        message: errorMessage(error)
      })))
      const failedIds = new Set(result.failures.map(({ id }) => id))
      setPendingKeys(targets.filter((key) => failedIds.has(key.id)))
      if (result.succeededIds.length) onUpdated?.(result.succeededIds)
      if (result.failures.length) {
        appStore.showError(t('keys.bulkEdit.partialFailure', {
          success: result.succeededIds.length, failed: result.failures.length
        }))
      } else {
        appStore.showSuccess(t('keys.bulkEdit.success', { count: result.succeededIds.length }))
        onClose?.()
      }
    } catch (error) {
      appStore.showError(errorMessage(error))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <BaseDialog
      show={show}
      title={t('keys.bulkEdit.title')}
      width="normal"
      closeOnEscape={!submitting}
      showCloseButton={!submitting}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={submitting} onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="bulk-edit-keys-form" disabled={!canSubmit} data-test="submit">
            {submitting ? t('keys.saving') : t('keys.bulkEdit.apply', { count: pendingKeys.length })}
          </Button>
        </>
      }
    >
      <form id="bulk-edit-keys-form" className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <div className={styles.summary}>
          <p className={styles.summaryTitle}>{t('keys.bulkEdit.selectedCount', { count: pendingKeys.length })}</p>
          <p className={styles.summaryHint}>{t('keys.bulkEdit.hint')}</p>
        </div>

        <fieldset disabled={submitting} className={styles.fields}>
          <div className={styles.field}>
            <Checkbox
              checked={enabled.group_id}
              onCheckedChange={(value) => toggle('group_id', value === true)}
              label={t('keys.groupLabel')}
              data-test="enable-group"
            />
            {enabled.group_id && (
              <Select
                value={groupId}
                onChange={(value) => setGroupId(value as number | null)}
                options={groupOptions}
                placeholder={t('keys.selectGroup')}
                disabled={submitting}
                aria-label={t('keys.groupLabel')}
                searchable
                data-test="group-input"
              />
            )}
          </div>

          <div className={styles.field}>
            <Checkbox
              checked={enabled.status}
              onCheckedChange={(value) => toggle('status', value === true)}
              label={t('keys.statusLabel')}
              data-test="enable-status"
            />
            {enabled.status && (
              <Select
                value={status}
                onChange={(value) => setStatus(value as 'active' | 'inactive')}
                options={statusOptions}
                disabled={submitting}
                aria-label={t('keys.statusLabel')}
                data-test="status-input"
              />
            )}
          </div>

          {limitFields.map((field) => (
            <div key={field.key} className={styles.field}>
              <Checkbox
                checked={enabled[field.key]}
                onCheckedChange={(value) => toggle(field.key, value === true)}
                label={t(field.label)}
                data-test={`enable-${field.key}`}
              />
              {enabled[field.key] && (
                <Input
                  value={limits[field.key]}
                  onChange={(value) => setLimits((current) => ({ ...current, [field.key]: value }))}
                  type="number"
                  min="0"
                  step="any"
                  required
                  aria-label={t(field.label)}
                  data-test={`${field.key}-input`}
                  hint={t('keys.bulkEdit.limitHint')}
                />
              )}
            </div>
          ))}

          <div className={styles.field}>
            <Checkbox
              checked={enabled.expires_at}
              onCheckedChange={(value) => toggle('expires_at', value === true)}
              label={t('keys.expiration')}
              data-test="enable-expiration"
            />
            {enabled.expires_at && (
              <div className={styles.field}>
                <Checkbox
                  checked={neverExpires}
                  onCheckedChange={(value) => setNeverExpires(value === true)}
                  label={t('keys.noExpiration')}
                  data-test="never-expires"
                />
                {!neverExpires && (
                  <Input
                    value={expirationDate}
                    onChange={setExpirationDate}
                    type="datetime-local"
                    required
                    aria-label={t('keys.expirationDate')}
                    data-test="expiration-input"
                  />
                )}
              </div>
            )}
          </div>

          {ipFields.map((field) => (
            <div key={field.key} className={styles.field}>
              <Checkbox
                checked={enabled[field.key]}
                onCheckedChange={(value) => toggle(field.key, value === true)}
                label={t(field.label)}
                data-test={`enable-${field.key}`}
              />
              {enabled[field.key] && (
                <TextArea
                  value={ipLists[field.key]}
                  onChange={(value) => setIpLists((current) => ({ ...current, [field.key]: value }))}
                  rows={3}
                  className={styles.mono}
                  aria-label={t(field.label)}
                  data-test={`${field.key}-input`}
                  hint={t('keys.bulkEdit.ipHint')}
                />
              )}
            </div>
          ))}
        </fieldset>

        {validationError && (
          <p role="alert" className={styles.error}>{validationError}</p>
        )}
        {failures.length > 0 && (
          <div role="alert" className={styles.failures}>
            <p>{t('keys.bulkEdit.failureHint')}</p>
            <ul className={styles.failureList}>
              {failures.map((failure) => (
                <li key={failure.id}>#{failure.id} {failure.name}: {failure.message}</li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </BaseDialog>
  )
}
