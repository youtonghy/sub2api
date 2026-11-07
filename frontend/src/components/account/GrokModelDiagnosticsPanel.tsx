/**
 * Grok 上游模型目录诊断，对应 Vue 版 GrokModelDiagnosticsPanel.vue。
 * 只展示已保存配置的诊断结果：摘要、当前目录缺口、目录详情与映射核对；同步由父组件处理。
 */
import { ArrowRight, ChevronRight, Info, RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { Button } from '@/components/arc/button/button'
import { useI18n } from '@/i18n/useI18n'
import type { GrokModelDiagnosticItem, GrokModelDiagnostics } from '@/types'
import { formatDateTime, formatRelativeTime } from '@/utils/format'
import styles from './GrokModelDiagnosticsPanel.module.css'

export interface GrokModelDiagnosticsPanelProps {
  diagnostics: GrokModelDiagnostics | null
  loading?: boolean
  /** 表单有未保存的改动（诊断只反映已保存配置） */
  dirty?: boolean
  refreshFailed?: boolean
  canSync?: boolean
  syncing?: boolean
  /** Vue 版 sync 事件 */
  onSync?: () => void
}

type EffectiveState = 'fresh' | 'stale' | 'source_changed' | 'unknown'

const RFC3339_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/
const ATTEMPT_LABEL_KEYS: Record<string, string> = {
  success: 'admin.accounts.grokModelDiagnostics.attemptSuccess',
  failed: 'admin.accounts.grokModelDiagnostics.syncFailed',
  configured_fallback: 'admin.accounts.grokModelDiagnostics.attemptFallback'
}
const ERROR_LABEL_KEYS: Record<string, string> = {
  configuration: 'admin.accounts.grokModelDiagnostics.errorConfiguration',
  http_error: 'admin.accounts.grokModelDiagnostics.errorHTTP',
  transport: 'admin.accounts.grokModelDiagnostics.errorTransport',
  invalid_response: 'admin.accounts.grokModelDiagnostics.errorInvalidResponse',
  empty_catalog: 'admin.accounts.grokModelDiagnostics.errorEmptyCatalog',
  too_large: 'admin.accounts.grokModelDiagnostics.errorTooLarge',
  persistence: 'admin.accounts.grokModelDiagnostics.errorPersistence'
}

/** 只认表内自有键，未知值不回显原文 */
function ownedLabelKey(table: Record<string, string>, value: string | undefined): string | undefined {
  if (!value || !Object.prototype.hasOwnProperty.call(table, value)) return undefined
  return table[value]
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    return leap ? 29 : 28
  }
  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0
}

