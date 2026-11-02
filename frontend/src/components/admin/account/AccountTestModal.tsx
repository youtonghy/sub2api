/**
 * 账号连通性测试弹窗，对应 Vue 版 AccountTestModal.vue。
 * 通过 fetch 读取 /admin/accounts/:id/test 的 SSE 流（EventSource 不支持 POST），
 * 输出到终端样式区域，并预览图片、音频、视频结果。
 * Grok 账号先选测试模式（text/image/video/search/tts/stt/realtime），再按模式选择模型与参数；
 * OpenAI 账号可切换 compact 探测模式。
 */
import { Check, Copy, Eye, LayoutGrid, MessageSquare, Play, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'

import { adminAPI } from '@/api/admin'
import { ADMIN_UI_REQUEST_HEADER } from '@/api/adminUIRequest'
import { buildApiUrl } from '@/api/client'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import Select from '@/components/common/Select'
import TextArea from '@/components/common/TextArea'
import { useClipboard } from '@/composables/useClipboard'
import { useI18n } from '@/i18n/useI18n'
import type { Account, ClaudeModel } from '@/types'
import styles from './AccountTestModal.module.css'

export interface AccountTestModalProps {
  show: boolean
  account: Account | null
  onClose: () => void
}

type LineTone = 'default' | 'muted' | 'info' | 'accent' | 'success' | 'successSoft' | 'warning' | 'danger' | 'media'

interface OutputLine {
  text: string
  tone: LineTone
}

interface PreviewMedia {
  url: string
  mimeType?: string
}

type TestStatus = 'idle' | 'connecting' | 'success' | 'error'
type OpenAITestMode = 'default' | 'compact'
type GrokTestMode = 'text' | 'image' | 'video' | 'search' | 'tts' | 'stt' | 'realtime'

interface TestEvent {
  type: string
  text?: string
  model?: string
  success?: boolean
  error?: string
  image_url?: string
  audio_url?: string
  video_url?: string
  mime_type?: string
}

const prioritizedGeminiModels = ['gemini-3.1-flash-image', 'gemini-2.5-flash-image', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-3-pro-preview', 'gemini-2.0-flash']

const MAX_MEDIA_BYTES = 6 * 1024 * 1024

const isGrokImageModel = (id: string) => {
  const modelID = id.toLowerCase()
  return modelID === 'grok-imagine' || modelID === 'grok-imagine-edit' || modelID.startsWith('grok-imagine-image')
}
const isGrokVideoModel = (id: string) => {
  const modelID = id.toLowerCase()
  return modelID.startsWith('grok-imagine-video') || modelID.startsWith('grok-video')
}
const isGrokTextModel = (id: string) => !isGrokImageModel(id) && !isGrokVideoModel(id)

const isStandaloneGrokMode = (mode: GrokTestMode) =>
  mode === 'search' || mode === 'tts' || mode === 'stt' || mode === 'realtime'

const sortTestModels = (models: ClaudeModel[]) => {
  const priorityMap = new Map(prioritizedGeminiModels.map((id, index) => [id, index]))

  return [...models].sort((a, b) => {
    const aPriority = priorityMap.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const bPriority = priorityMap.get(b.id) ?? Number.MAX_SAFE_INTEGER
    if (aPriority !== bPriority) return aPriority - bPriority
    return 0
  })
}

const computeSupportsImageTest = (account: Account | null, selectedModelId: string, grokTestMode: GrokTestMode) => {
  const modelID = selectedModelId.toLowerCase()
  const platform = account?.platform
  const gemini = modelID.startsWith('gemini-') && modelID.includes('-image') && (platform === 'gemini' || platform === 'antigravity')
  const openai = modelID.startsWith('gpt-image-') && platform === 'openai'
  const grok = platform === 'grok' && grokTestMode === 'image'
  return gemini || openai || grok
}

const computeModelOptionsForMode = (models: ClaudeModel[], isGrok: boolean, mode: GrokTestMode) => {
  if (!isGrok) return models
  if (mode === 'image') return models.filter((m) => isGrokImageModel(m.id))
  if (mode === 'video') return models.filter((m) => isGrokVideoModel(m.id))
  if (mode === 'text') return models.filter((m) => isGrokTextModel(m.id))
  return []
}

const computeSupportsPromptInput = (isGrok: boolean, mode: GrokTestMode, supportsImageTest: boolean) => {
  if (!isGrok) return supportsImageTest
  return mode === 'image' || mode === 'video' || mode === 'search' || mode === 'tts'
}

const pickDefaultModelForMode = (options: ClaudeModel[], current: string, mode: GrokTestMode) => {
  if (!options.length) return ''
  if (options.some((m) => m.id === current)) return current
  if (mode === 'text') {
    const preferred = options.find((m) => m.id.includes('grok-4.5')) || options.find((m) => m.id === 'grok') || options[0]
    return preferred.id
  }
  return options[0].id
}

export default function AccountTestModal({ show, account, onClose }: AccountTestModalProps) {
  const { t } = useI18n()
  const { copyToClipboard } = useClipboard()

  const [status, setStatusState] = useState<TestStatus>('idle')
  const [outputLines, setOutputLines] = useState<OutputLine[]>([])
  const [streamingContent, setStreamingContentState] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [availableModels, setAvailableModels] = useState<ClaudeModel[]>([])
  const [selectedModelId, setSelectedModelId] = useState('')
  const [testPrompt, setTestPrompt] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [generatedImages, setGeneratedImages] = useState<PreviewMedia[]>([])
  const [generatedAudios, setGeneratedAudios] = useState<PreviewMedia[]>([])
  const [generatedVideos, setGeneratedVideos] = useState<PreviewMedia[]>([])
  const [previewImageUrl, setPreviewImageUrl] = useState('')
  const [testMode, setTestMode] = useState<OpenAITestMode>('default')
  const [grokTestMode, setGrokTestModeState] = useState<GrokTestMode>('text')
  const [uploadImageDataURL, setUploadImageDataURL] = useState('')
  const [uploadImagePreview, setUploadImagePreview] = useState('')
  const [uploadImageName, setUploadImageName] = useState('')
  const [uploadAudioDataURL, setUploadAudioDataURL] = useState('')
  const [uploadAudioName, setUploadAudioName] = useState('')

  const terminalRef = useRef<HTMLDivElement>(null)
  const imageFileInput = useRef<HTMLInputElement>(null)
  const audioFileInput = useRef<HTMLInputElement>(null)
  const abortController = useRef<AbortController | null>(null)
  // 流式处理中需要同步读取的最新值
  const statusRef = useRef<TestStatus>('idle')
  const streamingRef = useRef('')
  const mediaCounts = useRef({ images: 0, audios: 0, videos: 0 })

  const setStatus = (value: TestStatus) => {
    statusRef.current = value
    setStatusState(value)
  }
  const setStreamingContent = (value: string) => {
    streamingRef.current = value
    setStreamingContentState(value)
  }

  const isOpenAIAccount = account?.platform === 'openai'
  const isGrokAccount = account?.platform === 'grok'

  const openAITestModeOptions = useMemo(
    () => [
      { value: 'default', label: t('admin.accounts.openai.testModeDefault') },
      { value: 'compact', label: t('admin.accounts.openai.testModeCompact') }
    ],
    [t]
  )
  const grokTestModeOptions = useMemo(
    () => [
      { value: 'text', label: t('admin.accounts.grok.testModeText') },
      { value: 'image', label: t('admin.accounts.grok.testModeImage') },
      { value: 'video', label: t('admin.accounts.grok.testModeVideo') },
      { value: 'search', label: t('admin.accounts.grok.testModeSearch') },
      { value: 'tts', label: t('admin.accounts.grok.testModeTTS') },
      { value: 'stt', label: t('admin.accounts.grok.testModeSTT') },
      { value: 'realtime', label: t('admin.accounts.grok.testModeRealtime') }
    ],
    [t]
  )

  const supportsImageTest = computeSupportsImageTest(account, selectedModelId, grokTestMode)
  const supportsGrokVideoTest = isGrokAccount && grokTestMode === 'video'

  // Model select only when the mode needs a model.
  const showModelSelect = !isGrokAccount || grokTestMode === 'text' || grokTestMode === 'image' || grokTestMode === 'video'
  const modelOptionsForMode = computeModelOptionsForMode(availableModels, isGrokAccount, grokTestMode)
  const supportsPromptInput = computeSupportsPromptInput(isGrokAccount, grokTestMode, supportsImageTest)
  const supportsImageUpload = isGrokAccount && (grokTestMode === 'image' || grokTestMode === 'video')
  const supportsAudioUpload = isGrokAccount && grokTestMode === 'stt'

  const imageUploadLabel =
    grokTestMode === 'video' ? t('admin.accounts.grok.videoFirstFrameLabel') : t('admin.accounts.grok.imageUploadLabel')
  const imageUploadHint =
    grokTestMode === 'video' ? t('admin.accounts.grok.videoFirstFrameHint') : t('admin.accounts.grok.imageUploadHint')

  const promptInputLabel = (() => {
    if (supportsGrokVideoTest || grokTestMode === 'video') return t('admin.accounts.videoPromptLabel')
    if (supportsImageTest || grokTestMode === 'image') return t('admin.accounts.imagePromptLabel')
    if (grokTestMode === 'search') return t('admin.accounts.grok.searchQueryLabel')
    if (grokTestMode === 'tts') return t('admin.accounts.grok.ttsTextLabel')
    return t('admin.accounts.imagePromptLabel')
  })()

  const promptInputPlaceholder = (() => {
    if (grokTestMode === 'video') return t('admin.accounts.videoPromptPlaceholder')
    if (grokTestMode === 'image' || supportsImageTest) return t('admin.accounts.imagePromptPlaceholder')
    if (grokTestMode === 'search') return t('admin.accounts.grok.searchQueryPlaceholder')
    if (grokTestMode === 'tts') return t('admin.accounts.grok.ttsTextPlaceholder')
    return ''
  })()

  const promptInputHint = (() => {
    if (grokTestMode === 'video') return t('admin.accounts.videoTestHint')
    if (grokTestMode === 'image' || supportsImageTest) return t('admin.accounts.imageTestHint')
    if (grokTestMode === 'search') return t('admin.accounts.grok.searchTestHint')
    if (grokTestMode === 'tts') return t('admin.accounts.grok.ttsTestHint')
    if (grokTestMode === 'stt') return t('admin.accounts.grok.sttTestHint')
    if (grokTestMode === 'realtime') return t('admin.accounts.grok.realtimeTestHint')
    return ''
  })()

  const testModeSummary = (() => {
    if (isGrokAccount) {
      switch (grokTestMode) {
        case 'video':
          return t('admin.accounts.videoTestMode')
        case 'image':
          return t('admin.accounts.imageTestMode')
        case 'search':
          return t('admin.accounts.grok.searchTestMode')
        case 'tts':
          return t('admin.accounts.grok.ttsTestMode')
        case 'stt':
          return t('admin.accounts.grok.sttTestMode')
        case 'realtime':
          return t('admin.accounts.grok.realtimeTestMode')
        default:
          return t('admin.accounts.grok.textTestMode')
      }
    }
    if (supportsImageTest) return t('admin.accounts.imageTestMode')
    return t('admin.accounts.testPrompt')
  })()

  const canStartTest = (() => {
    if (status === 'connecting') return false
    if (isGrokAccount && isStandaloneGrokMode(grokTestMode)) {
      return true // standalone modes (prompt/model optional)
    }
    return Boolean(selectedModelId)
  })()

  const defaultPromptFor = (mode: GrokTestMode, imageTest: boolean) => {
    if (mode === 'video') return t('admin.accounts.videoPromptDefault')
    if (mode === 'image' || imageTest) return t('admin.accounts.imagePromptDefault')
    if (mode === 'search') return t('admin.accounts.grok.searchQueryDefault')
    if (mode === 'tts') return t('admin.accounts.grok.ttsTextDefault')
    return ''
  }

  const clearMediaUploads = () => {
    setUploadImageDataURL('')
    setUploadImagePreview('')
    setUploadImageName('')
    setUploadAudioDataURL('')
    setUploadAudioName('')
    if (imageFileInput.current) imageFileInput.current.value = ''
    if (audioFileInput.current) audioFileInput.current.value = ''
  }

  const resetState = () => {
    setStatus('idle')
    setOutputLines([])
    setStreamingContent('')
    setErrorMessage('')
    setGeneratedImages([])
    setGeneratedAudios([])
    setGeneratedVideos([])
    mediaCounts.current = { images: 0, audios: 0, videos: 0 }
    setPreviewImageUrl('')
  }

  const abortStream = () => {
    if (abortController.current) {
      abortController.current.abort()
      abortController.current = null
    }
  }

  // Grok 模式切换：清空提示词与上传，重新选择默认模型与默认提示词（Vue 版 watch(grokTestMode)）
  const changeGrokTestMode = (mode: GrokTestMode) => {
    if (mode === grokTestMode) return
    setGrokTestModeState(mode)
    if (!isGrokAccount) return
    clearMediaUploads()
    const nextModel = pickDefaultModelForMode(computeModelOptionsForMode(availableModels, true, mode), selectedModelId, mode)
    setSelectedModelId(nextModel)
    const imageTest = computeSupportsImageTest(account, nextModel, mode)
    setTestPrompt(computeSupportsPromptInput(true, mode, imageTest) ? defaultPromptFor(mode, imageTest) : '')
  }

  const loadAvailableModels = async (target: Account) => {
    setLoadingModels(true)
    setSelectedModelId('') // Reset selection before loading
    let models: ClaudeModel[]
    let selected = ''
    try {
      const loaded = await adminAPI.accounts.getAvailableModels(target.id)
      models = target.platform === 'gemini' || target.platform === 'antigravity' ? sortTestModels(loaded) : loaded
      // Default selection by platform
      if (models.length > 0) {
        if (target.platform === 'gemini') {
          selected = models[0].id
        } else {
          // Try to select Sonnet as default, otherwise use first model
          const sonnetModel = models.find((m) => m.id.includes('sonnet'))
          selected = sonnetModel?.id || models[0].id
        }
      }
    } catch (error) {
      console.error('Failed to load available models:', error)
      // Fallback to empty list
      models = []
      selected = ''
    } finally {
      setLoadingModels(false)
    }
    setAvailableModels(models)
    setSelectedModelId(selected)
    return { models, selected }
  }

  const accountRef = useRef(account)
  useEffect(() => {
    accountRef.current = account
  })

  // Load available models when modal opens
  useEffect(() => {
    const target = accountRef.current
    if (!show || !target) {
      abortStream()
      return
    }
    let cancelled = false
    setTestPrompt('')
    setTestMode('default')
    setGrokTestModeState('text')
    clearMediaUploads()
    resetState()
    void loadAvailableModels(target).then(({ models, selected }) => {
      if (cancelled || target.platform !== 'grok') return
      const picked = pickDefaultModelForMode(computeModelOptionsForMode(models, true, 'text'), selected, 'text')
      setSelectedModelId(picked)
      // text 模式不需要提示词，applyDefaultPromptForMode 不会写入
    })
    return () => {
      cancelled = true
    }
    // 与 Vue 版一致，只跟随 show 变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  // 卸载时中止进行中的测试流
  useEffect(() => () => abortStream(), [])

  // 输出或流式内容变化后滚动到底部
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [outputLines, streamingContent])

  const readFileAsDataURL = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error(t('admin.accounts.grok.fileReadFailed')))
      reader.readAsDataURL(file)
    })

  const onImageFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const file = input.files?.[0]
    if (!file) {
      setUploadImageDataURL('')
      setUploadImagePreview('')
      setUploadImageName('')
      return
    }
    if (file.size > MAX_MEDIA_BYTES) {
      setErrorMessage(t('admin.accounts.grok.mediaTooLarge'))
      setStatus('error')
      input.value = ''
      return
    }
    try {
      const dataURL = await readFileAsDataURL(file)
      setUploadImageDataURL(dataURL)
      setUploadImagePreview(dataURL)
      setUploadImageName(file.name)
    } catch {
      setUploadImageDataURL('')
      setUploadImagePreview('')
      setUploadImageName('')
      setErrorMessage(t('admin.accounts.grok.fileReadFailed'))
      setStatus('error')
    }
  }

  const onAudioFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const file = input.files?.[0]
    if (!file) {
      setUploadAudioDataURL('')
      setUploadAudioName('')
      return
    }
    if (file.size > MAX_MEDIA_BYTES) {
      setErrorMessage(t('admin.accounts.grok.mediaTooLarge'))
      setStatus('error')
      input.value = ''
      return
    }
    try {
      setUploadAudioDataURL(await readFileAsDataURL(file))
      setUploadAudioName(file.name)
    } catch {
      setUploadAudioDataURL('')
      setUploadAudioName('')
      setErrorMessage(t('admin.accounts.grok.fileReadFailed'))
      setStatus('error')
    }
  }

  const handleClose = () => {
    abortStream()
    onClose()
  }

  const addLine = (text: string, tone: LineTone = 'default') => {
    setOutputLines((lines) => [...lines, { text, tone }])
  }

  const handleEvent = (event: TestEvent) => {
    switch (event.type) {
      case 'test_start':
        addLine(t('admin.accounts.connectedToApi'), 'success')
        if (event.model) {
          addLine(t('admin.accounts.usingModel', { model: event.model }), 'accent')
        }
        addLine(
          isGrokAccount
            ? grokTestMode === 'video'
              ? t('admin.accounts.sendingVideoRequest')
              : grokTestMode === 'image'
                ? t('admin.accounts.sendingImageRequest')
                : grokTestMode === 'search'
                  ? t('admin.accounts.grok.sendingSearchRequest')
                  : grokTestMode === 'tts'
                    ? t('admin.accounts.grok.sendingTTSRequest')
                    : grokTestMode === 'stt'
                      ? t('admin.accounts.grok.sendingSTTRequest')
                      : grokTestMode === 'realtime'
                        ? t('admin.accounts.grok.sendingRealtimeRequest')
                        : t('admin.accounts.sendingTestMessage')
            : supportsImageTest
              ? t('admin.accounts.sendingImageRequest')
              : t('admin.accounts.sendingTestMessage'),
          'muted'
        )
        addLine('', 'default')
        addLine(t('admin.accounts.response'), 'warning')
        break

      case 'content':
        if (event.text) {
          setStreamingContent(streamingRef.current + event.text)
        }
        break

      case 'image':
        if (event.image_url) {
          const media = { url: event.image_url, mimeType: event.mime_type }
          mediaCounts.current.images += 1
          setGeneratedImages((items) => [...items, media])
          addLine(t('admin.accounts.imageReceived', { count: mediaCounts.current.images }), 'media')
        }
        break

      case 'audio':
        if (event.audio_url) {
          const media = { url: event.audio_url, mimeType: event.mime_type }
          mediaCounts.current.audios += 1
          setGeneratedAudios((items) => [...items, media])
          addLine(t('admin.accounts.audioReceived', { count: mediaCounts.current.audios }), 'media')
        }
        break

      case 'video':
        if (event.video_url) {
          const media = { url: event.video_url, mimeType: event.mime_type }
          mediaCounts.current.videos += 1
          setGeneratedVideos((items) => [...items, media])
          addLine(t('admin.accounts.videoReceived', { count: mediaCounts.current.videos }), 'media')
        }
        break

      case 'status':
        if (event.text) {
          addLine(event.text, 'accent')
        }
        break

      case 'test_complete':
        // Move streaming content to output lines
        if (streamingRef.current) {
          addLine(streamingRef.current, 'successSoft')
          setStreamingContent('')
        }
        if (event.success) {
          setStatus('success')
        } else {
          setStatus('error')
          setErrorMessage(event.error || t('admin.accounts.testFailed'))
        }
        break

      case 'error':
        setStatus('error')
        setErrorMessage(event.error || t('common.unknownError'))
        if (streamingRef.current) {
          addLine(streamingRef.current, 'successSoft')
          setStreamingContent('')
        }
        break
    }
  }

  const startTest = async () => {
    if (!account || !canStartTest) return

    resetState()
    setStatus('connecting')
    addLine(t('admin.accounts.startingTestForAccount', { name: account.name }), 'info')
    addLine(t('admin.accounts.testAccountTypeLabel', { type: account.type }), 'muted')
    if (isGrokAccount) {
      const modeLabel = grokTestModeOptions.find((o) => o.value === grokTestMode)?.label || grokTestMode
      addLine(t('admin.accounts.grok.selectedTestMode', { mode: modeLabel }), 'muted')
    }
    addLine('', 'default')

    abortStream()

    const controller = new AbortController()
    abortController.current = controller

    try {
      const requestBody: {
        model_id: string
        prompt: string
        mode?: string
        image_data_url?: string
        audio_data_url?: string
      } = {
        model_id: showModelSelect ? selectedModelId : '',
        prompt: supportsPromptInput ? testPrompt.trim() : ''
      }
      if (isOpenAIAccount) {
        requestBody.mode = testMode
      }
      if (isGrokAccount) {
        // Always send explicit Grok mode. search/tts/stt/realtime are standalone
        // endpoints (no free-form model select). text/image/video use optional model.
        requestBody.mode = grokTestMode
        if (isStandaloneGrokMode(grokTestMode)) {
          requestBody.model_id = ''
        }
        if (uploadImageDataURL && (grokTestMode === 'image' || grokTestMode === 'video')) {
          requestBody.image_data_url = uploadImageDataURL
        }
        if (uploadAudioDataURL && grokTestMode === 'stt') {
          requestBody.audio_data_url = uploadAudioDataURL
        }
      }

      // Use the configured API base; EventSource does not support POST.
      const url = buildApiUrl(`/admin/accounts/${account.id}/test`)

      // Use fetch with streaming for SSE since EventSource doesn't support POST
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
          'Content-Type': 'application/json',
          [ADMIN_UI_REQUEST_HEADER]: '1'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error(t('admin.accounts.grok.noResponseBody'))
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim()
            if (jsonStr) {
              try {
                handleEvent(JSON.parse(jsonStr) as TestEvent)
              } catch (e) {
                console.error('Failed to parse SSE event:', e)
              }
            }
          }
        }
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStatus('idle')
        return
      }
      setStatus('error')
      const msg = error instanceof Error ? error.message : t('common.unknownError')
      setErrorMessage(msg)
      addLine(t('admin.accounts.errorPrefix', { message: msg }), 'danger')
    }
  }

  const copyOutput = () => {
    const text = outputLines.map((l) => l.text).join('\n')
    void copyToClipboard(text, t('admin.accounts.outputCopied'))
  }

  const startLabel =
    status === 'connecting' ? t('admin.accounts.testing') : status === 'idle' ? t('admin.accounts.startTest') : t('admin.accounts.retry')

  return (
    <>
      <BaseDialog
        show={show}
        title={t('admin.accounts.testAccountConnection')}
        width="normal"
        onClose={handleClose}
        footer={
          <div className={styles.footer}>
            <Button type="button" variant="secondary" onClick={handleClose}>
              {t('common.close')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!canStartTest}
              data-status={status}
              onClick={() => void startTest()}
            >
              {status === 'connecting' ? (
                <RefreshCw size={14} className={styles.spin} aria-hidden="true" />
              ) : status === 'idle' ? (
                <Play size={14} aria-hidden="true" />
              ) : (
                <RefreshCw size={14} aria-hidden="true" />
              )}
              <span>{startLabel}</span>
            </Button>
          </div>
        }
      >
        <div className={styles.root}>
          {/* Account Info Card */}
          {account ? (
            <div className={styles.accountCard}>
              <div className={styles.accountMain}>
                <div className={styles.accountIcon}>
                  <Play size={18} aria-hidden="true" />
                </div>
                <div>
                  <div className={styles.accountName}>{account.name}</div>
                  <div className={styles.accountMeta}>
                    <span className={styles.typeTag}>{account.type}</span>
                    <span>{t('admin.accounts.account')}</span>
                  </div>
                </div>
              </div>
              <Badge tone={account.status === 'active' ? 'success' : 'neutral'} size="sm">
                {account.status}
              </Badge>
            </div>
          ) : null}

          {/* Grok: mode first, then optional model / mode params */}
          {isGrokAccount ? (
            <div className={styles.field}>
              <span className={styles.label}>{t('admin.accounts.grok.testMode')}</span>
              <Select
                value={grokTestMode}
                options={grokTestModeOptions}
                disabled={status === 'connecting'}
                aria-label={t('admin.accounts.grok.testMode')}
                onChange={(value) => changeGrokTestMode(String(value) as GrokTestMode)}
              />
              <p className={styles.hint}>{t('admin.accounts.grok.testModeHint')}</p>
            </div>
          ) : null}

          {showModelSelect ? (
            <div className={styles.field}>
              <span className={styles.label}>{t('admin.accounts.selectTestModel')}</span>
              <Select
                value={selectedModelId}
                options={modelOptionsForMode as unknown as Array<Record<string, unknown>>}
                disabled={loadingModels || status === 'connecting'}
                valueKey="id"
                labelKey="display_name"
                placeholder={loadingModels ? t('common.loading') + '...' : t('admin.accounts.selectTestModel')}
                aria-label={t('admin.accounts.selectTestModel')}
                onChange={(value) => setSelectedModelId(value == null ? '' : String(value))}
              />
            </div>
          ) : null}

          {isOpenAIAccount ? (
            <div className={styles.field}>
              <span className={styles.label}>{t('admin.accounts.openai.testMode')}</span>
              <Select
                value={testMode}
                options={openAITestModeOptions}
                disabled={status === 'connecting'}
                aria-label={t('admin.accounts.openai.testMode')}
                onChange={(value) => setTestMode(String(value) as OpenAITestMode)}
              />
            </div>
          ) : null}

          {supportsPromptInput ? (
            <div className={styles.field}>
              <TextArea
                value={testPrompt}
                label={promptInputLabel}
                placeholder={promptInputPlaceholder}
                hint={promptInputHint}
                disabled={status === 'connecting'}
                rows={3}
                onChange={setTestPrompt}
              />
            </div>
          ) : isGrokAccount && promptInputHint ? (
            <p className={styles.hint}>{promptInputHint}</p>
          ) : null}

          {/* Optional media uploads for real generation / transcription */}
          {supportsImageUpload ? (
            <div className={styles.field}>
              <span className={styles.label}>{imageUploadLabel}</span>
              <div className={styles.uploadRow}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={status === 'connecting'}
                  onClick={() => imageFileInput.current?.click()}
                >
                  {t('admin.accounts.grok.chooseImageFile')}
                </Button>
                <span className={styles.fileName}>
                  {uploadImageName ? t('common.selectedFile', { name: uploadImageName }) : t('common.noFileSelected')}
                </span>
                <input
                  ref={imageFileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className={styles.hidden}
                  disabled={status === 'connecting'}
                  onChange={(event) => void onImageFileChange(event)}
                />
              </div>
              <p className={styles.hint}>{imageUploadHint}</p>
              {uploadImagePreview ? (
                <div className={styles.uploadPreview}>
                  <img src={uploadImagePreview} alt={t('admin.accounts.grok.uploadPreviewAlt')} />
                </div>
              ) : null}
            </div>
          ) : null}

          {supportsAudioUpload ? (
            <div className={styles.field}>
              <span className={styles.label}>{t('admin.accounts.grok.audioUploadLabel')}</span>
              <div className={styles.uploadRow}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={status === 'connecting'}
                  onClick={() => audioFileInput.current?.click()}
                >
                  {t('admin.accounts.grok.chooseAudioFile')}
                </Button>
                <span className={styles.fileName}>
                  {uploadAudioName ? t('common.selectedFile', { name: uploadAudioName }) : t('common.noFileSelected')}
                </span>
                <input
                  ref={audioFileInput}
                  type="file"
                  accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm"
                  className={styles.hidden}
                  disabled={status === 'connecting'}
                  onChange={(event) => void onAudioFileChange(event)}
                />
              </div>
              <p className={styles.hint}>{t('admin.accounts.grok.audioUploadHint')}</p>
            </div>
          ) : null}

          {/* Terminal Output */}
          <div className={styles.terminalWrap}>
            <div ref={terminalRef} className={styles.terminal} role="log" aria-live="polite">
              {status === 'idle' ? (
                <div className={styles.statusLine} data-tone="muted">
                  <Play size={14} aria-hidden="true" />
                  <span>{t('admin.accounts.readyToTest')}</span>
                </div>
              ) : status === 'connecting' ? (
                <div className={styles.statusLine} data-tone="warning">
                  <RefreshCw size={14} className={styles.spin} aria-hidden="true" />
                  <span>{t('admin.accounts.connectingToApi')}</span>
                </div>
              ) : null}

              {/* Output Lines */}
              {outputLines.map((line, index) => (
                <div key={index} className={styles.line} data-tone={line.tone}>
                  {line.text}
                </div>
              ))}

              {/* Streaming Content */}
              {streamingContent ? (
                <div className={styles.line} data-tone="success">
                  {streamingContent}
                  <span className={styles.cursor}>_</span>
                </div>
              ) : null}

              {/* Result Status */}
              {status === 'success' ? (
                <div className={styles.result} data-tone="success">
                  <Check size={14} aria-hidden="true" />
                  <span>{t('admin.accounts.testCompleted')}</span>
                </div>
              ) : status === 'error' ? (
                <div className={styles.result} data-tone="danger">
                  <X size={14} aria-hidden="true" />
                  <span>{errorMessage}</span>
                </div>
              ) : null}
            </div>

            {/* Copy Button */}
            {outputLines.length > 0 ? (
              <button
                type="button"
                className={styles.copyButton}
                title={t('admin.accounts.copyOutput')}
                aria-label={t('admin.accounts.copyOutput')}
                onClick={copyOutput}
              >
                <Copy size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          {generatedImages.length > 0 ? (
            <div className={styles.mediaSection}>
              <div className={styles.mediaTitle}>{t('admin.accounts.imagePreview')}</div>
              <div className={styles.imageGrid}>
                {generatedImages.map((image, index) => (
                  <button
                    key={`${image.url}-${index}`}
                    type="button"
                    className={styles.imageCard}
                    onClick={() => setPreviewImageUrl(image.url)}
                  >
                    <img src={image.url} alt={t('admin.accounts.imagePreviewAlt', { index: index + 1 })} />
                    <span className={styles.imageOverlay} aria-hidden="true">
                      <Eye size={24} />
                    </span>
                    <span className={styles.mediaMeta}>{image.mimeType || 'image/*'}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {generatedAudios.length > 0 ? (
            <div className={styles.mediaSection}>
              <div className={styles.mediaTitle}>{t('admin.accounts.audioPreview')}</div>
              {generatedAudios.map((audio, index) => (
                <div key={`audio-${index}`} className={styles.audioCard}>
                  <audio src={audio.url} controls className={styles.fullWidth} />
                  <div className={styles.mediaMetaPlain}>{audio.mimeType || 'audio/*'}</div>
                </div>
              ))}
            </div>
          ) : null}

          {generatedVideos.length > 0 ? (
            <div className={styles.mediaSection}>
              <div className={styles.mediaTitle}>{t('admin.accounts.videoPreview')}</div>
              {generatedVideos.map((video, index) => (
                <div key={`video-${index}`} className={styles.videoCard}>
                  <video src={video.url} controls className={styles.video} />
                  <div className={styles.videoMeta}>{video.mimeType || 'video/*'}</div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Test Info */}
          <div className={styles.testInfo}>
            <span className={styles.testInfoItem}>
              <LayoutGrid size={14} aria-hidden="true" />
              {t('admin.accounts.testModel')}
            </span>
            <span className={styles.testInfoItem}>
              <MessageSquare size={14} aria-hidden="true" />
              {testModeSummary}
            </span>
          </div>
        </div>
      </BaseDialog>

      {/* Image Lightbox：叠放在测试弹窗之上的对话框，Escape 或点击遮罩关闭 */}
      <BaseDialog
        show={Boolean(previewImageUrl)}
        title={t('admin.accounts.imagePreview')}
        width="full"
        closeOnClickOutside
        onClose={() => setPreviewImageUrl('')}
      >
        {previewImageUrl ? (
          <div className={styles.lightbox}>
            <img src={previewImageUrl} alt={t('admin.accounts.imageLightboxAlt')} />
          </div>
        ) : null}
      </BaseDialog>
    </>
  )
}
