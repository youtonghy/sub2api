import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { adminUsageAPI } from '@/api/admin/usage'
import type { AdminUsageQueryParams, CreateUsageCleanupTaskRequest, UsageCleanupTask } from '@/api/admin/usage'
import { Alert } from '@/components/arc/alert/alert'
import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import Pagination from '@/components/common/Pagination'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { requestTypeToLegacyStream } from '@/utils/usageRequestType'
import UsageFilters, { type UsageFiltersValue } from './UsageFilters'
import styles from './UsageCleanupDialog.module.css'

export interface UsageCleanupDialogProps {
  show: boolean
  filters: AdminUsageQueryParams
  startDate: string
  endDate: string
  onClose?: () => void
}

const STATUS_TONE: Record<string, BadgeTone> = {
  pending: 'warning',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  canceled: 'neutral'
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

const formatRange = (task: UsageCleanupTask) => {
  const start = formatDateTime(task.filters.start_time)
  const end = formatDateTime(task.filters.end_time)
  return `${start} ~ ${end}`
}

const getUserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

const canCancel = (task: UsageCleanupTask) => task.status === 'pending' || task.status === 'running'

export default function UsageCleanupDialog({ show, filters, startDate, endDate, onClose }: UsageCleanupDialogProps) {
  const { t } = useI18n()

  const [localFilters, setLocalFilters] = useState<AdminUsageQueryParams>({})
  const localFiltersRef = useRef<AdminUsageQueryParams>({})
  const [localStartDate, setLocalStartDate] = useState('')
  const [localEndDate, setLocalEndDate] = useState('')
  const localRangeRef = useRef({ start: '', end: '' })

  const [tasks, setTasks] = useState<UsageCleanupTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [tasksPage, setTasksPage] = useState(1)
  const [tasksPageSize, setTasksPageSize] = useState(5)
  const [tasksTotal, setTasksTotal] = useState(0)
  const pageRef = useRef({ page: 1, pageSize: 5 })
  const [submitting, setSubmitting] = useState(false)
  const [confirmVisible, setConfirmVisible] = useState(false)
  const [cancelConfirmVisible, setCancelConfirmVisible] = useState(false)
  const [, setCanceling] = useState(false)
  const cancelTargetRef = useRef<UsageCleanupTask | null>(null)
  const pollTimer = useRef<number | null>(null)
  const taskRequestId = useRef(0)
  const showRef = useRef(show)
  const propsRef = useRef({ filters, startDate, endDate, onClose })
  useLayoutEffect(() => {
    showRef.current = show
    propsRef.current = { filters, startDate, endDate, onClose }
  })

  const setPage = (page: number) => {
    pageRef.current.page = page
    setTasksPage(page)
  }
  const setPageSize = (size: number) => {
    pageRef.current.pageSize = size
    setTasksPageSize(size)
  }

  const updateLocalFilters = (next: UsageFiltersValue) => {
    localFiltersRef.current = next as AdminUsageQueryParams
    setLocalFilters(next as AdminUsageQueryParams)
  }

  const resetFilters = () => {
    const { filters: source, startDate: start, endDate: end } = propsRef.current
    localRangeRef.current = { start, end }
    setLocalStartDate(start)
    setLocalEndDate(end)
    updateLocalFilters({ ...source, start_date: start, end_date: end })
    setPage(1)
    setTasksTotal(0)
  }

  const stopPolling = () => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }

  const loadTasks = async () => {
    if (!showRef.current) return
    const requestId = ++taskRequestId.current
    setTasksLoading(true)
    try {
      const res = await adminUsageAPI.listCleanupTasks({
        page: pageRef.current.page,
        page_size: pageRef.current.pageSize
      })
      if (requestId !== taskRequestId.current) return
      setTasks(res.items || [])
      setTasksTotal(res.total || 0)
      if (res.page) {
        setPage(res.page)
      }
      if (res.page_size) {
        setPageSize(res.page_size)
      }
    } catch (error) {
      if (requestId !== taskRequestId.current) return
      console.error('Failed to load cleanup tasks:', error)
      useAppStore.getState().showError(t('admin.usage.cleanup.loadFailed'))
    } finally {
      if (requestId === taskRequestId.current) setTasksLoading(false)
    }
  }
  const loadTasksRef = useRef(loadTasks)
  useLayoutEffect(() => {
    loadTasksRef.current = loadTasks
  })

  const startPolling = () => {
    stopPolling()
    pollTimer.current = window.setInterval(() => {
      void loadTasksRef.current()
    }, 10000)
  }

  const handleClose = () => {
    taskRequestId.current++
    stopPolling()
    setConfirmVisible(false)
    setCancelConfirmVisible(false)
    setCanceling(false)
    cancelTargetRef.current = null
    setSubmitting(false)
    propsRef.current.onClose?.()
  }

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      pending: t('admin.usage.cleanup.status.pending'),
      running: t('admin.usage.cleanup.status.running'),
      succeeded: t('admin.usage.cleanup.status.succeeded'),
      failed: t('admin.usage.cleanup.status.failed'),
      canceled: t('admin.usage.cleanup.status.canceled')
    }
    return map[status] || status
  }

  const handleTaskPageChange = (page: number) => {
    setPage(page)
    void loadTasks()
  }

  const handleTaskPageSizeChange = (size: number) => {
    if (!Number.isFinite(size) || size <= 0) return
    setPageSize(size)
    setPage(1)
    void loadTasks()
  }

  const openCancelConfirm = (task: UsageCleanupTask) => {
    cancelTargetRef.current = task
    setCancelConfirmVisible(true)
  }

  const buildPayload = (): CreateUsageCleanupTaskRequest | null => {
    const { start, end } = localRangeRef.current
    const current = localFiltersRef.current
    if (!start || !end) {
      useAppStore.getState().showError(t('admin.usage.cleanup.missingRange'))
      return null
    }

    const payload: CreateUsageCleanupTaskRequest = {
      start_date: start,
      end_date: end,
      timezone: getUserTimezone()
    }

    if (current.user_id && current.user_id > 0) {
      payload.user_id = current.user_id
    }
    if (current.api_key_id && current.api_key_id > 0) {
      payload.api_key_id = current.api_key_id
    }
    if (current.account_id && current.account_id > 0) {
      payload.account_id = current.account_id
    }
    if (current.group_id && current.group_id > 0) {
      payload.group_id = current.group_id
    }
    if (current.model) {
      payload.model = current.model
    }
    if (current.request_type) {
      payload.request_type = current.request_type
      const legacyStream = requestTypeToLegacyStream(current.request_type)
      if (legacyStream !== null && legacyStream !== undefined) {
        payload.stream = legacyStream
      }
    } else if (current.stream !== null && current.stream !== undefined) {
      payload.stream = current.stream
    }
    if (current.billing_type !== null && current.billing_type !== undefined) {
      payload.billing_type = current.billing_type
    }

    return payload
  }

  const submitCleanup = async () => {
    const payload = buildPayload()
    if (!payload) {
      setConfirmVisible(false)
      return
    }
    setSubmitting(true)
    setConfirmVisible(false)
    try {
      await adminUsageAPI.createCleanupTask(payload)
      useAppStore.getState().showSuccess(t('admin.usage.cleanup.submitSuccess'))
      void loadTasks()
    } catch (error) {
      console.error('Failed to create cleanup task:', error)
      useAppStore.getState().showError(t('admin.usage.cleanup.submitFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const cancelTask = async () => {
    const task = cancelTargetRef.current
    if (!task) {
      setCancelConfirmVisible(false)
      return
    }
    setCanceling(true)
    setCancelConfirmVisible(false)
    try {
      await adminUsageAPI.cancelCleanupTask(task.id)
      useAppStore.getState().showSuccess(t('admin.usage.cleanup.cancelSuccess'))
      void loadTasks()
    } catch (error) {
      console.error('Failed to cancel cleanup task:', error)
      useAppStore.getState().showError(t('admin.usage.cleanup.cancelFailed'))
    } finally {
      setCanceling(false)
      cancelTargetRef.current = null
    }
  }

  useEffect(() => {
    if (show) {
      resetFilters()
      void loadTasksRef.current()
      startPolling()
    } else {
      taskRequestId.current++
      stopPolling()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  useEffect(
    () => () => {
      taskRequestId.current++
      stopPolling()
    },
    []
  )

  const renderTasks = () => {
    if (tasksLoading) return <p className={styles.muted}>{t('admin.usage.cleanup.loadingTasks')}</p>
    if (tasks.length === 0) return <p className={styles.muted}>{t('admin.usage.cleanup.noTasks')}</p>
    return (
      <ul className={styles.taskList}>
        {tasks.map((task) => (
          <li key={task.id} className={styles.task}>
            <div className={styles.taskHead}>
              <div className={styles.taskMeta}>
                <Badge tone={STATUS_TONE[task.status] ?? 'neutral'} size="sm">
                  {statusLabel(task.status)}
                </Badge>
                <span className={styles.taskId}>#{task.id}</span>
                {canCancel(task) ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => openCancelConfirm(task)}>
                    {t('admin.usage.cleanup.cancel')}
                  </Button>
                ) : null}
              </div>
              <div className={styles.taskTime}>{formatDateTime(task.created_at)}</div>
            </div>
            <div className={styles.taskDetails}>
              <span>
                {t('admin.usage.cleanup.range')}: {formatRange(task)}
              </span>
              <span>
                {t('admin.usage.cleanup.deletedRows')}: {task.deleted_rows.toLocaleString()}
              </span>
            </div>
            {task.error_message ? <div className={styles.taskError}>{task.error_message}</div> : null}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <>
      <BaseDialog
        show={show}
        title={t('admin.usage.cleanup.title')}
        width="wide"
        onClose={handleClose}
        footer={
          <div className={styles.footer}>
            <Button type="button" variant="secondary" onClick={handleClose}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="danger" disabled={submitting} onClick={() => setConfirmVisible(true)}>
              {submitting ? t('admin.usage.cleanup.submitting') : t('admin.usage.cleanup.submit')}
            </Button>
          </div>
        }
      >
        <div className={styles.content}>
          <UsageFilters
            value={localFilters}
            onValueChange={updateLocalFilters}
            startDate={localStartDate}
            endDate={localEndDate}
            exporting={false}
            showActions={false}
            flat
          />

          <Alert tone="warning" title={t('admin.usage.cleanup.warning')} />

          <section className={styles.tasks}>
            <div className={styles.tasksHeader}>
              <h4 className={styles.tasksTitle}>{t('admin.usage.cleanup.recentTasks')}</h4>
              <Button type="button" variant="ghost" size="sm" onClick={() => void loadTasks()}>
                {t('common.refresh')}
              </Button>
            </div>

            {renderTasks()}

            {tasksTotal > tasksPageSize ? (
              <Pagination
                total={tasksTotal}
                page={tasksPage}
                pageSize={tasksPageSize}
                pageSizeOptions={[5]}
                showPageSizeSelector={false}
                showJump
                onPageChange={handleTaskPageChange}
                onPageSizeChange={handleTaskPageSizeChange}
              />
            ) : null}
          </section>
        </div>
      </BaseDialog>

      <ConfirmDialog
        show={confirmVisible}
        title={t('admin.usage.cleanup.confirmTitle')}
        message={t('admin.usage.cleanup.confirmMessage')}
        confirmText={t('admin.usage.cleanup.confirmSubmit')}
        danger
        onConfirm={() => void submitCleanup()}
        onCancel={() => setConfirmVisible(false)}
      />

      <ConfirmDialog
        show={cancelConfirmVisible}
        title={t('admin.usage.cleanup.cancelConfirmTitle')}
        message={t('admin.usage.cleanup.cancelConfirmMessage')}
        confirmText={t('admin.usage.cleanup.cancelConfirm')}
        danger
        onConfirm={() => void cancelTask()}
        onCancel={() => setCancelConfirmVisible(false)}
      />
    </>
  )
}
