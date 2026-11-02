/**
 * 使用记录页的调用流向桑基图：分组 → 请求模型 → 上游模型。
 * 面板进入视口后才请求 mapping 统计；之后随已应用的筛选（FlowQuery）变化重新请求，过期响应直接丢弃。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useInView } from 'motion/react'

import { adminAPI } from '@/api/admin'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import SankeyFlow, { type SankeyFlowLabels } from '@/components/arc/sankey-flow/sankey-flow'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { formatCost, formatNumber, formatTokens } from '@/components/charts/chartUtils'
import chartStyles from '@/components/charts/charts.module.css'
import { useI18n } from '@/i18n/useI18n'
import type { GroupStat, ModelStat } from '@/types'
import { OVERALL_KEY, buildFlowGraph, planFlowRequests, type FlowMetric, type FlowQuery } from './usageFlowData'
import styles from './UsageFlowSankey.module.css'

export interface UsageFlowSankeyProps {
  /** 已应用的筛选与对应的分组统计；分组统计尚未加载时为 null */
  query: FlowQuery | null
  /** 页面图表数据正在刷新 */
  loading?: boolean
  className?: string
}

type StatsCache = { query: FlowQuery | null; stats: Record<string, ModelStat[]> }

const EMPTY_STATS: Record<string, ModelStat[]> = {}

function useSankeyFlowLabels(): SankeyFlowLabels {
  const { t, locale } = useI18n()
  return useMemo(
    () => ({
      flow: t('flowUi.sankey.flow'),
      from: t('flowUi.sankey.from'),
      to: t('flowUi.sankey.to'),
      value: t('flowUi.sankey.value'),
      shareOfSource: t('flowUi.sankey.shareOfSource'),
      roleDescription: t('flowUi.sankey.roleDescription'),
      keyboardHint: t('flowUi.sankey.keyboardHint'),
      toNode: (label: string) => t('flowUi.sankey.toNode', { label }),
      fromNode: (label: string) => t('flowUi.sankey.fromNode', { label }),
      linkTitle: (source: string, target: string) => t('flowUi.sankey.linkTitle', { source, target }),
      shareOf: (share: string, of: string) => t('flowUi.sankey.shareOf', { share, of })
    }),
    // locale 变化时重新取文案
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale]
  )
}

const formatByMetric = (value: number, metric: FlowMetric): string => {
  if (metric === 'actual_cost') return `$${formatCost(value)}`
  if (metric === 'requests') return formatNumber(value)
  return formatTokens(value)
}

export default function UsageFlowSankey({ query, loading = false, className }: UsageFlowSankeyProps) {
  const { t, locale } = useI18n()
  const sankeyLabels = useSankeyFlowLabels()
  const sectionRef = useRef<HTMLElement>(null)
  // 首次进入视口（提前 200px）才开始请求，之后保持激活，筛选变化时自动重载
  const inView = useInView(sectionRef, { once: true, margin: '200px 0px' })
  const [metric, setMetric] = useState<FlowMetric>('tokens')
  const [cache, setCache] = useState<StatsCache>({ query: null, stats: EMPTY_STATS })
  const [failure, setFailure] = useState<{ query: FlowQuery; keys: string } | null>(null)
  const [attempt, setAttempt] = useState(0)

  const plan = useMemo(() => (query ? planFlowRequests(query.groups, metric) : null), [query, metric])
  const stats = cache.query === query ? cache.stats : EMPTY_STATS
  const missingKey = plan ? plan.keys.filter((key) => !stats[key]).join(',') : ''
  const failed = !!query && !!missingKey && failure?.query === query && failure.keys === missingKey

  useEffect(() => {
    if (!inView || !query || !missingKey) return
    let stale = false
    // 页面的模型筛选在客户端按请求模型过滤（模型统计接口不接收 model 参数）
    const { model: _model, ...params } = query.params
    const keys = missingKey.split(',')
    Promise.all(
      keys.map(async (key) => {
        const response = await adminAPI.dashboard.getModelStats({
          ...params,
          model_source: 'mapping',
          ...(key === OVERALL_KEY ? {} : { group_id: Number(key) })
        })
        return [key, response.models ?? []] as const
      })
    )
      .then((entries) => {
        if (stale) return
        setCache((prev) => ({
          query,
          stats: { ...(prev.query === query ? prev.stats : {}), ...Object.fromEntries(entries) }
        }))
      })
      .catch((err: unknown) => {
        if (stale) return
        console.error('[UsageFlowSankey] failed to load mapping model stats', err)
        setFailure({ query, keys: missingKey })
      })
    return () => {
      stale = true
    }
  }, [inView, query, missingKey, attempt])

  const modelFilter = query?.params.model ?? ''
  const graph = useMemo(() => {
    if (!plan || missingKey) return null
    return buildFlowGraph({
      plan,
      stats,
      metric,
      modelFilter,
      labels: {
        groupName: (group: GroupStat) => group.group_name || (group.group_id ? `#${group.group_id}` : t('flowUi.noGroup')),
        otherGroups: t('flowUi.otherGroups'),
        otherModels: t('flowUi.otherModels'),
        unknownModel: t('flowUi.unknownModel')
      }
    })
  }, [plan, missingKey, stats, metric, modelFilter, t])

  const metricOptions = [
    { value: 'tokens', label: t('flowUi.metric.tokens') },
    { value: 'actual_cost', label: t('flowUi.metric.actualCost') },
    { value: 'requests', label: t('flowUi.metric.requests') }
  ]

  const retry = () => {
    setFailure(null)
    setAttempt((value) => value + 1)
  }

  const renderBody = () => {
    if (failed) {
      return (
        <div className={styles.error}>
          <Alert tone="danger" title={t('flowUi.failed')} />
          <Button type="button" variant="secondary" size="sm" onClick={retry}>
            {t('flowUi.retry')}
          </Button>
        </div>
      )
    }
    if (!graph) {
      return (
        <div className={styles.placeholder}>
          <Skeleton lines={6} label={t('common.loading')} />
        </div>
      )
    }
    if (!graph.links.length) return <p className={chartStyles.message}>{t('flowUi.empty')}</p>
    return (
      <SankeyFlow
        nodes={graph.nodes}
        links={graph.links}
        label={t('flowUi.title')}
        columns={[t('flowUi.columns.group'), t('flowUi.columns.requested'), t('flowUi.columns.upstream')]}
        totalLabel={t('flowUi.total')}
        formatValue={(value) => formatByMetric(value, metric)}
        emptyLabel={t('flowUi.empty')}
        height={360}
        locale={locale}
        labels={sankeyLabels}
      />
    )
  }

  return (
    <section
      ref={sectionRef}
      className={[chartStyles.panel, className].filter(Boolean).join(' ')}
      aria-busy={loading || (!!missingKey && !failed) || undefined}
      data-testid="usage-flow-sankey"
    >
      <div className={chartStyles.header}>
        <div className={styles.heading}>
          <h2 className={chartStyles.title}>{t('flowUi.title')}</h2>
          <p className={styles.description}>{t('flowUi.description')}</p>
        </div>
        <div className={chartStyles.toggles}>
          <SegmentedControl
            label={t('flowUi.metricLabel')}
            options={metricOptions}
            value={metric}
            onValueChange={(value) => setMetric(value as FlowMetric)}
          />
        </div>
      </div>
      {renderBody()}
    </section>
  )
}
