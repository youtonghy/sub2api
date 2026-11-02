import { AlertTriangle, Ban, Box, FlaskConical, Play, RefreshCw, Settings, Trash2, Upload } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react'

import { adminAPI, type PluginInstallation, type PluginUISession } from '@/api/admin'
import TotpStepUpDialog from '@/components/auth/TotpStepUpDialog'
import { Alert } from '@/components/arc/alert/alert'
import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import BaseDialog from '@/components/common/BaseDialog'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { isStepUpBlocked, isStepUpCancelled, stepUpBlockReason, useStepUp } from '@/composables/useStepUp'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import styles from './PluginsView.module.css'

interface PluginBridgeMessage {
  source?: string
  bridge_token?: string
  type?: string
  request_id?: string
  config?: unknown
  height?: unknown
  level?: unknown
  message?: unknown
}

function currentRollout(plugin: PluginInstallation): number {
  return plugin.bindings.find((binding) => binding.capability === 'openai.oauth.outbound_transport.v1')?.rollout_percent || 100
}

function hasEnabledBinding(plugin: PluginInstallation): boolean {
  return plugin.bindings.some((binding) => binding.enabled)
}

function stateTone(state: PluginInstallation['state']): BadgeTone {
  if (state === 'enabled') return 'success'
  if (state === 'error' || state === 'incompatible') return 'danger'
  if (state === 'starting') return 'warning'
  return 'neutral'
}

function compatibilityTone(status: PluginInstallation['compatibility']['status']): BadgeTone {
  if (status === 'compatible') return 'success'
  if (status === 'untested') return 'warning'
  return 'danger'
}

