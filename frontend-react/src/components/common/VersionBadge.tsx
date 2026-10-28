/**
 * 侧边栏品牌区的版本徽标。
 * 管理员：点击打开 Arc Popover，可检查更新、在线更新（release 构建）、重启服务与版本回滚；
 * 普通用户：只显示静态版本号。侧边栏收起时（collapsed）管理员显示紧凑图标按钮，普通用户不显示。
 */
import { useEffect, useState } from 'react'
import {
  ArrowUpCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Tag,
  TriangleAlert,
} from 'lucide-react'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import {
  getRollbackVersions,
  performUpdate,
  restartService,
  rollback as rollbackAPI,
  type RollbackVersionInfo,
} from '@/api/admin/system'
import { useClipboard } from '@/composables/useClipboard'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import styles from './VersionBadge.module.css'

const GITHUB_REPO = 'Wei-Shaw/sub2api'
// Docker Hub image published by CI (tags carry no "v" prefix, e.g. weishaw/sub2api:0.1.146)
const DOCKER_IMAGE = 'weishaw/sub2api'

type ManualTab = 'script' | 'docker'

export interface VersionBadgeProps {
  version?: string
  /** 侧边栏收起时为 true：管理员显示紧凑图标按钮，普通用户不显示 */
  collapsed?: boolean
}

function apiErrorMessage(error: unknown, fallback: string): string {
  const err = error as { response?: { data?: { message?: string } }; message?: string }
  return err.response?.data?.message || err.message || fallback
}

function formatPublishedAt(publishedAt: string): string {
  if (!publishedAt) return ''
  const date = new Date(publishedAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString()
}

async function checkServiceAndReload() {
  const maxRetries = 5
  const retryDelay = 1000

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch('/health', {
        method: 'GET',
        cache: 'no-cache'
      })
      if (response.ok) {
        // Service is back, reload page
        window.location.reload()
        return
      }
    } catch {
      // Service not ready yet
    }

    if (i < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay))
    }
  }

  // After retries, reload anyway
  window.location.reload()
}

function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 className={styles.spin} size={size} strokeWidth={1.75} aria-hidden="true" />
}

function GithubIcon() {
  return (
    <svg width={16} height={16} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"
      />
    </svg>
  )
}

