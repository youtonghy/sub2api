/**
 * 腾讯天御验证码（动作触发式）。国内站弹窗，国际站在容器内展示 Robot checkbox。
 * SDK 脚本地址由 utils/tencentCaptcha 按站点成对管理，与 Vue 版一致。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react'

import { useI18n } from '@/i18n/useI18n'
import {
  loadTencentCaptcha,
  normalizeTencentCaptchaRegion,
  type TencentCaptchaProof,
  type TencentCaptchaResult
} from '@/utils/tencentCaptcha'
import styles from './captcha.module.css'

export interface TencentCaptchaGateProps {
  appId: string
  region?: string
}

export interface TencentCaptchaGateHandle {
  verify: () => Promise<TencentCaptchaProof | null>
  reset: (reinitialize?: boolean) => void
}

// 腾讯国际站票据官方有效期为 5 分钟，提前 1 分钟放弃缓存，避免提交时刚好过期。
const cachedProofMaxAgeMs = 4 * 60 * 1000

const visibleClass = styles.intlVisible
const hiddenClass = styles.intlHidden

/** 对应 Vue 的 nextTick；容器可见性是同步写入 DOM 的，这里只需让出一个微任务 */
function nextTick(): Promise<void> {
  return Promise.resolve()
}

interface GateLatest {
  appId: string
  region: string
  locale: string
  isInternational: boolean
}

interface GateOptions {
  containerRef: RefObject<HTMLDivElement | null>
  latest: RefObject<GateLatest>
  setContainerVisible: (visible: boolean) => void
}

