/**
 * Step-up (sudo) 2FA hook，对应 Vue 版 composables/useStepUp.ts。
 *
 * Wraps a sensitive admin action so that when the backend responds with a
 * STEP_UP_REQUIRED error, the caller can prompt for a TOTP code, obtain a
 * short-lived grant, and transparently retry the original action.
 *
 * Usage in a view:
 *   const stepUp = useStepUp()
 *   async function exportData() {
 *     await stepUp.run(() => adminAPI.accounts.exportData(...))
 *   }
 *   // JSX: <TotpStepUpDialog controller={stepUp} />
 *
 * 与 Vue 版的差异：状态放在与框架无关的 createStepUpController 中（可在组件外单测），
 * useStepUp 通过 useSyncExternalStore 订阅；Vue 版的 visible.value / blockedReason.value
 * 变为 visible / blockedReason 字段（渲染期快照）与 isVisible() / getBlockedReason()（即时值）。
 */
import { useState, useSyncExternalStore } from 'react'

/** Error codes the backend uses to signal step-up state. */
const STEP_UP_REQUIRED = 'STEP_UP_REQUIRED'
const STEP_UP_TOTP_NOT_ENABLED = 'STEP_UP_TOTP_NOT_ENABLED'
const STEP_UP_ADMIN_API_KEY_FORBIDDEN = 'STEP_UP_ADMIN_API_KEY_FORBIDDEN'

/**
 * Thrown by run() when the user dismisses the TOTP dialog.
 * Callers should treat it as a silent no-op, not an error to toast.
 */
export class StepUpCancelledError extends Error {
  readonly code = 'STEP_UP_CANCELLED'
  constructor() {
    super('step-up verification cancelled by user')
    this.name = 'StepUpCancelledError'
  }
}

export function isStepUpCancelled(err: unknown): boolean {
  return err instanceof StepUpCancelledError
}

interface ApiError {
  status?: number
  code?: string | number
  reason?: string
  message?: string
}

/** Extract the semantic error marker from either envelope shape (code or reason). */
function markerOf(err: unknown): string {
  const e = (err ?? {}) as ApiError
  const candidates = [e.code, e.reason].map((v) => (typeof v === 'string' ? v : ''))
  return candidates.find((v) => v.startsWith('STEP_UP')) || ''
}

export function isStepUpRequired(err: unknown): boolean {
  return markerOf(err) === STEP_UP_REQUIRED
}

export function isStepUpBlocked(err: unknown): boolean {
  const m = markerOf(err)
  return m === STEP_UP_TOTP_NOT_ENABLED || m === STEP_UP_ADMIN_API_KEY_FORBIDDEN
}

export function stepUpBlockReason(err: unknown): string {
  return markerOf(err)
}

/** 与框架无关的 step-up 控制器：保存弹窗可见性并在验证结束时唤醒等待者 */
export function createStepUpController() {
  let visible = false
  let blockedReason = ''
  let resolver: ((ok: boolean) => void) | null = null
  let pendingPrompt: Promise<boolean> | null = null
  const listeners = new Set<() => void>()

  const notify = () => listeners.forEach((listener) => listener())

  const setVisible = (next: boolean) => {
    if (visible === next) return
    visible = next
    notify()
  }

  function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const isVisible = () => visible
  const getBlockedReason = () => blockedReason

  /** Open the TOTP dialog and resolve true once a grant is obtained. */
  function prompt(): Promise<boolean> {
    if (pendingPrompt) return pendingPrompt
    pendingPrompt = new Promise<boolean>((resolve) => {
      resolver = resolve
    })
    setVisible(true)
    return pendingPrompt
  }

  function onVerified() {
    const resolve = resolver
    resolver = null
    pendingPrompt = null
    setVisible(false)
    resolve?.(true)
  }

  function onCancel() {
    const resolve = resolver
    resolver = null
    pendingPrompt = null
    setVisible(false)
    resolve?.(false)
  }

  /**
   * Run a sensitive action. On STEP_UP_REQUIRED, prompt for a TOTP code and
   * retry once. STEP_UP_TOTP_NOT_ENABLED / admin-api-key errors are surfaced
   * to the caller (they cannot be resolved by entering a code). If the user
   * cancels the prompt, a StepUpCancelledError is thrown so callers can
   * distinguish "user changed their mind" from real failures.
   */
  async function run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    } catch (err) {
      if (isStepUpBlocked(err)) {
        blockedReason = markerOf(err)
        notify()
        throw err
      }
      if (!isStepUpRequired(err)) {
        throw err
      }
      const ok = await prompt()
      if (!ok) {
        throw new StepUpCancelledError()
      }
      // Retry once now that the session holds a step-up grant.
      return await action()
    }
  }

  return { subscribe, isVisible, getBlockedReason, prompt, onVerified, onCancel, run }
}

export type StepUpControllerCore = ReturnType<typeof createStepUpController>

export type StepUpController = StepUpControllerCore & {
  /** 渲染期快照：TOTP 弹窗是否可见 */
  visible: boolean
  /** 渲染期快照：最近一次被阻断的原因标记 */
  blockedReason: string
}

export function useStepUp(): StepUpController {
  const [controller] = useState(createStepUpController)
  const visible = useSyncExternalStore(controller.subscribe, controller.isVisible, controller.isVisible)
  const blockedReason = useSyncExternalStore(
    controller.subscribe,
    controller.getBlockedReason,
    controller.getBlockedReason
  )
  return { ...controller, visible, blockedReason }
}
