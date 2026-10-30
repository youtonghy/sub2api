import { BarChart3, Eye, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'

import { adminAPI } from '@/api/admin'
import AnnouncementReadStatusDialog from '@/components/admin/announcements/AnnouncementReadStatusDialog'
import AnnouncementTargetingEditor from '@/components/admin/announcements/AnnouncementTargetingEditor'
import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { Textarea } from '@/components/arc/textarea/textarea'
import AnnouncementPopup from '@/components/common/AnnouncementPopup'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import DataTable from '@/components/common/DataTable'
import EmptyState from '@/components/common/EmptyState'
import Pagination from '@/components/common/Pagination'
import SearchInput from '@/components/common/SearchInput'
import Select from '@/components/common/Select'
import TablePageLayout from '@/components/common/TablePageLayout'
import type { Column } from '@/components/common/types'
import { getPersistedPageSize } from '@/composables/usePersistedPageSize'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type {
  AdminGroup,
  Announcement,
  AnnouncementNotifyMode,
  AnnouncementStatus,
  AnnouncementTargeting,
  UpdateAnnouncementRequest
} from '@/types'
import { formatDateTime, formatDateTimeLocalInput, parseDateTimeLocalInput } from '@/utils/format'
import styles from './AnnouncementsView.module.css'

interface PaginationState {
  page: number
  page_size: number
  total: number
  pages: number
}

interface AnnouncementForm {
  title: string
  content: string
  status: string
  notify_mode: string
  starts_at_str: string
  ends_at_str: string
  targeting: AnnouncementTargeting
}

const emptyForm = (): AnnouncementForm => ({
  title: '',
  content: '',
  status: 'draft',
  notify_mode: 'silent',
  starts_at_str: '',
  ends_at_str: '',
  targeting: { any_of: [] }
})

type RequestError = { name?: string; code?: string; response?: { data?: { detail?: string } } } | null

const STATUS_TONE: Record<string, BadgeTone> = {
  active: 'success',
  draft: 'neutral'
}

export default function AnnouncementsView() {
  const { t } = useI18n()

  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilterState] = useState('')
  const [searchQuery, setSearchQueryState] = useState('')
  const [pagination, setPaginationState] = useState<PaginationState>(() => ({
    page: 1,
    page_size: getPersistedPageSize(),
    total: 0,
    pages: 0
  }))

  // 最新查询参数（同步读写，保持 Vue 版语义）
  const queryRef = useRef({
    status: '',
    search: '',
    pagination,
    sort_by: 'created_at',
    sort_order: 'desc' as 'asc' | 'desc'
  })

  const setPagination = (patch: Partial<PaginationState>) => {
    queryRef.current.pagination = { ...queryRef.current.pagination, ...patch }
    setPaginationState(queryRef.current.pagination)
  }

  const statusFilterOptions = [
    { value: '', label: t('admin.announcements.allStatus') },
    { value: 'draft', label: t('admin.announcements.statusLabels.draft') },
    { value: 'active', label: t('admin.announcements.statusLabels.active') },
    { value: 'archived', label: t('admin.announcements.statusLabels.archived') }
  ]

  const statusOptions = [
    { value: 'draft', label: t('admin.announcements.statusLabels.draft') },
    { value: 'active', label: t('admin.announcements.statusLabels.active') },
    { value: 'archived', label: t('admin.announcements.statusLabels.archived') }
  ]

  const notifyModeOptions = [
    { value: 'silent', label: t('admin.announcements.notifyModeLabels.silent') },
    { value: 'popup', label: t('admin.announcements.notifyModeLabels.popup') }
  ]

  const columns: Column<Announcement>[] = [
    { key: 'title', label: t('admin.announcements.columns.title'), sortable: true },
    { key: 'status', label: t('admin.announcements.columns.status'), sortable: true },
    { key: 'notify_mode', label: t('admin.announcements.columns.notifyMode'), sortable: true },
    { key: 'targeting', label: t('admin.announcements.columns.targeting') },
    { key: 'timeRange', label: t('admin.announcements.columns.timeRange') },
    { key: 'created_at', label: t('admin.announcements.columns.createdAt'), sortable: true },
    { key: 'actions', label: t('admin.announcements.columns.actions') }
  ]

  const statusLabel = (status: string) => {
    if (status === 'draft') return t('admin.announcements.statusLabels.draft')
    if (status === 'active') return t('admin.announcements.statusLabels.active')
    if (status === 'archived') return t('admin.announcements.statusLabels.archived')
    return status
  }

  const targetingSummary = (targeting: AnnouncementTargeting) => {
    const anyOf = targeting?.any_of ?? []
    if (!anyOf || anyOf.length === 0) return t('admin.announcements.targetingSummaryAll')
    return t('admin.announcements.targetingSummaryCustom', { groups: anyOf.length })
  }

  // ===== CRUD / list =====
  const currentController = useRef<AbortController | null>(null)

  async function loadAnnouncements() {
    currentController.current?.abort()
    const requestController = new AbortController()
    currentController.current = requestController
    const { signal } = requestController

    try {
      setLoading(true)
      const query = queryRef.current
      const res = await adminAPI.announcements.list(
        query.pagination.page,
        query.pagination.page_size,
        {
          status: query.status || undefined,
          search: query.search || undefined,
          sort_by: query.sort_by,
          sort_order: query.sort_order
        },
        { signal }
      )

      if (signal.aborted || currentController.current !== requestController) return

      setAnnouncements(res.items)
      setPagination({ total: res.total, pages: res.pages, page: res.page, page_size: res.page_size })
    } catch (error: unknown) {
      const err = error as RequestError
      if (signal.aborted || currentController.current !== requestController || err?.name === 'AbortError' || err?.code === 'ERR_CANCELED') {
        return
      }
      console.error('Error loading announcements:', error)
      useAppStore.getState().showError(err?.response?.data?.detail || t('admin.announcements.failedToLoad'))
    } finally {
      if (currentController.current === requestController) {
        setLoading(false)
        currentController.current = null
      }
    }
  }
  const loadRef = useRef(loadAnnouncements)
  useLayoutEffect(() => {
    loadRef.current = loadAnnouncements
  })

  function handlePageChange(page: number) {
    setPagination({ page })
    void loadAnnouncements()
  }

  function handlePageSizeChange(pageSize: number) {
    setPagination({ page_size: pageSize, page: 1 })
    void loadAnnouncements()
  }

  function handleStatusChange(value: string) {
    queryRef.current.status = value
    setStatusFilterState(value)
    setPagination({ page: 1 })
    void loadAnnouncements()
  }

  function handleSort(key: string, order: 'asc' | 'desc') {
    queryRef.current.sort_by = key
    queryRef.current.sort_order = order
    setPagination({ page: 1 })
    void loadAnnouncements()
  }

  const searchDebounceTimer = useRef<number | null>(null)
  function handleSearch(value: string) {
    queryRef.current.search = value
    setSearchQueryState(value)
    if (searchDebounceTimer.current) window.clearTimeout(searchDebounceTimer.current)
    searchDebounceTimer.current = window.setTimeout(() => {
      setPagination({ page: 1 })
      void loadRef.current()
    }, 300)
  }

  // ===== Create/Edit dialog =====
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null)
  const [form, setForm] = useState<AnnouncementForm>(emptyForm)
  const [subscriptionGroups, setSubscriptionGroups] = useState<AdminGroup[]>([])

  const isEditing = !!editingAnnouncement
  const updateForm = (patch: Partial<AnnouncementForm>) => setForm((prev) => ({ ...prev, ...patch }))

  async function loadSubscriptionGroups() {
    try {
      const all = await adminAPI.groups.getAll()
      setSubscriptionGroups((all || []).filter((g) => g.subscription_type === 'subscription'))
    } catch (error: unknown) {
      console.error('Error loading groups:', error)
      // not fatal
    }
  }

  function fillFormFromAnnouncement(a: Announcement) {
    setForm({
      title: a.title,
      content: a.content,
      status: a.status,
      notify_mode: a.notify_mode || 'silent',
      // Backend returns RFC3339 strings
      starts_at_str: a.starts_at ? formatDateTimeLocalInput(Math.floor(new Date(a.starts_at).getTime() / 1000)) : '',
      ends_at_str: a.ends_at ? formatDateTimeLocalInput(Math.floor(new Date(a.ends_at).getTime() / 1000)) : '',
      targeting: a.targeting ?? { any_of: [] }
    })
  }

  function openCreateDialog() {
    setEditingAnnouncement(null)
    setForm(emptyForm())
    setShowEditDialog(true)
  }

  function openEditDialog(row: Announcement) {
    setEditingAnnouncement(row)
    fillFormFromAnnouncement(row)
    setShowEditDialog(true)
  }

  function closeEdit() {
    setShowEditDialog(false)
    setEditingAnnouncement(null)
  }

  function buildCreatePayload() {
    const startsAt = parseDateTimeLocalInput(form.starts_at_str)
    const endsAt = parseDateTimeLocalInput(form.ends_at_str)

    return {
      title: form.title,
      content: form.content,
      status: form.status as AnnouncementStatus,
      notify_mode: form.notify_mode as AnnouncementNotifyMode,
      targeting: form.targeting,
      starts_at: startsAt ?? undefined,
      ends_at: endsAt ?? undefined
    }
  }

  function buildUpdatePayload(original: Announcement) {
    const payload: UpdateAnnouncementRequest = {}

    if (form.title !== original.title) payload.title = form.title
    if (form.content !== original.content) payload.content = form.content
    if (form.status !== original.status) payload.status = form.status as AnnouncementStatus
    if (form.notify_mode !== (original.notify_mode || 'silent')) payload.notify_mode = form.notify_mode as AnnouncementNotifyMode

    // starts_at / ends_at: distinguish unchanged vs clear(0) vs set
    const originalStarts = original.starts_at ? Math.floor(new Date(original.starts_at).getTime() / 1000) : null
    const originalEnds = original.ends_at ? Math.floor(new Date(original.ends_at).getTime() / 1000) : null

    const newStarts = parseDateTimeLocalInput(form.starts_at_str)
    const newEnds = parseDateTimeLocalInput(form.ends_at_str)

    if (newStarts !== originalStarts) {
      payload.starts_at = newStarts === null ? 0 : newStarts
    }
    if (newEnds !== originalEnds) {
      payload.ends_at = newEnds === null ? 0 : newEnds
    }

    // targeting: do shallow compare by JSON
    if (JSON.stringify(form.targeting ?? {}) !== JSON.stringify(original.targeting ?? {})) {
      payload.targeting = form.targeting
    }

    return payload
  }

  async function handleSave(event?: FormEvent) {
    event?.preventDefault()
    // Frontend validation for targeting (to avoid ANNOUNCEMENT_INVALID_TARGET)
    const anyOf = form.targeting?.any_of ?? []
    if (anyOf.length > 50) {
      useAppStore.getState().showError(t('admin.announcements.failedToCreate'))
      return
    }
    for (const g of anyOf) {
      const allOf = g?.all_of ?? []
      if (allOf.length > 50) {
        useAppStore.getState().showError(t('admin.announcements.failedToCreate'))
        return
      }
    }

    setSaving(true)
    try {
      if (!editingAnnouncement) {
        const payload = buildCreatePayload()
        await adminAPI.announcements.create(payload)
        useAppStore.getState().showSuccess(t('common.success'))
        setShowEditDialog(false)
        await loadAnnouncements()
        return
      }

      const original = editingAnnouncement
      const payload = buildUpdatePayload(original)
      await adminAPI.announcements.update(original.id, payload)
      useAppStore.getState().showSuccess(t('common.success'))
      setShowEditDialog(false)
      setEditingAnnouncement(null)
      await loadAnnouncements()
    } catch (error: unknown) {
      console.error('Failed to save announcement:', error)
      useAppStore
        .getState()
        .showError(
          (error as RequestError)?.response?.data?.detail ||
            (editingAnnouncement ? t('admin.announcements.failedToUpdate') : t('admin.announcements.failedToCreate'))
        )
    } finally {
      setSaving(false)
    }
  }

  // ===== Delete =====
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deletingAnnouncement, setDeletingAnnouncement] = useState<Announcement | null>(null)

  function handleDelete(row: Announcement) {
    setDeletingAnnouncement(row)
    setShowDeleteDialog(true)
  }

  async function confirmDelete() {
    if (!deletingAnnouncement) return

    try {
      await adminAPI.announcements.delete(deletingAnnouncement.id)
      useAppStore.getState().showSuccess(t('common.success'))
      setShowDeleteDialog(false)
      setDeletingAnnouncement(null)
      await loadAnnouncements()
    } catch (error: unknown) {
      console.error('Failed to delete announcement:', error)
      useAppStore.getState().showError((error as RequestError)?.response?.data?.detail || t('admin.announcements.failedToDelete'))
    }
  }

  // ===== Read status =====
  const [showReadStatusDialog, setShowReadStatusDialog] = useState(false)
  const [readStatusAnnouncementId, setReadStatusAnnouncementId] = useState<number | null>(null)
  const [previewAnnouncement, setPreviewAnnouncement] = useState<Announcement | null>(null)

  function openReadStatus(row: Announcement) {
    setReadStatusAnnouncementId(row.id)
    setShowReadStatusDialog(true)
  }

  const mountRef = useRef({ loadSubscriptionGroups })
  useLayoutEffect(() => {
    mountRef.current = { loadSubscriptionGroups }
  })
  useEffect(() => {
    void (async () => {
      await mountRef.current.loadSubscriptionGroups()
      await loadRef.current()
    })()
    return () => {
      if (searchDebounceTimer.current) window.clearTimeout(searchDebounceTimer.current)
      currentController.current?.abort()
    }
  }, [])

  const filterBar = (
    <div className={styles.toolbar}>
      {/* Left: Search + Filters */}
      <SearchInput
        className={styles.search}
        value={searchQuery}
        placeholder={t('admin.announcements.searchAnnouncements')}
        onChange={handleSearch}
      />
      <Select
        className={styles.status}
        value={statusFilter}
        options={statusFilterOptions}
        aria-label={t('admin.announcements.allStatus')}
        onChange={(value) => handleStatusChange(String(value ?? ''))}
      />

      {/* Right: Action buttons */}
      <div className={styles.actions}>
        <Button
          type="button"
          variant="secondary"
          disabled={loading}
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
          onClick={() => void loadAnnouncements()}
        >
          <RefreshCw size={16} strokeWidth={1.75} className={loading ? styles.spinning : undefined} aria-hidden="true" />
        </Button>
        <Button type="button" variant="primary" onClick={openCreateDialog}>
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          {t('admin.announcements.createAnnouncement')}
        </Button>
      </div>
    </div>
  )

  const table = (
    <DataTable
      columns={columns}
      data={announcements}
      loading={loading}
      serverSideSort
      defaultSortKey="created_at"
      defaultSortOrder="desc"
      onSort={handleSort}
      cells={{
        title: ({ value, row }) => (
          <div className={styles.titleCell}>
            <span className={styles.title}>{value}</span>
            <div className={styles.meta}>
              <span>#{row.id}</span>
              <span className={styles.dot}>·</span>
              <span>{formatDateTime(row.created_at)}</span>
            </div>
          </div>
        ),
        status: ({ value }) => (
          <Badge tone={STATUS_TONE[value] ?? 'warning'} size="sm">
            {statusLabel(value)}
          </Badge>
        ),
        notify_mode: ({ row }) => (
          <Badge tone={row.notify_mode === 'popup' ? 'warning' : 'neutral'} size="sm">
            {row.notify_mode === 'popup'
              ? t('admin.announcements.notifyModeLabels.popup')
              : t('admin.announcements.notifyModeLabels.silent')}
          </Badge>
        ),
        targeting: ({ row }) => <span className={styles.text}>{targetingSummary(row.targeting)}</span>,
        timeRange: ({ row }) => (
          <div className={styles.timeRange}>
            <div>
              <span className={styles.timeLabel}>{t('admin.announcements.form.startsAt')}:</span>
              <span>{row.starts_at ? formatDateTime(row.starts_at) : t('admin.announcements.timeImmediate')}</span>
            </div>
            <div>
              <span className={styles.timeLabel}>{t('admin.announcements.form.endsAt')}:</span>
              <span>{row.ends_at ? formatDateTime(row.ends_at) : t('admin.announcements.timeNever')}</span>
            </div>
          </div>
        ),
        created_at: ({ value }) => <span className={styles.muted}>{formatDateTime(value)}</span>,
        actions: ({ row }) => (
          <div className={styles.rowActions}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title={t('admin.announcements.preview')}
              aria-label={t('admin.announcements.preview')}
              onClick={() => setPreviewAnnouncement(row)}
            >
              <Eye size={16} strokeWidth={1.75} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title={t('admin.announcements.readStatus')}
              aria-label={t('admin.announcements.readStatus')}
              onClick={() => openReadStatus(row)}
            >
              <BarChart3 size={16} strokeWidth={1.75} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title={t('common.edit')}
              aria-label={t('common.edit')}
              onClick={() => openEditDialog(row)}
            >
              <Pencil size={16} strokeWidth={1.75} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title={t('common.delete')}
              aria-label={t('common.delete')}
              onClick={() => handleDelete(row)}
            >
              <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </div>
        )
      }}
      empty={
        <EmptyState
          title={t('empty.noData')}
          description={t('admin.announcements.createFirstAnnouncement')}
          actionText={t('admin.announcements.createAnnouncement')}
          onAction={openCreateDialog}
        />
      }
    />
  )

  const paginationNode =
    pagination.total > 0 ? (
      <Pagination
        page={pagination.page}
        total={pagination.total}
        pageSize={pagination.page_size}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
      />
    ) : null

  return (
    <>
      <TablePageLayout filters={filterBar} table={table} pagination={paginationNode} />

      {/* Create/Edit Dialog */}
      <BaseDialog
        show={showEditDialog}
        title={isEditing ? t('admin.announcements.editAnnouncement') : t('admin.announcements.createAnnouncement')}
        width="wide"
        onClose={closeEdit}
        footer={
          <div className={styles.footer}>
            <Button type="button" variant="secondary" onClick={closeEdit}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="announcement-form" variant="primary" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        }
      >
        <form id="announcement-form" className={styles.form} onSubmit={(event) => void handleSave(event)}>
          <Input
            label={t('admin.announcements.form.title')}
            type="text"
            value={form.title}
            required
            onChange={(e) => updateForm({ title: e.target.value })}
          />

          <Textarea
            label={t('admin.announcements.form.content')}
            value={form.content}
            rows={6}
            required
            onChange={(e) => updateForm({ content: e.target.value })}
          />

          <div className={styles.grid}>
            <div className={styles.field}>
              <span className={styles.label}>{t('admin.announcements.form.status')}</span>
              <Select
                value={form.status}
                options={statusOptions}
                aria-label={t('admin.announcements.form.status')}
                onChange={(value) => updateForm({ status: String(value) })}
              />
            </div>
            <div className={styles.field}>
              <span className={styles.label}>{t('admin.announcements.form.notifyMode')}</span>
              <Select
                value={form.notify_mode}
                options={notifyModeOptions}
                aria-label={t('admin.announcements.form.notifyMode')}
                onChange={(value) => updateForm({ notify_mode: String(value) })}
              />
              <span className={styles.hint}>{t('admin.announcements.form.notifyModeHint')}</span>
            </div>
          </div>

          <div className={styles.grid}>
            <Input
              label={t('admin.announcements.form.startsAt')}
              description={t('admin.announcements.form.startsAtHint')}
              type="datetime-local"
              max="9999-12-31T23:59"
              value={form.starts_at_str}
              onChange={(e) => updateForm({ starts_at_str: e.target.value })}
            />
            <Input
              label={t('admin.announcements.form.endsAt')}
              description={t('admin.announcements.form.endsAtHint')}
              type="datetime-local"
              max="9999-12-31T23:59"
              value={form.ends_at_str}
              onChange={(e) => updateForm({ ends_at_str: e.target.value })}
            />
          </div>

          <AnnouncementTargetingEditor
            value={form.targeting}
            onChange={(targeting) => updateForm({ targeting })}
            groups={subscriptionGroups}
          />
        </form>
      </BaseDialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        show={showDeleteDialog}
        title={t('admin.announcements.deleteAnnouncement')}
        message={t('admin.announcements.deleteConfirm')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setShowDeleteDialog(false)}
      />

      {/* Read Status Dialog */}
      <AnnouncementReadStatusDialog
        show={showReadStatusDialog}
        announcementId={readStatusAnnouncementId}
        onClose={() => setShowReadStatusDialog(false)}
      />

      <AnnouncementPopup announcement={previewAnnouncement} preview onClose={() => setPreviewAnnouncement(null)} />
    </>
  )
}
