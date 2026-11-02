/**
 * Prompt Audit 页面，对应 Vue 版 features/prompt-audit/PromptAuditView.vue。
 * 「审计事件 / 配置」两个页签；配置页底部有粘性保存栏（总开关、阻断、仅审最新轮、记录通过事件、重置、保存）。
 */
import { useEffect, useRef, useState } from 'react'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Switch } from '@/components/arc/switch/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { extractApiErrorCode, extractApiErrorMessage } from '@/utils/apiError'
import promptAuditAPI from './api'
import EndpointPool from './components/EndpointPool'
import EventDetailDialog from './components/EventDetailDialog'
import EventWorkspace from './components/EventWorkspace'
import FilterDeleteDialog from './components/FilterDeleteDialog'
import PolicyPanel from './components/PolicyPanel'
import RuntimeOverview from './components/RuntimeOverview'
import styles from './components/promptAudit.module.css'
import type {
  PromptAuditDraft,
  PromptAuditEndpointDraft,
  PromptAuditEvent,
  PromptAuditGroup,
  PromptAuditRuntime,
  PromptDeletePreview,
  PromptEventFilters,
  PromptEventPage,
  PromptLoadErrors,
  PromptProbeResult
} from './types'
import { buildUpdateRequest, cloneData, configToDraft, draftFingerprint, emptyEventFilters } from './viewModel'

type PromptAuditPageTab = 'config' | 'events'
type LoadingState = Record<'config' | 'runtime' | 'groups' | 'events' | 'saving' | 'detail' | 'deleting' | 'previewing', boolean>

interface SaveToggleProps {
  label: string
  value: boolean
  disabled?: boolean
  testId: string
  onChange: (value: boolean) => void
}

function SaveToggle({ label, value, disabled = false, testId, onChange }: SaveToggleProps) {
  return (
    <Switch
      data-test={testId}
      checked={value}
      disabled={disabled}
      label={label}
      aria-label={label}
      onCheckedChange={(next) => {
        if (!disabled) onChange(next)
      }}
    />
  )
}

