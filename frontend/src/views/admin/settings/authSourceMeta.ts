/** 认证来源默认值的展示元数据（来自 Vue 版 authSourceDefaultsMeta） */
import type { AuthSourceType } from '@/api/admin/settings'
import type { LocalText } from './settingsHelpers'

export interface AuthSourceMeta {
  source: AuthSourceType
  title: string
  description: string
}

export function authSourceDefaultsMeta(t: (key: string) => string, localText: LocalText): AuthSourceMeta[] {
  return [
    {
      source: 'email',
      title: t('admin.settings.authSourceDefaults.sources.email.title'),
      description: t('admin.settings.authSourceDefaults.sources.email.description')
    },
    {
      source: 'linuxdo',
      title: t('admin.settings.authSourceDefaults.sources.linuxdo.title'),
      description: t('admin.settings.authSourceDefaults.sources.linuxdo.description')
    },
    {
      source: 'oidc',
      title: t('admin.settings.authSourceDefaults.sources.oidc.title'),
      description: t('admin.settings.authSourceDefaults.sources.oidc.description')
    },
    {
      source: 'wechat',
      title: t('admin.settings.authSourceDefaults.sources.wechat.title'),
      description: t('admin.settings.authSourceDefaults.sources.wechat.description')
    },
    {
      source: 'github',
      title: 'GitHub',
      description: localText(
        '通过 GitHub 已验证邮箱首次注册或首次绑定时应用。',
        'Applied on first signup or first bind through a verified GitHub email.'
      )
    },
    {
      source: 'google',
      title: 'Google',
      description: localText(
        '通过 Google 已验证邮箱首次注册或首次绑定时应用。',
        'Applied on first signup or first bind through a verified Google email.'
      )
    },
    {
      source: 'dingtalk',
      title: t('auth.dingtalkProviderName'),
      description: localText('通过钉钉首次注册或首次绑定时应用。', 'Applied on first signup or first bind through DingTalk.')
    }
  ]
}
