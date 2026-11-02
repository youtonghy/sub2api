/**
 * 阿里云验证码 2.0（弹出式）。脚本地址、弹窗 DOM id 与 Vue 版一致（CSP 白名单依赖脚本地址）。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react'
import { CircleCheck, ShieldCheck } from 'lucide-react'

import { useI18n } from '@/i18n/useI18n'
import styles from './captcha.module.css'

interface AliyunCaptchaVerifyResult {
  captchaResult: boolean
  bizResult?: boolean
}

interface AliyunCaptchaInitOptions {
  SceneId: string
  prefix: string
  mode: 'popup' | 'embed'
  element: string
  button: string
  captchaVerifyCallback: (
    captchaVerifyParam: string
  ) => AliyunCaptchaVerifyResult | Promise<AliyunCaptchaVerifyResult>
  onBizResultCallback: (bizResult: boolean) => void
  getInstance: (instance: unknown) => void
  slideStyle?: { width: number; height: number }
  language?: string
}

declare global {
  interface Window {
    initAliyunCaptcha?: (options: AliyunCaptchaInitOptions) => void
    AliyunCaptchaConfig?: { region: string; prefix: string }
  }
}

export interface AliyunCaptchaWidgetProps {
  sceneId: string
  prefix: string
  region?: 'cn' | 'sgp'
  onVerify?: (param: string) => void
  onExpire?: () => void
  onError?: () => void
}

export interface AliyunCaptchaWidgetHandle {
  verify: () => Promise<string | null>
  reset: () => void
}

// idle: 未验证可点击；verifying: 弹窗已拉起（关闭后回到 idle 可重试）；verified: 已通过
type AliyunCaptchaState = 'idle' | 'verifying' | 'verified'

const SCRIPT_SRC = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js'
const POPUP_ID = 'aliyunCaptcha-window-popup'
const MASK_ID = 'aliyunCaptcha-mask'
const POPUP_OPEN_TIMEOUT_MS = 8000
const POPUP_WATCH_INTERVAL_MS = 300

interface WidgetLatest {
  sceneId: string
  prefix: string
  region: 'cn' | 'sgp'
  locale: string
  onVerify?: (param: string) => void
}

interface WidgetOptions {
  buttonId: string
  elementId: string
  latest: RefObject<WidgetLatest>
  setState: (state: AliyunCaptchaState) => void
}

/** 与 Vue 版组件内的模块级变量和函数一一对应，每个组件实例一份 */
function createAliyunCaptcha({ buttonId, elementId, latest, setState }: WidgetOptions) {
  let state: AliyunCaptchaState = 'idle'
  // captchaVerifyParam 是一次性参数：verified 后缓存于此，提交失败需 reset 后重新验证
  let cachedParam: string | null = null
  let pending: { resolve: (value: string | null) => void } | null = null
  let popupWatchTimer: number | null = null
  let readyPromise: Promise<void> | null = null

  const updateState = (next: AliyunCaptchaState) => {
    state = next
    setState(next)
  }

  const loadScript = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      // 全局配置必须在脚本加载前就位（region/prefix 全站一致，重复赋值无副作用）
      window.AliyunCaptchaConfig = { region: latest.current.region, prefix: latest.current.prefix }

      if (window.initAliyunCaptcha) {
        resolve()
        return
      }

      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[src*="aliyunCaptcha/AliyunCaptcha"]'
      )
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve())
        existingScript.addEventListener('error', () =>
          reject(new Error('Failed to load Aliyun captcha script'))
        )
        return
      }

      const script = document.createElement('script')
      script.src = SCRIPT_SRC
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Failed to load Aliyun captcha script'))
      document.head.appendChild(script)
    })
  }

  const initCaptcha = (): void => {
    if (!window.initAliyunCaptcha) {
      throw new Error('Aliyun captcha script not ready')
    }
    window.initAliyunCaptcha({
      SceneId: latest.current.sceneId,
      prefix: latest.current.prefix,
      mode: 'popup',
      element: `#${elementId}`,
      button: `#${buttonId}`,
      // 这里不发业务请求，只把 captchaVerifyParam 当 token 交给页面，随登录/注册等
      // 业务请求的 turnstile_token 字段提交，由后端在业务接口内调阿里云校验。
      captchaVerifyCallback: (captchaVerifyParam: string) => {
        onCaptchaParam(captchaVerifyParam)
        return { captchaResult: true }
      },
      onBizResultCallback: () => {},
      getInstance: () => {},
      slideStyle: { width: 360, height: 40 },
      language: latest.current.locale.toLowerCase().startsWith('zh') ? 'cn' : 'en'
    })
  }

  const ensureReady = (): Promise<void> => {
    if (!readyPromise) {
      readyPromise = loadScript().then(() => initCaptcha())
      readyPromise.catch(() => {
        // 失败后允许下次重试（如网络恢复）
        readyPromise = null
      })
    }
    return readyPromise
  }

  const onCaptchaParam = (param: string): void => {
    stopPopupWatch()
    cachedParam = param
    updateState('verified')
    latest.current.onVerify?.(param)
    const current = pending
    pending = null
    current?.resolve(param)
  }

  const settlePending = (value: string | null): void => {
    const current = pending
    pending = null
    current?.resolve(value)
  }

  const isPopupVisible = (): boolean => {
    const popup = document.getElementById(POPUP_ID)
    if (!popup) return false
    return window.getComputedStyle(popup).display !== 'none'
  }

  const stopPopupWatch = (): void => {
    if (popupWatchTimer !== null) {
      window.clearInterval(popupWatchTimer)
      popupWatchTimer = null
    }
  }

  // SDK 没有用户关闭弹窗的回调，靠轮询弹窗可见性兜底：
  // 弹窗出现过又消失且未产生 param → 用户主动关闭；迟迟未出现 → 打开失败。
  // initAliyunCaptcha 对触发按钮的事件绑定是异步完成的，首次 click 可能落空，
  // 因此弹窗出现前每个 tick 重试触发一次。
  const startPopupWatch = (): void => {
    stopPopupWatch()
    const startedAt = Date.now()
    let seen = false
    popupWatchTimer = window.setInterval(() => {
      if (state === 'verified') {
        stopPopupWatch()
        return
      }
      if (isPopupVisible()) {
        seen = true
        return
      }
      if (seen || Date.now() - startedAt > POPUP_OPEN_TIMEOUT_MS) {
        stopPopupWatch()
        updateState('idle')
        settlePending(null)
        return
      }
      document.getElementById(buttonId)?.click()
    }, POPUP_WATCH_INTERVAL_MS)
  }

  // 用户点击与程序化触发共用：置 verifying 并启动弹窗监视（幂等，重试 click 不重置计时）
  const handleTriggerClick = (): void => {
    if (state === 'verified') {
      return
    }
    updateState('verifying')
    if (popupWatchTimer === null) {
      startPopupWatch()
    }
  }

  // 程序化触发验证（OAuth 启动、passkey、未预验证时的表单提交兜底）：
  // 已通过预验证则直接复用缓存的 captchaVerifyParam；否则弹出验证码等待结果。
  // 用户关闭/未能弹出 resolve null；脚本加载失败 reject。
  const verify = async (): Promise<string | null> => {
    if (state === 'verified' && cachedParam) {
      return cachedParam
    }
    settlePending(null)
    await ensureReady()
    return new Promise<string | null>((resolve) => {
      pending = { resolve }
      document.getElementById(buttonId)?.click()
    })
  }

  // 重置为未验证态；captchaVerifyParam 是一次性参数，服务端校验失败后需用户重新验证
  const reset = (): void => {
    stopPopupWatch()
    settlePending(null)
    cachedParam = null
    updateState('idle')
  }

  const dispose = (): void => {
    stopPopupWatch()
    settlePending(null)
    // SDK 不会自清理弹窗 DOM，残留会导致下次挂载时回调重复触发
    document.getElementById(MASK_ID)?.remove()
    document.getElementById(POPUP_ID)?.remove()
  }

  return { verify, reset, ensureReady, handleTriggerClick, dispose }
}

