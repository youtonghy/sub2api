import { useEffect, useRef, useState } from 'react'

import { getMyErrorDetail } from '@/api/usage'
import { Alert } from '@/components/arc/alert/alert'
import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import BaseDialog from '@/components/common/BaseDialog'
import { useI18n } from '@/i18n/useI18n'
import type { UserErrorRequestDetail } from '@/types'
import { formatDateTime } from '@/utils/format'
import styles from './UserErrorDetailModal.module.css'

export interface UserErrorDetailModalProps {
  show: boolean
  errorId: number | null
  /** 对应 Vue 版 update:show */
  onShowChange?: (show: boolean) => void
}

/** 状态码徽章：≥500 危险、429 警告、其余中性（与 Vue 版 statusClass 一致） */
function statusTone(code: number): BadgeTone {
  if (code >= 500) return 'danger'
  if (code === 429) return 'warning'
  return 'neutral'
}

/** 用户端错误请求详情弹窗 */
export default function UserErrorDetailModal({ show, errorId, onShowChange }: UserErrorDetailModalProps) {
  const { t } = useI18n()

  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [detail, setDetail] = useState<UserErrorRequestDetail | null>(null)
  const requestVersion = useRef(0)
  const [prevShow, setPrevShow] = useState(show)

  // 关闭时清空详情与错误（渲染期间按 show 变化调整状态）
  if (prevShow !== show) {
    setPrevShow(show)
    if (!show) {
      setDetail(null)
      setLoadError(false)
    }
  }

  // show / errorId 变化时加载；清理时作废进行中的请求，晚到的旧响应不会覆盖新结果
  useEffect(() => {
    const fetchDetail = async (id: number) => {
      const version = ++requestVersion.current
      setLoading(true)
      setLoadError(false)
      setDetail(null)
      try {
        const result = await getMyErrorDetail(id)
        if (version === requestVersion.current) setDetail(result)
      } catch (e) {
        if (version !== requestVersion.current) return
        console.error('[UserErrorDetailModal] Failed to load error detail:', e)
        setLoadError(true)
      } finally {
        if (version === requestVersion.current) setLoading(false)
      }
    }

    if (show && errorId != null) {
      void fetchDetail(errorId)
    }
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- 请求计数器而非 DOM 节点，清理时递增用于作废进行中的请求
      requestVersion.current++
    }
  }, [show, errorId])

  const renderBody = () => {
    if (loading) {
      return (
        <div data-testid="error-detail-loading">
          <Skeleton lines={5} label={t('common.loading')} />
        </div>
      )
    }
    if (loadError) return <Alert tone="danger" title={t('usage.errors.detail.loadFailed')} />
    if (!detail) return null
    return (
      <div className={styles.body}>
        <dl className={styles.grid}>
          <div>
            <dt>{t('usage.errors.time')}</dt>
            <dd>{formatDateTime(detail.created_at)}</dd>
          </div>
          <div>
            <dt>{t('usage.errors.model')}</dt>
            <dd>{detail.model || '-'}</dd>
          </div>
          <div>
            <dt>{t('usage.errors.endpoint')}</dt>
            <dd>{detail.inbound_endpoint || '-'}</dd>
          </div>
          <div>
            <dt>{t('usage.errors.status')}</dt>
            <dd>
              <Badge size="sm" tone={statusTone(detail.status_code)}>
                {detail.status_code || '-'}
              </Badge>
            </dd>
          </div>
          <div>
            <dt>{t('usage.errors.category')}</dt>
            <dd>{t('usage.errors.categories.' + detail.category)}</dd>
          </div>
          <div>
            <dt>{t('usage.errors.platform')}</dt>
            <dd>{detail.platform || '-'}</dd>
          </div>
          {detail.upstream_status_code != null && (
            <div>
              <dt>{t('usage.errors.detail.upstreamStatus')}</dt>
              <dd>{detail.upstream_status_code}</dd>
            </div>
          )}
        </dl>

        {detail.message ? (
          <div className={styles.field}>
            <span className={styles.label}>{t('usage.errors.message')}</span>
            <p className={styles.message}>{detail.message}</p>
          </div>
        ) : null}

        {detail.error_body ? (
          <div className={styles.field}>
            <span className={styles.label}>{t('usage.errors.detail.responseBody')}</span>
            <pre className={styles.pre}>{detail.error_body}</pre>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <BaseDialog show={show} title={t('usage.errors.detail.title')} width="wide" onClose={() => onShowChange?.(false)}>
      {renderBody()}
    </BaseDialog>
  )
}
