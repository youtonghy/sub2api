/** Prompt Audit 审计事件列表（筛选、选择、查看、删除），对应 Vue 版 components/EventWorkspace.vue */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { Alert } from '@/components/arc/alert/alert'
import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import DataTable, { type DataTableCellContext, type DataTableHeaderContext } from '@/components/common/DataTable'
import Pagination from '@/components/common/Pagination'
import type { Column } from '@/components/common/types'
import { useI18n } from '@/i18n/useI18n'
import type { PromptAuditEvent, PromptEventFilters } from '../types'
import { cloneData, emptyEventFilters, SCANNER_CATALOG } from '../viewModel'
import styles from './promptAudit.module.css'

export interface EventWorkspaceProps {
  events: PromptAuditEvent[]
  total: number
  page: number
  pageSize: number
  filters: PromptEventFilters
  selectedIds: number[]
  loading: boolean
  error: string
  onFiltersChange?: (value: PromptEventFilters) => void
  onSearch?: (value: PromptEventFilters) => void
  onSelection?: (value: number[]) => void
  onPage?: (value: number) => void
  onPageSize?: (value: number) => void
  onView?: (id: number) => void
  onDelete?: (id: number) => void
  onBatchDelete?: () => void
  onPreviewDelete?: () => void
}

const DECISIONS = new Set(['pass', 'flag', 'critical'])
const RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical'])

function decisionTone(decision: string): BadgeTone {
  if (decision === 'critical') return 'danger'
  if (decision === 'flag') return 'warning'
  return 'success'
}

function CopyLine({ label, value }: { label: string; value: string }) {
  const { t } = useI18n()
  return (
    <div className={styles.copyLine}>
      <span className={styles.copyLabel}>{label}</span>
      <span className={styles.copyValue}>{value || '—'}</span>
      {value ? (
        <button
          type="button"
          className={styles.linkButton}
          aria-label={`${t('common.copy')} ${label}`}
          onClick={() => void navigator.clipboard?.writeText(value)}
        >
          {t('common.copy')}
        </button>
      ) : null}
    </div>
  )
}

