/**
 * 注册邮箱精确黑名单（对应 Vue 版 RegistrationEmailBlacklistEditor.vue）。
 * 名单在独立弹窗中编辑与保存，不依赖设置页底部的保存按钮；保存后对新增项核查已注册用户并可分批禁用。
 */
import { useMemo, useState } from 'react'
import { Plus, Search, X } from 'lucide-react'

import { adminAPI } from '@/api'
import type { BlacklistedEmailUser } from '@/api/admin/users'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Textarea } from '@/components/arc/textarea/textarea'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores'
import { extractApiErrorMessage } from '@/utils/apiError'
import { mergeIntoBlacklist, parseBlacklistInput } from '@/utils/registrationEmailBlacklist'
import { cx } from './settingsUtils'
import s from './SettingsLayout.module.css'
import styles from './RegistrationEmailBlacklistEditor.module.css'

const VISIBLE_LIMIT = 200
const INVALID_SAMPLE_LIMIT = 10
const DISABLE_BATCH_SIZE = 1000
const KEY = 'admin.settings.registration.emailBlacklist'

interface AddResult {
  added: number
  duplicates: number
  invalid: string[]
}

export default function RegistrationEmailBlacklistEditor() {
  const { t, locale } = useI18n()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [savedEmails, setSavedEmails] = useState<string[]>([])
  const [maxEntries, setMaxEntries] = useState(20000)

  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState<string[]>([])
  const [bulkInput, setBulkInput] = useState('')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)
  const [addResult, setAddResult] = useState<AddResult | null>(null)

  const [checking, setChecking] = useState(false)
  const [disableDialogOpen, setDisableDialogOpen] = useState(false)
  const [disabling, setDisabling] = useState(false)
  const [matchedUsers, setMatchedUsers] = useState<BlacklistedEmailUser[]>([])

  const savedSet = useMemo(() => new Set(savedEmails), [savedEmails])
  const pendingAdded = useMemo(() => draft.filter((email) => !savedSet.has(email)).length, [draft, savedSet])
  const pendingRemoved = useMemo(() => {
    const draftSet = new Set(draft)
    return savedEmails.filter((email) => !draftSet.has(email)).length
  }, [draft, savedEmails])
  const dirty = pendingAdded > 0 || pendingRemoved > 0

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return keyword ? draft.filter((email) => email.includes(keyword)) : draft
  }, [draft, search])
  const visible = filtered.slice(0, VISIBLE_LIMIT)
  const invalid = addResult?.invalid ?? []
  const invalidSample =
    invalid.slice(0, INVALID_SAMPLE_LIMIT).join(', ') + (invalid.length > INVALID_SAMPLE_LIMIT ? ' …' : '')

  const formatCount = (value: number) => value.toLocaleString(locale)

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const result = await adminAPI.settings.getRegistrationEmailBlacklist()
      setSavedEmails(result.emails ?? [])
      if (result.max > 0) setMaxEntries(result.max)
    } catch (error) {
      setLoadError(true)
      console.error('Failed to load registration email blacklist:', error)
    } finally {
      setLoading(false)
    }
  }

  useMountOnce(load)

  function openEditor() {
    setDraft([...savedEmails])
    setBulkInput('')
    setSearch('')
    setAddResult(null)
    setEditorOpen(true)
  }

  function closeEditor() {
    if (saving) return
    if (dirty) {
      setDiscardConfirmOpen(true)
      return
    }
    setEditorOpen(false)
  }

  function discardDraft() {
    setDiscardConfirmOpen(false)
    setEditorOpen(false)
  }

  function addBulk() {
    const parsed = parseBlacklistInput(bulkInput)
    const merged = mergeIntoBlacklist(draft, parsed.valid)
    setDraft(merged.list)
    setAddResult({
      added: merged.added.length,
      duplicates: parsed.duplicates + merged.duplicates,
      invalid: parsed.invalid
    })
    setBulkInput(parsed.invalid.join('\n'))
    setSearch('')
  }

  function removeEmail(email: string) {
    setDraft((prev) => prev.filter((item) => item !== email))
  }

  function clearDraft() {
    setDraft([])
    setSearch('')
  }

  async function save() {
    setSaving(true)
    let added: string[]
    try {
      const result = await adminAPI.settings.updateRegistrationEmailBlacklist(draft)
      const emails = result.emails ?? []
      setSavedEmails(emails)
      added = result.added ?? []
      useAppStore.getState().showSuccess(t(`${KEY}.saved`, { count: formatCount(emails.length) }))
      setEditorOpen(false)
    } catch (error) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('common.error')))
      return
    } finally {
      setSaving(false)
    }
    if (added.length > 0) await checkRegisteredUsers(added, { silentWhenNone: true })
  }

  async function checkRegisteredUsers(emails: string[], options: { silentWhenNone?: boolean } = {}) {
    if (emails.length === 0) return
    setChecking(true)
    try {
      const result = await adminAPI.users.findBlacklistedEmailUsers(emails)
      const items = result.items ?? []
      setMatchedUsers(items)
      if (items.length > 0) setDisableDialogOpen(true)
      else if (!options.silentWhenNone) useAppStore.getState().showInfo(t(`${KEY}.noActiveMatches`))
    } catch (error) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('common.error')))
    } finally {
      setChecking(false)
    }
  }

  function closeDisableDialog() {
    if (disabling) return
    setDisableDialogOpen(false)
  }

  // 分批提交；失败时弹窗只保留尚未提交的用户，重试从断点继续（已禁用的用户后端会跳过）。
  async function disableMatchedUsers() {
    setDisabling(true)
    let affected = 0
    let remaining = matchedUsers
    try {
      while (remaining.length > 0) {
        const batch = remaining.slice(0, DISABLE_BATCH_SIZE)
        const result = await adminAPI.users.batchDisable(batch.map((user) => user.id))
        affected += result.affected
        remaining = remaining.slice(batch.length)
        setMatchedUsers(remaining)
      }
      useAppStore.getState().showSuccess(t(`${KEY}.disabled`, { count: formatCount(affected) }))
      setDisableDialogOpen(false)
    } catch (error) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('common.error')))
    } finally {
      setDisabling(false)
    }
  }

  return (
    <div className={s.row} data-testid="email-blacklist-editor">
      <div className={styles.head}>
        <div className={s.rowText}>
          <span className={s.rowLabel}>{t(`${KEY}.title`)}</span>
          <p className={s.rowDescription}>{t(`${KEY}.hint`)}</p>
          <p className={styles.summary} data-testid="email-blacklist-summary">
            {loading ? (
              <span className={s.hint}>{t('common.loading')}</span>
            ) : loadError ? (
              <span className={s.error}>
                {t(`${KEY}.loadFailed`)}
                <button type="button" className={styles.linkButton} onClick={() => void load()}>
                  {t(`${KEY}.retry`)}
                </button>
              </span>
            ) : (
              <span>{t(`${KEY}.count`, { count: formatCount(savedEmails.length) })}</span>
            )}
          </p>
        </div>
        <div className={styles.actions}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loading || loadError || savedEmails.length === 0 || checking}
            data-testid="email-blacklist-check"
            onClick={() => void checkRegisteredUsers(savedEmails)}
          >
            <Search size={14} aria-hidden="true" />
            {t(`${KEY}.checkUsers`)}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={loading || loadError || checking}
            data-testid="email-blacklist-edit"
            onClick={openEditor}
          >
            {t(`${KEY}.edit`)}
          </Button>
        </div>
      </div>

      <BaseDialog
        show={editorOpen}
        title={t(`${KEY}.editorTitle`)}
        width="wide"
        closeOnEscape={false}
        onClose={closeEditor}
        footer={
          <>
            <Button type="button" variant="secondary" disabled={saving} onClick={closeEditor}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={saving || !dirty || draft.length > maxEntries}
              data-testid="email-blacklist-save"
              onClick={() => void save()}
            >
              {saving ? t('common.saving') : t(`${KEY}.save`)}
            </Button>
          </>
        }
      >
        <div className={styles.editor}>
          <section className={s.columnTight}>
            <Textarea
              label={t(`${KEY}.bulkLabel`)}
              rows={5}
              className={s.mono}
              value={bulkInput}
              placeholder={t(`${KEY}.bulkPlaceholder`)}
              data-testid="email-blacklist-bulk-input"
              onChange={(e) => setBulkInput(e.target.value)}
            />
            <div className={s.inline}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!bulkInput.trim()}
                data-testid="email-blacklist-bulk-add"
                onClick={addBulk}
              >
                <Plus size={14} aria-hidden="true" />
                {t(`${KEY}.bulkAdd`)}
              </Button>
              {addResult ? (
                <span className={s.hint} data-testid="email-blacklist-add-result">
                  {t(`${KEY}.addResult`, {
                    added: formatCount(addResult.added),
                    duplicates: formatCount(addResult.duplicates)
                  })}
                </span>
              ) : null}
            </div>
            {addResult && addResult.invalid.length > 0 ? (
              <p className={cx(s.warningText, styles.breakAll)} data-testid="email-blacklist-invalid">
                {t(`${KEY}.invalidResult`, { count: formatCount(addResult.invalid.length), sample: invalidSample })}
              </p>
            ) : null}
          </section>

          <section className={s.columnTight}>
            <div className={styles.listHead}>
              <div className={s.label}>
                {t(`${KEY}.listLabel`, { count: formatCount(draft.length) })}
                {dirty ? (
                  <span className={styles.pending} data-testid="email-blacklist-pending">
                    {t(`${KEY}.pending`, { added: formatCount(pendingAdded), removed: formatCount(pendingRemoved) })}
                  </span>
                ) : null}
              </div>
              <div className={s.inline}>
                <input
                  type="search"
                  className={cx(s.input, styles.search)}
                  value={search}
                  placeholder={t(`${KEY}.searchPlaceholder`)}
                  aria-label={t(`${KEY}.searchPlaceholder`)}
                  data-testid="email-blacklist-search"
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={draft.length === 0}
                  data-testid="email-blacklist-clear"
                  onClick={clearDraft}
                >
                  {t(`${KEY}.clear`)}
                </Button>
              </div>
            </div>

            <div className={styles.list}>
              {draft.length === 0 ? (
                <p className={styles.listEmpty}>{t(`${KEY}.empty`)}</p>
              ) : filtered.length === 0 ? (
                <p className={styles.listEmpty}>{t(`${KEY}.noMatch`)}</p>
              ) : (
                <ul className={styles.rows}>
                  {visible.map((email) => (
                    <li key={email} className={styles.row} data-testid="email-blacklist-row">
                      <span className={styles.email} title={email}>
                        {email}
                        {!savedSet.has(email) ? (
                          <Badge tone="info" size="sm" className={styles.newTag}>
                            {t(`${KEY}.newTag`)}
                          </Badge>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        className={cx(s.iconButton, s.iconButtonDanger)}
                        title={t(`${KEY}.remove`)}
                        aria-label={t(`${KEY}.remove`)}
                        onClick={() => removeEmail(email)}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {filtered.length > VISIBLE_LIMIT ? (
              <p className={s.hint}>{t(`${KEY}.truncated`, { limit: VISIBLE_LIMIT, total: formatCount(filtered.length) })}</p>
            ) : null}
            {draft.length > maxEntries ? (
              <p className={s.error} data-testid="email-blacklist-too-many">
                {t(`${KEY}.tooMany`, { max: formatCount(maxEntries) })}
              </p>
            ) : null}
          </section>
        </div>
      </BaseDialog>

      <ConfirmDialog
        show={discardConfirmOpen}
        title={t(`${KEY}.discardTitle`)}
        message={t(`${KEY}.discardMessage`, { added: formatCount(pendingAdded), removed: formatCount(pendingRemoved) })}
        confirmText={t(`${KEY}.discardConfirm`)}
        cancelText={t(`${KEY}.discardCancel`)}
        danger
        onConfirm={discardDraft}
        onCancel={() => setDiscardConfirmOpen(false)}
      />

      <BaseDialog
        show={disableDialogOpen}
        title={t(`${KEY}.disableTitle`)}
        width="normal"
        onClose={closeDisableDialog}
        footer={
          <>
            <Button type="button" variant="secondary" disabled={disabling} onClick={closeDisableDialog}>
              {t(`${KEY}.disableLater`)}
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={disabling}
              data-testid="email-blacklist-disable-confirm"
              onClick={() => void disableMatchedUsers()}
            >
              {t(`${KEY}.disableConfirm`, { count: formatCount(matchedUsers.length) })}
            </Button>
          </>
        }
      >
        <div className={s.column}>
          <p className={styles.message}>{t(`${KEY}.disableMessage`, { count: formatCount(matchedUsers.length) })}</p>
          <ul className={cx(styles.list, styles.rows)} data-testid="email-blacklist-matched-users">
            {matchedUsers.map((user) => (
              <li key={user.id} className={styles.row}>
                <span className={styles.email} title={user.email}>
                  {user.email}
                </span>
                <span className={s.hint}>
                  {user.username ? `${user.username} · ` : ''}#{user.id}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </BaseDialog>
    </div>
  )
}
