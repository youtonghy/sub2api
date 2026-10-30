/** Prompt Audit 事件详情（摘要 / 风险 / 技术信息），对应 Vue 版 components/EventDetailDialog.vue */
import { useState } from 'react'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs'
import BaseDialog from '@/components/common/BaseDialog'
import Skeleton from '@/components/common/Skeleton'
import { useI18n } from '@/i18n/useI18n'
import type { PromptAuditEvent, PromptIssueSummary } from '../types'
import { SCANNER_CATALOG } from '../viewModel'
import styles from './promptAudit.module.css'

export interface EventDetailDialogProps {
  show: boolean
  event: PromptAuditEvent | null
  loading: boolean
  onClose?: () => void
}

const tabs = ['summary', 'risks', 'technical'] as const
type DetailTab = (typeof tabs)[number]

const DECISIONS = new Set(['pass', 'flag', 'critical'])
const ACTIONS = new Set(['Allow', 'Warn', 'Block'])
const RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical'])

function displayPrompt(event: PromptAuditEvent): string {
  return event.snapshot.full_prompt || event.snapshot.redacted_preview || '—'
}

export default function EventDetailDialog({ show, event, loading, onClose }: EventDetailDialogProps) {
  const { t, te } = useI18n()
  const [activeTab, setActiveTab] = useState<DetailTab>('summary')
  // 与 Vue 版 watch(event.id) 一致：切换事件时回到摘要页
  const [lastEventId, setLastEventId] = useState(event?.id)
  if (event?.id !== lastEventId) {
    setLastEventId(event?.id)
    setActiveTab('summary')
  }

  const formatDecisionAction = (decision: string, action: string): string => {
    const decisionLabel = DECISIONS.has(decision) ? t(`admin.promptAudit.decisions.${decision}`) : decision
    const actionLabel = ACTIONS.has(action) ? t(`admin.promptAudit.actions.${action}`) : action
    return `${decisionLabel} · ${actionLabel}`
  }
  const translateCategory = (category: string): string =>
    SCANNER_CATALOG.some((scanner) => scanner.id === category) ? t(`admin.promptAudit.scanners.${category}`) : category
  const formatCategories = (categories: string[]): string => (categories.length ? categories.map(translateCategory).join(', ') : '—')
  const translateEvidence = (value: string): string => {
    const byId = SCANNER_CATALOG.find((scanner) => scanner.id === value)
    if (byId) return t(`admin.promptAudit.scanners.${byId.id}`)
    const byLabel = SCANNER_CATALOG.find((scanner) => scanner.label === value)
    if (byLabel) return t(`admin.promptAudit.scanners.${byLabel.id}`)
    return value
  }
  const formatGuardReturn = (item: PromptAuditEvent): string => {
    const evidence: Record<string, string> = {}
    for (const [key, value] of Object.entries(item.scanner_evidence || {})) {
      evidence[key] = translateEvidence(value)
    }
    return JSON.stringify(
      {
        decision: DECISIONS.has(item.decision) ? t(`admin.promptAudit.decisions.${item.decision}`) : item.decision,
        risk_level: RISK_LEVELS.has(item.risk_level) ? t(`admin.promptAudit.riskLevels.${item.risk_level}`) : item.risk_level,
        action: ACTIONS.has(item.action) ? t(`admin.promptAudit.actions.${item.action}`) : item.action,
        categories: item.categories.map(translateCategory),
        matched_scanners: item.matched_scanners.map(translateCategory),
        scanner_scores: item.scanner_scores,
        scanner_evidence: evidence,
        scanner_backend: item.scanner_backend,
        scanner_version: item.scanner_version,
        guard_endpoint_id: item.guard_endpoint_id,
        chunk_total: item.chunk_total,
        latency_ms: item.latency_ms
      },
      null,
      2
    )
  }
  const issueTitle = (issue: PromptIssueSummary): string => translateCategory(issue.category || issue.scanner_id) || issue.title
  const issueDescription = (issue: PromptIssueSummary): string => {
    const category = issue.category || issue.scanner_id
    const key = `admin.promptAudit.scannerDescriptions.${category}`
    // Vue 版以「翻译结果等于 key」判断缺失；这里用 te 判断，结果相同
    return te(key) ? t(key) : issue.description
  }
  const issueSeverity = (issue: PromptIssueSummary): string =>
    RISK_LEVELS.has(issue.severity) ? t(`admin.promptAudit.riskLevels.${issue.severity}`) : issue.severity_label || issue.severity
  const issueAction = (issue: PromptIssueSummary): string =>
    ACTIONS.has(issue.action) ? t(`admin.promptAudit.actions.${issue.action}`) : issue.action_label || issue.action

  return (
    <BaseDialog show={show} title={t('admin.promptAudit.events.detailTitle')} width="extra-wide" onClose={() => onClose?.()}>
      {loading ? (
        <div aria-busy="true">
          <Skeleton height="20rem" />
        </div>
      ) : event ? (
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as DetailTab)}>
          <TabsList aria-label={t('admin.promptAudit.events.detailTitle')}>
            {tabs.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {t(`admin.promptAudit.events.tabs.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Fixed panel height so switching tabs does not resize the dialog */}
          <div className={styles.detailPanel} data-test="event-detail-tab-panel">
            <TabsContent value="summary">
              <div className={styles.twoCol}>
                <div>
                  <h4 className={styles.h3}>{t('admin.promptAudit.events.promptFull')}</h4>
                  <pre className={`${styles.pre} ${styles.preCapped}`} data-test="summary-prompt-full">
                    {displayPrompt(event)}
                  </pre>
                </div>
                <dl className={styles.dl}>
                  <dt>{t('admin.promptAudit.events.decision')}</dt>
                  <dd className={styles.h3}>{formatDecisionAction(event.decision, event.action)}</dd>
                  <dt>{t('admin.promptAudit.events.user')}</dt>
                  <dd>{event.snapshot.username || '—'}</dd>
                  <dt>{t('admin.promptAudit.events.email')}</dt>
                  <dd>{event.snapshot.user_email || '—'}</dd>
                  <dt>{t('admin.promptAudit.events.apiKey')}</dt>
                  <dd>{event.snapshot.api_key_name || '—'}</dd>
                  <dt>{t('admin.promptAudit.events.group')}</dt>
                  <dd>{event.snapshot.group_name || '—'}</dd>
                  <dt>{t('admin.promptAudit.events.model')}</dt>
                  <dd>{event.snapshot.model || '—'}</dd>
                  <dt>{t('admin.promptAudit.events.categories')}</dt>
                  <dd>{formatCategories(event.categories)}</dd>
                </dl>
              </div>
            </TabsContent>

            <TabsContent value="risks">
              <div className={styles.stack}>
                <div className={styles.twoCol}>
                  <section data-test="risk-prompt-preview">
                    <h4 className={styles.h3}>{t('admin.promptAudit.events.promptFull')}</h4>
                    <p className={styles.subText}>{t('admin.promptAudit.events.promptFullHint')}</p>
                    <pre className={`${styles.pre} ${styles.preFixed}`} data-test="risk-prompt-full">
                      {displayPrompt(event)}
                    </pre>
                  </section>
                  <section data-test="risk-guard-return">
                    <h4 className={styles.h3}>{t('admin.promptAudit.events.guardReturn')}</h4>
                    <p className={styles.subText}>{t('admin.promptAudit.events.guardReturnHint')}</p>
                    <pre className={`${styles.pre} ${styles.preFixed} ${styles.preMono}`}>{formatGuardReturn(event)}</pre>
                  </section>
                </div>

                <div className={styles.stack}>
                  <h4 className={styles.h3}>{t('admin.promptAudit.events.riskSummaries')}</h4>
                  {event.issue_summaries.map((issue) => (
                    <article key={`${issue.scanner_id}-${issue.code}`} className={styles.issue} data-test="risk-issue">
                      <div className={styles.issueHead}>
                        <h5 className={styles.h3}>{issueTitle(issue)}</h5>
                        <span className={`${styles.hint} ${styles.dangerText}`}>
                          {issueSeverity(issue)} · {issueAction(issue)}
                        </span>
                      </div>
                      <p className={styles.description}>{issueDescription(issue)}</p>
                      <dl className={styles.issueMeta}>
                        <div>
                          <dt>{t('admin.promptAudit.events.categories')} · </dt>
                          <dd>{translateCategory(issue.category || issue.scanner_id)}</dd>
                        </div>
                        <div>
                          <dt>{t('admin.promptAudit.events.score')} · </dt>
                          <dd>{issue.score}</dd>
                        </div>
                        <div>
                          <dt>{t('admin.promptAudit.events.evidence')} · </dt>
                          <dd>{issue.evidence ? translateEvidence(issue.evidence) : '—'}</dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                  {event.issue_summaries.length === 0 ? <p className={styles.centerText}>{t('admin.promptAudit.events.noRisks')}</p> : null}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="technical">
              <dl className={styles.dl}>
                <dt>{t('admin.promptAudit.events.requestId')}</dt>
                <dd className={`${styles.mono} ${styles.breakAll}`}>{event.snapshot.request_id || '—'}</dd>
                <dt>{t('admin.promptAudit.events.promptHash')}</dt>
                <dd className={`${styles.mono} ${styles.breakAll}`}>{event.snapshot.prompt_hash}</dd>
                <dt>{t('admin.promptAudit.events.technical.scanner')}</dt>
                <dd>
                  {event.scanner_backend} · {event.scanner_version}
                </dd>
                <dt>{t('admin.promptAudit.events.technical.policy')}</dt>
                <dd>
                  {event.policy_id} · v{event.policy_version}
                </dd>
                <dt>{t('admin.promptAudit.events.technical.guardEndpoint')}</dt>
                <dd>{event.guard_endpoint_id}</dd>
                <dt>{t('admin.promptAudit.events.technical.config')}</dt>
                <dd>v{event.config_version}</dd>
                <dt>{t('admin.promptAudit.events.technical.chunks')}</dt>
                <dd>{event.chunk_total}</dd>
                <dt>{t('admin.promptAudit.events.technical.latency')}</dt>
                <dd>{event.latency_ms} ms</dd>
                <dt>{t('admin.promptAudit.events.stage')}</dt>
                <dd>{event.snapshot.stage || 'http'}</dd>
                <dt>{t('admin.promptAudit.events.technical.protocol')}</dt>
                <dd>
                  {event.snapshot.protocol} · {event.snapshot.endpoint}
                </dd>
              </dl>
            </TabsContent>
          </div>
        </Tabs>
      ) : null}
    </BaseDialog>
  )
}
