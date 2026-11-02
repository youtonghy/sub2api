/**
 * 登录、注册、找回密码等表单共用的验证码设置与登录协议状态。
 * Vue 版在每个页面里各写一份，这里只是搬到一处，行为不变。
 */
import { useCallback, useRef, useState } from 'react'

import type { CaptchaChallengeProps } from '@/components/captcha/CaptchaChallenge'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { LoginAgreementDocument, PublicSettings } from '@/types'

export const LOGIN_AGREEMENT_STORAGE_KEY = 'sub2api_login_agreement_consent'

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface CaptchaSettings {
  turnstileEnabled: boolean
  turnstileSiteKey: string
  tencentCaptchaEnabled: boolean
  tencentCaptchaAppId: string
  tencentCaptchaRegion: string
  aliyunCaptchaEnabled: boolean
  aliyunCaptchaSceneId: string
  aliyunCaptchaPrefix: string
  aliyunCaptchaRegion: string
}

export const EMPTY_CAPTCHA_SETTINGS: CaptchaSettings = {
  turnstileEnabled: false,
  turnstileSiteKey: '',
  tencentCaptchaEnabled: false,
  tencentCaptchaAppId: '',
  tencentCaptchaRegion: 'cn',
  aliyunCaptchaEnabled: false,
  aliyunCaptchaSceneId: '',
  aliyunCaptchaPrefix: '',
  aliyunCaptchaRegion: 'cn'
}

export function readCaptchaSettings(settings: PublicSettings): CaptchaSettings {
  return {
    turnstileEnabled: settings.turnstile_enabled,
    turnstileSiteKey: settings.turnstile_site_key || '',
    tencentCaptchaEnabled: settings.tencent_captcha_enabled === true,
    tencentCaptchaAppId: settings.tencent_captcha_app_id || '',
    tencentCaptchaRegion: settings.tencent_captcha_region || 'cn',
    aliyunCaptchaEnabled: settings.aliyun_captcha_enabled === true,
    aliyunCaptchaSceneId: settings.aliyun_captcha_scene_id || '',
    aliyunCaptchaPrefix: settings.aliyun_captcha_prefix || '',
    aliyunCaptchaRegion: settings.aliyun_captcha_region || 'cn'
  }
}

export function captchaFlags(captcha: CaptchaSettings) {
  const aliyunCaptchaReady =
    captcha.aliyunCaptchaEnabled && Boolean(captcha.aliyunCaptchaSceneId) && Boolean(captcha.aliyunCaptchaPrefix)
  // 动作触发式验证码（腾讯/阿里云）：提交、OAuth 启动等动作时弹窗验证
  const actionCaptchaEnabled =
    (captcha.tencentCaptchaEnabled && Boolean(captcha.tencentCaptchaAppId)) || aliyunCaptchaReady
  const captchaEnabled = (captcha.turnstileEnabled && Boolean(captcha.turnstileSiteKey)) || actionCaptchaEnabled
  return { actionCaptchaEnabled, captchaEnabled }
}

export function captchaChallengeProps(
  captcha: CaptchaSettings
): Pick<CaptchaChallengeProps,
  'turnstileEnabled' | 'turnstileSiteKey' | 'tencentEnabled' | 'tencentAppId' | 'tencentRegion' |
  'aliyunEnabled' | 'aliyunSceneId' | 'aliyunPrefix' | 'aliyunRegion'> {
  return {
    turnstileEnabled: captcha.turnstileEnabled,
    turnstileSiteKey: captcha.turnstileSiteKey,
    tencentEnabled: captcha.tencentCaptchaEnabled,
    tencentAppId: captcha.tencentCaptchaAppId,
    tencentRegion: captcha.tencentCaptchaRegion,
    aliyunEnabled: captcha.aliyunCaptchaEnabled,
    aliyunSceneId: captcha.aliyunCaptchaSceneId,
    aliyunPrefix: captcha.aliyunCaptchaPrefix,
    aliyunRegion: captcha.aliyunCaptchaRegion
  }
}

/**
 * 验证码票据：state 驱动按钮禁用，ref 让同一个处理函数在 await 之后立刻读到刚写入的值（等同 Vue ref）。
 */
export function useCaptchaProof() {
  const proof = useRef({ token: '', randstr: '' })
  const [token, setToken] = useState('')
  const setProof = useCallback((nextToken: string, randstr: string = '') => {
    proof.current = { token: nextToken, randstr }
    setToken(nextToken)
  }, [])
  return { token, proof, setProof }
}

type AgreementSettings = {
  login_agreement_enabled?: boolean
  login_agreement_mode?: string
  login_agreement_updated_at?: string
  login_agreement_revision?: string
  login_agreement_documents?: LoginAgreementDocument[]
}

interface AgreementState {
  enabled: boolean
  mode: 'modal' | 'checkbox'
  updatedAt: string
  revision: string
  documents: LoginAgreementDocument[]
  accepted: boolean
  showModal: boolean
}

function hasAcceptedLoginAgreement(revision: string): boolean {
  if (!revision) {
    return false
  }
  try {
    const raw = localStorage.getItem(LOGIN_AGREEMENT_STORAGE_KEY)
    if (!raw) {
      return false
    }
    const parsed = JSON.parse(raw) as { revision?: string }
    return parsed.revision === revision
  } catch {
    return false
  }
}

/** 登录协议同意状态；同意记录按协议修订号存在 localStorage，键名与 Vue 版相同 */
export function useLoginAgreement(rejectedWarningKey: string) {
  const { t } = useI18n()
  const [agreement, setAgreement] = useState<AgreementState>({
    enabled: false,
    mode: 'modal',
    updatedAt: '',
    revision: '',
    documents: [],
    accepted: false,
    showModal: false
  })

  const apply = useCallback((settings: AgreementSettings) => {
    const documents = Array.isArray(settings.login_agreement_documents)
      ? settings.login_agreement_documents.filter((doc) => doc.title?.trim())
      : []
    const enabled = settings.login_agreement_enabled === true && documents.length > 0
    const mode = settings.login_agreement_mode === 'checkbox' ? 'checkbox' : 'modal'
    const updatedAt = settings.login_agreement_updated_at || ''
    const revision =
      settings.login_agreement_revision ||
      `${updatedAt}:${documents.map((doc) => `${doc.id}:${doc.title}`).join('|')}`
    const accepted = !enabled || hasAcceptedLoginAgreement(revision)
    setAgreement({
      enabled,
      mode,
      updatedAt,
      revision,
      documents,
      accepted,
      showModal: enabled && !accepted && mode !== 'checkbox'
    })
  }, [])

  /** 公开设置加载失败时放行 */
  const disable = useCallback(() => {
    setAgreement((current) => ({ ...current, enabled: false, accepted: true }))
  }, [])

  const accept = () => {
    if (agreement.revision) {
      localStorage.setItem(
        LOGIN_AGREEMENT_STORAGE_KEY,
        JSON.stringify({
          revision: agreement.revision,
          accepted_at: new Date().toISOString()
        })
      )
    }
    setAgreement((current) => ({ ...current, accepted: true, showModal: false }))
  }

  const reject = () => {
    localStorage.removeItem(LOGIN_AGREEMENT_STORAGE_KEY)
    setAgreement((current) => ({ ...current, accepted: false, showModal: false }))
    useAppStore.getState().showWarning(t(rejectedWarningKey))
  }

  const setShowModal = useCallback((showModal: boolean) => {
    setAgreement((current) => ({ ...current, showModal }))
  }, [])

  const gateActive = agreement.enabled && !agreement.accepted

  return { agreement, gateActive, apply, disable, accept, reject, setShowModal }
}