export default function PluginsView() {
  const { t } = useI18n()
  const { confirm, confirmDialog } = useConfirmDialog()
  const pluginStepUp = useStepUp()
  const [plugins, setPlugins] = useState<PluginInstallation[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [busyID, setBusyID] = useState<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [rolloutValues, setRolloutValues] = useState<Record<number, number>>({})
  const rolloutRef = useRef<Record<number, number>>({})
  const [configPlugin, setConfigPluginState] = useState<PluginInstallation | null>(null)
  const configPluginRef = useRef<PluginInstallation | null>(null)
  const [uiSession, setUiSessionState] = useState<PluginUISession | null>(null)
  const uiSessionRef = useRef<PluginUISession | null>(null)
  const pluginFrame = useRef<HTMLIFrameElement>(null)
  const [uiLoading, setUiLoading] = useState(false)
  const [uiError, setUiError] = useState('')
  const [iframeHeight, setIframeHeight] = useState(640)
  const pluginFrameLoaded = useRef(false)
  const pendingBridgeRequests = useRef(new Map<string, number>())
  const uiSessionVersion = useRef(0)

  // 桥接处理函数在 window message 回调里读取最新会话，因此同时维护 ref
  const setConfigPlugin = (plugin: PluginInstallation | null) => {
    configPluginRef.current = plugin
    setConfigPluginState(plugin)
  }
  const setUiSession = (session: PluginUISession | null) => {
    uiSessionRef.current = session
    setUiSessionState(session)
  }

  function errorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message?: unknown }).message || t('common.unknownError'))
    }
    return t('common.unknownError')
  }

  function reportSensitiveActionError(error: unknown): void {
    if (isStepUpCancelled(error)) return
    if (isStepUpBlocked(error)) {
      useAppStore
        .getState()
        .showError(
          stepUpBlockReason(error) === 'STEP_UP_ADMIN_API_KEY_FORBIDDEN' ? t('stepUp.adminApiKeyForbidden') : t('stepUp.notEnabled')
        )
      return
    }
    useAppStore.getState().showError(errorMessage(error))
  }

  async function loadPlugins(): Promise<void> {
    setLoading(true)
    try {
      const list = await adminAPI.plugins.list()
      setPlugins(list)
      const next = { ...rolloutRef.current }
      for (const plugin of list) {
        next[plugin.id] = currentRollout(plugin)
      }
      rolloutRef.current = next
      setRolloutValues(next)
    } catch (error: unknown) {
      useAppStore.getState().showError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const target = event.target
    const file = target.files?.[0]
    target.value = ''
    if (!file || !file.name.toLowerCase().endsWith('.s2plugin')) {
      useAppStore.getState().showError(t('admin.plugins.fileRequired'))
      return
    }
    setUploading(true)
    try {
      await pluginStepUp.run(() => adminAPI.plugins.upload(file))
      useAppStore.getState().showSuccess(t('admin.plugins.uploadSuccess'))
      await loadPlugins()
    } catch (error: unknown) {
      reportSensitiveActionError(error)
    } finally {
      setUploading(false)
    }
  }

  function setRollout(id: number, raw: string): void {
    const value = Number(raw)
    const next = { ...rolloutRef.current, [id]: Math.min(100, Math.max(1, value)) }
    rolloutRef.current = next
    setRolloutValues(next)
  }

  async function enablePlugin(plugin: PluginInstallation): Promise<void> {
    let acceptUntested = false
    if (!plugin.compatibility.tested) {
      acceptUntested = await confirm(t('admin.plugins.confirmUntested'))
      if (!acceptUntested) return
    }
    setBusyID(plugin.id)
    try {
      await pluginStepUp.run(() => adminAPI.plugins.enable(plugin.id, rolloutRef.current[plugin.id] || 100, acceptUntested))
      useAppStore.getState().showSuccess(t('admin.plugins.enableSuccess'))
      await loadPlugins()
    } catch (error: unknown) {
      reportSensitiveActionError(error)
    } finally {
      setBusyID(null)
    }
  }

  async function disablePlugin(plugin: PluginInstallation): Promise<void> {
    if (!(await confirm(t('admin.plugins.confirmDisable')))) return
    setBusyID(plugin.id)
    try {
      await pluginStepUp.run(() => adminAPI.plugins.disable(plugin.id))
      useAppStore.getState().showSuccess(t('admin.plugins.disableSuccess'))
      await loadPlugins()
    } catch (error: unknown) {
      reportSensitiveActionError(error)
    } finally {
      setBusyID(null)
    }
  }

  async function uninstallPlugin(plugin: PluginInstallation): Promise<void> {
    if (!(await confirm(t('admin.plugins.confirmUninstall'), { danger: true }))) return
    setBusyID(plugin.id)
    try {
      await pluginStepUp.run(() => adminAPI.plugins.remove(plugin.id))
      useAppStore.getState().showSuccess(t('admin.plugins.uninstallSuccess'))
      await loadPlugins()
    } catch (error: unknown) {
      reportSensitiveActionError(error)
    } finally {
      setBusyID(null)
    }
  }

  async function testPlugin(plugin: PluginInstallation): Promise<void> {
    setBusyID(plugin.id)
    try {
      const result = await pluginStepUp.run(() => adminAPI.plugins.test(plugin.id))
      if (result.success) useAppStore.getState().showSuccess(result.message || t('admin.plugins.testSuccess'))
      else useAppStore.getState().showError(result.message || t('common.error'))
    } catch (error: unknown) {
      reportSensitiveActionError(error)
    } finally {
      setBusyID(null)
    }
  }

  function clearPendingBridgeRequests(): void {
    for (const timeout of pendingBridgeRequests.current.values()) window.clearTimeout(timeout)
    pendingBridgeRequests.current.clear()
  }

  async function openConfiguration(plugin: PluginInstallation): Promise<void> {
    const version = ++uiSessionVersion.current
    setConfigPlugin(plugin)
    setUiSession(null)
    pluginFrameLoaded.current = false
    clearPendingBridgeRequests()
    setUiLoading(true)
    setUiError('')
    setIframeHeight(640)
    try {
      const session = await adminAPI.plugins.createUISession(plugin.id)
      if (version !== uiSessionVersion.current) return
      setUiSession(session)
    } catch (error: unknown) {
      if (version !== uiSessionVersion.current) return
      setUiLoading(false)
      setUiError(errorMessage(error))
    }
  }

  function closeConfiguration(): void {
    uiSessionVersion.current++
    clearPendingBridgeRequests()
    pluginFrameLoaded.current = false
    setConfigPlugin(null)
    setUiSession(null)
    setUiLoading(false)
    setUiError('')
  }

  function handlePluginFrameLoad(): void {
    // A load can also be caused by a plugin navigating its iframe. Drop all
    // outstanding responses so a late config response is never sent to the new document.
    if (pluginFrameLoaded.current) clearPendingBridgeRequests()
    pluginFrameLoaded.current = true
    setUiLoading(false)
  }

  function registerBridgeRequest(requestID: string): void {
    const timeout = window.setTimeout(() => {
      pendingBridgeRequests.current.delete(requestID)
    }, 30_000)
    pendingBridgeRequests.current.set(requestID, timeout)
  }

  function postBridgeResult(request: PluginBridgeMessage, payload: Record<string, unknown>): void {
    const session = uiSessionRef.current
    if (!pluginFrame.current?.contentWindow || !session) return
    const requestID = typeof request.request_id === 'string' ? request.request_id.trim() : ''
    const timeout = pendingBridgeRequests.current.get(requestID)
    if (!requestID || timeout === undefined) return
    window.clearTimeout(timeout)
    pendingBridgeRequests.current.delete(requestID)
    pluginFrame.current.contentWindow.postMessage(
      {
        source: 'sub2api-plugin-host',
        bridge_token: session.bridge_token,
        type: `${request.type}.result`,
        request_id: requestID,
        ...payload
      },
      // The sandboxed iframe has an opaque origin, so no fixed target origin exists.
      // Pending request tracking plus load invalidation prevents cross-navigation leaks.
      '*'
    )
  }

  async function handleBridgeMessage(event: MessageEvent): Promise<void> {
    const session = uiSessionRef.current
    const plugin = configPluginRef.current
    if (!session || !plugin || event.source !== pluginFrame.current?.contentWindow || event.origin !== 'null') return
    const message = event.data as PluginBridgeMessage
    if (!message || message.source !== 'sub2api-plugin-ui' || message.bridge_token !== session.bridge_token) return

    const requestID = typeof message.request_id === 'string' ? message.request_id.trim() : ''
    const expectsResponse =
      message.type === 'config.load' ||
      message.type === 'config.save' ||
      message.type === 'config.test' ||
      message.type === 'plugin.status'
    if (expectsResponse) {
      if (!requestID || pendingBridgeRequests.current.has(requestID)) return
      registerBridgeRequest(requestID)
    }

    const appStore = useAppStore.getState()
    try {
      switch (message.type) {
        case 'sub2api.plugin.ready':
          setUiLoading(false)
          break
        case 'config.load': {
          const config = await adminAPI.plugins.getConfig(plugin.id)
          postBridgeResult(message, { ok: true, config })
          break
        }
        case 'config.save': {
          if (!message.config || typeof message.config !== 'object' || Array.isArray(message.config)) {
            throw new Error(t('admin.plugins.bridgeRejected'))
          }
          const config = await pluginStepUp.run(() =>
            adminAPI.plugins.saveConfig(plugin.id, message.config as Record<string, unknown>)
          )
          postBridgeResult(message, { ok: true, config })
          appStore.showSuccess(t('common.saved'))
          break
        }
        case 'config.test': {
          const result = await pluginStepUp.run(() => adminAPI.plugins.test(plugin.id))
          postBridgeResult(message, { ok: result.success, result })
          // A successful result is delivered back to the plugin UI, which owns how it
          // presents it (inline status, or an explicit ui.notify). Only force a host
          // toast on failure so genuine errors are never silently dropped — plugins
          // may call config.test for lightweight status polling, not just as an
          // explicit "test" action, and those must not spam a success toast.
          if (!result.success) appStore.showError(result.message || t('common.error'))
          break
        }
        case 'plugin.status': {
          // Read-only runtime status (the plugin's Health snapshot). It has no side
          // effects, so it is intentionally NOT step-up gated and never raises a host
          // toast — the plugin UI renders it however it likes. This is the generic
          // channel for any plugin to surface live state without abusing config.test.
          const result = await adminAPI.plugins.status(plugin.id)
          postBridgeResult(message, { ok: true, result })
          break
        }
        case 'ui.resize': {
          const height = Number(message.height)
          if (Number.isFinite(height)) setIframeHeight(Math.min(960, Math.max(520, Math.round(height))))
          break
        }
        case 'ui.notify': {
          const text = typeof message.message === 'string' ? message.message.slice(0, 500) : ''
          if (!text) break
          if (message.level === 'error') appStore.showError(text)
          else if (message.level === 'success') appStore.showSuccess(text)
          else appStore.showInfo(text)
          break
        }
      }
    } catch (error: unknown) {
      if (isStepUpBlocked(error)) reportSensitiveActionError(error)
      postBridgeResult(message, {
        ok: false,
        error: isStepUpCancelled(error) ? t('common.cancel') : errorMessage(error)
      })
    }
  }

  const handlersRef = useRef({ handleBridgeMessage, loadPlugins })
  useLayoutEffect(() => {
    handlersRef.current = { handleBridgeMessage, loadPlugins }
  })

  useEffect(() => {
    const onMessage = (event: MessageEvent) => void handlersRef.current.handleBridgeMessage(event)
    window.addEventListener('message', onMessage)
    void handlersRef.current.loadPlugins()
    const pending = pendingBridgeRequests.current
    const sessionVersion = uiSessionVersion
    return () => {
      window.removeEventListener('message', onMessage)
      // 卸载时与 Vue 版 closeConfiguration 一致：作废未完成的会话请求与桥接请求
      sessionVersion.current++
      for (const timeout of pending.values()) window.clearTimeout(timeout)
      pending.clear()
    }
  }, [])

  const configTitle = t('admin.plugins.configTitle', { name: configPlugin?.name || '' })

  const renderList = () => {
    if (loading) {
      return (
        <div className={styles.loading}>
          <Skeleton lines={4} label={t('common.loading')} />
        </div>
      )
    }
    if (plugins.length === 0) {
      return (
        <EmptyState
          icon={<Box size={24} strokeWidth={1.5} aria-hidden="true" />}
          title={t('admin.plugins.empty')}
          description={t('admin.plugins.emptyHint')}
        />
      )
    }
    return (
      <div className={styles.list}>
        {plugins.map((plugin) => {
          const enabled = hasEnabledBinding(plugin)
          const busy = busyID === plugin.id
          const rollout = rolloutValues[plugin.id] ?? currentRollout(plugin)
          return (
            <article key={plugin.id} className={styles.plugin}>
              <div className={styles.pluginHeader}>
                <div className={styles.pluginTitle}>
                  <div className={styles.nameRow}>
                    <h2 className={styles.name}>{plugin.name}</h2>
                    <span className={styles.version}>v{plugin.version}</span>
                    <Badge tone={stateTone(plugin.state)} size="sm">
                      {t(`admin.plugins.${plugin.state}`)}
                    </Badge>
                  </div>
                  <p className={styles.meta}>
                    {plugin.plugin_key}
                    {plugin.author ? <span> · {plugin.author}</span> : null}
                  </p>
                  {plugin.description ? <p className={styles.pluginDescription}>{plugin.description}</p> : null}
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={() => void openConfiguration(plugin)}>
                  <Settings size={16} strokeWidth={1.75} aria-hidden="true" />
                  {t('admin.plugins.configure')}
                </Button>
              </div>

              <div className={styles.pluginBody}>
                <div>
                  <p className={styles.sectionTitle}>{t('admin.plugins.compatibility')}</p>
                  <div className={styles.inline}>
                    <Badge tone={compatibilityTone(plugin.compatibility.status)} size="sm">
                      {t(`admin.plugins.${plugin.compatibility.status}`)}
                    </Badge>
                    <span className={styles.small}>{plugin.compatibility.message}</span>
                  </div>
                  <dl className={styles.versions}>
                    <dt>{t('admin.plugins.currentVersion')}</dt>
                    <dd>{plugin.compatibility.current_sub2api_version}</dd>
                    <dt>{t('admin.plugins.requiredVersion')}</dt>
                    <dd>{plugin.compatibility.required_sub2api_version}</dd>
                    <dt>{t('admin.plugins.recommendedVersion')}</dt>
                    <dd>{plugin.compatibility.recommended_sub2api_version || '-'}</dd>
                  </dl>
                </div>

                <div>
                  <p className={styles.sectionTitle}>{t('admin.plugins.runtime')}</p>
                  <div className={styles.inline}>
                    <Badge tone={plugin.runtime_healthy ? 'success' : 'neutral'} size="sm">
                      {plugin.runtime_healthy ? t('admin.plugins.healthy') : t('admin.plugins.unhealthy')}
                    </Badge>
                    <Badge tone="neutral" size="sm">
                      {`${t('admin.plugins.signature')}: ${t(`admin.plugins.${plugin.signature_status}`)}`}
                    </Badge>
                  </div>
                  {plugin.last_error ? (
                    <p className={styles.error}>{plugin.last_error}</p>
                  ) : plugin.runtime_message ? (
                    <p className={styles.runtimeMessage}>{plugin.runtime_message}</p>
                  ) : null}
                </div>

                <div className={styles.rollout}>
                  <label className={styles.rolloutLabel} htmlFor={`plugin-rollout-${plugin.id}`}>
                    <span>{t('admin.plugins.rollout')}</span>
                    <span className={styles.rolloutValue}>{rollout}%</span>
                  </label>
                  <input
                    id={`plugin-rollout-${plugin.id}`}
                    className={styles.range}
                    value={rollout}
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    disabled={enabled}
                    onChange={(event) => setRollout(plugin.id, event.target.value)}
                  />
                </div>
              </div>

              <div className={styles.pluginActions}>
                <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void testPlugin(plugin)}>
                  <FlaskConical size={16} strokeWidth={1.75} aria-hidden="true" />
                  {t('admin.plugins.test')}
                </Button>
                {enabled ? (
                  <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void disablePlugin(plugin)}>
                    <Ban size={16} strokeWidth={1.75} aria-hidden="true" />
                    {t('admin.plugins.disable')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={busy || plugin.state === 'starting' || !plugin.compatibility.compatible}
                    onClick={() => void enablePlugin(plugin)}
                  >
                    <Play size={16} strokeWidth={1.75} aria-hidden="true" />
                    {t('admin.plugins.enable')}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={busy || enabled}
                  onClick={() => void uninstallPlugin(plugin)}
                >
                  <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                  {t('admin.plugins.uninstall')}
                </Button>
              </div>
            </article>
          )
        })}
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <section className={styles.intro}>
        <div className={styles.introText}>
          <p className={styles.description}>{t('admin.plugins.description')}</p>
          <div className={styles.chips}>
            <Badge tone="neutral" size="sm">
              {t('admin.plugins.onlyOpenAI')}
            </Badge>
            <Badge tone="neutral" size="sm">
              {t('admin.plugins.noAccountCoupling')}
            </Badge>
          </div>
        </div>

        <div className={styles.introActions}>
          <input
            ref={fileInput}
            className={styles.hiddenInput}
            type="file"
            accept=".s2plugin,application/zip"
            onChange={(event) => void handleFileSelected(event)}
          />
          <Button type="button" variant="primary" disabled={uploading} onClick={() => fileInput.current?.click()}>
            <Upload size={16} strokeWidth={1.75} aria-hidden="true" />
            {uploading ? t('common.processing') : t('admin.plugins.upload')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={loading}
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            onClick={() => void loadPlugins()}
          >
            <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </div>
      </section>

      <p className={styles.hint}>{t('admin.plugins.uploadHint')}</p>

      <Alert tone="info" title={t('admin.plugins.runtimeNotice')}>
        {t('admin.plugins.menuNotice')}
      </Alert>

      {renderList()}

      <BaseDialog show={configPlugin !== null} title={configTitle} width="full" onClose={closeConfiguration}>
        <div className={styles.frameWrap} style={{ height: `${iframeHeight}px` }}>
          {uiLoading ? <div className={styles.frameOverlay}>{t('admin.plugins.loadingUI')}</div> : null}
          {uiError ? (
            <div className={styles.frameError}>
              <AlertTriangle size={32} strokeWidth={1.5} className={styles.warnIcon} aria-hidden="true" />
              <p className={styles.frameErrorTitle}>{t('admin.plugins.uiUnavailable')}</p>
              <p className={styles.frameErrorText}>{uiError}</p>
            </div>
          ) : null}
          {uiSession ? (
            <iframe
              ref={pluginFrame}
              src={uiSession.url}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              className={styles.frame}
              title={configTitle}
              onLoad={handlePluginFrameLoad}
            />
          ) : null}
        </div>
      </BaseDialog>

      <TotpStepUpDialog controller={pluginStepUp} />
      {confirmDialog}
    </div>
  )
}
