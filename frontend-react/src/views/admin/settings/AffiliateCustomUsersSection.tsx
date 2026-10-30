/**
 * 邀请返利的专属用户管理（对应 Vue 版 affiliateState / affiliateModal / affiliateBatchModal）。
 * 返利开关打开时加载列表；新增/编辑与批量设置用 BaseDialog，重置用 ConfirmDialog。
 */
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

import { affiliatesAPI, type AffiliateAdminEntry, type SimpleUser as AffiliateSimpleUser } from '@/api/admin/affiliates'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Field } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { cx } from '@/components/admin/settings/settingsUtils'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores'
import { extractApiErrorMessage } from '@/utils/apiError'
import styles from './AffiliateCustomUsersSection.module.css'

interface ModalState {
  open: boolean
  mode: 'add' | 'edit'
  saving: boolean
  userQuery: string
  userResults: AffiliateSimpleUser[]
  selectedUser: AffiliateSimpleUser | null
  editingEntry: AffiliateAdminEntry | null
  code: string
  rate: string
}

const closedModal: ModalState = {
  open: false,
  mode: 'add',
  saving: false,
  userQuery: '',
  userResults: [],
  selectedUser: null,
  editingEntry: null,
  code: '',
  rate: ''
}

interface ConfirmState {
  show: boolean
  title: string
  message: string
  confirmText: string
  pending: (() => Promise<unknown>) | null
}