/** 与 Vue 版组件内的模块级变量和函数一一对应，每个组件实例一份 */
function createTencentGate(options: GateOptions) {
  const s = {
    instance: null as { show(): void; destroy(): void } | null,
    pending: null as Promise<TencentCaptchaProof | null> | null,
    cancelPending: null as (() => void) | null,
    cachedProof: null as TencentCaptchaProof | null,
    cachedProofCreatedAt: 0,
    isMounted: false
  }

  const createVerificationPromise = (revealInternational: boolean = true): Promise<TencentCaptchaProof | null> => {
    return new Promise((resolve, reject) => {
      let settled = false

      const finish = (callback: () => void, keepInternationalContainer: boolean = false): void => {
        if (settled) return
        settled = true
        if (s.cancelPending === cancel) s.cancelPending = null
        if (!keepInternationalContainer) {
          s.instance?.destroy()
          s.instance = null
          options.setContainerVisible(false)
        }
        callback()
      }
      const cancel = (): void => finish(() => resolve(null))

      s.cancelPending = cancel
      const currentRegion = normalizeTencentCaptchaRegion(options.latest.current.region)
      if (currentRegion === 'intl' && revealInternational) {
        options.setContainerVisible(true)
      }

      void nextTick()
        .then(() => loadTencentCaptcha(currentRegion))
        .then((TencentCaptcha) => {
          if (s.cancelPending !== cancel) return

          const userLanguage = options.latest.current.locale.toLowerCase().startsWith('zh') ? 'zh-cn' : 'en'
          const handleResult = (result: TencentCaptchaResult): void => {
            if (result.ret === 2) {
              finish(() => resolve(null))
              return
            }

            const ticket = result.ticket?.trim() || ''
            const randstr = result.randstr?.trim() || ''
            if (!ticket || !randstr || ticket.startsWith('trerror_') || result.errorCode !== undefined) {
              finish(() => reject(new Error('Tencent Captcha verification failed')))
              return
            }

            // 国际站保留已勾选的控件，避免成功回调后页面出现跳动；登录流程结束时由 reset 清理。
            finish(() => resolve({ ticket, randstr }), currentRegion === 'intl')
          }

          if (currentRegion === 'intl') {
            // 新版国际站先在指定容器内展示 Robot checkbox，用户点击后才弹出挑战。
            // document.body 会把 checkbox 追加到整个页面末尾，在登录页上通常落到视口外，
            // 表现为 SDK 已成功初始化但页面没有任何可见组件。
            const container = options.containerRef.current
            if (!container) {
              throw new Error('Tencent Captcha international container is unavailable')
            }
            s.instance = new TencentCaptcha(container, options.latest.current.appId, handleResult, {
              // 国际站与国内站保持一致：页面加载后显示 Robot checkbox，由用户主动确认。
              enableAutoCheck: false,
              userLanguage,
              type: 'popup'
            })
          } else {
            s.instance = new TencentCaptcha(options.latest.current.appId, handleResult, { userLanguage })
          }
          s.instance.show()
        })
        .catch((error: unknown) => finish(() => reject(error)))
    })
  }

  const reset = (reinitialize: boolean = true): void => {
    s.instance?.destroy()
    s.instance = null
    s.cancelPending?.()
    s.cancelPending = null
    s.pending = null
    s.cachedProof = null
    s.cachedProofCreatedAt = 0
    options.setContainerVisible(options.latest.current.isInternational)

    // 国际站的票据一次性使用，登录失败后需要立即创建新的 checkbox，
    // 不能等下一次点击登录才重新初始化。卸载阶段不再启动预加载。
    if (reinitialize && s.isMounted && options.latest.current.isInternational) {
      void nextTick().then(() => {
        if (s.isMounted) preload()
      })
    }
  }

  const verify = (): Promise<TencentCaptchaProof | null> => {
    if (s.cachedProof) {
      if (Date.now() - s.cachedProofCreatedAt >= cachedProofMaxAgeMs) {
        // 过期票据不能再次提交；先同步销毁旧实例，再在本次调用中创建新验证。
        reset(false)
      } else {
        const proof = s.cachedProof
        s.cachedProof = null
        s.cachedProofCreatedAt = 0
        // 预加载 promise 已经完成，消费缓存时同步清除引用，避免同一票据被并发复用。
        s.pending = null
        return Promise.resolve(proof)
      }
    }

    if (s.pending) {
      const verification = s.pending
      options.setContainerVisible(true)
      // 预加载阶段可能因容器不可见而被 SDK 延迟绘制，提交时在容器显示后重新触发同一个实例。
      void nextTick().then(() => {
        if (s.pending === verification) s.instance?.show()
      })
      return verification.then((proof) => {
        if (s.cachedProof === proof) {
          s.cachedProof = null
          s.cachedProofCreatedAt = 0
        }
        return proof
      })
    }

    options.setContainerVisible(true)
    const verification = createVerificationPromise(true)
    s.pending = verification
    void verification.then(
      () => {
        if (s.pending === verification) s.pending = null
      },
      () => {
        if (s.pending === verification) s.pending = null
      }
    )
    return verification
  }

  const preload = (): void => {
    if (!options.latest.current.isInternational || s.pending || s.cachedProof) return

    // 国际站要求首屏直接展示 checkbox，避免用户点击登录后才看到验证码。
    const verification = createVerificationPromise(true)
    s.pending = verification
    void verification
      .then((proof) => {
        if (proof) {
          s.cachedProof = proof
          s.cachedProofCreatedAt = Date.now()
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (s.pending === verification) s.pending = null
      })
  }

  const setMounted = (mounted: boolean) => {
    s.isMounted = mounted
  }

  return { verify, preload, reset, setMounted }
}

const TencentCaptchaGate = forwardRef<TencentCaptchaGateHandle, TencentCaptchaGateProps>(function TencentCaptchaGate(
  { appId, region = 'cn' },
  ref
) {
  const { locale } = useI18n()
  const isInternational = normalizeTencentCaptchaRegion(region) === 'intl'
  const containerRef = useRef<HTMLDivElement | null>(null)
  const latest = useRef<GateLatest>({ appId, region, locale, isInternational })
  useEffect(() => {
    latest.current = { appId, region, locale, isInternational }
  })

  // 容器可见性直接写 DOM：SDK 初始化前容器必须已经可见，等同于 Vue 的 nextTick 之后
  const [gate] = useState(() => createTencentGate({
    containerRef,
    latest,
    setContainerVisible: (visible) => {
      if (containerRef.current) {
        containerRef.current.className = visible ? visibleClass : hiddenClass
      }
    }
  }))

  useImperativeHandle(ref, () => ({
    verify: gate.verify,
    reset: gate.reset
  }), [gate])

  useEffect(() => {
    gate.setMounted(true)
    gate.preload()
    return () => {
      gate.setMounted(false)
      gate.reset()
    }
  }, [gate])

  if (!isInternational) {
    return null
  }

  return (
    <div
      ref={containerRef}
      data-testid="tencent-captcha-international-container"
      className={visibleClass}
    />
  )
})

export default TencentCaptchaGate
