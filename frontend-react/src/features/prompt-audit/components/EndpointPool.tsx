/**
 * Prompt Audit 守卫节点池，对应 Vue 版 components/EndpointPool.vue。
 * 删除确认由原生 window.confirm 改为 ConfirmDialog（同一文案，确认才删除）。
 */
import { useState } from 'react'

import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import BaseDialog from '@/components/common/BaseDialog'
import Toggle from '@/components/common/Toggle'
import { useI18n } from '@/i18n/useI18n'
import type { PromptAuditEndpointDraft, PromptProbeResult } from '../types'
import { cloneData, createDefaultEndpoint } from '../viewModel'
import styles from './promptAudit.module.css'

export interface EndpointPoolProps {
  endpoints: PromptAuditEndpointDraft[]
  probeResults: Record<string, PromptProbeResult>
  probingIds: string[]
  /** Vue 版 update:endpoints */
  onEndpointsChange?: (value: PromptAuditEndpointDraft[]) => void
  onProbe?: (endpoint: PromptAuditEndpointDraft) => void
}

function hasCredential(endpoint: PromptAuditEndpointDraft): boolean {
  return Boolean(endpoint.token.trim() || (endpoint.has_token && !endpoint.clear_token))
}

function credentialInvalid(endpoint: PromptAuditEndpointDraft): boolean {
  return endpoint.token_status === 'invalid' && !endpoint.token.trim() && !endpoint.clear_token
}

