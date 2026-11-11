/**
 * 侧边栏品牌区的版本徽标。
 * RetooAi 是上游 Wei-Shaw/sub2api 的派生构建：程序版本号是打包时间（YYMMDDHHmm，如 2611111054），
 * 所基于的上游版本单独记录。管理员点击打开 Arc Popover，查看所基于的上游版本、上游最新 release，
 * 以及是否需要同步上游。上游 release 二进制会覆盖本地改动，因此不提供在线更新与回滚。
 * 普通用户只显示静态版本号；侧边栏收起时（collapsed）管理员显示紧凑图标按钮，普通用户不显示。
 */
import { useEffect, useState } from 'react'
import { ArrowUpCircle, Check, ExternalLink, GitCompareArrows, Loader2, RefreshCw, Tag } from 'lucide-react'

import { Alert } from '@/components/arc/alert/alert'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import styles from './VersionBadge.module.css'

const UPSTREAM_REPO = 'Wei-Shaw/sub2api'

export interface VersionBadgeProps {
  version?: string
  /** 侧边栏收起时为 true：管理员显示紧凑图标按钮，普通用户不显示 */
  collapsed?: boolean
}

/** 语义化版本加 v 前缀（0.2.21 → v0.2.21），打包时间等其他格式原样显示 */
function formatVersionLabel(version: string): string {
  if (!version) return ''
  return /^\d+\.\d+/.test(version) ? `v${version}` : version
}

/** 把打包时间版本号 YYMMDDHHmm 解析为 "2026-11-11 10:54"；不是该格式时返回空串 */
function formatBuildTime(version: string): string {
  const match = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(version)
  if (!match) return ''
  const [, yy, mm, dd, hh, min] = match
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31 || Number(hh) > 23 || Number(min) > 59) {
    return ''
  }
  return `20${yy}-${mm}-${dd} ${hh}:${min}`
}

function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 className={styles.spin} size={size} strokeWidth={1.75} aria-hidden="true" />
}