export default function AffiliateCustomUsersSection({ enabled }: { enabled: boolean }) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [entries, setEntries] = useState<AffiliateAdminEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [modal, setModal] = useState<ModalState>(closedModal)
  const [batch, setBatch] = useState({ open: false, saving: false, rate: '' })
  const [confirmState, setConfirmState] = useState<ConfirmState>({ show: false, title: '', message: '', confirmText: '', pending: null })
  const searchTimer = useRef<number | null>(null)
  const userSearchTimer = useRef<number | null>(null)
  const latest = useRef({ page: 1, search: '' })

  async function loadUsers(nextPage = latest.current.page, nextSearch = latest.current.search) {
    latest.current = { page: nextPage, search: nextSearch }
    setLoading(true)
    try {
      const res = await affiliatesAPI.listUsers({ page: nextPage, page_size: pageSize, search: nextSearch })
      const items = res.items ?? []
      setEntries(items)
      setTotal(res.total ?? 0)
      // Drop selections that are no longer visible.
      const visibleIds = new Set(items.map((e) => e.user_id))
      setSelected((prev) => prev.filter((id) => visibleIds.has(id)))
    } catch (err) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      setLoading(false)
    }
  }

  // 返利开关从关到开时加载专属用户列表（对应 Vue 版 watch(form.affiliate_enabled)）
  const loadRef = useRef(loadUsers)
  useEffect(() => {
    loadRef.current = loadUsers
  })
  useEffect(() => {
    if (enabled) void loadRef.current()
  }, [enabled])

  useEffect(
    () => () => {
      if (searchTimer.current != null) window.clearTimeout(searchTimer.current)
      if (userSearchTimer.current != null) window.clearTimeout(userSearchTimer.current)
    },
    []
  )

  // parseRebateRate validates 0-100 numeric input. Returns the parsed number on
  // success, null when the field is empty (caller decides empty semantics), or
  // undefined on invalid input (after surfacing a toast).
  function parseRebateRate(raw: unknown): number | null | undefined {
    const value = String(raw ?? '').trim()
    if (value === '') return null
    const parsed = Number(value)
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
      useAppStore.getState().showError(t('admin.settings.features.affiliate.modal.errorBadRate'))
      return undefined
    }
    return parsed
  }

  function onSearchInput(value: string) {
    setSearch(value)
    if (searchTimer.current != null) window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => {
      setPage(1)
      void loadUsers(1, value)
    }, 300)
  }

  function changePage(next: number) {
    if (next < 1) return
    setPage(next)
    void loadUsers(next, search)
  }

  // openModal opens the add/edit modal, prefilling fields from the
  // edited entry when present and resetting them otherwise.
  function openModal(entry: AffiliateAdminEntry | null) {
    setModal({
      ...closedModal,
      open: true,
      mode: entry ? 'edit' : 'add',
      editingEntry: entry,
      code: entry?.aff_code_custom ? entry.aff_code : '',
      rate: entry?.aff_rebate_rate_percent != null ? String(entry.aff_rebate_rate_percent) : ''
    })
  }

  function closeModal() {
    setModal((prev) => ({ ...prev, open: false }))
    if (userSearchTimer.current != null) {
      window.clearTimeout(userSearchTimer.current)
      userSearchTimer.current = null
    }
  }

  function onUserSearchInput(value: string) {
    setModal((prev) => ({ ...prev, userQuery: value }))
    const q = value.trim()
    if (!q) {
      setModal((prev) => ({ ...prev, userResults: [] }))
      return
    }
    if (userSearchTimer.current != null) window.clearTimeout(userSearchTimer.current)
    userSearchTimer.current = window.setTimeout(async () => {
      try {
        const results = await affiliatesAPI.lookupUsers(q)
        setModal((prev) => ({ ...prev, userResults: results }))
      } catch (err) {
        useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
      }
    }, 300)
  }

  // canSubmit guards the Save button: must have a user picked AND
  // produce at least one field change. Without this the admin could "save" an
  // empty payload that silently does nothing — the user reported exactly that
  // confusion.
  const canSubmit = (() => {
    if (modal.mode === 'add') {
      if (!modal.selectedUser) return false
    } else if (!modal.editingEntry) {
      return false
    }
    if (modal.code.trim() !== '' || modal.rate.trim() !== '') return true
    // Edit mode + empty rate input is a meaningful "clear" only if the user
    // currently has an exclusive rate to clear.
    return modal.mode === 'edit' && modal.editingEntry?.aff_rebate_rate_percent != null
  })()

  async function submitModal() {
    if (!canSubmit) {
      // Should be unreachable because the button is disabled, but keep a guard.
      useAppStore.getState().showError(t('admin.settings.features.affiliate.modal.errorEmpty'))
      return
    }
    const userId = modal.mode === 'add' ? modal.selectedUser!.id : modal.editingEntry!.user_id
    const payload: Parameters<typeof affiliatesAPI.updateUserSettings>[1] = {}
    const codeRaw = modal.code.trim()
    if (codeRaw) payload.aff_code = codeRaw.toUpperCase()
    const rateInput = parseRebateRate(modal.rate)
    if (rateInput === undefined) return // toast already shown
    if (rateInput === null) {
      if (modal.mode === 'edit' && modal.editingEntry?.aff_rebate_rate_percent != null) payload.clear_rebate_rate = true
    } else {
      payload.aff_rebate_rate_percent = rateInput
    }
    setModal((prev) => ({ ...prev, saving: true }))
    try {
      await affiliatesAPI.updateUserSettings(userId, payload)
      useAppStore.getState().showSuccess(t('common.saved'))
      closeModal()
      setPage(1)
      await loadUsers(1, search)
    } catch (err) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      setModal((prev) => ({ ...prev, saving: false }))
    }
  }

  // askReset prompts via the project ConfirmDialog, then on confirm calls the
  // backend "reset all" endpoint that clears both the exclusive rate AND
  // regenerates the invite code as a system random one.
  function askReset(entry: AffiliateAdminEntry) {
    setConfirmState({
      show: true,
      title: t('admin.settings.features.affiliate.customUsers.resetTitle'),
      message: t('admin.settings.features.affiliate.customUsers.resetMessage', { email: entry.email || `#${entry.user_id}` }),
      confirmText: t('common.delete'),
      pending: () => affiliatesAPI.clearUserSettings(entry.user_id)
    })
  }

  async function handleConfirm() {
    const fn = confirmState.pending
    setConfirmState((prev) => ({ ...prev, show: false, pending: null }))
    if (!fn) return
    try {
      await fn()
      useAppStore.getState().showSuccess(t('common.saved'))
      await loadUsers()
    } catch (err) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    }
  }

  async function submitBatch() {
    const rateInput = parseRebateRate(batch.rate)
    if (rateInput === undefined) return
    const userIDs = [...selected]
    const payload: Parameters<typeof affiliatesAPI.batchSetRate>[0] =
      rateInput === null ? { user_ids: userIDs, clear: true } : { user_ids: userIDs, aff_rebate_rate_percent: rateInput }
    setBatch((prev) => ({ ...prev, saving: true }))
    try {
      await affiliatesAPI.batchSetRate(payload)
      useAppStore.getState().showSuccess(t('common.saved'))
      setBatch({ open: false, saving: false, rate: '' })
      setSelected([])
      await loadUsers()
    } catch (err) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
      setBatch((prev) => ({ ...prev, saving: false }))
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className={s.column}>
      <div className={s.itemHead}>
        <div className={s.columnTight}>
          <h3 className={s.itemTitle}>{t('admin.settings.features.affiliate.customUsers.title')}</h3>
          <p className={s.hint}>{t('admin.settings.features.affiliate.customUsers.description')}</p>
        </div>
        <Button type="button" size="sm" onClick={() => openModal(null)}>
          + {t('admin.settings.features.affiliate.customUsers.addButton')}
        </Button>
      </div>
      <div className={s.inline}>
        <input
          type="text"
          className={cx(s.input, s.inputMedium)}
          value={search}
          placeholder={t('admin.settings.features.affiliate.customUsers.searchPlaceholder')}
          onChange={(e) => onSearchInput(e.target.value)}
        />
        {selected.length > 0 ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setBatch({ open: true, saving: false, rate: '' })}>
            {t('admin.settings.features.affiliate.customUsers.batchButton', { count: selected.length })}
          </Button>
        ) : null}
      </div>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label={t('admin.settings.features.affiliate.customUsers.col.email')}
                  checked={entries.length > 0 && selected.length === entries.length}
                  onChange={(e) => setSelected(e.target.checked ? entries.map((entry) => entry.user_id) : [])}
                />
              </th>
              <th>{t('admin.settings.features.affiliate.customUsers.col.email')}</th>
              <th>{t('admin.settings.features.affiliate.customUsers.col.username')}</th>
              <th>{t('admin.settings.features.affiliate.customUsers.col.code')}</th>
              <th>{t('admin.settings.features.affiliate.customUsers.col.rate')}</th>
              <th>{t('admin.settings.features.affiliate.customUsers.col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className={styles.message}>
                  {t('common.loading')}
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.message}>
                  {t('admin.settings.features.affiliate.customUsers.empty')}
                </td>
              </tr>
            ) : null}
            {entries.map((entry) => (
              <tr key={entry.user_id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={entry.email}
                    checked={selected.includes(entry.user_id)}
                    onChange={() =>
                      setSelected((prev) =>
                        prev.includes(entry.user_id) ? prev.filter((id) => id !== entry.user_id) : [...prev, entry.user_id]
                      )
                    }
                  />
                </td>
                <td>{entry.email}</td>
                <td>{entry.username}</td>
                <td>
                  <span className={s.mono}>{entry.aff_code}</span>{' '}
                  {entry.aff_code_custom ? (
                    <Badge tone="info" size="sm">
                      {t('admin.settings.features.affiliate.customUsers.customBadge')}
                    </Badge>
                  ) : null}
                </td>
                <td>
                  {entry.aff_rebate_rate_percent != null ? (
                    `${entry.aff_rebate_rate_percent}%`
                  ) : (
                    <span className={s.muted}>{t('admin.settings.features.affiliate.customUsers.useGlobal')}</span>
                  )}
                </td>
                <td>
                  <div className={s.inline}>
                    <Button type="button" variant="ghost" size="sm" onClick={() => openModal(entry)}>
                      {t('common.edit')}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => askReset(entry)}>
                      {t('common.delete')}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > pageSize ? (
        <div className={s.inlineEnd}>
          <span className={s.hint}>{t('admin.settings.features.affiliate.customUsers.totalLabel', { total })}</span>
          <Button type="button" variant="secondary" size="sm" disabled={page <= 1} onClick={() => changePage(page - 1)}>
            {t('pagination.previous')}
          </Button>
          <span className={s.hint}>
            {page} / {totalPages}
          </span>
          <Button type="button" variant="secondary" size="sm" disabled={page >= Math.ceil(total / pageSize)} onClick={() => changePage(page + 1)}>
            {t('pagination.next')}
          </Button>
        </div>
      ) : null}

      {/* Affiliate add/edit modal */}
      <BaseDialog
        show={modal.open}
        title={modal.mode === 'add' ? t('admin.settings.features.affiliate.modal.addTitle') : t('admin.settings.features.affiliate.modal.editTitle')}
        closeOnClickOutside
        onClose={closeModal}
        footer={
          <>
            {!canSubmit ? <p className={cx(s.warningText, s.grow)}>{t('admin.settings.features.affiliate.modal.errorEmpty')}</p> : null}
            <Button type="button" variant="secondary" onClick={closeModal}>
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={modal.saving || !canSubmit} onClick={() => void submitModal()}>
              {modal.saving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className={s.column}>
          <Field label={t('admin.settings.features.affiliate.modal.userLabel')}>
            {modal.mode === 'add' ? (
              modal.selectedUser ? (
                // Chip showing the picked user; clicking it re-opens the search
                <span className={s.chip}>
                  <span>{modal.selectedUser.email}</span>
                  <span className={s.muted}>({modal.selectedUser.username})</span>
                  <button
                    type="button"
                    className={s.chipRemove}
                    title={t('admin.settings.features.affiliate.modal.changeUser')}
                    aria-label={t('admin.settings.features.affiliate.modal.changeUser')}
                    onClick={() => setModal((prev) => ({ ...prev, selectedUser: null }))}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ) : (
                // Search input + result dropdown — hidden once a selection is made
                <div className={styles.lookup}>
                  <input
                    type="text"
                    className={s.input}
                    value={modal.userQuery}
                    placeholder={t('admin.settings.features.affiliate.modal.userPlaceholder')}
                    onChange={(e) => onUserSearchInput(e.target.value)}
                  />
                  {modal.userResults.length > 0 ? (
                    <div className={styles.results}>
                      {modal.userResults.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          className={styles.result}
                          onClick={() => setModal((prev) => ({ ...prev, selectedUser: u, userQuery: '', userResults: [] }))}
                        >
                          {u.email} <span className={s.muted}>({u.username})</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            ) : (
              <input type="text" className={s.input} value={modal.editingEntry ? modal.editingEntry.email : ''} disabled />
            )}
          </Field>
          <Field label={t('admin.settings.features.affiliate.modal.codeLabel')} hint={t('admin.settings.features.affiliate.modal.codeHint')}>
            <input
              type="text"
              className={cx(s.input, s.mono)}
              maxLength={32}
              value={modal.code}
              placeholder={t('admin.settings.features.affiliate.modal.codePlaceholder')}
              onChange={(e) => setModal((prev) => ({ ...prev, code: e.target.value }))}
            />
          </Field>
          <Field label={t('admin.settings.features.affiliate.modal.rateLabel')} hint={t('admin.settings.features.affiliate.modal.rateHint')}>
            <div className={s.inputWithSuffix}>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                className={s.input}
                value={modal.rate}
                placeholder={t('admin.settings.features.affiliate.modal.ratePlaceholder')}
                onChange={(e) => setModal((prev) => ({ ...prev, rate: e.target.value }))}
              />
              <span className={s.inputSuffix}>%</span>
            </div>
          </Field>
        </div>
      </BaseDialog>

      {/* Affiliate batch rate modal */}
      <BaseDialog
        show={batch.open}
        title={t('admin.settings.features.affiliate.batchModal.title', { count: selected.length })}
        description={t('admin.settings.features.affiliate.batchModal.hint')}
        closeOnClickOutside
        onClose={() => setBatch((prev) => ({ ...prev, open: false }))}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setBatch((prev) => ({ ...prev, open: false }))}>
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={batch.saving} onClick={() => void submitBatch()}>
              {batch.saving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <Field hint={t('admin.settings.features.affiliate.batchModal.clearHint')}>
          <div className={s.inputWithSuffix}>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              className={s.input}
              aria-label={t('admin.settings.features.affiliate.batchModal.placeholder')}
              value={batch.rate}
              placeholder={t('admin.settings.features.affiliate.batchModal.placeholder')}
              onChange={(e) => setBatch((prev) => ({ ...prev, rate: e.target.value }))}
            />
            <span className={s.inputSuffix}>%</span>
          </div>
        </Field>
      </BaseDialog>

      <ConfirmDialog
        show={confirmState.show}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        danger
        onConfirm={() => void handleConfirm()}
        onCancel={() => setConfirmState((prev) => ({ ...prev, show: false, pending: null }))}
      />
    </div>
  )
}
