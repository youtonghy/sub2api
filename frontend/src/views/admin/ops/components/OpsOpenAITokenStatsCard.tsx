import { useCallback, useEffect, useRef, useState } from 'react'

import { opsAPI, type OpsOpenAITokenStatsResponse, type OpsOpenAITokenStatsTimeRange } from '@/api/admin/ops'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import EmptyState from '@/components/common/EmptyState'
import Select from '@/components/common/Select'
import { useI18n } from '@/i18n/useI18n'
import { formatNumber } from '@/utils/format'
import { useMediaQuery } from '../hooks/useMediaQuery'
import panel from './OpsPanel.module.css'
import styles from './OpsOpenAITokenStatsCard.module.css'

export interface OpsOpenAITokenStatsCardProps {
  platformFilter?: string
  groupIdFilter?: number | null
  refreshToken: number
}

type ViewMode = 'topn' | 'pagination'

function formatRate(v?: number | null): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '-'
  return v.toFixed(2)
}

function formatInt(v?: number | null): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '-'
  return formatNumber(Math.round(v))
}

function computeTotalPages(viewMode: ViewMode, total: number, pageSize: number): number {
  if (viewMode !== 'pagination') return 1
  const size = pageSize > 0 ? pageSize : 20
  return Math.max(1, Math.ceil(total / size))
}

