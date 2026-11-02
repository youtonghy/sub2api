/**
 * 全平台分组的模型路由（Composite Routes）弹窗，对应 Vue 版 GroupsView 中的 Composite Routes Modal：
 * 左侧为路由列表（编辑 / 删除），右侧为新增或编辑表单与路由预览。
 */
import { Check, Pencil, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import arcInput from '@/components/arc/input/input.module.css'
import arcTextarea from '@/components/arc/textarea/textarea.module.css'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import PlatformIcon from '@/components/common/PlatformIcon'
import Select from '@/components/common/Select'
import Skeleton from '@/components/common/Skeleton'
import { CONCRETE_PLATFORM_OPTIONS } from '@/constants/platforms'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type {
  AdminGroup,
  CompositeModelRoute,
  CompositeModelRouteInput,
  CompositeRouteDecision,
  CompositeRouteEndpoint,
  CompositeRouteMatchType,
  GroupPlatform
} from '@/types'
import { platformLabel } from '@/utils/platformColors'
import styles from './GroupCompositeRoutesModal.module.css'

type ConcreteGroupPlatform = Exclude<GroupPlatform, 'composite'>
type CompositeRouteFormState = {
  public_model: string
  match_type: CompositeRouteMatchType
  target_platform: ConcreteGroupPlatform
  upstream_model: string
  endpoint: CompositeRouteEndpoint
  priority: number | string
  enabled: boolean
  notes: string
}

const defaultRouteForm = (): CompositeRouteFormState => ({
  public_model: '',
  match_type: 'exact',
  target_platform: 'openai',
  upstream_model: '',
  endpoint: 'any',
  priority: 100,
  enabled: true,
  notes: ''
})

const apiErrorMessage = (error: any, fallback: string) =>
  error?.response?.data?.detail || error?.response?.data?.message || fallback

export interface GroupCompositeRoutesModalProps {
  show: boolean
  group: AdminGroup | null
  onClose: () => void
}

export default function GroupCompositeRoutesModal({ show, group, onClose }: GroupCompositeRoutesModalProps) {
  const { t } = useI18n()
  const [routes, setRoutes] = useState<CompositeModelRoute[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [routeForm, setRouteForm] = useState<CompositeRouteFormState>(defaultRouteForm)
  const [previewModel, setPreviewModel] = useState('')
  const [previewEndpoint, setPreviewEndpoint] = useState<CompositeRouteEndpoint>('any')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewDecision, setPreviewDecision] = useState<CompositeRouteDecision | null>(null)
  const [pendingDelete, setPendingDelete] = useState<CompositeModelRoute | null>(null)
  const groupRef = useRef(group)
  useEffect(() => {
    groupRef.current = group
  })

  const endpointOptions = [
    { value: 'any', label: t('admin.groups.compositeRoutes.endpoints.any') },
    { value: 'messages', label: t('admin.groups.compositeRoutes.endpoints.messages') },
    { value: 'count_tokens', label: t('admin.groups.compositeRoutes.endpoints.countTokens') },
    { value: 'responses', label: t('admin.groups.compositeRoutes.endpoints.responses') },
    { value: 'chat_completions', label: t('admin.groups.compositeRoutes.endpoints.chatCompletions') },
    { value: 'embeddings', label: t('admin.groups.compositeRoutes.endpoints.embeddings') },
    { value: 'images', label: t('admin.groups.compositeRoutes.endpoints.images') },
    { value: 'gemini', label: t('admin.groups.compositeRoutes.endpoints.gemini') }
  ]
  const matchOptions = [
    { value: 'exact', label: t('admin.groups.compositeRoutes.match.exact') },
    { value: 'prefix', label: t('admin.groups.compositeRoutes.match.prefix') }
  ]
  const platformOptions = [...CONCRETE_PLATFORM_OPTIONS]

  const matchLabel = (matchType: CompositeRouteMatchType) =>
    matchOptions.find((option) => option.value === matchType)?.label || matchType
  const formatEndpoint = (endpoint: CompositeRouteEndpoint) =>
    endpointOptions.find((option) => option.value === endpoint)?.label || endpoint
  const formatPlatform = (platform: string) => {
    if (!platform) return '—'
    return t(`admin.groups.platforms.${platform}`, platformLabel(platform))
  }
  const sourceLabel = (source: string) => {
    if (source === 'route') return t('admin.groups.compositeRoutes.sources.route')
    if (source === 'detector') return t('admin.groups.compositeRoutes.sources.detector')
    return source || '—'
  }

  const resetRouteForm = () => {
    setEditingId(null)
    setRouteForm(defaultRouteForm())
  }

  const loadRoutes = async () => {
    const current = groupRef.current
    if (!current) return
    setLoading(true)
    try {
      const list = await adminAPI.groups.listCompositeRoutes(current.id)
      setRoutes(
        list.sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority
          return a.id - b.id
        })
      )
    } catch (error: any) {
      useAppStore.getState().showError(apiErrorMessage(error, t('admin.groups.compositeRoutes.failedToLoad')))
      console.error('Error loading composite routes:', error)
    } finally {
      setLoading(false)
    }
  }

  // 打开时重置预览与表单并加载路由；关闭时清空
  const groupId = group?.id
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- 打开 / 关闭时重置弹窗状态 */
    setPreviewModel('')
    setPreviewEndpoint('any')
    setPreviewDecision(null)
    resetRouteForm()
    if (!show || groupId == null) {
      setRoutes([])
      return
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    void loadRoutes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, groupId])

  const editRoute = (route: CompositeModelRoute) => {
    setEditingId(route.id)
    setRouteForm({
      public_model: route.public_model,
      match_type: route.match_type,
      target_platform: route.target_platform,
      upstream_model: route.upstream_model,
      endpoint: route.endpoint,
      priority: route.priority || 100,
      enabled: route.enabled,
      notes: route.notes || ''
    })
  }

  const toRouteInput = (): CompositeModelRouteInput => ({
    public_model: routeForm.public_model.trim(),
    match_type: routeForm.match_type,
    target_platform: routeForm.target_platform,
    upstream_model: routeForm.upstream_model.trim(),
    endpoint: routeForm.endpoint,
    priority: Number(routeForm.priority) || 100,
    enabled: routeForm.enabled,
    notes: routeForm.notes.trim()
  })

  const saveRoute = async () => {
    if (!group) return
    if (!routeForm.public_model.trim()) {
      useAppStore.getState().showError(t('admin.groups.compositeRoutes.publicModelRequired'))
      return
    }
    setSaving(true)
    try {
      const payload = toRouteInput()
      if (editingId) {
        await adminAPI.groups.updateCompositeRoute(group.id, editingId, payload)
        useAppStore.getState().showSuccess(t('admin.groups.compositeRoutes.routeUpdated'))
      } else {
        await adminAPI.groups.createCompositeRoute(group.id, payload)
        useAppStore.getState().showSuccess(t('admin.groups.compositeRoutes.routeCreated'))
      }
      resetRouteForm()
      await loadRoutes()
    } catch (error: any) {
      useAppStore.getState().showError(apiErrorMessage(error, t('admin.groups.compositeRoutes.failedToSave')))
      console.error('Error saving composite route:', error)
    } finally {
      setSaving(false)
    }
  }

  const deleteRoute = async (route: CompositeModelRoute) => {
    if (!group) return
    try {
      await adminAPI.groups.deleteCompositeRoute(group.id, route.id)
      if (editingId === route.id) {
        resetRouteForm()
      }
      useAppStore.getState().showSuccess(t('admin.groups.compositeRoutes.routeDeleted'))
      await loadRoutes()
    } catch (error: any) {
      useAppStore.getState().showError(apiErrorMessage(error, t('admin.groups.compositeRoutes.failedToDelete')))
      console.error('Error deleting composite route:', error)
    }
  }

  const previewRoute = async () => {
    if (!group || !previewModel.trim()) return
    setPreviewLoading(true)
    try {
      setPreviewDecision(
        await adminAPI.groups.previewCompositeRoute(group.id, {
          model: previewModel.trim(),
          endpoint: previewEndpoint
        })
      )
    } catch (error: any) {
      useAppStore.getState().showError(apiErrorMessage(error, t('admin.groups.compositeRoutes.failedToPreview')))
      console.error('Error previewing composite route:', error)
    } finally {
      setPreviewLoading(false)
    }
  }

  const title = group
    ? t('admin.groups.compositeRoutes.titleWithGroup', { name: group.name })
    : t('admin.groups.compositeRoutes.title')

  return (
    <>
      <BaseDialog
        show={show}
        title={title}
        width="wide"
        onClose={onClose}
        footer={
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        }
      >
        <div className={styles.layout}>
          <section className={styles.column}>
            <div className={styles.columnHeader}>
              <h3 className={styles.heading}>{t('admin.groups.compositeRoutes.routes')}</h3>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={loading}
                aria-label={t('common.refresh')}
                title={t('common.refresh')}
                onClick={() => void loadRoutes()}
              >
                <RefreshCw size={16} strokeWidth={1.75} className={loading ? styles.spinning : undefined} aria-hidden="true" />
              </Button>
            </div>

            <div className={styles.region}>
              {loading ? (
                <div className={styles.loading} aria-busy="true">
                  <span className={styles.srOnly}>{t('common.loading')}</span>
                  {[0, 1, 2].map((row) => (
                    <Skeleton key={row} height={40} />
                  ))}
                </div>
              ) : routes.length === 0 ? (
                <div className={styles.empty}>{t('admin.groups.compositeRoutes.empty')}</div>
              ) : (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>{t('admin.groups.compositeRoutes.publicModel')}</th>
                        <th>{t('admin.groups.compositeRoutes.target')}</th>
                        <th>{t('admin.groups.compositeRoutes.scope')}</th>
                        <th className={styles.alignEnd}>{t('admin.groups.columns.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {routes.map((route) => (
                        <tr key={route.id} data-disabled={!route.enabled || undefined}>
                          <td className={styles.modelCell}>
                            <div className={styles.strong}>{route.public_model}</div>
                            <div className={styles.badges}>
                              <Badge size="sm" tone="neutral">
                                {matchLabel(route.match_type)}
                              </Badge>
                              {!route.enabled ? (
                                <Badge size="sm" tone="danger">
                                  {t('admin.accounts.status.inactive')}
                                </Badge>
                              ) : null}
                            </div>
                          </td>
                          <td>
                            <div className={styles.platform}>
                              <PlatformIcon platform={route.target_platform} size="xs" />
                              <span>{formatPlatform(route.target_platform)}</span>
                            </div>
                            <div className={styles.secondary}>{route.upstream_model || route.public_model}</div>
                          </td>
                          <td>
                            <div>{formatEndpoint(route.endpoint)}</div>
                            <div className={styles.secondary}>
                              {t('admin.groups.compositeRoutes.priority')}: {route.priority}
                            </div>
                          </td>
                          <td>
                            <div className={styles.rowActions}>
                              <button
                                type="button"
                                className={styles.iconButton}
                                title={t('common.edit')}
                                aria-label={t('common.edit')}
                                onClick={() => editRoute(route)}
                              >
                                <Pencil size={16} strokeWidth={1.75} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className={styles.iconButton}
                                data-tone="danger"
                                title={t('common.delete')}
                                aria-label={t('common.delete')}
                                onClick={() => setPendingDelete(route)}
                              >
                                <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section className={styles.column}>
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault()
                void saveRoute()
              }}
            >
              <div className={styles.columnHeader}>
                <h3 className={styles.heading}>
                  {editingId ? t('admin.groups.compositeRoutes.editRoute') : t('admin.groups.compositeRoutes.addRoute')}
                </h3>
                {editingId ? (
                  <Button type="button" size="sm" variant="ghost" onClick={resetRouteForm}>
                    {t('common.cancel')}
                  </Button>
                ) : null}
              </div>

              <label className={styles.field}>
                <span className={styles.label}>{t('admin.groups.compositeRoutes.publicModel')}</span>
                <input
                  type="text"
                  className={arcInput.input}
                  required
                  placeholder="openrouter/gpt-5"
                  value={routeForm.public_model}
                  onChange={(event) => setRouteForm({ ...routeForm, public_model: event.target.value })}
                />
              </label>

              <div className={styles.grid2}>
                <div className={styles.field}>
                  <span className={styles.label}>{t('admin.groups.compositeRoutes.matchType')}</span>
                  <Select
                    value={routeForm.match_type}
                    options={matchOptions}
                    aria-label={t('admin.groups.compositeRoutes.matchType')}
                    onChange={(value) => setRouteForm({ ...routeForm, match_type: value as CompositeRouteMatchType })}
                  />
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>{t('admin.groups.compositeRoutes.endpoint')}</span>
                  <Select
                    value={routeForm.endpoint}
                    options={endpointOptions}
                    aria-label={t('admin.groups.compositeRoutes.endpoint')}
                    onChange={(value) => setRouteForm({ ...routeForm, endpoint: value as CompositeRouteEndpoint })}
                  />
                </div>
              </div>

              <div className={styles.grid2}>
                <div className={styles.field}>
                  <span className={styles.label}>{t('admin.groups.compositeRoutes.targetPlatform')}</span>
                  <Select
                    value={routeForm.target_platform}
                    options={platformOptions}
                    aria-label={t('admin.groups.compositeRoutes.targetPlatform')}
                    onChange={(value) => setRouteForm({ ...routeForm, target_platform: value as ConcreteGroupPlatform })}
                  />
                </div>
                <label className={styles.field}>
                  <span className={styles.label}>{t('admin.groups.compositeRoutes.priority')}</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className={arcInput.input}
                    value={routeForm.priority}
                    onChange={(event) => {
                      const parsed = parseFloat(event.target.value)
                      setRouteForm({ ...routeForm, priority: Number.isNaN(parsed) ? event.target.value : parsed })
                    }}
                  />
                </label>
              </div>

              <label className={styles.field}>
                <span className={styles.label}>{t('admin.groups.compositeRoutes.upstreamModel')}</span>
                <input
                  type="text"
                  className={arcInput.input}
                  placeholder="gpt-5"
                  value={routeForm.upstream_model}
                  onChange={(event) => setRouteForm({ ...routeForm, upstream_model: event.target.value })}
                />
                <span className={styles.hint}>{t('admin.groups.compositeRoutes.upstreamModelHint')}</span>
              </label>

              <label className={styles.field}>
                <span className={styles.label}>{t('admin.groups.compositeRoutes.notes')}</span>
                <textarea
                  rows={2}
                  className={arcTextarea.control}
                  value={routeForm.notes}
                  onChange={(event) => setRouteForm({ ...routeForm, notes: event.target.value })}
                />
              </label>

              <div className={styles.columnHeader}>
                <Checkbox
                  label={t('admin.groups.compositeRoutes.enabled')}
                  checked={routeForm.enabled}
                  onCheckedChange={(checked) => setRouteForm({ ...routeForm, enabled: checked === true })}
                />
                <Button type="submit" variant="primary" disabled={saving} loading={saving}>
                  {!saving ? <Check size={16} strokeWidth={1.75} aria-hidden="true" /> : null}
                  {editingId ? t('common.update') : t('common.create')}
                </Button>
              </div>
            </form>

            <div className={styles.preview}>
              <h3 className={styles.heading}>{t('admin.groups.compositeRoutes.preview')}</h3>
              <input
                type="text"
                className={arcInput.input}
                placeholder="openrouter/gpt-5"
                aria-label={t('admin.groups.compositeRoutes.preview')}
                value={previewModel}
                onChange={(event) => setPreviewModel(event.target.value)}
                onKeyUp={(event) => {
                  if (event.key === 'Enter') void previewRoute()
                }}
              />
              <div className={styles.previewControls}>
                <div className={styles.grow}>
                  <Select
                    value={previewEndpoint}
                    options={endpointOptions}
                    aria-label={t('admin.groups.compositeRoutes.endpoint')}
                    onChange={(value) => setPreviewEndpoint(value as CompositeRouteEndpoint)}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={previewLoading || !previewModel.trim()}
                  aria-label={t('admin.groups.compositeRoutes.preview')}
                  onClick={() => void previewRoute()}
                >
                  <Play size={16} strokeWidth={1.75} aria-hidden="true" />
                </Button>
              </div>

              {previewDecision ? (
                <div className={styles.decision}>
                  <div className={styles.badges}>
                    <Badge size="sm" tone={previewDecision.matched ? 'success' : 'danger'}>
                      {previewDecision.matched
                        ? t('admin.groups.compositeRoutes.matched')
                        : t('admin.groups.compositeRoutes.notMatched')}
                    </Badge>
                    <Badge size="sm" tone="neutral">
                      {sourceLabel(previewDecision.source)}
                    </Badge>
                  </div>
                  {previewDecision.matched ? (
                    <div className={styles.decisionBody}>
                      <div>
                        {t('admin.groups.compositeRoutes.targetPlatform')}: {formatPlatform(previewDecision.target_platform)}
                      </div>
                      <div className={styles.breakAll}>
                        {t('admin.groups.compositeRoutes.upstreamModel')}: {previewDecision.upstream_model}
                      </div>
                    </div>
                  ) : (
                    <div className={styles.secondary}>{previewDecision.reason}</div>
                  )}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </BaseDialog>

      <ConfirmDialog
        show={pendingDelete !== null}
        title={t('common.delete')}
        message={t('admin.groups.compositeRoutes.deleteConfirm')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => {
          const route = pendingDelete
          setPendingDelete(null)
          if (route) void deleteRoute(route)
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  )
}