export default function EndpointPool({ endpoints, probeResults, probingIds, onEndpointsChange, onProbe }: EndpointPoolProps) {
  const { t } = useI18n()
  const { confirm, confirmDialog } = useConfirmDialog()
  const [editing, setEditing] = useState<PromptAuditEndpointDraft | null>(null)
  const [editingIndex, setEditingIndex] = useState(-1)

  const patchEditing = (patch: Partial<PromptAuditEndpointDraft>) =>
    setEditing((prev) => (prev ? { ...prev, ...patch } : prev))

  const openCreate = () => {
    setEditingIndex(-1)
    setEditing(createDefaultEndpoint(endpoints.length + 1))
  }
  const openEdit = (endpoint: PromptAuditEndpointDraft) => {
    setEditingIndex(endpoints.findIndex((item) => item.id === endpoint.id))
    setEditing(cloneData(endpoint))
  }
  const closeEditor = () => {
    setEditing(null)
    setEditingIndex(-1)
  }
  const saveEditor = () => {
    if (!editing?.id.trim() || !editing.name.trim() || !editing.base_url.trim()) return
    const next = endpoints.map((item) => cloneData(item))
    const value = cloneData(editing)
    if (value.token.trim()) value.clear_token = false
    if (editingIndex < 0) next.push(value)
    else next.splice(editingIndex, 1, value)
    onEndpointsChange?.(next)
    closeEditor()
  }
  const toggleEndpoint = (id: string) => {
    onEndpointsChange?.(endpoints.map((item) => (item.id === id ? { ...item, enabled: !item.enabled } : cloneData(item))))
  }
  const removeEndpoint = async (endpoint: PromptAuditEndpointDraft) => {
    if (!(await confirm(t('admin.promptAudit.pool.deleteConfirm', { name: endpoint.name }), { danger: true }))) return
    onEndpointsChange?.(endpoints.filter((item) => item.id !== endpoint.id).map((item) => cloneData(item)))
  }

  return (
    <section aria-labelledby="prompt-pool-title" className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2 id="prompt-pool-title" className={styles.h2}>
            {t('admin.promptAudit.pool.title')}
          </h2>
          <p className={styles.description}>{t('admin.promptAudit.pool.description')}</p>
        </div>
        <Button type="button" size="sm" variant="primary" data-test="add-endpoint" onClick={openCreate}>
          {t('admin.promptAudit.pool.add')}
        </Button>
      </div>

      {endpoints.length === 0 ? (
        <div className={styles.emptyBox}>{t('admin.promptAudit.pool.empty')}</div>
      ) : (
        <div className={styles.poolList}>
          <div className={styles.poolHeader}>
            <span>{t('admin.promptAudit.pool.node')}</span>
            <span>{t('admin.promptAudit.pool.model')}</span>
            <span>{t('admin.promptAudit.pool.limits')}</span>
            <span>{t('admin.promptAudit.pool.credential')}</span>
            <span>{t('admin.promptAudit.common.actions')}</span>
          </div>

          {endpoints.map((endpoint) => {
            const probing = probingIds.includes(endpoint.id)
            const probe = probeResults[endpoint.id]
            const invalid = credentialInvalid(endpoint)
            const configured = hasCredential(endpoint)
            return (
              <article key={endpoint.id} data-test={`endpoint-${endpoint.id}`} className={styles.poolRow}>
                <div className={styles.nodeCell}>
                  <Toggle
                    value={endpoint.enabled}
                    aria-label={t('admin.promptAudit.pool.toggleNode', { name: endpoint.name })}
                    onChange={() => toggleEndpoint(endpoint.id)}
                  />
                  <div className={styles.truncate}>
                    <div className={styles.nodeName}>
                      <span className={styles.truncate}>{endpoint.name}</span>
                      <span className={`${styles.dot} ${endpoint.enabled ? styles.dotSuccess : styles.dotMuted}`} aria-hidden="true" />
                    </div>
                    <p className={`${styles.hint} ${styles.mono} ${styles.truncate}`} title={endpoint.base_url}>
                      {endpoint.base_url}
                    </p>
                  </div>
                </div>

                <div className={styles.truncate}>
                  <p className={styles.cellLabel}>{t('admin.promptAudit.pool.model')}</p>
                  <span className={styles.truncate} title={endpoint.model}>
                    {endpoint.model}
                  </span>
                </div>

                <div>
                  <p className={styles.cellLabel}>{t('admin.promptAudit.pool.limits')}</p>
                  <div className={styles.chips}>
                    <span className={styles.chip}>{endpoint.timeout_ms} ms</span>
                    <span className={styles.chip}>{endpoint.input_limit} chars</span>
                  </div>
                </div>

                <div className={styles.truncate}>
                  <p className={styles.cellLabel}>{t('admin.promptAudit.pool.credential')}</p>
                  <div className={`${styles.credential} ${invalid ? styles.dangerText : configured ? styles.successText : styles.muted}`}>
                    <span
                      className={`${styles.dot} ${invalid ? styles.dotDanger : configured ? styles.dotSuccess : styles.dotMuted}`}
                      aria-hidden="true"
                    />
                    {invalid
                      ? t('admin.promptAudit.pool.invalid')
                      : configured
                        ? t('admin.promptAudit.pool.configured')
                        : t('admin.promptAudit.pool.missing')}
                  </div>
                  {probing ? <p className={`${styles.subText} ${styles.accentText}`}>{t('admin.promptAudit.pool.probeProgress')}</p> : null}
                  {probe ? (
                    <p className={`${styles.lineClamp} ${probe.ok ? styles.successText : styles.dangerText}`}>
                      {t('admin.promptAudit.pool.probeResult', {
                        status: probe.status,
                        http: probe.http_status || '—',
                        latency: probe.latency_ms
                      })}{' '}
                      · {probe.message}
                    </p>
                  ) : null}
                </div>

                <div className={styles.rowActions}>
                  <Button type="button" size="sm" variant="secondary" disabled={probing} onClick={() => onProbe?.(endpoint)}>
                    {probing ? t('admin.promptAudit.pool.probing') : t('admin.promptAudit.pool.probe')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => openEdit(endpoint)}>
                    {t('common.edit')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className={styles.dangerText} onClick={() => void removeEndpoint(endpoint)}>
                    {t('common.delete')}
                  </Button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <BaseDialog
        show={Boolean(editing)}
        title={editingIndex < 0 ? t('admin.promptAudit.pool.add') : t('admin.promptAudit.pool.edit')}
        width="wide"
        onClose={closeEditor}
        footer={
          <div className={styles.footer}>
            <Button type="button" variant="secondary" onClick={closeEditor}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="primary" data-test="save-endpoint" onClick={saveEditor}>
              {t('common.save')}
            </Button>
          </div>
        }
      >
        {editing ? (
          <form
            className={styles.formGrid}
            onSubmit={(event) => {
              event.preventDefault()
              saveEditor()
            }}
          >
            <label className={styles.field}>
              <span className={styles.labelText}>{t('admin.promptAudit.pool.name')}</span>
              <input
                className={styles.input}
                required
                value={editing.name}
                aria-label={t('admin.promptAudit.pool.name')}
                onChange={(event) => patchEditing({ name: event.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.labelText}>{t('admin.promptAudit.pool.id')}</span>
              <input
                className={styles.input}
                required
                disabled={editingIndex >= 0}
                value={editing.id}
                aria-label={t('admin.promptAudit.pool.id')}
                onChange={(event) => patchEditing({ id: event.target.value })}
              />
            </label>
            <label className={`${styles.field} ${styles.span2}`}>
              <span className={styles.labelText}>{t('admin.promptAudit.pool.baseUrl')}</span>
              <input
                className={styles.input}
                required
                inputMode="url"
                value={editing.base_url}
                aria-label={t('admin.promptAudit.pool.baseUrl')}
                onChange={(event) => patchEditing({ base_url: event.target.value })}
              />
            </label>
            <label className={`${styles.field} ${styles.span2}`}>
              <span className={styles.labelText}>{t('admin.promptAudit.pool.apiKey')}</span>
              <input
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={editing.token}
                placeholder={
                  editing.has_token
                    ? editing.token_status === 'invalid'
                      ? t('admin.promptAudit.pool.reenterSecret')
                      : t('admin.promptAudit.pool.keepSecret')
                    : ''
                }
                aria-label={t('admin.promptAudit.pool.apiKey')}
                onChange={(event) => patchEditing({ token: event.target.value })}
              />
              <span className={styles.hint}>{t('admin.promptAudit.pool.secretHint')}</span>
            </label>
            {editing.has_token ? (
              <div className={`${styles.checkRow} ${styles.span2}`}>
                <Checkbox
                  checked={editing.clear_token}
                  label={t('admin.promptAudit.pool.clearSecret')}
                  aria-label={t('admin.promptAudit.pool.clearSecret')}
                  onCheckedChange={(checked) => patchEditing({ clear_token: checked === true })}
                />
              </div>
            ) : null}
            <label className={`${styles.field} ${styles.span2}`}>
              <span className={styles.labelText}>{t('admin.promptAudit.pool.model')}</span>
              <input
                className={styles.input}
                value={editing.model}
                aria-label={t('admin.promptAudit.pool.model')}
                onChange={(event) => patchEditing({ model: event.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.labelText}>{t('admin.promptAudit.pool.timeout')}</span>
              <input
                className={styles.input}
                type="number"
                min={100}
                max={30000}
                required
                value={editing.timeout_ms}
                aria-label={t('admin.promptAudit.pool.timeout')}
                onChange={(event) => patchEditing({ timeout_ms: Number(event.target.value) })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.labelText}>{t('admin.promptAudit.pool.inputLimit')}</span>
              <input
                className={styles.input}
                type="number"
                min={128}
                max={100000}
                required
                value={editing.input_limit}
                aria-label={t('admin.promptAudit.pool.inputLimit')}
                onChange={(event) => patchEditing({ input_limit: Number(event.target.value) })}
              />
            </label>
          </form>
        ) : null}
      </BaseDialog>

      {confirmDialog}
    </section>
  )
}
