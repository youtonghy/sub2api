import { MessageCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

import { isWeChatWebOAuthEnabled } from '@/api/auth'
import ProfileBalanceNotifyCard from '@/components/user/profile/ProfileBalanceNotifyCard'
import ProfileInfoCard from '@/components/user/profile/ProfileInfoCard'
import ProfilePasskeyCard from '@/components/user/profile/ProfilePasskeyCard'
import ProfilePasswordForm from '@/components/user/profile/ProfilePasswordForm'
import ProfileTotpCard from '@/components/user/profile/ProfileTotpCard'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import styles from './ProfileView.module.css'

interface ProfileSettings {
  contactInfo: string
  balanceLowNotifyEnabled: boolean
  systemDefaultThreshold: number
  linuxdoOAuthEnabled: boolean
  dingtalkOAuthEnabled: boolean
  wechatOAuthEnabled: boolean
  wechatOAuthOpenEnabled: boolean | undefined
  wechatOAuthMPEnabled: boolean | undefined
  oidcOAuthEnabled: boolean
  oidcOAuthProviderName: string
  passkeyEnabled: boolean
}

const defaultSettings: ProfileSettings = {
  contactInfo: '',
  balanceLowNotifyEnabled: false,
  systemDefaultThreshold: 0,
  linuxdoOAuthEnabled: false,
  dingtalkOAuthEnabled: false,
  wechatOAuthEnabled: false,
  wechatOAuthOpenEnabled: undefined,
  wechatOAuthMPEnabled: undefined,
  oidcOAuthEnabled: false,
  oidcOAuthProviderName: 'OIDC',
  passkeyEnabled: false
}

/** 个人资料页，对应 Vue 版 ProfileView.vue：单列布局，挂载时刷新用户信息并读取公开设置 */
export default function ProfileView() {
  const { t } = useI18n()
  const user = useAuthStore((s) => s.user)
  const [settings, setSettings] = useState<ProfileSettings>(defaultSettings)

  useEffect(() => {
    let active = true
    useAuthStore
      .getState()
      .refreshUser()
      .catch((error: unknown) => {
        console.error('Failed to refresh profile:', error)
      })

    useAppStore
      .getState()
      .fetchPublicSettings()
      .then((loaded) => {
        if (!loaded || !active) {
          return
        }
        setSettings({
          contactInfo: loaded.contact_info || '',
          balanceLowNotifyEnabled: loaded.balance_low_notify_enabled ?? false,
          systemDefaultThreshold: loaded.balance_low_notify_threshold ?? 0,
          linuxdoOAuthEnabled: loaded.linuxdo_oauth_enabled ?? false,
          dingtalkOAuthEnabled: loaded.dingtalk_oauth_enabled ?? false,
          wechatOAuthEnabled: isWeChatWebOAuthEnabled(loaded),
          wechatOAuthOpenEnabled:
            typeof loaded.wechat_oauth_open_enabled === 'boolean' ? loaded.wechat_oauth_open_enabled : undefined,
          wechatOAuthMPEnabled:
            typeof loaded.wechat_oauth_mp_enabled === 'boolean' ? loaded.wechat_oauth_mp_enabled : undefined,
          oidcOAuthEnabled: loaded.oidc_oauth_enabled ?? false,
          oidcOAuthProviderName: loaded.oidc_oauth_provider_name || 'OIDC',
          passkeyEnabled: loaded.passkey_enabled === true
        })
      })
      .catch((error: unknown) => {
        console.error('Failed to load settings:', error)
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <div data-testid="profile-shell" className={styles.shell}>
      <ProfileInfoCard
        user={user}
        linuxdoEnabled={settings.linuxdoOAuthEnabled}
        dingtalkEnabled={settings.dingtalkOAuthEnabled}
        oidcEnabled={settings.oidcOAuthEnabled}
        oidcProviderName={settings.oidcOAuthProviderName}
        wechatEnabled={settings.wechatOAuthEnabled}
        wechatOpenEnabled={settings.wechatOAuthOpenEnabled}
        wechatMpEnabled={settings.wechatOAuthMPEnabled}
      />

      {settings.contactInfo && (
        <section className={styles.contact}>
          <span className={styles.contactIcon}>
            <MessageCircle size={20} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div>
            <h2 className={styles.contactTitle}>{t('common.contactSupport')}</h2>
            <p className={styles.contactInfo}>{settings.contactInfo}</p>
          </div>
        </section>
      )}

      <ProfilePasswordForm />

      {user && settings.balanceLowNotifyEnabled && (
        <ProfileBalanceNotifyCard
          enabled={user.balance_notify_enabled ?? true}
          threshold={user.balance_notify_threshold}
          extraEmails={user.balance_notify_extra_emails ?? []}
          systemDefaultThreshold={settings.systemDefaultThreshold}
          userEmail={user.email}
        />
      )}

      <ProfileTotpCard />
      <ProfilePasskeyCard enabled={settings.passkeyEnabled} />
    </div>
  )
}