export default function VersionBadge({ version, collapsed = false }: VersionBadgeProps) {
  const { t } = useI18n()
  const isAdmin = useAuthStore((state) => state.isAdmin)

  const [open, setOpen] = useState(false)

  // Use store's cached version state
  const loading = useAppStore((state) => state.versionLoading)
  const storeVersion = useAppStore((state) => state.currentVersion)
  const upstreamVersion = useAppStore((state) => state.upstreamVersion)
  const latestVersion = useAppStore((state) => state.latestVersion)
  const versionWarning = useAppStore((state) => state.versionWarning)
  const hasUpdate = useAppStore((state) => state.hasUpdate)
  const releaseInfo = useAppStore((state) => state.releaseInfo)
  const currentVersion = storeVersion || version || ''
  const currentLabel = formatVersionLabel(currentVersion)
  const buildTime = formatBuildTime(currentVersion)

  const releaseUrl = releaseInfo?.html_url && releaseInfo.html_url !== '#' ? releaseInfo.html_url : ''
  const compareUrl =
    hasUpdate && upstreamVersion && latestVersion
      ? `https://github.com/${UPSTREAM_REPO}/compare/v${upstreamVersion}...v${latestVersion}`
      : ''
  // 后端检查上游失败且没有缓存时，latest 会退回成当前基线，不能据此判断“已是最新”
  const checkFailed = Boolean(versionWarning) && !releaseInfo

  useEffect(() => {
    if (isAdmin) {
      // Use cached version if available, otherwise fetch
      void useAppStore.getState().fetchVersion(false)
    }
  }, [isAdmin])

  // Non-admin: Simple static version text（收起时不显示）
  if (!isAdmin) {
    if (collapsed || !version) return null
    return <span className={styles.static}>{formatVersionLabel(version)}</span>
  }

  const triggerTitle = hasUpdate
    ? t('shell.forkVersion.behind', { version: `v${latestVersion}` })
    : t('shell.forkVersion.upToDate')

  function renderStatus() {
    if (checkFailed) {
      return <Alert tone="danger" title={t('shell.forkVersion.checkFailed')}>{versionWarning}</Alert>
    }
    if (hasUpdate) {
      return (
        <Alert tone="warning" title={t('shell.forkVersion.behind', { version: `v${latestVersion}` })}>
          {t('shell.forkVersion.syncHint')}
        </Alert>
      )
    }
    return <Alert tone="success" title={t('shell.forkVersion.upToDate')} />
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={collapsed ? styles.compactTrigger : styles.trigger}
        data-update={hasUpdate || undefined}
        title={triggerTitle}
        aria-label={collapsed ? `${currentLabel ? `${currentLabel}, ` : ''}${triggerTitle}` : undefined}
      >
        {collapsed ? (
          hasUpdate
            ? <ArrowUpCircle size={16} strokeWidth={1.75} aria-hidden="true" />
            : <Tag size={16} strokeWidth={1.75} aria-hidden="true" />
        ) : currentLabel ? (
          <span className={styles.versionText}>{currentLabel}</span>
        ) : (
          <span className={styles.placeholder} aria-hidden="true" />
        )}
        {/* Upstream update indicator */}
        {hasUpdate && <span className={styles.updateDot} aria-hidden="true" />}
      </PopoverTrigger>

      <PopoverContent side={collapsed ? 'right' : 'bottom'} className={styles.panel} aria-label={t('version.currentVersion')}>
        {/* Header with refresh button */}
        <div className={styles.header}>
          <span className={styles.headerTitle}>{t('version.currentVersion')}</span>
          <button
            type="button"
            className={styles.iconButton}
            disabled={loading}
            title={t('version.refresh')}
            aria-label={t('version.refresh')}
            onClick={() => void useAppStore.getState().fetchVersion(true)}
          >
            {loading ? <Spinner size={14} /> : <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />}
          </button>
        </div>

        {loading ? (
          <div className={styles.center}><Spinner size={24} /></div>
        ) : (
          <>
            {/* Program version (build time) */}
            <div className={styles.summary}>
              <div className={styles.inline}>
                <span className={currentLabel ? styles.bigVersion : styles.bigVersionEmpty}>{currentLabel || '--'}</span>
                {!hasUpdate && !checkFailed && (
                  <span className={styles.check} aria-hidden="true">
                    <Check size={12} strokeWidth={2} />
                  </span>
                )}
              </div>
              {buildTime && <p className={styles.summaryText}>{t('shell.forkVersion.builtAt', { time: buildTime })}</p>}
            </div>

            {/* Upstream base vs latest upstream release */}
            <dl className={styles.facts}>
              <div className={styles.fact}>
                <dt>{t('shell.forkVersion.upstreamBase')}</dt>
                <dd>{upstreamVersion ? `v${upstreamVersion}` : '--'}</dd>
              </div>
              <div className={styles.fact}>
                <dt>{t('shell.forkVersion.upstreamLatest')}</dt>
                <dd data-update={hasUpdate || undefined}>{latestVersion && !checkFailed ? `v${latestVersion}` : '--'}</dd>
              </div>
            </dl>

            <div className={styles.stack}>
              {renderStatus()}
              {(releaseUrl || compareUrl) && (
                <div className={styles.links}>
                  {releaseUrl && (
                    <a href={releaseUrl} target="_blank" rel="noopener noreferrer" className={styles.subtleLink}>
                      {t('shell.forkVersion.viewChangelog')}
                      <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
                    </a>
                  )}
                  {compareUrl && (
                    <a href={compareUrl} target="_blank" rel="noopener noreferrer" className={styles.subtleLink}>
                      <GitCompareArrows size={12} strokeWidth={1.75} aria-hidden="true" />
                      {t('shell.forkVersion.viewDiff')}
                    </a>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