export default function OpsOpenAITokenStatsCard({ platformFilter = '', groupIdFilter = null, refreshToken }: OpsOpenAITokenStatsCardProps) {
  const { t } = useI18n()

  // 与 DataTable 一致：< 768px 切换为卡片视图，避免宽表在移动端被截断。
  const isDesktopViewport = useMediaQuery('(min-width: 768px)')

  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [response, setResponse] = useState<OpsOpenAITokenStatsResponse | null>(null)

  const [timeRange, setTimeRange] = useState<OpsOpenAITokenStatsTimeRange>('30d')
  const [viewMode, setViewMode] = useState<ViewMode>('topn')
  const [topN, setTopN] = useState<number>(20)
  const [page, setPage] = useState<number>(1)
  const [pageSize, setPageSize] = useState<number>(20)

  const items = response?.items ?? []
  const total = response?.total ?? 0
  const totalPages = computeTotalPages(viewMode, total, pageSize)

  // 避免“筛选变化 -> 重置页码 -> 触发两次请求”：
  // 筛选条件变化时在渲染阶段直接把页码重置为 1，随后只发起一次请求。
  const filterKey = JSON.stringify([timeRange, viewMode, pageSize, platformFilter, groupIdFilter])
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey)
    if (viewMode === 'pagination' && page !== 1) setPage(1)
  }

  const timeRangeOptions = [
    { value: '30m', label: t('admin.ops.timeRange.30m') },
    { value: '1h', label: t('admin.ops.timeRange.1h') },
    { value: '1d', label: t('admin.ops.timeRange.1d') },
    { value: '15d', label: t('admin.ops.timeRange.15d') },
    { value: '30d', label: t('admin.ops.timeRange.30d') }
  ]

  const viewModeOptions = [
    { value: 'topn', label: t('admin.ops.openaiTokenStats.viewModeTopN') },
    { value: 'pagination', label: t('admin.ops.openaiTokenStats.viewModePagination') }
  ]

  const topNOptions = [
    { value: 10, label: 'Top 10' },
    { value: 20, label: 'Top 20' },
    { value: 50, label: 'Top 50' },
    { value: 100, label: 'Top 100' }
  ]

  const pageSizeOptions = [
    { value: 10, label: '10' },
    { value: 20, label: '20' },
    { value: 50, label: '50' },
    { value: 100, label: '100' }
  ]

  const loadData = useCallback(async () => {
    const buildParams = (pageValue: number) => {
      const params: Record<string, any> = {
        time_range: timeRange,
        platform: platformFilter || undefined,
        group_id: typeof groupIdFilter === 'number' && groupIdFilter > 0 ? groupIdFilter : undefined
      }

      if (viewMode === 'topn') {
        params.top_n = topN
      } else {
        params.page = pageValue
        params.page_size = pageSize
      }
      return params
    }

    setLoading(true)
    setErrorMessage('')
    try {
      let next = await opsAPI.getOpenAITokenStats(buildParams(page))
      setResponse(next)
      // 防御：若 total 变化导致当前页超出最大页，则回退到末页并重新拉取一次。
      const maxPage = computeTotalPages(viewMode, next?.total ?? 0, pageSize)
      if (viewMode === 'pagination' && page > maxPage) {
        setPage(maxPage)
        next = await opsAPI.getOpenAITokenStats(buildParams(maxPage))
        setResponse(next)
      }
    } catch (err: any) {
      console.error('[OpsOpenAITokenStatsCard] Failed to load data', err)
      setResponse(null)
      setErrorMessage(err?.message || t('admin.ops.openaiTokenStats.failedToLoad'))
    } finally {
      setLoading(false)
    }
  }, [timeRange, viewMode, topN, page, pageSize, platformFilter, groupIdFilter, t])

  const loadRef = useRef(loadData)
  useEffect(() => {
    loadRef.current = loadData
  }, [loadData])

  // 时间窗口、视图模式、TopN、分页、平台/分组筛选或刷新令牌变化时重新加载（含首次挂载）。
  useEffect(() => {
    void loadRef.current()
  }, [timeRange, viewMode, topN, page, pageSize, platformFilter, groupIdFilter, refreshToken])

  function onPrevPage() {
    if (viewMode !== 'pagination') return
    if (page > 1) setPage(page - 1)
  }

  function onNextPage() {
    if (viewMode !== 'pagination') return
    if (page < totalPages) setPage(page + 1)
  }

  return (
    <section className={panel.panel}>
      <div className={panel.header}>
        <h2 className={panel.title}>{t('admin.ops.openaiTokenStats.title')}</h2>
        <div className={panel.toolbar}>
          <div className={styles.selectWide}>
            <Select value={timeRange} options={timeRangeOptions} onChange={(value) => setTimeRange(value as OpsOpenAITokenStatsTimeRange)} />
          </div>
          <div className={styles.selectWide}>
            <Select value={viewMode} options={viewModeOptions} onChange={(value) => setViewMode(value === 'pagination' ? 'pagination' : 'topn')} />
          </div>
          {viewMode === 'topn' ? (
            <div className={styles.selectMedium}>
              <Select value={topN} options={topNOptions} onChange={(value) => setTopN(Number(value))} />
            </div>
          ) : (
            <>
              <div className={styles.selectNarrow}>
                <Select value={pageSize} options={pageSizeOptions} onChange={(value) => setPageSize(Number(value))} />
              </div>
              <Button type="button" variant="secondary" size="sm" disabled={loading || page <= 1} onClick={onPrevPage}>
                {t('admin.ops.openaiTokenStats.prevPage')}
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={loading || page >= totalPages} onClick={onNextPage}>
                {t('admin.ops.openaiTokenStats.nextPage')}
              </Button>
              <span className={panel.muted}>{t('admin.ops.openaiTokenStats.pageInfo', { page, total: totalPages })}</span>
            </>
          )}
        </div>
      </div>

      {errorMessage && <Alert tone="danger" title={errorMessage} />}

      {loading ? (
        <Skeleton label={t('admin.ops.loadingText')} lines={4} />
      ) : items.length === 0 ? (
        <EmptyState title={t('common.noData')} description={t('admin.ops.openaiTokenStats.empty')} />
      ) : (
        <div className={styles.content}>
          <div className={styles.frame}>
            <div data-testid="openai-token-stats-scroll" className={styles.scroll}>
              {!isDesktopViewport ? (
                <div className={styles.cards}>
                  {items.map((row) => (
                    <div key={row.model} className={styles.cardItem}>
                      <div className={styles.cardModel}>{row.model}</div>
                      <div className={styles.cardGrid}>
                        <div className={styles.cardPair}>
                          <span className={styles.pairLabel}>{t('admin.ops.openaiTokenStats.table.requestCount')}</span>
                          <span>{formatInt(row.request_count)}</span>
                        </div>
                        <div className={styles.cardPair}>
                          <span className={styles.pairLabel}>{t('admin.ops.openaiTokenStats.table.avgTokensPerSec')}</span>
                          <span>{formatRate(row.avg_tokens_per_sec)}</span>
                        </div>
                        <div className={styles.cardPair}>
                          <span className={styles.pairLabel}>{t('admin.ops.openaiTokenStats.table.avgFirstTokenMs')}</span>
                          <span>{formatRate(row.avg_first_token_ms)}</span>
                        </div>
                        <div className={styles.cardPair}>
                          <span className={styles.pairLabel}>{t('admin.ops.openaiTokenStats.table.totalOutputTokens')}</span>
                          <span>{formatInt(row.total_output_tokens)}</span>
                        </div>
                        <div className={styles.cardPair}>
                          <span className={styles.pairLabel}>{t('admin.ops.openaiTokenStats.table.avgDurationMs')}</span>
                          <span>{formatInt(row.avg_duration_ms)}</span>
                        </div>
                        <div className={styles.cardPair}>
                          <span className={styles.pairLabel}>{t('admin.ops.openaiTokenStats.table.requestsWithFirstToken')}</span>
                          <span>{formatInt(row.requests_with_first_token)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>{t('admin.ops.openaiTokenStats.table.model')}</th>
                      <th>{t('admin.ops.openaiTokenStats.table.requestCount')}</th>
                      <th>{t('admin.ops.openaiTokenStats.table.avgTokensPerSec')}</th>
                      <th>{t('admin.ops.openaiTokenStats.table.avgFirstTokenMs')}</th>
                      <th>{t('admin.ops.openaiTokenStats.table.totalOutputTokens')}</th>
                      <th>{t('admin.ops.openaiTokenStats.table.avgDurationMs')}</th>
                      <th>{t('admin.ops.openaiTokenStats.table.requestsWithFirstToken')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => (
                      <tr key={row.model}>
                        <td className={styles.model}>{row.model}</td>
                        <td>{formatInt(row.request_count)}</td>
                        <td>{formatRate(row.avg_tokens_per_sec)}</td>
                        <td>{formatRate(row.avg_first_token_ms)}</td>
                        <td>{formatInt(row.total_output_tokens)}</td>
                        <td>{formatInt(row.avg_duration_ms)}</td>
                        <td>{formatInt(row.requests_with_first_token)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          {viewMode === 'topn' && <div className={panel.muted}>{t('admin.ops.openaiTokenStats.totalModels', { total })}</div>}
        </div>
      )}
    </section>
  )
}
