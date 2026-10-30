/**
 * 优惠码管理页，对应 Vue 版 views/admin/PromoCodesView.vue。
 * 工具栏（搜索、状态、刷新、创建）+ 表格区域 + 分页；创建、编辑、使用记录、删除与复制注册链接沿用 Vue 版的接口调用。
 */
import { Check, Copy, Eye, Link2, Pencil, Plus, RefreshCw, Trash2, User } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { adminAPI } from '@/api/admin'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import DataTable, { type DataTableCellContext } from '@/components/common/DataTable'
import Input from '@/components/common/Input'
import Pagination from '@/components/common/Pagination'
import SearchInput from '@/components/common/SearchInput'
import Select from '@/components/common/Select'
import Skeleton from '@/components/common/Skeleton'
import TablePageLayout from '@/components/common/TablePageLayout'
import TextArea from '@/components/common/TextArea'
import type { Column } from '@/components/common/types'
import { useClipboard } from '@/composables/useClipboard'
import { getPersistedPageSize } from '@/composables/usePersistedPageSize'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { PromoCode, PromoCodeUsage } from '@/types'
import { formatDateTime, formatDateTimeLocalInput } from '@/utils/format'
import styles from './PromoCodesView.module.css'

interface CreateForm {
  code: string
  bonus_amount: number | string
  max_uses: number | string
  expires_at_str: string
  notes: string
}

interface EditForm {
  code: string
  bonus_amount: number | string
  max_uses: number | string
  status: 'active' | 'disabled'
  expires_at_str: string
  notes: string
}

const iconProps = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

const emptyCreateForm = (): CreateForm => ({
  code: '',
  bonus_amount: 1,
  max_uses: 0,
  expires_at_str: '',
  notes: ''
})

const toNumberInput = (value: string): number | string => (value === '' ? '' : Number(value))

const isAbortError = (error: unknown) => {
  const failure = error as { name?: string; code?: string } | null
  return failure?.name === 'AbortError' || failure?.code === 'ERR_CANCELED'
}

const errorDetail = (error: unknown): string | undefined =>
  (error as { response?: { data?: { detail?: string } } } | null)?.response?.data?.detail

/** 表单字段标签，后缀以弱化文字显示（Vue 版 label 内的灰色 span） */
function FieldLabel({ htmlFor, children, suffix }: { htmlFor: string; children: ReactNode; suffix?: string }) {
  return (
    <label className={styles.label} htmlFor={htmlFor}>
      {children}
      {suffix && <span className={styles.labelSuffix}>({suffix})</span>}
    </label>
  )
}