/** 严格解析 RFC 3339（必须带时区），不合法的日期或无时区的本地时间一律视为未知 */
function parseCatalogTime(value: string | undefined): number | null {
  if (!value) return null
  const match = RFC3339_RE.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = match[7] === undefined ? 0 : Number(match[7])
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8])
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null
  }
  const parsed = Date.parse(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function MappingRow({ item, status }: { item: GrokModelDiagnosticItem; status: string }) {
  return (
    <div className={styles.mappingRow}>
      <div className={styles.mono}>{item.requested}</div>
      <div className={styles.mappingTarget}>
        {item.upstream ? <ArrowRight size={12} aria-hidden="true" className={styles.inlineIcon} /> : null}
        <div className={styles.minW0}>
          {item.upstream ? <div className={styles.mono}>{item.upstream}</div> : null}
          {status ? <div>{status}</div> : null}
        </div>
      </div>
    </div>
  )
}

export default function GrokModelDiagnosticsPanel({
  diagnostics,
  loading = false,
  dirty = false,
  refreshFailed = false,
  canSync = false,
  syncing = false,
  onSync
}: GrokModelDiagnosticsPanelProps) {
  const { t } = useI18n()
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [differencesOpen, setDifferencesOpen] = useState(false)
  const instanceId = useId()
  const detailsId = `grok-catalog-${instanceId}`
  const differencesId = `grok-differences-${instanceId}`

  // 时钟每秒推进：到达 expires_at 时无需请求即可转为历史目录，相对时间也随之更新
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const fetchedMs = parseCatalogTime(diagnostics?.fetched_at)
  const expiresMs = parseCatalogTime(diagnostics?.expires_at)
  const fetchedUsable = fetchedMs !== null && fetchedMs <= nowMs

  const effectiveState: EffectiveState = (() => {
    if (!diagnostics) return 'unknown'
    if (diagnostics.state === 'fresh') {
      if (!fetchedUsable || expiresMs === null) return 'unknown'
      if (nowMs >= expiresMs) return 'stale'
      return 'fresh'
    }
    if (diagnostics.state === 'stale' || diagnostics.state === 'source_changed') {
      if (!fetchedUsable) return 'unknown'
      return diagnostics.state
    }
    return 'unknown'
  })()
  const isFresh = effectiveState === 'fresh'

  const attemptStatus = diagnostics?.last_attempt?.status ?? ''
  const missingMappings = isFresh ? (diagnostics?.mappings ?? []).filter((item) => item.status === 'not_listed') : []

  const catalogHost = (() => {
    try {
      return new URL(diagnostics?.endpoint ?? '').host
    } catch {
      return ''
    }
  })()

  const lastSuccessRelative =
    fetchedMs === null || fetchedMs > nowMs
      ? t('admin.accounts.grokModelDiagnostics.unknown')
      : formatRelativeTime(diagnostics?.fetched_at)

  const modelCount = diagnostics?.models?.length ?? 0
  const modelCountLabel = isFresh
    ? t('admin.accounts.grokModelDiagnostics.modelCount', { count: modelCount })
    : effectiveState === 'stale' || effectiveState === 'source_changed'
      ? t('admin.accounts.grokModelDiagnostics.historicalModelCount', { count: modelCount })
      : ''

  const headline =
    effectiveState === 'stale'
      ? t('admin.accounts.grokModelDiagnostics.stale')
      : effectiveState === 'source_changed'
        ? t('admin.accounts.grokModelDiagnostics.sourceChanged')
        : effectiveState === 'unknown'
          ? t('admin.accounts.grokModelDiagnostics.unknown')
          : attemptStatus === 'failed'
            ? t('admin.accounts.grokModelDiagnostics.syncFailed')
            : attemptStatus === 'configured_fallback'
              ? t('admin.accounts.grokModelDiagnostics.attemptFallback')
              : t('admin.accounts.grokModelDiagnostics.fresh')

  const attemptNeedsAttention = attemptStatus === 'failed' || attemptStatus === 'configured_fallback'
  const stateTone = isFresh && !attemptNeedsAttention ? 'success' : effectiveState === 'unknown' && !attemptNeedsAttention ? 'neutral' : 'warning'

  const attemptLabel = attemptStatus
    ? t(ownedLabelKey(ATTEMPT_LABEL_KEYS, attemptStatus) ?? 'admin.accounts.grokModelDiagnostics.attemptUnknown')
    : ''
  const attemptErrorLabel =
    diagnostics?.last_attempt && attemptStatus === 'failed'
      ? t(
          ownedLabelKey(ERROR_LABEL_KEYS, diagnostics.last_attempt.error_code) ??
            'admin.accounts.grokModelDiagnostics.attemptUnavailable'
        )
      : ''
  const attemptDetail =
    attemptStatus === 'configured_fallback' ? t('admin.accounts.grokModelDiagnostics.fallbackNotice') : attemptErrorLabel

  const showFailureNotice = attemptStatus === 'failed'
  const showFallbackNotice = attemptStatus === 'configured_fallback'
  const showPreviousValid = isFresh && attemptNeedsAttention
  const showStateNotice = !isFresh

  const observedTime = (value: string | undefined): string => {
    const parsed = parseCatalogTime(value)
    if (parsed === null || parsed > nowMs) return t('admin.accounts.grokModelDiagnostics.unknown')
    return formatDateTime(value)
  }

  const mappingStatus = (item: GrokModelDiagnosticItem): string => {
    if (item.status === 'out_of_scope') return t('admin.accounts.grokModelDiagnostics.outOfScope')
    if (item.status === 'unverifiable') return t('admin.accounts.grokModelDiagnostics.unverifiable')
    if (item.status === 'not_listed') {
      return isFresh
        ? t('admin.accounts.grokModelDiagnostics.notListed')
        : t('admin.accounts.grokModelDiagnostics.historicalComparison')
    }
    if (item.status === 'listed') {
      return isFresh
        ? t('admin.accounts.grokModelDiagnostics.currentListed')
        : t('admin.accounts.grokModelDiagnostics.historicalComparison')
    }
    return ''
  }

  const requestSync = () => {
    if (syncing || loading) return
    onSync?.()
  }

  const summaryParts = [modelCountLabel, catalogHost].filter(Boolean)

  return (
    <section data-testid="grok-model-diagnostics" className={styles.panel}>
      <div data-testid="grok-diagnostics-summary" className={styles.summary}>
        <div className={styles.minW0}>
          <div className={styles.titleRow}>
            <h3 className={styles.title}>{t('admin.accounts.grokModelDiagnostics.catalogTitle')}</h3>
            <p data-testid="grok-diagnostics-state" className={styles.state} data-tone={stateTone}>
              {headline}
            </p>
          </div>
          <p className={styles.meta}>
            {summaryParts.join(' · ')}
            <span data-testid="grok-diagnostics-last-success">
              {summaryParts.length > 0 ? ' · ' : ''}
              {t('admin.accounts.grokModelDiagnostics.lastSuccessRelative', { time: lastSuccessRelative })}
            </span>
          </p>
        </div>
        {canSync ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="grok-diagnostics-sync"
            title={t('admin.accounts.grokModelDiagnostics.syncSavedConfig')}
            aria-label={`${t('admin.accounts.grokModelDiagnostics.syncCatalog')}: ${t('admin.accounts.grokModelDiagnostics.syncSavedConfig')}`}
            disabled={syncing || loading}
            onClick={requestSync}
          >
            <RefreshCw size={14} aria-hidden="true" className={styles.syncIcon} />
            {syncing ? t('common.loading') : t('admin.accounts.grokModelDiagnostics.syncCatalog')}
          </Button>
        ) : null}
      </div>

      {loading ? <p className={styles.padLine}>{t('common.loading')}</p> : null}
      {refreshFailed ? (
        <p data-testid="grok-diagnostics-refresh-failed" className={styles.padLine} data-tone="danger">
          {t('admin.accounts.grokModelDiagnostics.refreshFailed')}
        </p>
      ) : null}

      {showFailureNotice || showFallbackNotice || showStateNotice || showPreviousValid ? (
        <div className={styles.notice}>
          {showFailureNotice ? (
            <p className={styles.iconLine}>
              <TriangleAlert size={12} aria-hidden="true" className={styles.inlineIcon} />
              <span>{attemptErrorLabel}</span>
            </p>
          ) : null}
          {showFallbackNotice ? (
            <p className={styles.iconLine}>
              <TriangleAlert size={12} aria-hidden="true" className={styles.inlineIcon} />
              <span>{t('admin.accounts.grokModelDiagnostics.fallbackNotice')}</span>
            </p>
          ) : null}
          {showPreviousValid ? <p>{t('admin.accounts.grokModelDiagnostics.previousCatalogValid')}</p> : null}
          {effectiveState === 'stale' ? <p>{t('admin.accounts.grokModelDiagnostics.staleNotice')}</p> : null}
          {effectiveState === 'source_changed' ? <p>{t('admin.accounts.grokModelDiagnostics.changedNotice')}</p> : null}
          {effectiveState === 'unknown' ? <p>{t('admin.accounts.grokModelDiagnostics.unknownNotice')}</p> : null}
        </div>
      ) : null}

      {missingMappings.length > 0 ? (
        <div className={styles.notice}>
          <p data-testid="grok-diagnostics-missing-summary" className={styles.iconLine}>
            <TriangleAlert size={12} aria-hidden="true" className={styles.inlineIcon} />
            <span>{t('admin.accounts.grokModelDiagnostics.missingSummary', { count: missingMappings.length })}</span>
          </p>
          <p>{t('admin.accounts.grokModelDiagnostics.summaryNotice')}</p>
          <button
            type="button"
            data-testid="grok-diagnostics-difference-toggle"
            className={styles.inlineToggle}
            aria-expanded={differencesOpen}
            aria-controls={differencesId}
            onClick={() => setDifferencesOpen((open) => !open)}
          >
            <ChevronRight size={12} aria-hidden="true" className={styles.chevron} data-open={differencesOpen || undefined} />
            {differencesOpen
              ? t('admin.accounts.grokModelDiagnostics.hideDifferences')
              : t('admin.accounts.grokModelDiagnostics.viewDifferences')}
          </button>
          {differencesOpen ? (
            <div id={differencesId} data-testid="grok-diagnostics-difference-list" className={styles.differenceList}>
              <p>
                {t('admin.accounts.grokModelDiagnostics.notListed')} {t('admin.accounts.grokModelDiagnostics.compatibilityNotice')}
              </p>
              {attemptStatus === 'configured_fallback' ? (
                <p>{t('admin.accounts.grokModelDiagnostics.lastSuccessRelative', { time: lastSuccessRelative })}</p>
              ) : null}
              <ul className={styles.list}>
                {missingMappings.map((item, index) => (
                  <li key={`${item.requested}-${index}`}>
                    <MappingRow item={item} status="" />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={styles.detailsSection}>
        <button
          type="button"
          data-testid="grok-diagnostics-details-toggle"
          className={styles.detailsToggle}
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          <ChevronRight size={12} aria-hidden="true" className={styles.chevron} data-open={detailsOpen || undefined} />
          {t('admin.accounts.grokModelDiagnostics.details')}
        </button>
        {detailsOpen ? (
          <div id={detailsId} data-testid="grok-diagnostics-details" className={styles.details}>
            <dl className={styles.facts}>
              <div>
                <dt className={styles.muted}>
                  {isFresh
                    ? t('admin.accounts.grokModelDiagnostics.source')
                    : t('admin.accounts.grokModelDiagnostics.historicalSource')}
                </dt>
                <dd data-testid="grok-diagnostics-endpoint" className={styles.mono}>
                  {diagnostics?.endpoint || t('admin.accounts.grokModelDiagnostics.unknown')}
                </dd>
              </div>
              <div>
                <dt className={styles.muted}>{t('admin.accounts.grokModelDiagnostics.lastSuccess')}</dt>
                <dd>{observedTime(diagnostics?.fetched_at)}</dd>
              </div>
              <div>
                <dt className={styles.muted}>{t('admin.accounts.grokModelDiagnostics.lastAttempt')}</dt>
                <dd data-testid="grok-diagnostics-last-attempt" className={styles.breakAll}>
                  {diagnostics?.last_attempt
                    ? [attemptLabel, attemptDetail, observedTime(diagnostics.last_attempt.finished_at)].filter(Boolean).join(' ')
                    : t('admin.accounts.grokModelDiagnostics.unknown')}
                </dd>
              </div>
            </dl>

            <div className={styles.block}>
              <h4 className={styles.subtitle}>
                {isFresh
                  ? t('admin.accounts.grokModelDiagnostics.upstreamModels')
                  : t('admin.accounts.grokModelDiagnostics.historicalModels')}
              </h4>
              <ul className={styles.modelList}>
                {(diagnostics?.models ?? []).map((model) => (
                  <li key={model} data-testid="grok-diagnostics-model" className={styles.mono}>
                    {model}
                  </li>
                ))}
              </ul>
            </div>

            <div className={styles.block} data-testid="grok-diagnostics-mappings">
              <h4 className={styles.subtitle}>{t('admin.accounts.grokModelDiagnostics.savedMappings')}</h4>
              {missingMappings.length > 0 ? (
                <p className={styles.muted}>{t('admin.accounts.grokModelDiagnostics.compatibilityNotice')}</p>
              ) : null}
              <div className={styles.columns}>
                <span>{t('admin.accounts.grokModelDiagnostics.requestColumn')}</span>
                <span>{t('admin.accounts.grokModelDiagnostics.targetColumn')}</span>
              </div>
              <ul className={styles.list}>
                {(diagnostics?.mappings ?? []).map((item, index) => (
                  <li key={`${item.requested}-${index}`}>
                    <MappingRow item={item} status={mappingStatus(item)} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>

      {dirty ? (
        <p data-testid="grok-diagnostics-dirty" className={`${styles.padLine} ${styles.iconLine}`}>
          <Info size={12} aria-hidden="true" className={styles.inlineIcon} />
          <span>{t('admin.accounts.grokModelDiagnostics.savedConfigHint')}</span>
        </p>
      ) : null}
    </section>
  )
}
