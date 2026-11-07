/**
 * 「使用密钥」弹窗，对应 Vue 版 UseKeyModal.vue：按分组平台给出各客户端（Claude Code / Codex / Gemini CLI /
 * Grok / OpenCode 等）的配置片段。片段生成逻辑在 useKeyConfigFiles.ts，与 Vue 版逐字节一致。
 */
import { saveAs } from 'file-saver'
import { Check, Clipboard, Download, RefreshCw, Terminal, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { buildCodexModelCatalogUrl, fetchCodexModelsManifest } from '@/api/codex'
import BaseDialog from '@/components/common/BaseDialog'
import { useClipboard } from '@/composables/useClipboard'
import { useI18n } from '@/i18n/useI18n'
import type { GroupPlatform } from '@/types'
import {
  buildUseKeyConfigFiles,
  joinConfigPath,
  type CodexAuthMode,
  type CodexModelCatalogMode
} from './useKeyConfigFiles'
import styles from './UseKeyModal.module.css'

export interface UseKeyModalProps {
  show: boolean
  apiKey: string
  baseUrl: string
  platform: GroupPlatform | null
  claudeCodeOnly?: boolean
  allowMessagesDispatch?: boolean
  onClose?: () => void
}

interface TabConfig {
  id: string
  label: string
  icon: ReactNode
}

type CodexModelManifestState = 'idle' | 'loading' | 'ready' | 'error'

const AppleIcon = (
  <svg fill="currentColor" viewBox="0 0 24 24" className={styles.tabIcon} aria-hidden="true">
    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
  </svg>
)

const WindowsIcon = (
  <svg fill="currentColor" viewBox="0 0 24 24" className={styles.tabIcon} aria-hidden="true">
    <path d="M3 12V6.75l6-1.32v6.48L3 12zm17-9v8.75l-10 .15V5.21L20 3zM3 13l6 .09v6.81l-6-1.15V13zm7 .25l10 .15V21l-10-1.91v-5.84z" />
  </svg>
)

// Terminal icon for Claude Code
const TerminalIcon = <Terminal className={styles.tabIcon} aria-hidden="true" />
// Sparkle icon for Gemini
const SparkleIcon = <Sparkles className={styles.tabIcon} aria-hidden="true" />

// Reset tabs when platform changes
function defaultClientTabFor(platform: GroupPlatform | null, claudeCodeOnly?: boolean): string {
  if (claudeCodeOnly) return 'claude'
  switch (platform) {
    case 'openai':
      return 'codex'
    case 'grok':
      return 'grok'
    case 'gemini':
      return 'gemini'
    case 'antigravity':
      return 'claude'
    case 'typesafe':
      return 'systemone'
    default:
      return 'claude'
  }
}

export default function UseKeyModal({
  show,
  apiKey,
  baseUrl,
  platform,
  claudeCodeOnly,
  allowMessagesDispatch,
  onClose
}: UseKeyModalProps) {
  const { t } = useI18n()
  const { copyToClipboard: clipboardCopy } = useClipboard()

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<string>('unix')
  const [activeClientTab, setActiveClientTab] = useState<string>(() => defaultClientTabFor(platform, claudeCodeOnly))
  const [codexAuthMode, setCodexAuthMode] = useState<CodexAuthMode>('api-key')
  const [codexModelManifestState, setCodexModelManifestState] = useState<CodexModelManifestState>('idle')
  const [codexModelManifestContent, setCodexModelManifestContent] = useState('')
  const [codexModelManifestModelCount, setCodexModelManifestModelCount] = useState(0)
  const [codexModelCatalogMode, setCodexModelCatalogMode] = useState<CodexModelCatalogMode>('remote')
  const [codexModelManifestResponseBytes, setCodexModelManifestResponseBytes] = useState(0)
  const codexModelManifestController = useRef<AbortController | null>(null)
  const codexModelManifestRequestID = useRef(0)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 对应 Vue 版 watch([platform, claudeCodeOnly], { immediate: true })：在渲染期间同步重置标签与认证模式
  const platformKey = `${platform}|${claudeCodeOnly ? 1 : 0}`
  const [prevPlatformKey, setPrevPlatformKey] = useState(platformKey)
  if (prevPlatformKey !== platformKey) {
    setPrevPlatformKey(platformKey)
    setActiveTab('unix')
    setActiveClientTab(defaultClientTabFor(platform, claudeCodeOnly))
    setCodexAuthMode('api-key')
  }

  const codexModelCatalogOversized = codexModelManifestResponseBytes > 1024 * 1024
  const codexModelCatalogUrl = buildCodexModelCatalogUrl(baseUrl)

  const showCodexModelCatalog = show &&
    (activeClientTab === 'codex' ||
      (platform === 'openai' && activeClientTab === 'codex-ws'))

  const codexModelCatalogPath = (() => {
    const isWindows = activeTab === 'windows'
    const configDir = isWindows ? '%userprofile%\\.codex' : '~/.codex'
    return joinConfigPath(configDir, 'codex-models.json', isWindows)
  })()

  const codexManifestContext = showCodexModelCatalog ? `${platform}|${baseUrl}|${apiKey}` : ''

  const resetCodexModelManifest = () => {
    codexModelManifestController.current?.abort()
    codexModelManifestController.current = null
    codexModelManifestRequestID.current += 1
    setCodexModelManifestState('idle')
    setCodexModelManifestContent('')
    setCodexModelManifestModelCount(0)
    setCodexModelManifestResponseBytes(0)
  }

  // 对应 Vue 版 watch(show)：打开时恢复默认认证模式，关闭时清空模型清单
  const previousShow = useRef(show)
  useEffect(() => {
    if (previousShow.current === show) return
    previousShow.current = show
    if (show) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 对应 Vue 版 watch(show)：打开时重置
      setCodexAuthMode('api-key')
    } else {
      resetCodexModelManifest()
    }
  }, [show])

  // 对应 Vue 版 watch(codexManifestContext)：平台、地址或密钥变化时作废已加载的清单
  const previousManifestContext = useRef(codexManifestContext)
  useEffect(() => {
    if (previousManifestContext.current === codexManifestContext) return
    previousManifestContext.current = codexManifestContext
    resetCodexModelManifest()
  }, [codexManifestContext])

  useEffect(() => () => {
    codexModelManifestController.current?.abort()
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
  }, [])

  // Reset shell tab when client changes
  const selectClientTab = (id: string) => {
    if (id !== activeClientTab) setActiveTab('unix')
    setActiveClientTab(id)
  }

  const clientTabs = useMemo((): TabConfig[] => {
    if (!platform) return []
    if (claudeCodeOnly) {
      return [{ id: 'claude', label: t('keys.useKeyModal.cliTabs.claudeCode'), icon: TerminalIcon }]
    }
    switch (platform) {
      case 'openai': {
        const tabs: TabConfig[] = [
          { id: 'codex', label: t('keys.useKeyModal.cliTabs.codexCli'), icon: TerminalIcon },
          { id: 'codex-ws', label: t('keys.useKeyModal.cliTabs.codexCliWs'), icon: TerminalIcon },
        ]
        if (allowMessagesDispatch) {
          tabs.push({ id: 'claude', label: t('keys.useKeyModal.cliTabs.claudeCode'), icon: TerminalIcon })
        }
        tabs.push({ id: 'opencode', label: t('keys.useKeyModal.cliTabs.opencode'), icon: TerminalIcon })
        return tabs
      }
      case 'gemini':
        return [
          { id: 'gemini', label: t('keys.useKeyModal.cliTabs.geminiCli'), icon: SparkleIcon },
          { id: 'codex', label: t('keys.useKeyModal.cliTabs.codexCli'), icon: TerminalIcon },
          { id: 'opencode', label: t('keys.useKeyModal.cliTabs.opencode'), icon: TerminalIcon }
        ]
      case 'antigravity':
        return [
          { id: 'claude', label: t('keys.useKeyModal.cliTabs.claudeCode'), icon: TerminalIcon },
          { id: 'gemini', label: t('keys.useKeyModal.cliTabs.geminiCli'), icon: SparkleIcon },
          { id: 'codex', label: t('keys.useKeyModal.cliTabs.codexCli'), icon: TerminalIcon },
          { id: 'opencode', label: t('keys.useKeyModal.cliTabs.opencode'), icon: TerminalIcon }
        ]
      case 'grok':
        return [
          { id: 'grok', label: t('keys.useKeyModal.cliTabs.grokCli'), icon: TerminalIcon },
          { id: 'claude', label: t('keys.useKeyModal.cliTabs.claudeCode'), icon: TerminalIcon },
          { id: 'codex', label: t('keys.useKeyModal.cliTabs.codexCli'), icon: TerminalIcon },
          { id: 'opencode', label: t('keys.useKeyModal.cliTabs.opencode'), icon: TerminalIcon }
        ]
      case 'typesafe':
        return [
          { id: 'systemone', label: t('keys.useKeyModal.cliTabs.systemOne'), icon: TerminalIcon }
        ]
      case 'deepseek':
      case 'minimax':
      case 'composite':
        return [
          { id: 'claude', label: t('keys.useKeyModal.cliTabs.claudeCode'), icon: TerminalIcon },
          { id: 'codex', label: t('keys.useKeyModal.cliTabs.codexCli'), icon: TerminalIcon },
          { id: 'opencode', label: t('keys.useKeyModal.cliTabs.opencode'), icon: TerminalIcon }
        ]
      default:
        return [
          { id: 'claude', label: t('keys.useKeyModal.cliTabs.claudeCode'), icon: TerminalIcon },
          { id: 'codex', label: t('keys.useKeyModal.cliTabs.codexCli'), icon: TerminalIcon },
          { id: 'opencode', label: t('keys.useKeyModal.cliTabs.opencode'), icon: TerminalIcon }
        ]
    }
  }, [platform, claudeCodeOnly, allowMessagesDispatch, t])

  // Shell tabs (3 types for environment variable based configs)
  const shellTabs: TabConfig[] = [
    { id: 'unix', label: 'macOS / Linux', icon: AppleIcon },
    { id: 'cmd', label: 'Windows CMD', icon: WindowsIcon },
    { id: 'powershell', label: 'PowerShell', icon: WindowsIcon }
  ]

  // OpenAI tabs (2 OS types)
  const openaiTabs: TabConfig[] = [
    { id: 'unix', label: 'macOS / Linux', icon: AppleIcon },
    { id: 'windows', label: 'Windows', icon: WindowsIcon }
  ]

  const showShellTabs = activeClientTab !== 'opencode'

  const showCodexAuthMode = platform === 'openai' &&
    (activeClientTab === 'codex' || activeClientTab === 'codex-ws')

  const currentTabs = !showShellTabs
    ? []
    : activeClientTab === 'codex' || activeClientTab === 'codex-ws' || activeClientTab === 'grok'
      ? openaiTabs
      : shellTabs

  const platformDescription = (() => {
    if (activeClientTab === 'codex' &&
      platform !== 'openai' &&
      platform !== 'grok' &&
      platform !== 'deepseek' &&
      platform !== 'minimax' &&
      platform !== 'composite') {
      return t('keys.useKeyModal.routedCodex.description')
    }
    switch (platform) {
      case 'openai':
        if (activeClientTab === 'claude') {
          return t('keys.useKeyModal.description')
        }
        return t('keys.useKeyModal.openai.description')
      case 'gemini':
        return t('keys.useKeyModal.gemini.description')
      case 'antigravity':
        return t('keys.useKeyModal.antigravity.description')
      case 'grok':
        if (activeClientTab === 'claude') {
          return t('keys.useKeyModal.grok.claudeDescription')
        }
        if (activeClientTab === 'codex') {
          return t('keys.useKeyModal.grok.codexDescription')
        }
        return t('keys.useKeyModal.grok.description')
      case 'deepseek':
        return activeClientTab === 'codex'
          ? t('keys.useKeyModal.deepseek.codexDescription')
          : t('keys.useKeyModal.deepseek.description')
      case 'minimax':
        return activeClientTab === 'codex'
          ? t('keys.useKeyModal.minimax.codexDescription')
          : t('keys.useKeyModal.minimax.description')
      case 'composite':
        return activeClientTab === 'codex'
          ? t('keys.useKeyModal.composite.codexDescription')
          : t('keys.useKeyModal.composite.description')
      case 'typesafe':
        return t('keys.useKeyModal.typesafe.description')
      default:
        return t('keys.useKeyModal.description')
    }
  })()

  const platformNote = (() => {
    if (activeClientTab === 'codex' &&
      platform !== 'openai' &&
      platform !== 'grok' &&
      platform !== 'deepseek' &&
      platform !== 'minimax' &&
      platform !== 'composite') {
      return t('keys.useKeyModal.routedCodex.note')
    }
    switch (platform) {
      case 'openai':
        if (activeClientTab === 'claude') {
          return t('keys.useKeyModal.note')
        }
        return activeTab === 'windows'
          ? t('keys.useKeyModal.openai.noteWindows')
          : t('keys.useKeyModal.openai.note')
      case 'gemini':
        return t('keys.useKeyModal.gemini.note')
      case 'antigravity':
        return activeClientTab === 'claude'
          ? t('keys.useKeyModal.antigravity.claudeNote')
          : t('keys.useKeyModal.antigravity.geminiNote')
      case 'grok':
        if (activeClientTab === 'claude') {
          return t('keys.useKeyModal.grok.claudeNote')
        }
        if (activeClientTab === 'codex') {
          return activeTab === 'windows'
            ? t('keys.useKeyModal.grok.codexNoteWindows')
            : t('keys.useKeyModal.grok.codexNote')
        }
        // Grok CLI: shell-specific path guidance (env + ~/.grok/config.toml).
        if (activeClientTab === 'grok' && (activeTab === 'cmd' || activeTab === 'powershell')) {
          return t('keys.useKeyModal.grok.noteWindows')
        }
        if (activeClientTab === 'grok' && activeTab === 'windows') {
          return t('keys.useKeyModal.grok.noteWindows')
        }
        return t('keys.useKeyModal.grok.note')
      case 'deepseek':
        return activeClientTab === 'codex'
          ? t('keys.useKeyModal.deepseek.codexNote')
          : t('keys.useKeyModal.note')
      case 'minimax':
        return activeClientTab === 'codex'
          ? t('keys.useKeyModal.minimax.codexNote')
          : t('keys.useKeyModal.note')
      case 'composite':
        return activeClientTab === 'codex'
          ? t('keys.useKeyModal.composite.codexNote')
          : t('keys.useKeyModal.note')
      case 'typesafe':
        return t('keys.useKeyModal.typesafe.note')
      default:
        return t('keys.useKeyModal.note')
    }
  })()

  const showPlatformNote = activeClientTab !== 'opencode'

  const loadCodexModelManifest = async () => {
    if (!showCodexModelCatalog || !apiKey) return

    codexModelManifestController.current?.abort()
    const controller = new AbortController()
    const requestID = ++codexModelManifestRequestID.current
    codexModelManifestController.current = controller
    setCodexModelManifestState('loading')

    try {
      const result = await fetchCodexModelsManifest(baseUrl, apiKey, controller.signal)
      if (requestID !== codexModelManifestRequestID.current) return
      setCodexModelManifestContent(result.content)
      setCodexModelManifestModelCount(result.modelCount)
      setCodexModelManifestResponseBytes(result.responseBytes)
      if (result.responseBytes > 1024 * 1024) setCodexModelCatalogMode('file')
      setCodexModelManifestState('ready')
    } catch (error) {
      const errorName = error && typeof error === 'object' && 'name' in error
        ? String((error as { name?: unknown }).name || '')
        : ''
      if (requestID !== codexModelManifestRequestID.current || errorName === 'AbortError') return
      setCodexModelManifestState('error')
    } finally {
      if (requestID === codexModelManifestRequestID.current) {
        codexModelManifestController.current = null
      }
    }
  }

  const downloadCodexModelManifest = () => {
    if (!codexModelManifestContent) return
    saveAs(
      new Blob([codexModelManifestContent], { type: 'application/json;charset=utf-8' }),
      'codex-models.json'
    )
  }

  // Generate file configs based on platform and active tab
  const currentFiles = buildUseKeyConfigFiles({
    t,
    baseUrl,
    apiKey,
    platform,
    activeTab,
    activeClientTab,
    codexAuthMode,
    codexModelCatalogMode,
    codexModelManifestContent
  })

  const copyContent = async (content: string, index: number) => {
    const success = await clipboardCopy(content, t('keys.copied'))
    if (success) {
      setCopiedIndex(index)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => {
        setCopiedIndex(null)
      }, 2000)
    }
  }

  const renderTabs = (tabs: TabConfig[], active: string, onSelect: (id: string) => void, label: string) => (
    <div className={styles.tabsScroll}>
      <nav className={styles.tabs} aria-label={label}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={styles.tab}
            aria-current={active === tab.id ? 'page' : undefined}
            data-active={active === tab.id}
            onClick={() => onSelect(tab.id)}
          >
            <span className={styles.tabLabel}>
              {tab.icon}
              {tab.label}
            </span>
          </button>
        ))}
      </nav>
    </div>
  )

  return (
    <BaseDialog
      show={show}
      title={t('keys.useKeyModal.title')}
      width="wide"
      onClose={onClose}
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <div className={styles.body}>
        {/* No Group Assigned Warning */}
        {!platform ? (
          <Alert tone="warning" title={t('keys.useKeyModal.noGroupTitle')}>
            {t('keys.useKeyModal.noGroupDescription')}
          </Alert>
        ) : (
          <>
            {/* Description */}
            <p className={styles.description}>{platformDescription}</p>

            {/* Client Tabs */}
            {clientTabs.length > 0 && renderTabs(clientTabs, activeClientTab, selectClientTab, 'Client')}

            {/* Codex Authentication Mode */}
            {showCodexAuthMode && (
              <div className={styles.authMode}>
                <div>
                  <p className={styles.authModeTitle}>{t('keys.useKeyModal.openai.authModeTitle')}</p>
                  <p className={styles.authModeDescription}>{t('keys.useKeyModal.openai.authModeDescription')}</p>
                </div>
                <div
                  className={styles.segmented}
                  role="radiogroup"
                  aria-label={t('keys.useKeyModal.openai.authModeTitle')}
                >
                  <button
                    type="button"
                    role="radio"
                    data-testid="codex-auth-mode-legacy"
                    aria-checked={codexAuthMode === 'legacy'}
                    className={styles.segment}
                    onClick={() => setCodexAuthMode('legacy')}
                  >
                    {t('keys.useKeyModal.openai.authModeLegacy')}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    data-testid="codex-auth-mode-api-key"
                    aria-checked={codexAuthMode === 'api-key'}
                    className={styles.segment}
                    onClick={() => setCodexAuthMode('api-key')}
                  >
                    {t('keys.useKeyModal.openai.authModeApiKey')}
                  </button>
                </div>
                {codexAuthMode === 'api-key' && (
                  <Alert
                    tone="warning"
                    data-testid="codex-api-key-restart-notice"
                    title={t('keys.useKeyModal.openai.authModeApiKeyRestartNotice')}
                  />
                )}
              </div>
            )}

            {/* OS/Shell Tabs */}
            {showShellTabs && renderTabs(currentTabs, activeTab, setActiveTab, 'Tabs')}

            {/* Code Blocks (Stacked for multi-file platforms) */}
            <div className={styles.files}>
              {currentFiles.map((file, index) => (
                <div key={index}>
                  {/* File Hint (if exists) */}
                  {file.hint && <p className={styles.fileHint}>{file.hint}</p>}
                  <div className={styles.codeBlock}>
                    {/* Code Header */}
                    <div className={styles.codeHeader}>
                      <span className={styles.codePath}>{file.path}</span>
                      <button
                        type="button"
                        className={styles.copyButton}
                        data-copied={copiedIndex === index}
                        onClick={() => void copyContent(file.content, index)}
                      >
                        {copiedIndex === index
                          ? <Check size={14} aria-hidden="true" />
                          : <Clipboard size={14} aria-hidden="true" />}
                        {copiedIndex === index ? t('keys.useKeyModal.copied') : t('keys.useKeyModal.copy')}
                      </button>
                    </div>
                    {/* Code Content；highlighted 由本模块转义拼接，与 Vue 版 v-html 一致 */}
                    <pre className={styles.code}>
                      {file.highlighted
                        ? <code dangerouslySetInnerHTML={{ __html: file.highlighted }} />
                        : <code>{file.content}</code>}
                    </pre>
                  </div>
                </div>
              ))}
            </div>

            {showCodexModelCatalog && (
              <section data-testid="codex-model-catalog" className={styles.catalog}>
                <div className={styles.catalogMain}>
                  <div className={styles.catalogText}>
                    <h3 className={styles.catalogTitle}>{t('keys.useKeyModal.codexModelCatalog.title')}</h3>
                    <p className={styles.catalogDescription}>{t('keys.useKeyModal.codexModelCatalog.description')}</p>
                    <p className={styles.catalogPath}>
                      {codexModelCatalogMode === 'remote' ? codexModelCatalogUrl : codexModelCatalogPath}
                    </p>
                    <select
                      value={codexModelCatalogMode}
                      data-testid="codex-model-catalog-mode"
                      aria-label={t('keys.useKeyModal.codexModelCatalog.mode')}
                      className={styles.select}
                      onChange={(event) => setCodexModelCatalogMode(event.target.value as CodexModelCatalogMode)}
                    >
                      <option value="remote" disabled={codexModelCatalogOversized}>
                        {t('keys.useKeyModal.codexModelCatalog.remote')}
                      </option>
                      <option value="file">{t('keys.useKeyModal.codexModelCatalog.local')}</option>
                    </select>
                    {codexModelCatalogOversized && (
                      <p className={styles.catalogWarning}>{t('keys.useKeyModal.codexModelCatalog.oversized')}</p>
                    )}
                  </div>
                  {codexModelManifestState === 'ready' ? (
                    <Button type="button" size="sm" onClick={downloadCodexModelManifest}>
                      <Download size={14} aria-hidden="true" />
                      {t('keys.useKeyModal.codexModelCatalog.download')}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      data-testid="codex-model-catalog-fetch"
                      disabled={codexModelManifestState === 'loading' || !apiKey}
                      onClick={() => void loadCodexModelManifest()}
                    >
                      <RefreshCw
                        size={14}
                        aria-hidden="true"
                        className={codexModelManifestState === 'loading' ? styles.spin : undefined}
                      />
                      {codexModelManifestState === 'error'
                        ? t('keys.useKeyModal.codexModelCatalog.retry')
                        : t('keys.useKeyModal.codexModelCatalog.fetch')}
                    </Button>
                  )}
                </div>
                {codexModelManifestState === 'ready' ? (
                  <p className={styles.catalogReady}>
                    {t('keys.useKeyModal.codexModelCatalog.modelsCount', { count: codexModelManifestModelCount })}
                  </p>
                ) : codexModelManifestState === 'error' ? (
                  <p className={styles.catalogError}>{t('keys.useKeyModal.codexModelCatalog.errorDescription')}</p>
                ) : null}
              </section>
            )}

            {/* Usage Note */}
            {showPlatformNote && <Alert tone="info" title={platformNote} />}
          </>
        )}
      </div>
    </BaseDialog>
  )
}