export default function PromoCodesView() {
  const { t } = useI18n()
  const { copyToClipboard: clipboardCopy } = useClipboard()
  const fieldId = useId()

  // State
  const [codes, setCodes] = useState<PromoCode[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchQueryRef = useRef('')
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState('')
  const statusFilterRef = useRef('')

  const [pagination, setPaginationState] = useState(() => ({
    page: 1,
    page_size: getPersistedPageSize(),
    total: 0
  }))
  const paginationRef = useRef(pagination)
  const sortRef = useRef<{ sort_by: string; sort_order: 'asc' | 'desc' }>({ sort_by: 'created_at', sort_order: 'desc' })
  const abortControllerRef = useRef<AbortController | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Dialogs
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showUsagesDialog, setShowUsagesDialog] = useState(false)

  const [editingCode, setEditingCode] = useState<PromoCode | null>(null)
  const [deletingCode, setDeletingCode] = useState<PromoCode | null>(null)

  // Usages
  const [usages, setUsages] = useState<PromoCodeUsage[]>([])
  const [usagesLoading, setUsagesLoading] = useState(false)
  const currentViewingCodeRef = useRef<PromoCode | null>(null)
  const [usagesPage, setUsagesPage] = useState(1)
  const [usagesPageSize, setUsagesPageSize] = useState(20)
  const [usagesTotal, setUsagesTotal] = useState(0)

  // Forms
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreateForm)
  const [editForm, setEditForm] = useState<EditForm>({
    code: '',
    bonus_amount: 0,
    max_uses: 0,
    status: 'active',
    expires_at_str: '',
    notes: ''
  })

  const updateCreateForm = (patch: Partial<CreateForm>) => setCreateForm((prev) => ({ ...prev, ...patch }))
  const updateEditForm = (patch: Partial<EditForm>) => setEditForm((prev) => ({ ...prev, ...patch }))

  const updatePagination = (patch: Partial<typeof pagination>) => {
    paginationRef.current = { ...paginationRef.current, ...patch }
    setPaginationState(paginationRef.current)
  }

  // Options
  const filterStatusOptions = [
    { value: '', label: t('admin.promo.allStatus') },
    { value: 'active', label: t('admin.promo.statusActive') },
    { value: 'disabled', label: t('admin.promo.statusDisabled') }
  ]

  const statusOptions = [
    { value: 'active', label: t('admin.promo.statusActive') },
    { value: 'disabled', label: t('admin.promo.statusDisabled') }
  ]

  const columns: Column<PromoCode>[] = [
    { key: 'code', label: t('admin.promo.columns.code') },
    { key: 'bonus_amount', label: t('admin.promo.columns.bonusAmount'), sortable: true },
    { key: 'usage', label: t('admin.promo.columns.usage') },
    { key: 'status', label: t('admin.promo.columns.status'), sortable: true },
    { key: 'expires_at', label: t('admin.promo.columns.expiresAt'), sortable: true },
    { key: 'created_at', label: t('admin.promo.columns.createdAt'), sortable: true },
    { key: 'actions', label: t('admin.promo.columns.actions') }
  ]

  // Helpers
  const getStatusTone = (status: string, row: PromoCode): BadgeTone => {
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return 'danger'
    }
    if (row.max_uses > 0 && row.used_count >= row.max_uses) {
      return 'neutral'
    }
    return status === 'active' ? 'success' : 'neutral'
  }

  const getStatusLabel = (status: string, row: PromoCode) => {
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return t('admin.promo.statusExpired')
    }
    if (row.max_uses > 0 && row.used_count >= row.max_uses) {
      return t('admin.promo.statusMaxUsed')
    }
    return status === 'active' ? t('admin.promo.statusActive') : t('admin.promo.statusDisabled')
  }

  // API calls
  const loadCodes = async () => {
    abortControllerRef.current?.abort()
    const currentController = new AbortController()
    abortControllerRef.current = currentController
    setLoading(true)

    try {
      const response = await adminAPI.promo.list(
        paginationRef.current.page,
        paginationRef.current.page_size,
        {
          status: statusFilterRef.current || undefined,
          search: searchQueryRef.current || undefined,
          sort_by: sortRef.current.sort_by,
          sort_order: sortRef.current.sort_order
        },
        { signal: currentController.signal }
      )
      if (currentController.signal.aborted || abortControllerRef.current !== currentController) return

      setCodes(response.items)
      updatePagination({ total: response.total })
    } catch (error: unknown) {
      if (currentController.signal.aborted || abortControllerRef.current !== currentController || isAbortError(error)) {
        return
      }
      useAppStore.getState().showError(t('admin.promo.failedToLoad'))
      console.error('Error loading promo codes:', error)
    } finally {
      if (abortControllerRef.current === currentController) {
        setLoading(false)
        abortControllerRef.current = null
      }
    }
  }

  const handleSearch = () => {
    updatePagination({ page: 1 })
    void loadCodes()
  }

  const handlePageChange = (page: number) => {
    updatePagination({ page })
    void loadCodes()
  }

  const handlePageSizeChange = (pageSize: number) => {
    updatePagination({ page_size: pageSize, page: 1 })
    void loadCodes()
  }

  const handleSort = (key: string, order: 'asc' | 'desc') => {
    sortRef.current = { sort_by: key, sort_order: order }
    updatePagination({ page: 1 })
    void loadCodes()
  }

  const copyToClipboard = async (text: string) => {
    const success = await clipboardCopy(text, t('admin.promo.copied'))
    if (success) {
      setCopiedCode(text)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(() => {
        setCopiedCode(null)
      }, 2000)
    }
  }

  // Create
  const handleCreate = async (event?: FormEvent) => {
    event?.preventDefault()
    setCreating(true)
    try {
      await adminAPI.promo.create({
        code: createForm.code || undefined,
        bonus_amount: Number(createForm.bonus_amount),
        max_uses: Number(createForm.max_uses),
        expires_at: createForm.expires_at_str ? Math.floor(new Date(createForm.expires_at_str).getTime() / 1000) : undefined,
        notes: createForm.notes || undefined
      })
      useAppStore.getState().showSuccess(t('admin.promo.codeCreated'))
      setShowCreateDialog(false)
      setCreateForm(emptyCreateForm())
      void loadCodes()
    } catch (error: unknown) {
      useAppStore.getState().showError(errorDetail(error) || t('admin.promo.failedToCreate'))
    } finally {
      setCreating(false)
    }
  }

  // Edit
  const handleEdit = (code: PromoCode) => {
    setEditingCode(code)
    setEditForm({
      code: code.code,
      bonus_amount: code.bonus_amount,
      max_uses: code.max_uses,
      status: code.status,
      expires_at_str: code.expires_at
        ? formatDateTimeLocalInput(Math.floor(new Date(code.expires_at).getTime() / 1000))
        : '',
      notes: code.notes || ''
    })
    setShowEditDialog(true)
  }

  const closeEditDialog = () => {
    setShowEditDialog(false)
    setEditingCode(null)
  }

  const handleUpdate = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!editingCode) return

    setUpdating(true)
    try {
      await adminAPI.promo.update(editingCode.id, {
        code: editForm.code,
        bonus_amount: Number(editForm.bonus_amount),
        max_uses: Number(editForm.max_uses),
        status: editForm.status,
        expires_at: editForm.expires_at_str ? Math.floor(new Date(editForm.expires_at_str).getTime() / 1000) : 0,
        notes: editForm.notes
      })
      useAppStore.getState().showSuccess(t('admin.promo.codeUpdated'))
      closeEditDialog()
      void loadCodes()
    } catch (error: unknown) {
      useAppStore.getState().showError(errorDetail(error) || t('admin.promo.failedToUpdate'))
    } finally {
      setUpdating(false)
    }
  }

  // Copy Register Link
  const copyRegisterLink = async (code: PromoCode) => {
    const baseUrl = window.location.origin
    const registerLink = `${baseUrl}/register?promo=${encodeURIComponent(code.code)}`

    try {
      await navigator.clipboard.writeText(registerLink)
      useAppStore.getState().showSuccess(t('admin.promo.registerLinkCopied'))
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = registerLink
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      useAppStore.getState().showSuccess(t('admin.promo.registerLinkCopied'))
    }
  }

  // Delete
  const handleDelete = (code: PromoCode) => {
    setDeletingCode(code)
    setShowDeleteDialog(true)
  }

  const confirmDelete = async () => {
    if (!deletingCode) return

    try {
      await adminAPI.promo.delete(deletingCode.id)
      useAppStore.getState().showSuccess(t('admin.promo.codeDeleted'))
      setShowDeleteDialog(false)
      setDeletingCode(null)
      void loadCodes()
    } catch (error: unknown) {
      useAppStore.getState().showError(errorDetail(error) || t('admin.promo.failedToDelete'))
    }
  }

  // View Usages
  const loadUsages = async (page: number, pageSize: number) => {
    const code = currentViewingCodeRef.current
    if (!code) return
    setUsagesLoading(true)
    setUsages([])

    try {
      const response = await adminAPI.promo.getUsages(code.id, page, pageSize)
      setUsages(response.items)
      setUsagesTotal(response.total)
    } catch (error: unknown) {
      useAppStore.getState().showError(errorDetail(error) || t('admin.promo.failedToLoadUsages'))
    } finally {
      setUsagesLoading(false)
    }
  }

  const handleViewUsages = async (code: PromoCode) => {
    currentViewingCodeRef.current = code
    setShowUsagesDialog(true)
    setUsagesPage(1)
    await loadUsages(1, usagesPageSize)
  }

  const handleUsagesPageChange = (page: number) => {
    setUsagesPage(page)
    void loadUsages(page, usagesPageSize)
  }

  const handleUsagesPageSizeChange = (size: number) => {
    setUsagesPageSize(size)
    setUsagesPage(1)
    void loadUsages(1, size)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时拉取列表，属于与后端同步的副作用
    void loadCodes()
    return () => {
      abortControllerRef.current?.abort()
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
    // 仅在挂载时加载（Vue 版 onMounted）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cells: Record<string, (context: DataTableCellContext<PromoCode>) => ReactNode> = {
    code: ({ value }) => (
      <div className={styles.codeCell}>
        <code className={styles.code}>{value}</code>
        <button
          type="button"
          className={styles.copyButton}
          data-copied={copiedCode === value ? '' : undefined}
          title={copiedCode === value ? t('admin.promo.copied') : t('keys.copyToClipboard')}
          aria-label={copiedCode === value ? t('admin.promo.copied') : t('keys.copyToClipboard')}
          onClick={() => void copyToClipboard(value)}
        >
          {copiedCode === value ? <Check {...iconProps} /> : <Copy {...iconProps} />}
        </button>
      </div>
    ),
    bonus_amount: ({ value }) => <span className={styles.amount}>${value.toFixed(2)}</span>,
    usage: ({ row }) => (
      <span className={styles.secondary}>
        {row.used_count} / {row.max_uses === 0 ? '∞' : row.max_uses}
      </span>
    ),
    status: ({ value, row }) => <Badge tone={getStatusTone(value, row)}>{getStatusLabel(value, row)}</Badge>,
    expires_at: ({ value }) => (
      <span className={styles.secondary}>{value ? formatDateTime(value) : t('admin.promo.neverExpires')}</span>
    ),
    created_at: ({ value }) => <span className={styles.secondary}>{formatDateTime(value)}</span>,
    actions: ({ row }) => (
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.actionButton}
          data-tone="success"
          title={t('admin.promo.copyRegisterLink')}
          aria-label={t('admin.promo.copyRegisterLink')}
          onClick={() => void copyRegisterLink(row)}
        >
          <Link2 {...iconProps} />
        </button>
        <button
          type="button"
          className={styles.actionButton}
          data-tone="accent"
          title={t('admin.promo.viewUsages')}
          aria-label={t('admin.promo.viewUsages')}
          onClick={() => void handleViewUsages(row)}
        >
          <Eye {...iconProps} />
        </button>
        <button
          type="button"
          className={styles.actionButton}
          title={t('common.edit')}
          aria-label={t('common.edit')}
          onClick={() => handleEdit(row)}
        >
          <Pencil {...iconProps} />
        </button>
        <button
          type="button"
          className={styles.actionButton}
          data-tone="danger"
          title={t('common.delete')}
          aria-label={t('common.delete')}
          onClick={() => handleDelete(row)}
        >
          <Trash2 {...iconProps} />
        </button>
      </div>
    )
  }

  const filtersBar = (
    <div className={styles.toolbar}>
      {/* Left: Search + Filters */}
      <div className={styles.search}>
        <SearchInput
          value={searchQuery}
          placeholder={t('admin.promo.searchCodes')}
          onChange={(value) => {
            searchQueryRef.current = value
            setSearchQuery(value)
          }}
          onSearch={handleSearch}
        />
      </div>
      <div className={styles.filter}>
        <Select
          value={statusFilter}
          options={filterStatusOptions}
          onChange={(value) => {
            statusFilterRef.current = String(value ?? '')
            setStatusFilter(statusFilterRef.current)
            void loadCodes()
          }}
        />
      </div>

      {/* Right: Action buttons */}
      <div className={styles.toolbarActions}>
        <Button
          type="button"
          variant="secondary"
          disabled={loading}
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
          onClick={() => void loadCodes()}
        >
          <RefreshCw {...iconProps} className={loading ? styles.spinning : undefined} />
        </Button>
        <Button type="button" variant="primary" onClick={() => setShowCreateDialog(true)}>
          <Plus {...iconProps} />
          {t('admin.promo.createCode')}
        </Button>
      </div>
    </div>
  )

  const table = (
    <div className={styles.region}>
      <DataTable<PromoCode>
        columns={columns}
        data={codes}
        loading={loading}
        serverSideSort
        defaultSortKey="created_at"
        defaultSortOrder="desc"
        onSort={handleSort}
        cells={cells}
        className={styles.dataTable}
      />
    </div>
  )

  const id = (name: string) => `${fieldId}-${name}`

  return (
    <>
      <TablePageLayout
        filters={filtersBar}
        table={table}
        pagination={
          pagination.total > 0 ? (
            <Pagination
              page={pagination.page}
              total={pagination.total}
              pageSize={pagination.page_size}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          ) : null
        }
      />

      {/* Create Dialog */}
      <BaseDialog
        show={showCreateDialog}
        title={t('admin.promo.createCode')}
        width="normal"
        onClose={() => setShowCreateDialog(false)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setShowCreateDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="create-promo-form" variant="primary" disabled={creating}>
              {creating ? t('common.creating') : t('common.create')}
            </Button>
          </>
        }
      >
        <form id="create-promo-form" className={styles.form} onSubmit={(event) => void handleCreate(event)}>
          <div className={styles.field}>
            <FieldLabel htmlFor={id('create-code')} suffix={t('admin.promo.autoGenerate')}>
              {t('admin.promo.code')}
            </FieldLabel>
            <Input
              id={id('create-code')}
              className={styles.mono}
              value={createForm.code}
              placeholder={t('admin.promo.codePlaceholder')}
              onChange={(value) => updateCreateForm({ code: value })}
            />
          </div>
          <Input
            type="number"
            step="0.01"
            min="0"
            required
            label={t('admin.promo.bonusAmount')}
            value={createForm.bonus_amount}
            onChange={(value) => updateCreateForm({ bonus_amount: toNumberInput(value) })}
          />
          <div className={styles.field}>
            <FieldLabel htmlFor={id('create-max-uses')} suffix={t('admin.promo.zeroUnlimited')}>
              {t('admin.promo.maxUses')}
            </FieldLabel>
            <Input
              id={id('create-max-uses')}
              type="number"
              min="0"
              value={createForm.max_uses}
              onChange={(value) => updateCreateForm({ max_uses: toNumberInput(value) })}
            />
          </div>
          <div className={styles.field}>
            <FieldLabel htmlFor={id('create-expires')} suffix={t('common.optional')}>
              {t('admin.promo.expiresAt')}
            </FieldLabel>
            <Input
              id={id('create-expires')}
              type="datetime-local"
              value={createForm.expires_at_str}
              onChange={(value) => updateCreateForm({ expires_at_str: value })}
            />
          </div>
          <div className={styles.field}>
            <FieldLabel htmlFor={id('create-notes')} suffix={t('common.optional')}>
              {t('admin.promo.notes')}
            </FieldLabel>
            <TextArea
              id={id('create-notes')}
              rows={2}
              value={createForm.notes}
              placeholder={t('admin.promo.notesPlaceholder')}
              onChange={(value) => updateCreateForm({ notes: value })}
            />
          </div>
        </form>
      </BaseDialog>

      {/* Edit Dialog */}
      <BaseDialog
        show={showEditDialog}
        title={t('admin.promo.editCode')}
        width="normal"
        onClose={closeEditDialog}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeEditDialog}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="edit-promo-form" variant="primary" disabled={updating}>
              {updating ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="edit-promo-form" className={styles.form} onSubmit={(event) => void handleUpdate(event)}>
          <Input
            className={styles.mono}
            label={t('admin.promo.code')}
            value={editForm.code}
            onChange={(value) => updateEditForm({ code: value })}
          />
          <Input
            type="number"
            step="0.01"
            min="0"
            required
            label={t('admin.promo.bonusAmount')}
            value={editForm.bonus_amount}
            onChange={(value) => updateEditForm({ bonus_amount: toNumberInput(value) })}
          />
          <div className={styles.field}>
            <FieldLabel htmlFor={id('edit-max-uses')} suffix={t('admin.promo.zeroUnlimited')}>
              {t('admin.promo.maxUses')}
            </FieldLabel>
            <Input
              id={id('edit-max-uses')}
              type="number"
              min="0"
              value={editForm.max_uses}
              onChange={(value) => updateEditForm({ max_uses: toNumberInput(value) })}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.label}>{t('admin.promo.status')}</span>
            <Select
              value={editForm.status}
              options={statusOptions}
              onChange={(value) => updateEditForm({ status: value as 'active' | 'disabled' })}
            />
          </div>
          <div className={styles.field}>
            <FieldLabel htmlFor={id('edit-expires')} suffix={t('common.optional')}>
              {t('admin.promo.expiresAt')}
            </FieldLabel>
            <Input
              id={id('edit-expires')}
              type="datetime-local"
              value={editForm.expires_at_str}
              onChange={(value) => updateEditForm({ expires_at_str: value })}
            />
          </div>
          <div className={styles.field}>
            <FieldLabel htmlFor={id('edit-notes')} suffix={t('common.optional')}>
              {t('admin.promo.notes')}
            </FieldLabel>
            <TextArea id={id('edit-notes')} rows={2} value={editForm.notes} onChange={(value) => updateEditForm({ notes: value })} />
          </div>
        </form>
      </BaseDialog>

      {/* Usages Dialog */}
      <BaseDialog
        show={showUsagesDialog}
        title={t('admin.promo.usageRecords')}
        width="wide"
        onClose={() => setShowUsagesDialog(false)}
        footer={
          <Button type="button" variant="secondary" onClick={() => setShowUsagesDialog(false)}>
            {t('common.close')}
          </Button>
        }
      >
        {usagesLoading ? (
          <div className={styles.usages} aria-busy="true">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} height={58} />
            ))}
          </div>
        ) : usages.length === 0 ? (
          <p className={styles.emptyUsages}>{t('admin.promo.noUsages')}</p>
        ) : (
          <div className={styles.usages}>
            {usages.map((usage) => (
              <div key={usage.id} className={styles.usage}>
                <div className={styles.usageUser}>
                  <span className={styles.usageAvatar} aria-hidden="true">
                    <User {...iconProps} />
                  </span>
                  <div>
                    <p className={styles.usageEmail}>
                      {usage.user?.email || t('admin.promo.userPrefix', { id: usage.user_id })}
                    </p>
                    <p className={styles.usageTime}>{formatDateTime(usage.used_at)}</p>
                  </div>
                </div>
                <span className={styles.usageBonus}>+${usage.bonus_amount.toFixed(2)}</span>
              </div>
            ))}
            {/* Usages Pagination */}
            {usagesTotal > usagesPageSize && (
              <div className={styles.usagesPagination}>
                <Pagination
                  page={usagesPage}
                  total={usagesTotal}
                  pageSize={usagesPageSize}
                  onPageChange={handleUsagesPageChange}
                  onPageSizeChange={handleUsagesPageSizeChange}
                />
              </div>
            )}
          </div>
        )}
      </BaseDialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        show={showDeleteDialog}
        title={t('admin.promo.deleteCode')}
        message={t('admin.promo.deleteCodeConfirm')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setShowDeleteDialog(false)}
      />
    </>
  )
}
