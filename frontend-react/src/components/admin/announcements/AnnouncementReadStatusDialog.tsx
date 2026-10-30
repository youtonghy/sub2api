import { RefreshCw } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import DataTable from '@/components/common/DataTable'
import Pagination from '@/components/common/Pagination'
import SearchInput from '@/components/common/SearchInput'
import type { Column } from '@/components/common/types'
import { getPersistedPageSize } from '@/composables/usePersistedPageSize'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AnnouncementUserReadStatus } from '@/types'
import { formatDateTime } from '@/utils/format'
import styles from './AnnouncementReadStatusDialog.module.css'

export interface AnnouncementReadStatusDialogProps {
  show: boolean
  announcementId: number | null
  onClose?: () => void
}

interface PaginationState {
  page: number
  page_size: number
  total: number
  pages: number
}

type RequestError = { name?: string; code?: string; response?: { data?: { detail?: string } } } | null

export default function AnnouncementReadStatusDialog({ show, announcementId, onClose }: AnnouncementReadStatusDialogProps) {
  const { t } = useI18n()

  const [loading, setLoading] = useState(false)
  const [search, setSearchState] = useState('')
  const [pagination, setPaginationState] = useState<PaginationState>(() => ({
    page: 1,
    page_size: getPersistedPageSize(),
    total: 0,
    pages: 0
  }))
  const [items, setItems] = useState<AnnouncementUserReadStatus[]>([])

  // 最新查询参数（同步读写，保持 Vue 版语义）
  const stateRef = useRef({
    search: '',
    pagination: pagination,
    sort_by: 'email',
    sort_order: 'asc' as 'asc' | 'desc'
  })
  const propsRef = useRef({ show, announcementId, onClose })
  useLayoutEffect(() => {
    propsRef.current = { show, announcementId, onClose }
  })

  const currentController = useRef<AbortController | null>(null)
  const searchDebounceTimer = useRef<number | null>(null)

  const setPagination = (patch: Partial<PaginationState>) => {
    stateRef.current.pagination = { ...stateRef.current.pagination, ...patch }
    setPaginationState(stateRef.current.pagination)
  }
  const setSearch = (value: string) => {
    stateRef.current.search = value
    setSearchState(value)
  }

  const columns: Column<AnnouncementUserReadStatus>[] = [
    { key: 'email', label: t('common.email'), sortable: true },
    { key: 'username', label: t('admin.users.columns.username'), sortable: true },
    { key: 'balance', label: t('common.balance'), sortable: true },
    { key: 'eligible', label: t('admin.announcements.eligible') },
    { key: 'read_at', label: t('admin.announcements.readAt') }
  ]

  function resetDialogState() {
    setLoading(false)
    setSearch('')
    setItems([])
    setPagination({ page: 1, total: 0, pages: 0 })
    stateRef.current.sort_by = 'email'
    stateRef.current.sort_order = 'asc'
  }

  function cancelPendingLoad(resetState = false) {
    if (searchDebounceTimer.current) {
      window.clearTimeout(searchDebounceTimer.current)
      searchDebounceTimer.current = null
    }
    currentController.current?.abort()
    currentController.current = null
    if (resetState) {
      resetDialogState()
    }
  }

  async function load() {
    const { show: visible, announcementId: id } = propsRef.current
    if (!visible || !id) return

    currentController.current?.abort()
    const requestController = new AbortController()
    currentController.current = requestController
    const { signal } = requestController

    try {
      setLoading(true)
      const current = stateRef.current
      const res = await adminAPI.announcements.getReadStatus(
        id,
        current.pagination.page,
        current.pagination.page_size,
        {
          search: current.search,
          sort_by: current.sort_by,
          sort_order: current.sort_order
        },
        { signal }
      )

      if (signal.aborted || currentController.current !== requestController) return

      setItems(res.items)
      setPagination({ total: res.total, pages: res.pages, page: res.page, page_size: res.page_size })
    } catch (error: unknown) {
      const err = error as RequestError
      if (
        signal.aborted ||
        currentController.current !== requestController ||
        err?.name === 'AbortError' ||
        err?.code === 'ERR_CANCELED'
      ) {
        return
      }
      console.error('Failed to load read status:', error)
      useAppStore.getState().showError(err?.response?.data?.detail || t('admin.announcements.failedToLoadReadStatus'))
    } finally {
      if (currentController.current === requestController) {
        setLoading(false)
        currentController.current = null
      }
    }
  }
  const loadRef = useRef(load)
  useLayoutEffect(() => {
    loadRef.current = load
  })

  function handlePageChange(page: number) {
    setPagination({ page })
    void load()
  }

  function handlePageSizeChange(pageSize: number) {
    setPagination({ page_size: pageSize, page: 1 })
    void load()
  }

  function handleSort(key: string, order: 'asc' | 'desc') {
    stateRef.current.sort_by = key
    stateRef.current.sort_order = order
    setPagination({ page: 1 })
    void load()
  }

  function handleSearch(value: string) {
    setSearch(value)
    if (searchDebounceTimer.current) window.clearTimeout(searchDebounceTimer.current)
    searchDebounceTimer.current = window.setTimeout(() => {
      searchDebounceTimer.current = null
      setPagination({ page: 1 })
      void loadRef.current()
    }, 300)
  }

  function handleClose() {
    cancelPendingLoad(true)
    propsRef.current.onClose?.()
  }

  useEffect(() => {
    if (!show) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 与 Vue 版 watch(show) 一致，关闭时取消请求并重置状态
      cancelPendingLoad(true)
      return
    }
    setPagination({ page: 1 })
    void loadRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  const lastAnnouncementId = useRef(announcementId)
  useEffect(() => {
    if (lastAnnouncementId.current === announcementId) return
    lastAnnouncementId.current = announcementId
    if (!propsRef.current.show) return
    setPagination({ page: 1 })
    void loadRef.current()
  }, [announcementId])

  useEffect(() => {
    const timer = searchDebounceTimer
    const controller = currentController
    return () => {
      // 卸载：清除防抖并取消进行中的请求（不重置状态）
      if (timer.current) window.clearTimeout(timer.current)
      controller.current?.abort()
    }
  }, [])

  return (
    <BaseDialog
      show={show}
      title={t('admin.announcements.readStatus')}
      width="extra-wide"
      onClose={handleClose}
      footer={
        <div className={styles.footer}>
          <Button type="button" variant="secondary" onClick={handleClose}>
            {t('common.close')}
          </Button>
        </div>
      }
    >
      <div className={styles.content}>
        <div className={styles.toolbar}>
          <SearchInput
            className={styles.search}
            value={search}
            placeholder={t('admin.announcements.searchUsers')}
            onChange={handleSearch}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={loading}
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            onClick={() => void load()}
          >
            <RefreshCw size={16} strokeWidth={1.75} className={loading ? styles.spinning : undefined} aria-hidden="true" />
          </Button>
        </div>

        <div className={styles.table}>
          <DataTable
            columns={columns}
            data={items}
            loading={loading}
            rowKey="user_id"
            serverSideSort
            defaultSortKey="email"
            defaultSortOrder="asc"
            onSort={handleSort}
            cells={{
              email: ({ value }) => <span className={styles.strong}>{value}</span>,
              balance: ({ value }) => <span className={styles.strong}>${Number(value ?? 0).toFixed(2)}</span>,
              eligible: ({ value }) => (
                <Badge tone={value ? 'success' : 'neutral'} size="sm">
                  {value ? t('admin.announcements.eligible') : t('common.no')}
                </Badge>
              ),
              read_at: ({ value }) => (
                <span className={styles.muted}>{value ? formatDateTime(value) : t('admin.announcements.unread')}</span>
              )
            }}
          />
        </div>

        {pagination.total > 0 ? (
          <Pagination
            page={pagination.page}
            total={pagination.total}
            pageSize={pagination.page_size}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        ) : null}
      </div>
    </BaseDialog>
  )
}