export default function EventWorkspace({
  events,
  total,
  page,
  pageSize,
  filters,
  selectedIds,
  loading,
  error,
  onFiltersChange,
  onSearch,
  onSelection,
  onPage,
  onPageSize,
  onView,
  onDelete,
  onBatchDelete,
  onPreviewDelete
}: EventWorkspaceProps) {
  const { t, locale } = useI18n()
  const [localFilters, setLocalFilters] = useState<PromptEventFilters>(() => cloneData(filters))

  // 与 Vue 版 watch(props.filters, deep) 一致：父组件筛选变化时同步本地输入
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 同步父组件下发的筛选条件
    setLocalFilters(cloneData(filters))
  }, [filters])

  const allSelected = events.length > 0 && events.every((event) => selectedIds.includes(event.id))

  const setFilter = (key: keyof PromptEventFilters, value: string) => setLocalFilters((prev) => ({ ...prev, [key]: value }))
  const filtersChanged = (next: PromptEventFilters = localFilters) => onFiltersChange?.(cloneData(next))
  const changeAndEmit = (key: keyof PromptEventFilters, value: string) => {
    const next = { ...localFilters, [key]: value }
    setLocalFilters(next)
    filtersChanged(next)
  }
  const applyFilters = (value: PromptEventFilters = localFilters) => {
    const next = cloneData(value)
    onFiltersChange?.(next)
    onSearch?.(next)
  }
  const resetFilters = () => {
    const next = emptyEventFilters()
    setLocalFilters(next)
    applyFilters(next)
  }
  const toggleOne = (id: number) => {
    const selected = new Set(selectedIds)
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
    onSelection?.([...selected])
  }
  const toggleAll = () => onSelection?.(allSelected ? [] : events.map((event) => event.id))

  const formatDate = (value: string): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))
  const translateDecision = (decision: string) => (DECISIONS.has(decision) ? t(`admin.promptAudit.decisions.${decision}`) : decision)
  const translateRiskLevel = (riskLevel: string) =>
    RISK_LEVELS.has(riskLevel) ? t(`admin.promptAudit.riskLevels.${riskLevel}`) : riskLevel
  const translateCategory = (category: string) =>
    SCANNER_CATALOG.some((scanner) => scanner.id === category) ? t(`admin.promptAudit.scanners.${category}`) : category
  const formatDecisionRisk = (decision: string, riskLevel: string) => `${translateDecision(decision)} · ${translateRiskLevel(riskLevel)}`
  const formatCategories = (categories: string[]) => (categories.length ? categories.map(translateCategory).join(', ') : '—')

  const textFilter = (key: keyof PromptEventFilters, label: string, type = 'text') => (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        type={type}
        className={styles.input}
        value={localFilters[key]}
        aria-label={label}
        onChange={(event) => setFilter(key, event.target.value)}
        onBlur={() => filtersChanged()}
      />
    </label>
  )

  const columns: Column<PromptAuditEvent>[] = [
    { key: 'select', label: '' },
    { key: 'created_at', label: t('admin.promptAudit.events.time') },
    { key: 'identity', label: t('admin.promptAudit.events.identity') },
    { key: 'group', label: t('admin.promptAudit.events.group') },
    { key: 'route', label: t('admin.promptAudit.events.route') },
    { key: 'result', label: t('admin.promptAudit.events.result') },
    { key: 'preview', label: t('admin.promptAudit.events.preview') },
    { key: 'actions', label: t('admin.promptAudit.common.actions'), align: 'right' }
  ]

  const headers: Record<string, (context: DataTableHeaderContext) => ReactNode> = {
    select: () => (
      <Checkbox checked={allSelected} aria-label={t('admin.promptAudit.events.selectAll')} onCheckedChange={toggleAll} />
    )
  }

  type Cell = (context: DataTableCellContext<PromptAuditEvent>) => ReactNode
  const cells: Record<string, Cell> = {
    select: ({ row }) => (
      <Checkbox
        checked={selectedIds.includes(row.id)}
        aria-label={t('admin.promptAudit.events.selectEvent', { id: row.id })}
        onCheckedChange={() => toggleOne(row.id)}
      />
    ),
    created_at: ({ row }) => <span className={`${styles.nowrap} ${styles.hint}`}>{formatDate(row.created_at)}</span>,
    identity: ({ row }) => (
      <div>
        <CopyLine label={t('admin.promptAudit.events.user')} value={row.snapshot.username} />
        <CopyLine label={t('admin.promptAudit.events.email')} value={row.snapshot.user_email} />
        <CopyLine label={t('admin.promptAudit.events.apiKey')} value={row.snapshot.api_key_name} />
      </div>
    ),
    group: ({ row }) => <span>{row.snapshot.group_name || '—'}</span>,
    route: ({ row }) => (
      <div>
        <p className={styles.h3}>{row.snapshot.endpoint}</p>
        <p className={styles.subText}>
          {row.snapshot.model} · {row.snapshot.protocol} · {row.snapshot.stage || 'http'}
        </p>
      </div>
    ),
    result: ({ row }) => (
      <div>
        <Badge tone={decisionTone(row.decision)} size="sm">
          {formatDecisionRisk(row.decision, row.risk_level)}
        </Badge>
        <p className={styles.categories} title={formatCategories(row.categories)}>
          {formatCategories(row.categories)}
        </p>
      </div>
    ),
    preview: ({ row }) => <p className={styles.preview}>{row.snapshot.redacted_preview || '—'}</p>,
    actions: ({ row }) => (
      <div className={styles.rowActions}>
        <Button type="button" size="sm" variant="ghost" onClick={() => onView?.(row.id)}>
          {t('common.view')}
        </Button>
        <Button type="button" size="sm" variant="ghost" className={styles.dangerText} onClick={() => onDelete?.(row.id)}>
          {t('common.delete')}
        </Button>
      </div>
    )
  }

  return (
    <section aria-labelledby="prompt-events-title" className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2 id="prompt-events-title" className={styles.h2}>
            {t('admin.promptAudit.events.title')}
          </h2>
          <p className={styles.description}>{t('admin.promptAudit.events.description')}</p>
        </div>
        <div className={styles.buttonRow}>
          <Button type="button" size="sm" variant="secondary" disabled={selectedIds.length === 0} onClick={() => onBatchDelete?.()}>
            {t('admin.promptAudit.events.deleteSelected', { count: selectedIds.length })}
          </Button>
          <Button type="button" size="sm" variant="danger" data-test="filter-delete" onClick={() => onPreviewDelete?.()}>
            {t('admin.promptAudit.events.deleteByFilter')}
          </Button>
        </div>
      </div>

      <form
        className={styles.filterGrid}
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          applyFilters()
        }}
      >
        <label className={styles.field}>
          <span>{t('admin.promptAudit.events.decision')}</span>
          <select
            className={styles.select}
            value={localFilters.decision}
            aria-label={t('admin.promptAudit.events.decision')}
            onChange={(event) => changeAndEmit('decision', event.target.value)}
          >
            <option value="">{t('common.all')}</option>
            <option value="pass">{t('admin.promptAudit.decisions.pass')}</option>
            <option value="flag">{t('admin.promptAudit.decisions.flag')}</option>
            <option value="critical">{t('admin.promptAudit.decisions.critical')}</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>{t('admin.promptAudit.events.risk')}</span>
          <select
            className={styles.select}
            value={localFilters.risk_level}
            aria-label={t('admin.promptAudit.events.risk')}
            onChange={(event) => changeAndEmit('risk_level', event.target.value)}
          >
            <option value="">{t('common.all')}</option>
            <option value="low">{t('admin.promptAudit.riskLevels.low')}</option>
            <option value="medium">{t('admin.promptAudit.riskLevels.medium')}</option>
            <option value="high">{t('admin.promptAudit.riskLevels.high')}</option>
            <option value="critical">{t('admin.promptAudit.riskLevels.critical')}</option>
          </select>
        </label>
        {textFilter('endpoint', t('admin.promptAudit.events.endpoint'))}
        {textFilter('group_id', t('admin.promptAudit.events.groupId'), 'number')}
        {textFilter('user_id', t('admin.promptAudit.events.userId'), 'number')}
        {textFilter('api_key_id', t('admin.promptAudit.events.apiKeyId'), 'number')}
        {textFilter('request_id', t('admin.promptAudit.events.requestId'))}
        {textFilter('prompt_hash', t('admin.promptAudit.events.promptHash'))}
        {textFilter('keyword', t('admin.promptAudit.events.keyword'))}
        <label className={styles.field}>
          <span>{t('admin.promptAudit.events.startAt')}</span>
          <input
            type="datetime-local"
            className={styles.input}
            value={localFilters.start_at}
            aria-label={t('admin.promptAudit.events.startAt')}
            onChange={(event) => changeAndEmit('start_at', event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>{t('admin.promptAudit.events.endAt')}</span>
          <input
            type="datetime-local"
            className={styles.input}
            value={localFilters.end_at}
            aria-label={t('admin.promptAudit.events.endAt')}
            onChange={(event) => changeAndEmit('end_at', event.target.value)}
          />
        </label>
        <div className={styles.filterActions}>
          <Button type="submit" size="sm" variant="primary">
            {t('common.search')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={resetFilters}>
            {t('common.reset')}
          </Button>
        </div>
      </form>

      {error ? <Alert tone="danger" title={error} role="alert" /> : null}

      <div className={styles.tableRegion}>
        <DataTable<PromptAuditEvent>
          columns={columns}
          data={events}
          loading={loading}
          rowKey="id"
          cells={cells}
          headers={headers}
          empty={<p className={styles.centerText}>{t('admin.promptAudit.events.empty')}</p>}
        />
        <div className={styles.tablePagination}>
          <Pagination total={total} page={page} pageSize={pageSize} onPageChange={onPage} onPageSizeChange={onPageSize} />
        </div>
      </div>
    </section>
  )
}