let uidCounter = 0
function createUid(): string {
  uidCounter += 1
  return `${Math.random().toString(36).slice(2, 10)}${uidCounter}`
}

const AliyunCaptchaWidget = forwardRef<AliyunCaptchaWidgetHandle, AliyunCaptchaWidgetProps>(function AliyunCaptchaWidget(
  { sceneId, prefix, region = 'cn', onVerify, onError },
  ref
) {
  const { t, locale } = useI18n()
  const [ids] = useState(() => {
    const uid = createUid()
    return { buttonId: `aliyun-captcha-button-${uid}`, elementId: `aliyun-captcha-element-${uid}` }
  })
  const [state, setState] = useState<AliyunCaptchaState>('idle')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const latest = useRef<WidgetLatest>({ sceneId, prefix, region, locale, onVerify })
  const onErrorRef = useRef(onError)
  useEffect(() => {
    latest.current = { sceneId, prefix, region, locale, onVerify }
    onErrorRef.current = onError
  })

  const [captcha] = useState(() => createAliyunCaptcha({ ...ids, latest, setState }))

  useImperativeHandle(ref, () => ({ verify: captcha.verify, reset: captcha.reset }), [captcha])

  const enabled = Boolean(sceneId && prefix)
  useEffect(() => {
    if (!enabled) {
      return
    }
    const button = buttonRef.current
    button?.addEventListener('click', captcha.handleTriggerClick)
    captcha.ensureReady().catch((error: unknown) => {
      console.error('Failed to initialize Aliyun captcha:', error)
      onErrorRef.current?.()
    })
    return () => {
      button?.removeEventListener('click', captcha.handleTriggerClick)
      captcha.dispose()
    }
  }, [captcha, enabled])

  if (!enabled) {
    return null
  }

  const buttonText =
    state === 'verified'
      ? t('auth.captchaVerified')
      : state === 'verifying'
        ? t('auth.captchaVerifying')
        : t('auth.captchaClickToVerify')

  return (
    <div className={styles.aliyun}>
      <button
        ref={buttonRef}
        id={ids.buttonId}
        type="button"
        className={styles.aliyunButton}
        data-verified={state === 'verified' || undefined}
        disabled={state === 'verified'}
      >
        {state === 'verified' ? (
          <CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <ShieldCheck size={16} strokeWidth={1.75} aria-hidden="true" />
        )}
        <span>{buttonText}</span>
      </button>
      <div id={ids.elementId} />
    </div>
  )
})

export default AliyunCaptchaWidget
