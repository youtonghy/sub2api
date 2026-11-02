import { ChevronDown, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { opsAPI, type OpsErrorDetail } from '@/api/admin/ops'
import { Alert } from '@/components/arc/alert/alert'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import BaseDialog from '@/components/common/BaseDialog'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores'
import { formatDateTime } from '@/utils/format'
import { resolveUpstreamPayload } from '../utils/errorDetailResponse'
import { statusCodeTone } from './opsBadgeTones'
import styles from './OpsErrorDetailModal.module.css'

export interface OpsErrorDetailModalProps {
  show: boolean
  errorId: number | null
  errorType?: 'request' | 'upstream'
  backToList?: boolean
  onShowChange?: (value: boolean) => void
  onBack?: () => void
}

type DiagnosticPayloadKey = 'client' | 'upstream_message' | 'upstream_detail' | 'upstream_events'

function meaningfulPayload(candidate: unknown): string {
  const value = String(candidate || '').trim()
  if (!value || value === '[]' || value === '{}' || value.toLowerCase() === 'null') return ''
  return value
}

function isUpstreamError(d: OpsErrorDetail | null): boolean {
  if (!d) return false
  const phase = String(d.phase || '').toLowerCase()
  const owner = String(d.error_owner || '').toLowerCase()
  return phase === 'upstream' && owner === 'provider'
}

function hasModelMapping(d: OpsErrorDetail | null): boolean {
  if (!d) return false
  const requested = String(d.requested_model || '').trim()
  const upstream = String(d.upstream_model || '').trim()
  return !!requested && !!upstream && requested !== upstream
}

function displayModel(d: OpsErrorDetail | null): string {
  if (!d) return ''
  const upstream = String(d.upstream_model || '').trim()
  if (upstream) return upstream
  const requested = String(d.requested_model || '').trim()
  if (requested) return requested
  return String(d.model || '').trim()
}

function getUpstreamResponsePreview(ev: OpsErrorDetail): string {
  const upstreamPayload = resolveUpstreamPayload(ev)
  if (upstreamPayload) return upstreamPayload
  return String(ev.error_body || '').trim()
}

function prettyJSON(raw?: string): string {
  if (!raw) return 'N/A'
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export default function OpsErrorDetailModal({ show, errorId, errorType, backToList = false, onShowChange, onBack }: OpsErrorDetailModalProps) {
  const { t } = useI18n()

  const [loading, setLoading] = useState(false)
  // 记录详情所属的错误 ID；关闭或切换 ID 时不再展示旧详情（Vue 版在关闭时把 detail 置空）
  const [result, setResult] = useState<{ id: number; detail: OpsErrorDetail | null } | null>(null)
  const detail = show && result && result.id === errorId ? result.detail : null
  const [correlatedUpstream, setCorrelatedUpstream] = useState<OpsErrorDetail[]>([])
  const [correlatedUpstreamLoading, setCorrelatedUpstreamLoading] = useState(false)
  const [expandedUpstreamDetailIds, setExpandedUpstreamDetailIds] = useState<Set<number>>(() => new Set())

  const detailRef = useRef(result?.detail ?? null)
  const errorTypeRef = useRef(errorType)
  const detailSeq = useRef(0)
  const upstreamSeq = useRef(0)
  useEffect(() => {
    detailRef.current = result?.detail ?? null
    errorTypeRef.current = errorType
  })

  // 已打开但当前 ID 的详情还没返回：按加载中展示
  const pending = show && typeof errorId === 'number' && errorId > 0 && (!result || result.id !== errorId)
  const showUpstreamList = errorType === 'request'
  const requestId = detail?.request_id || detail?.client_request_id || ''

  let rootCauseMessage = ''
  if (detail) {
    for (const candidate of [detail.upstream_error_message, detail.upstream_error_detail, detail.message, detail.error_body]) {
      const value = meaningfulPayload(candidate)
      if (value) {
        rootCauseMessage = value
        break
      }
    }
  }

  const diagnosticPayloadSections: Array<{ key: DiagnosticPayloadKey; value: string }> = detail
    ? ([
        { key: 'client', value: meaningfulPayload(detail.error_body) },
        { key: 'upstream_message', value: meaningfulPayload(detail.upstream_error_message) },
        { key: 'upstream_detail', value: meaningfulPayload(detail.upstream_error_detail) },
        { key: 'upstream_events', value: meaningfulPayload(detail.upstream_errors) }
      ] as Array<{ key: DiagnosticPayloadKey; value: string }>).filter(
        (section, index, all) => section.value && all.findIndex((candidate) => candidate.value === section.value) === index
      )
    : []

  const title = errorId ? t('admin.ops.errorDetail.titleWithId', { id: String(errorId) }) : t('admin.ops.errorDetail.title')

  const formatRequestTypeLabel = (type: number | null | undefined): string => {
    switch (type) {
      case 1: return t('admin.ops.errorDetail.requestTypeSync')
      case 2: return t('admin.ops.errorDetail.requestTypeStream')
      case 3: return t('admin.ops.errorDetail.requestTypeWs')
      default: return t('admin.ops.errorDetail.requestTypeUnknown')
    }
  }

  const toggleUpstreamDetail = (id: number) => {
    setExpandedUpstreamDetailIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const fetchCorrelatedUpstreamErrors = useCallback(async (requestErrorId: number) => {
    const seq = ++upstreamSeq.current
    setCorrelatedUpstreamLoading(true)
    try {
      const res = await opsAPI.listRequestErrorUpstreamErrors(
        requestErrorId,
        { page: 1, page_size: 100, view: 'all' },
        { include_detail: true }
      )
      if (seq !== upstreamSeq.current) return
      setCorrelatedUpstream(res.items || [])
    } catch (err) {
      if (seq !== upstreamSeq.current) return
      console.error('[OpsErrorDetailModal] Failed to load correlated upstream errors', err)
      setCorrelatedUpstream([])
    } finally {
      if (seq === upstreamSeq.current) setCorrelatedUpstreamLoading(false)
    }
  }, [])

  const fetchDetail = useCallback(async (id: number) => {
    const seq = ++detailSeq.current
    setLoading(true)
    try {
      const kind = errorTypeRef.current || (detailRef.current?.phase === 'upstream' ? 'upstream' : 'request')
      const d = kind === 'upstream' ? await opsAPI.getUpstreamErrorDetail(id) : await opsAPI.getRequestErrorDetail(id)
      if (seq !== detailSeq.current) return
      setResult({ id, detail: d })
    } catch (err: any) {
      if (seq !== detailSeq.current) return
      setResult({ id, detail: null })
      useAppStore.getState().showError(err?.message || t('admin.ops.failedToLoadErrorDetail'))
    } finally {
      if (seq === detailSeq.current) setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (!show) {
      // 关闭时作废进行中的请求
      detailSeq.current += 1
      upstreamSeq.current += 1
      return
    }
    if (typeof errorId === 'number' && errorId > 0) {
      // 对应 Vue 的 watch([show, errorId], { immediate: true })：打开或切换 ID 时重置展开状态并拉取详情
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 与后端同步的副作用
      setExpandedUpstreamDetailIds(new Set())
      void fetchDetail(errorId)
      if (errorTypeRef.current === 'request') {
        void fetchCorrelatedUpstreamErrors(errorId)
      } else {
        upstreamSeq.current += 1
        setCorrelatedUpstream([])
      }
    }
  }, [show, errorId, fetchDetail, fetchCorrelatedUpstreamErrors])

  const close = () => onShowChange?.(false)

  const goBack = () => {
    onShowChange?.(false)
    onBack?.()
  }

  const field = (label: string, value: ReactNode, mono = false) => (
    <div className={styles.field}>
      <dt className={styles.fieldLabel}>{label}</dt>
      <dd className={[styles.fieldValue, mono ? styles.mono : ''].filter(Boolean).join(' ')}>{value}</dd>
    </div>
  )

  const renderBody = () => {
    if (loading || pending) {
      return (
        <div className={styles.loading}>
          <Skeleton label={t('admin.ops.errorDetail.loading')} lines={6} />
        </div>
      )
    }

    if (!detail) {
      return <div className={styles.emptyText}>{t('admin.ops.errorDetail.noErrorSelected')}</div>
    }

    const upstream = isUpstreamError(detail)

    return (
      <div className={styles.content}>
        {/* Summary */}
        <dl className={styles.summary}>
          {field(t('admin.ops.errorDetail.requestId'), requestId || '—', true)}
          {field(t('admin.ops.errorDetail.time'), formatDateTime(detail.created_at))}
          {field(
            upstream ? t('admin.ops.errorDetail.account') : t('admin.ops.errorDetail.user'),
            upstream
              ? detail.account_name || (detail.account_id != null ? String(detail.account_id) : '—')
              : detail.user_email || (detail.user_id != null ? String(detail.user_id) : '—')
          )}
          {field(t('admin.ops.errorDetail.platform'), detail.platform || '—')}
          {field(t('admin.ops.errorDetail.group'), detail.group_name || (detail.group_id != null ? String(detail.group_id) : '—'))}
          {field(
            t('admin.ops.errorDetail.model'),
            hasModelMapping(detail) ? (
              <>
                <span className={styles.mono}>{detail.requested_model}</span>
                <span className={styles.arrow} aria-hidden="true">→</span>
                <span className={[styles.mono, styles.accent].join(' ')}>{detail.upstream_model}</span>
              </>
            ) : (
              displayModel(detail) || '—'
            )
          )}
          {field(t('admin.ops.errorDetail.inboundEndpoint'), detail.inbound_endpoint || '—', true)}
          {field(t('admin.ops.errorDetail.upstreamEndpoint'), detail.upstream_endpoint || '—', true)}
          {field(
            t('admin.ops.errorDetail.status'),
            <Badge tone={statusCodeTone(detail.status_code ?? 0)}>{detail.status_code}</Badge>
          )}
          {field(
            t('admin.ops.errorDetail.upstreamStatus'),
            <Badge tone={statusCodeTone(detail.upstream_status_code ?? 0)}>{detail.upstream_status_code ?? '—'}</Badge>
          )}
          {field(t('admin.ops.errorDetail.requestType'), formatRequestTypeLabel(detail.request_type))}
          <div className={styles.field}>
            <dt className={styles.fieldLabel}>{t('admin.ops.errorDetail.message')}</dt>
            <dd className={[styles.fieldValue, styles.breakWords].join(' ')} title={rootCauseMessage}>
              {rootCauseMessage || '—'}
            </dd>
          </div>
          {detail.api_key_prefix && field(t('admin.ops.errorDetail.apiKeyPrefix'), detail.api_key_prefix, true)}
        </dl>

        {rootCauseMessage && (
          <Alert tone="warning" title={t('admin.ops.errorDetail.rootCause')}>
            <span className={styles.breakWords}>{rootCauseMessage}</span>
          </Alert>
        )}

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t('admin.ops.errorDetail.diagnosticPayloads')}</h3>
          {!diagnosticPayloadSections.length ? (
            <div className={styles.muted}>{t('common.noData')}</div>
          ) : (
            <div className={styles.stack}>
              {diagnosticPayloadSections.map((section) => (
                <div key={section.key}>
                  <div className={styles.payloadLabel}>{t(`admin.ops.errorDetail.payloads.${section.key}`)}</div>
                  <pre className={styles.pre}><code>{prettyJSON(section.value)}</code></pre>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Upstream errors list (only for request errors) */}
        {showUpstreamList && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>{t('admin.ops.errorDetails.upstreamErrors')}</h3>
              {correlatedUpstreamLoading && <div className={styles.muted}>{t('common.loading')}</div>}
            </div>

            {!correlatedUpstreamLoading && !correlatedUpstream.length ? (
              <div className={styles.muted}>{t('common.noData')}</div>
            ) : (
              <div className={styles.stack}>
                {correlatedUpstream.map((ev, idx) => {
                  const preview = getUpstreamResponsePreview(ev)
                  const expanded = expandedUpstreamDetailIds.has(ev.id)
                  return (
                    <div key={ev.id} className={styles.event}>
                      <div className={styles.eventHeader}>
                        <div className={styles.eventTitle}>
                          #{idx + 1}
                          {ev.type && <span className={styles.eventType}>{ev.type}</span>}
                        </div>
                        <div className={styles.eventActions}>
                          <span className={styles.mono}>{ev.status_code ?? '—'}</span>
                          <button
                            type="button"
                            className={styles.toggle}
                            disabled={!preview}
                            title={preview ? '' : t('common.noData')}
                            aria-expanded={expanded}
                            onClick={() => toggleUpstreamDetail(ev.id)}
                          >
                            {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                            <span>
                              {expanded
                                ? t('admin.ops.errorDetail.responsePreview.collapse')
                                : t('admin.ops.errorDetail.responsePreview.expand')}
                            </span>
                          </button>
                        </div>
                      </div>

                      <div className={styles.eventMeta}>
                        <div>
                          <span className={styles.metaLabel}>{t('admin.ops.errorDetail.upstreamEvent.status')}:</span>
                          <span className={styles.mono}> {ev.status_code ?? '—'}</span>
                        </div>
                        <div>
                          <span className={styles.metaLabel}>{t('admin.ops.errorDetail.upstreamEvent.requestId')}:</span>
                          <span className={styles.mono}> {ev.request_id || ev.client_request_id || '—'}</span>
                        </div>
                      </div>

                      {ev.message && <div className={styles.eventMessage}>{ev.message}</div>}

                      {expanded && (
                        <pre className={[styles.pre, styles.preSmall].join(' ')}><code>{prettyJSON(preview)}</code></pre>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )}
      </div>
    )
  }

  return (
    <BaseDialog
      show={show}
      title={title}
      width="full"
      closeOnClickOutside
      onClose={close}
      footer={
        backToList ? (
          <Button type="button" variant="secondary" data-testid="error-detail-back-to-list" onClick={goBack}>
            {t('admin.ops.errorDetail.backToList')}
          </Button>
        ) : undefined
      }
    >
      {renderBody()}
    </BaseDialog>
  )
}