export default function VersionBadge({ version, collapsed = false }: VersionBadgeProps) {
  const { t } = useI18n()
  const isAdmin = useAuthStore((state) => state.isAdmin)

  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Use store's cached version state
  const loading = useAppStore((state) => state.versionLoading)
  const storeVersion = useAppStore((state) => state.currentVersion)
  const latestVersion = useAppStore((state) => state.latestVersion)
  const hasUpdate = useAppStore((state) => state.hasUpdate)
  const releaseInfo = useAppStore((state) => state.releaseInfo)
  const buildType = useAppStore((state) => state.buildType)
  const currentVersion = storeVersion || version || ''

  // Update process states (local to this component)
  const [updating, setUpdating] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [needRestart, setNeedRestart] = useState(false)
  const [updateError, setUpdateError] = useState('')
  const [updateSuccess, setUpdateSuccess] = useState(false)
  const [restartCountdown, setRestartCountdown] = useState(0)
  // Distinguishes the success + restart panel between update and rollback flows
  const [successKind, setSuccessKind] = useState<'update' | 'rollback'>('update')

  // Rollback states
  const [rollbackPanelOpen, setRollbackPanelOpen] = useState(false)
  const [rollbackVersions, setRollbackVersions] = useState<RollbackVersionInfo[]>([])
  const [rollbackVersionsLoading, setRollbackVersionsLoading] = useState(false)
  const [rollbackVersionsError, setRollbackVersionsError] = useState('')
  const [selectedRollbackVersion, setSelectedRollbackVersion] = useState('')
  const [rollingBack, setRollingBack] = useState(false)
  const [rollbackError, setRollbackError] = useState('')

  const { copied, copyToClipboard } = useClipboard()

  // Manual rollback methods differ by deployment: script installs use install.sh,
  // docker deployments pin the image tag instead
  const [manualTab, setManualTab] = useState<ManualTab>('script')

  const manualTabs = [
    { value: 'script', label: t('version.deployScript') },
    { value: 'docker', label: t('version.deployDocker') }
  ]

  const scriptRollbackCommand = selectedRollbackVersion
    ? `curl -sSL https://raw.githubusercontent.com/${GITHUB_REPO}/v${selectedRollbackVersion}/deploy/install.sh | sudo bash -s -- rollback v${selectedRollbackVersion}`
    : ''

  const dockerRollbackCommand = selectedRollbackVersion
    ? [
        `# ${t('version.dockerEditCompose')}`,
        `image: ${DOCKER_IMAGE}:${selectedRollbackVersion}`,
        '',
        `# ${t('version.dockerRecreate')}`,
        'docker compose up -d'
      ].join('\n')
    : ''

  const activeManualCommand = manualTab === 'docker' ? dockerRollbackCommand : scriptRollbackCommand

  // Only show update check for release builds (binary/docker deployment)
  const isReleaseBuild = buildType === 'release'
  const releaseUrl = releaseInfo?.html_url && releaseInfo.html_url !== '#' ? releaseInfo.html_url : ''

  useEffect(() => {
    if (isAdmin) {
      // Use cached version if available, otherwise fetch
      void useAppStore.getState().fetchVersion(false)
    }
  }, [isAdmin])

  function resetRollbackState() {
    setRollbackPanelOpen(false)
    setRollbackVersions([])
    setRollbackVersionsError('')
    setSelectedRollbackVersion('')
    setRollbackError('')
    setManualTab('script')
  }

  async function refreshVersion(force = true) {
    if (!isAdmin) return

    // Reset update states when refreshing
    setUpdateError('')
    setUpdateSuccess(false)
    setNeedRestart(false)
    resetRollbackState()

    await useAppStore.getState().fetchVersion(force)
  }

  async function handleUpdate() {
    if (updating) return

    setUpdating(true)
    setUpdateError('')
    setUpdateSuccess(false)

    try {
      const result = await performUpdate()
      setSuccessKind('update')
      setUpdateSuccess(true)
      setNeedRestart(result.need_restart)
      // Clear version cache to reflect update completed
      useAppStore.getState().clearVersionCache()
    } catch (error: unknown) {
      setUpdateError(apiErrorMessage(error, t('version.updateFailed')))
    } finally {
      setUpdating(false)
    }
  }

  async function loadRollbackVersions() {
    if (!isAdmin) return
    setRollbackVersionsLoading(true)
    setRollbackVersionsError('')
    try {
      const data = await getRollbackVersions()
      setRollbackVersions(data.versions || [])
    } catch (error: unknown) {
      setRollbackVersionsError(apiErrorMessage(error, t('version.loadVersionsFailed')))
    } finally {
      setRollbackVersionsLoading(false)
    }
  }

  async function toggleRollbackPanel() {
    if (!isAdmin) return
    const nextOpen = !rollbackPanelOpen
    setRollbackPanelOpen(nextOpen)
    // Source builds only show a hint, no version list to fetch
    if (nextOpen && isReleaseBuild && rollbackVersions.length === 0 && !rollbackVersionsLoading) {
      await loadRollbackVersions()
    }
  }

  function selectRollbackVersion(nextVersion: string) {
    if (rollingBack) return
    setRollbackError('')
    setSelectedRollbackVersion((current) => (current === nextVersion ? '' : nextVersion))
  }

  async function handleRollback() {
    if (!isAdmin) return
    if (rollingBack || !selectedRollbackVersion) return

    setRollingBack(true)
    setRollbackError('')

    try {
      const result = await rollbackAPI(selectedRollbackVersion)
      setSuccessKind('rollback')
      setUpdateSuccess(true)
      setNeedRestart(result.need_restart)
      setRollbackPanelOpen(false)
      // Clear version cache so the next check reflects the rolled-back version
      useAppStore.getState().clearVersionCache()
    } catch (error: unknown) {
      setRollbackError(apiErrorMessage(error, t('version.rollbackFailed')))
    } finally {
      setRollingBack(false)
    }
  }

  async function handleRestart() {
    if (restarting) return

    setRestarting(true)
    let countdown = 8
    setRestartCountdown(countdown)

    try {
      await restartService()
      // Service will restart, page will reload automatically or show disconnected
    } catch {
      // Expected - connection will be lost during restart
      console.log('Service restarting...')
    }

    // Start countdown
    const countdownInterval = setInterval(() => {
      countdown--
      setRestartCountdown(countdown)
      if (countdown <= 0) {
        clearInterval(countdownInterval)
        // Try to check if service is back before reload
        void checkServiceAndReload()
      }
    }, 1000)
  }

  // Non-admin: Simple static version text（收起时不显示）
  if (!isAdmin) {
    if (collapsed || !version) return null
    return <span className={styles.static}>v{version}</span>
  }

  const triggerTitle = hasUpdate ? t('version.updateAvailable') : t('version.upToDate')

  function renderStatus() {
    // Priority 1: Update error (must check before hasUpdate)
    if (updateError) {
      return (
        <div className={styles.stack}>
          <Alert tone="danger" title={t('version.updateFailed')}>{updateError}</Alert>
          {/* Retry button */}
          <Button variant="danger" size="sm" className={styles.block} loading={updating} onClick={() => void handleUpdate()}>
            {t('version.retry')}
          </Button>
        </div>
      )
    }

    // Priority 2: Update success - need restart
    if (updateSuccess && needRestart) {
      return (
        <div className={styles.stack}>
          <Alert
            tone="success"
            title={successKind === 'rollback' ? t('version.rollbackComplete') : t('version.updateComplete')}
          >
            {t('version.restartRequired')}
          </Alert>
          {/* Restart button with countdown */}
          <Button size="sm" className={styles.block} disabled={restarting} onClick={() => void handleRestart()}>
            <span className={styles.buttonLabel}>
              {restarting ? <Spinner /> : <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />}
              {restarting ? t('version.restarting') : t('version.restartNow')}
              {restarting && restartCountdown > 0 && <span className={styles.tabular}>({restartCountdown}s)</span>}
            </span>
          </Button>
        </div>
      )
    }

    // Priority 3: Update available for source build - show git pull hint
    if (hasUpdate && !isReleaseBuild) {
      return (
        <div className={styles.stack}>
          {releaseUrl && (
            <a href={releaseUrl} target="_blank" rel="noopener noreferrer" className={styles.updateCard}>
              <Download size={16} strokeWidth={1.75} aria-hidden="true" />
              <span className={styles.updateText}>
                <span>{t('version.updateAvailable')}</span>
                <span className={styles.muted}>v{latestVersion}</span>
              </span>
              <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
            </a>
          )}
          {/* Source build hint */}
          <Alert tone="info" title={t('version.sourceModeHint')} />
        </div>
      )
    }

    // Priority 4: Update available for release build - show update button
    if (hasUpdate && isReleaseBuild) {
      return (
        <div className={styles.stack}>
          <Alert tone="warning" title={t('version.updateAvailable')}>{`v${latestVersion}`}</Alert>
          <Button size="sm" className={styles.block} loading={updating} onClick={() => void handleUpdate()}>
            <span className={styles.buttonLabel}>
              <Download size={16} strokeWidth={1.75} aria-hidden="true" />
              {updating ? t('version.updating') : t('version.updateNow')}
            </span>
          </Button>
          {/* View release link */}
          {releaseUrl && (
            <a href={releaseUrl} target="_blank" rel="noopener noreferrer" className={styles.subtleLink}>
              {t('version.viewChangelog')}
              <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
            </a>
          )}
        </div>
      )
    }

    // Priority 5: Up to date - GitHub link + version rollback
    return (
      <div className={styles.stack}>
        {releaseUrl && (
          <a href={releaseUrl} target="_blank" rel="noopener noreferrer" className={styles.subtleLink}>
            <GithubIcon />
            {t('version.viewRelease')}
          </a>
        )}

        {/* Version rollback entry */}
        <div className={styles.rollback}>
          <button
            type="button"
            className={styles.rollbackToggle}
            aria-expanded={rollbackPanelOpen}
            onClick={() => void toggleRollbackPanel()}
          >
            <span className={styles.inline}>
              <Clock size={14} strokeWidth={1.75} aria-hidden="true" />
              {t('version.rollback')}
            </span>
            <ChevronDown
              size={14}
              strokeWidth={1.75}
              aria-hidden="true"
              className={styles.chevron}
              data-open={rollbackPanelOpen || undefined}
            />
          </button>

          {rollbackPanelOpen && <div className={styles.stack}>{renderRollbackPanel()}</div>}
        </div>
      </div>
    )
  }

  function renderRollbackPanel() {
    // Source build: online rollback unavailable, use git instead
    if (!isReleaseBuild) {
      return <Alert tone="info" title={t('version.rollbackSourceHint')} />
    }

    // Loading versions
    if (rollbackVersionsLoading) {
      return <div className={styles.center}><Spinner size={20} /></div>
    }

    // Load error + retry
    if (rollbackVersionsError) {
      return (
        <>
          <Alert tone="danger" title={rollbackVersionsError} />
          <Button variant="secondary" size="sm" className={styles.block} onClick={() => void loadRollbackVersions()}>
            {t('version.retry')}
          </Button>
        </>
      )
    }

    // No versions available
    if (rollbackVersions.length === 0) {
      return <p className={styles.emptyText}>{t('version.noRollbackVersions')}</p>
    }

    // Version list
    return (
      <>
        <p className={styles.caption}>{t('version.rollbackSelectVersion')}</p>

        <div className={styles.versionList}>
          {rollbackVersions.map((item) => (
            <button
              key={item.version}
              type="button"
              className={styles.versionOption}
              aria-pressed={selectedRollbackVersion === item.version}
              disabled={rollingBack}
              onClick={() => selectRollbackVersion(item.version)}
            >
              <span className={styles.inline}>
                <span className={styles.radio} aria-hidden="true" />
                <span className={styles.versionName}>v{item.version}</span>
              </span>
              <span className={styles.published}>{formatPublishedAt(item.published_at)}</span>
            </button>
          ))}
        </div>

        {/* Selected version: manual command (per deploy method) + confirm */}
        {selectedRollbackVersion && (
          <div className={styles.stack}>
            <p className={styles.caption}>{t('version.manualRollbackCommand')}</p>

            <div className={styles.terminal}>
              <div className={styles.terminalBar}>
                <SegmentedControl
                  options={manualTabs}
                  value={manualTab}
                  onValueChange={(value) => setManualTab(value as ManualTab)}
                  label={t('version.manualRollbackCommand')}
                />
                <button
                  type="button"
                  className={styles.copyButton}
                  data-copied={copied || undefined}
                  onClick={() => void copyToClipboard(activeManualCommand)}
                >
                  {copied
                    ? <Check size={12} strokeWidth={1.75} aria-hidden="true" />
                    : <Copy size={12} strokeWidth={1.75} aria-hidden="true" />}
                  {copied ? t('version.copied') : t('version.copyCommand')}
                </button>
              </div>
              <code className={styles.command}>{activeManualCommand}</code>
            </div>

            <p className={styles.warning}>
              <TriangleAlert size={12} strokeWidth={1.75} aria-hidden="true" />
              {t('version.rollbackWarning')}
            </p>

            {rollbackError && <Alert tone="danger" title={rollbackError} />}

            <Button size="sm" className={styles.block} loading={rollingBack} onClick={() => void handleRollback()}>
              <span className={styles.buttonLabel}>
                <Clock size={16} strokeWidth={1.75} aria-hidden="true" />
                {rollingBack
                  ? t('version.rollingBack')
                  : t('version.rollbackConfirm', { version: 'v' + selectedRollbackVersion })}
              </span>
            </Button>
          </div>
        )}
      </>
    )
  }

  return (
    <Popover open={dropdownOpen} onOpenChange={setDropdownOpen}>
      {/* Admin: Full version badge with dropdown */}
      <PopoverTrigger
        className={collapsed ? styles.compactTrigger : styles.trigger}
        data-update={hasUpdate || undefined}
        title={triggerTitle}
        aria-label={collapsed ? `${currentVersion ? `v${currentVersion}, ` : ''}${triggerTitle}` : undefined}
      >
        {collapsed ? (
          hasUpdate
            ? <ArrowUpCircle size={16} strokeWidth={1.75} aria-hidden="true" />
            : <Tag size={16} strokeWidth={1.75} aria-hidden="true" />
        ) : currentVersion ? (
          <span className={styles.versionText}>v{currentVersion}</span>
        ) : (
          <span className={styles.placeholder} aria-hidden="true" />
        )}
        {/* Update indicator */}
        {hasUpdate && <span className={styles.updateDot} aria-hidden="true" />}
      </PopoverTrigger>

      <PopoverContent
        side={collapsed ? 'right' : 'bottom'}
        className={rollbackPanelOpen && isReleaseBuild ? styles.panelWide : styles.panel}
        aria-label={t('version.currentVersion')}
      >
        {/* Header with refresh button */}
        <div className={styles.header}>
          <span className={styles.headerTitle}>{t('version.currentVersion')}</span>
          <button
            type="button"
            className={styles.iconButton}
            disabled={loading}
            title={t('version.refresh')}
            aria-label={t('version.refresh')}
            onClick={() => void refreshVersion(true)}
          >
            {loading ? <Spinner size={14} /> : <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />}
          </button>
        </div>

        {loading ? (
          // Loading state
          <div className={styles.center}><Spinner size={24} /></div>
        ) : (
          <>
            {/* Version display - centered and prominent */}
            <div className={styles.summary}>
              <div className={styles.inline}>
                <span className={currentVersion ? styles.bigVersion : styles.bigVersionEmpty}>
                  {currentVersion ? `v${currentVersion}` : '--'}
                </span>
                {/* Show check mark when up to date */}
                {!hasUpdate && (
                  <span className={styles.check} aria-hidden="true">
                    <Check size={12} strokeWidth={2} />
                  </span>
                )}
              </div>
              <p className={styles.summaryText}>
                {hasUpdate ? t('version.latestVersion') + ': v' + latestVersion : t('version.upToDate')}
              </p>
            </div>

            {renderStatus()}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