export default function PromptAuditView() {
  const { t, te, locale } = useI18n()
  const [activeTab, setActiveTab] = useState<PromptAuditPageTab>('events')
  const pageTabs = [
    { id: 'events' as const, label: t('admin.promptAudit.tabs.events') },
    { id: 'config' as const, label: t('admin.promptAudit.tabs.config') }
  ]
  const [serverConfig, setServerConfig] = useState<PromptAuditDraft | null>(null)
  const [draft, setDraft] = useState<PromptAuditDraft | null>(null)
  const [runtime, setRuntime] = useState<PromptAuditRuntime | null>(null)
  const [groups, setGroups] = useState<PromptAuditGroup[]>([])
  const [events, setEvents] = useState<PromptEventPage>({ items: [], total: 0, page: 1, page_size: 20, pages: 0 })
  const eventsRef = useRef(events)
  const [filters, setFilters] = useState<PromptEventFilters>(emptyEventFilters)
  const appliedFilters = useRef<PromptEventFilters>(emptyEventFilters())
  const [selectedEventIds, setSelectedEventIds] = useState<number[]>([])
  const [activeEvent, setActiveEvent] = useState<PromptAuditEvent | null>(null)
  const [showEventDetail, setShowEventDetail] = useState(false)
  const [probeResults, setProbeResults] = useState<Record<string, PromptProbeResult>>({})
  const probingRef = useRef<string[]>([])
  const [probingIds, setProbingIdsState] = useState<string[]>([])
  const [showFilterDelete, setShowFilterDelete] = useState(false)
  const [deletePreview, setDeletePreview] = useState<PromptDeletePreview | null>(null)
  const deletePreviewRef = useRef<{ preview: PromptDeletePreview | null; filters: PromptEventFilters | null }>({ preview: null, filters: null })
  const [showBlockingConfirmation, setShowBlockingConfirmation] = useState(false)
  const [deleteRequest, setDeleteRequest] = useState<{ mode: '' | 'single' | 'batch'; ids: number[] }>({ mode: '', ids: [] })
  const [loading, setLoadingState] = useState<LoadingState>({
    config: false,
    runtime: false,
    groups: false,
    events: false,
    saving: false,
    detail: false,
    deleting: false,
    previewing: false
  })
  const loadingRef = useRef(loading)
  const [loadErrors, setLoadErrors] = useState<PromptLoadErrors>({ config: '', runtime: '', groups: '', events: '' })
  const dirty = draftFingerprint(draft) !== draftFingerprint(serverConfig)

  const setLoading = (key: keyof LoadingState, value: boolean) => {
    loadingRef.current = { ...loadingRef.current, [key]: value }
    setLoadingState(loadingRef.current)
  }
  const setLoadError = (key: keyof PromptLoadErrors, value: string) => setLoadErrors((prev) => ({ ...prev, [key]: value }))
  const setProbingIds = (ids: string[]) => {
    probingRef.current = ids
    setProbingIdsState(ids)
  }
  const updateEvents = (patch: Partial<PromptEventPage>) => {
    eventsRef.current = { ...eventsRef.current, ...patch }
    setEvents(eventsRef.current)
  }

  function errorMessage(error: unknown, fallbackKey: string): string {
    const code = extractApiErrorCode(error)
    if (code) {
      const key = `admin.promptAudit.errors.${code}`
      if (te(key)) return t(key)
    }
    return extractApiErrorMessage(error, t(fallbackKey))
  }

  async function loadConfig() {
    setLoading('config', true)
    setLoadError('config', '')
    try {
      const config = await promptAuditAPI.getConfig()
      setServerConfig(configToDraft(config))
      setDraft(configToDraft(config))
    } catch (error) {
      setLoadError('config', errorMessage(error, 'admin.promptAudit.errors.loadConfig'))
    } finally {
      setLoading('config', false)
    }
  }
  async function loadRuntime() {
    setLoading('runtime', true)
    setLoadError('runtime', '')
    try {
      setRuntime(await promptAuditAPI.getRuntime())
    } catch (error) {
      setLoadError('runtime', errorMessage(error, 'admin.promptAudit.errors.loadRuntime'))
    } finally {
      setLoading('runtime', false)
    }
  }
  async function loadGroups() {
    setLoading('groups', true)
    setLoadError('groups', '')
    try {
      setGroups(await promptAuditAPI.listGroups())
    } catch (error) {
      setLoadError('groups', errorMessage(error, 'admin.promptAudit.errors.loadGroups'))
    } finally {
      setLoading('groups', false)
    }
  }
  async function loadEvents() {
    setLoading('events', true)
    setLoadError('events', '')
    try {
      const result = await promptAuditAPI.listEvents(appliedFilters.current, eventsRef.current.page, eventsRef.current.page_size)
      updateEvents(result)
      setSelectedEventIds([])
    } catch (error) {
      setLoadError('events', errorMessage(error, 'admin.promptAudit.errors.loadEvents'))
    } finally {
      setLoading('events', false)
    }
  }

  const loadInitialRef = useRef(() => Promise.allSettled([loadConfig(), loadRuntime(), loadGroups(), loadEvents()]))
  useEffect(() => {
    void loadInitialRef.current()
  }, [])

  const replaceDraft = (value: PromptAuditDraft) => setDraft(cloneData(value))
  const updateEndpoints = (value: PromptAuditEndpointDraft[]) => {
    if (!draft) return
    replaceDraft({ ...draft, endpoints: value })
  }
  const setEnabled = (value: boolean) => {
    if (!draft) return
    replaceDraft({ ...draft, enabled: value, blocking_enabled: value ? draft.blocking_enabled : false })
  }
  const setBlocking = (value: boolean) => {
    if (!draft || !draft.enabled) return
    if (value && !draft.blocking_enabled) {
      setShowBlockingConfirmation(true)
      return
    }
    replaceDraft({ ...draft, blocking_enabled: value })
  }
  const confirmBlocking = () => {
    setShowBlockingConfirmation(false)
    if (draft) replaceDraft({ ...draft, blocking_enabled: true })
  }
  const resetDraft = () => {
    if (serverConfig) setDraft(cloneData(serverConfig))
  }
  async function saveConfig() {
    if (!draft || !dirty) return
    const appStore = useAppStore.getState()
    setLoading('saving', true)
    try {
      const saved = await promptAuditAPI.updateConfig(buildUpdateRequest(draft))
      setServerConfig(configToDraft(saved))
      setDraft(configToDraft(saved))
      appStore.showSuccess(t('admin.promptAudit.messages.saved'))
      await loadRuntime()
    } catch (error) {
      const code = extractApiErrorCode(error)
      appStore.showError(
        errorMessage(
          error,
          code === 'prompt_audit_config_conflict' ? 'admin.promptAudit.errors.prompt_audit_config_conflict' : 'admin.promptAudit.errors.saveConfig'
        )
      )
    } finally {
      setLoading('saving', false)
    }
  }
  async function runProbe(endpoint: PromptAuditEndpointDraft) {
    if (probingRef.current.includes(endpoint.id)) return
    const appStore = useAppStore.getState()
    setProbingIds([...probingRef.current, endpoint.id])
    try {
      const result = await promptAuditAPI.probeEndpoint(endpoint)
      setProbeResults((prev) => ({ ...prev, [endpoint.id]: result }))
      if (result.ok) appStore.showSuccess(t('admin.promptAudit.messages.probeSucceeded'))
      else appStore.showError(`${result.error_code || result.status}: ${result.message}`)
    } catch (error) {
      appStore.showError(errorMessage(error, 'admin.promptAudit.errors.probe'))
    } finally {
      setProbingIds(probingRef.current.filter((id) => id !== endpoint.id))
    }
  }

  function clearDeletePreview() {
    deletePreviewRef.current = { preview: null, filters: null }
    setDeletePreview(null)
  }
  function handleFiltersChanged(value: PromptEventFilters) {
    setFilters(cloneData(value))
    clearDeletePreview()
  }
  function applyEventFilters(value: PromptEventFilters) {
    setFilters(cloneData(value))
    appliedFilters.current = cloneData(value)
    updateEvents({ page: 1 })
    clearDeletePreview()
    void loadEvents()
  }
  const changePage = (value: number) => {
    updateEvents({ page: value })
    void loadEvents()
  }
  const changePageSize = (value: number) => {
    updateEvents({ page_size: value, page: 1 })
    void loadEvents()
  }
  async function openEvent(id: number) {
    setShowEventDetail(true)
    setLoading('detail', true)
    setActiveEvent(null)
    try {
      setActiveEvent(await promptAuditAPI.getEvent(id))
    } catch (error) {
      useAppStore.getState().showError(errorMessage(error, 'admin.promptAudit.errors.loadDetail'))
      setShowEventDetail(false)
    } finally {
      setLoading('detail', false)
    }
  }
  const closeEventDetail = () => {
    setShowEventDetail(false)
    setActiveEvent(null)
  }
  const requestSingleDelete = (id: number) => setDeleteRequest({ mode: 'single', ids: [id] })
  const requestBatchDelete = () => {
    if (selectedEventIds.length) setDeleteRequest({ mode: 'batch', ids: [...selectedEventIds] })
  }
  const clearDeleteRequest = () => setDeleteRequest({ mode: '', ids: [] })
  async function confirmIDDelete() {
    const { mode } = deleteRequest
    const ids = [...deleteRequest.ids]
    clearDeleteRequest()
    if (!mode || ids.length === 0) return
    const appStore = useAppStore.getState()
    setLoading('deleting', true)
    try {
      const result = mode === 'single' ? await promptAuditAPI.deleteEvent(ids[0]) : await promptAuditAPI.batchDeleteEvents(ids)
      appStore.showSuccess(t('admin.promptAudit.messages.deleted', { count: result.deleted_events }))
      await Promise.allSettled([loadEvents(), loadRuntime()])
    } catch (error) {
      appStore.showError(errorMessage(error, 'admin.promptAudit.errors.delete'))
    } finally {
      setLoading('deleting', false)
    }
  }
  function requestFilterDeletePreview() {
    clearDeletePreview()
    setShowFilterDelete(true)
  }
  function closeFilterDelete() {
    setShowFilterDelete(false)
    clearDeletePreview()
  }
  async function runFilterDeletePreview(value: PromptEventFilters) {
    setLoading('previewing', true)
    try {
      const preview = await promptAuditAPI.previewDelete(value)
      deletePreviewRef.current = { preview, filters: cloneData(value) }
      setDeletePreview(preview)
    } catch (error) {
      clearDeletePreview()
      useAppStore.getState().showError(errorMessage(error, 'admin.promptAudit.errors.previewDelete'))
    } finally {
      setLoading('previewing', false)
    }
  }
  async function confirmFilterDelete(value?: PromptEventFilters) {
    if (loadingRef.current.deleting) return
    const appStore = useAppStore.getState()
    setLoading('deleting', true)
    try {
      let preview = deletePreviewRef.current.preview
      let previewFilters = deletePreviewRef.current.filters ? cloneData(deletePreviewRef.current.filters) : null
      // One-click path: no fresh preview (never requested, or cleared by a
      // criteria change) — mint the confirmation token on the fly from the
      // criteria the dialog just emitted, then delete in the same action.
      if ((!preview || !previewFilters) && value) {
        preview = await promptAuditAPI.previewDelete(value)
        previewFilters = cloneData(value)
      }
      if (!preview || !previewFilters) return
      const result = await promptAuditAPI.deleteEventsByFilter(previewFilters, preview)
      closeFilterDelete()
      appStore.showSuccess(t('admin.promptAudit.messages.deleted', { count: result.deleted_events }))
      await Promise.allSettled([loadEvents(), loadRuntime()])
    } catch (error) {
      clearDeletePreview()
      appStore.showError(errorMessage(error, 'admin.promptAudit.errors.deleteConfirmation'))
    } finally {
      setLoading('deleting', false)
    }
  }
  const formatDate = (value: string): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value))

  return (
    <div className={styles.page}>
      {draft ? (
        <div className={styles.pageTop}>
          <span />
          <div className={styles.versionMeta}>
            <p>{t('admin.promptAudit.configVersion', { version: draft.config_version })}</p>
            {draft.updated_at ? <p>{formatDate(draft.updated_at)}</p> : null}
          </div>
        </div>
      ) : null}

      {loadErrors.config && !draft ? (
        <Alert tone="danger" title={loadErrors.config} role="alert">
          <Button type="button" size="sm" variant="secondary" onClick={() => void loadConfig()}>
            {t('admin.promptAudit.actions.retry')}
          </Button>
        </Alert>
      ) : (
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PromptAuditPageTab)}>
          <TabsList aria-label={t('admin.promptAudit.title')}>
            {pageTabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} data-test={`tab-${tab.id}`}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* 与 Vue 版 v-show 一致：两个面板都保持挂载，只隐藏非当前页签（保留节点池编辑等局部状态） */}
          <div role="tabpanel" data-test="tab-panel-config" hidden={activeTab !== 'config'}>
            <div className={styles.mainRegion}>
              <RuntimeOverview
                runtime={runtime}
                loading={loading.runtime}
                error={loadErrors.runtime}
                onRefresh={() => void loadRuntime()}
              />
              {draft ? (
                <>
                  <EndpointPool
                    endpoints={draft.endpoints}
                    probeResults={probeResults}
                    probingIds={probingIds}
                    onEndpointsChange={updateEndpoints}
                    onProbe={(endpoint) => void runProbe(endpoint)}
                  />
                  {loadErrors.groups ? <Alert tone="warning" title={loadErrors.groups} role="alert" /> : null}
                  <PolicyPanel draft={draft} groups={groups} onDraftChange={replaceDraft} />
                </>
              ) : null}
            </div>
          </div>

          <div role="tabpanel" data-test="tab-panel-events" hidden={activeTab !== 'events'}>
            {draft?.enabled && !draft.store_pass_events ? (
              <Alert
                tone="warning"
                title={t('admin.promptAudit.events.passEventsDisabled')}
                role="status"
                data-test="pass-events-disabled-notice"
                className={styles.notice}
              >
                <Button type="button" size="sm" variant="secondary" onClick={() => setActiveTab('config')}>
                  {t('admin.promptAudit.events.openConfiguration')}
                </Button>
              </Alert>
            ) : null}
            <div className={styles.mainRegion}>
              <EventWorkspace
                events={events.items}
                total={events.total}
                page={events.page}
                pageSize={events.page_size}
                filters={filters}
                selectedIds={selectedEventIds}
                loading={loading.events}
                error={loadErrors.events}
                onFiltersChange={handleFiltersChanged}
                onSearch={applyEventFilters}
                onSelection={setSelectedEventIds}
                onPage={changePage}
                onPageSize={changePageSize}
                onView={(id) => void openEvent(id)}
                onDelete={requestSingleDelete}
                onBatchDelete={requestBatchDelete}
                onPreviewDelete={requestFilterDeletePreview}
              />
            </div>
          </div>
        </Tabs>
      )}

      {draft && activeTab === 'config' ? (
        <div className={styles.saveBar}>
          <div className={styles.saveToggles}>
            <SaveToggle label={t('admin.promptAudit.saveBar.enabled')} value={draft.enabled} testId="enabled-toggle" onChange={setEnabled} />
            <SaveToggle
              label={t('admin.promptAudit.saveBar.blocking')}
              value={draft.blocking_enabled}
              disabled={!draft.enabled}
              testId="blocking-toggle"
              onChange={setBlocking}
            />
            <SaveToggle
              label={t('admin.promptAudit.saveBar.blockingLatestTurnOnly')}
              value={draft.blocking_latest_turn_only}
              disabled={!draft.enabled || !draft.blocking_enabled}
              testId="blocking-latest-turn-only-toggle"
              onChange={(value) => replaceDraft({ ...draft, blocking_latest_turn_only: value })}
            />
            <SaveToggle
              label={t('admin.promptAudit.saveBar.storePass')}
              value={draft.store_pass_events}
              testId="store-pass-toggle"
              onChange={(value) => replaceDraft({ ...draft, store_pass_events: value })}
            />
          </div>
          <div className={styles.buttonRow}>
            <span className={styles.saveState} data-dirty={dirty ? 'true' : undefined}>
              {dirty ? t('admin.promptAudit.saveBar.dirty') : t('admin.promptAudit.saveBar.synced')}
            </span>
            <Button type="button" variant="secondary" disabled={!dirty || loading.saving} onClick={resetDraft}>
              {t('common.reset')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!dirty || loading.saving}
              data-test="save-config"
              onClick={() => void saveConfig()}
            >
              {loading.saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        show={showBlockingConfirmation}
        title={t('admin.promptAudit.blockingConfirm.title')}
        message={t('admin.promptAudit.blockingConfirm.message')}
        confirmText={t('admin.promptAudit.blockingConfirm.confirm')}
        danger
        onConfirm={confirmBlocking}
        onCancel={() => setShowBlockingConfirmation(false)}
      />
      <ConfirmDialog
        show={deleteRequest.mode !== ''}
        title={t('admin.promptAudit.events.deleteConfirmTitle')}
        message={t('admin.promptAudit.events.deleteConfirmMessage', { count: deleteRequest.ids.length })}
        confirmText={t('common.delete')}
        danger
        onConfirm={() => void confirmIDDelete()}
        onCancel={clearDeleteRequest}
      />
      <FilterDeleteDialog
        show={showFilterDelete}
        initialFilters={filters}
        preview={deletePreview}
        previewing={loading.previewing}
        deleting={loading.deleting}
        onClose={closeFilterDelete}
        onPreview={(value) => void runFilterDeletePreview(value)}
        onConfirm={(value) => void confirmFilterDelete(value)}
        onCriteriaChange={clearDeletePreview}
      />
      <EventDetailDialog show={showEventDetail} event={activeEvent} loading={loading.detail} onClose={closeEventDetail} />
    </div>
  )
}
