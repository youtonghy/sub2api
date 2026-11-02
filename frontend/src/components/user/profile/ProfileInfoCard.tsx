import { Link2 } from 'lucide-react'

import { Badge } from '@/components/arc/badge/badge'
import { useI18n } from '@/i18n/useI18n'
import type { User, UserAuthBindingStatus, UserAuthProvider, UserProfileSourceContext } from '@/types'
import ProfileAvatarCard from './ProfileAvatarCard'
import ProfileEditForm from './ProfileEditForm'
import ProfileIdentityBindingsSection from './ProfileIdentityBindingsSection'
import styles from './ProfileInfoCard.module.css'
import shared from './Profile.module.css'

export interface ProfileInfoCardProps {
  user: User | null
  linuxdoEnabled?: boolean
  dingtalkEnabled?: boolean
  oidcEnabled?: boolean
  oidcProviderName?: string
  wechatEnabled?: boolean
  wechatOpenEnabled?: boolean
  wechatMpEnabled?: boolean
}

function normalizeBindingStatus(binding: boolean | UserAuthBindingStatus | undefined): boolean | null {
  if (typeof binding === 'boolean') {
    return binding
  }
  if (!binding) {
    return null
  }
  if (typeof binding.bound === 'boolean') {
    return binding.bound
  }
  return Boolean(binding.provider_subject || binding.issuer || binding.provider_key)
}

function isEmailBound(user: User | null | undefined): boolean {
  if (typeof user?.email_bound === 'boolean') {
    return user.email_bound
  }
  const nested = user?.auth_bindings?.email ?? user?.identity_bindings?.email
  return normalizeBindingStatus(nested) ?? false
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`
}

function normalizeProvider(value: string): UserAuthProvider | null {
  const normalized = value.trim().toLowerCase()
  if (
    normalized === 'email' ||
    normalized === 'linuxdo' ||
    normalized === 'dingtalk' ||
    normalized === 'wechat' ||
    normalized === 'github' ||
    normalized === 'google'
  ) {
    return normalized
  }
  if (normalized === 'oidc' || normalized.startsWith('oidc:') || normalized.startsWith('oidc/')) {
    return 'oidc'
  }
  return null
}

function readObjectString(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

/** 个人资料概览（头像、身份、余额/并发/注册时间）+ 基础资料与登录方式分区，对应 Vue 版 ProfileInfoCard.vue */
export default function ProfileInfoCard({
  user,
  linuxdoEnabled = false,
  dingtalkEnabled = false,
  oidcEnabled = false,
  oidcProviderName = 'OIDC',
  wechatEnabled = false,
  wechatOpenEnabled,
  wechatMpEnabled
}: ProfileInfoCardProps) {
  const { t } = useI18n()

  const avatarUrl = user?.avatar_url?.trim() || ''
  const displayName = user?.username?.trim() || user?.email?.trim() || t('profile.user')
  const rawEmail = user?.email?.trim() || ''
  const primaryEmailDisplay = rawEmail && !(rawEmail.endsWith('.invalid') && !isEmailBound(user)) ? rawEmail : ''
  const avatarInitial = displayName.charAt(0).toUpperCase() || 'U'

  let memberSinceLabel = '-'
  const rawCreated = user?.created_at?.trim()
  if (rawCreated) {
    const date = new Date(rawCreated)
    if (!Number.isNaN(date.getTime())) {
      memberSinceLabel = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short' }).format(date)
    }
  }

  const providerLabels: Record<UserAuthProvider, string> = {
    email: t('profile.authBindings.providers.email'),
    linuxdo: t('profile.authBindings.providers.linuxdo'),
    dingtalk: t('profile.authBindings.providers.dingtalk'),
    oidc: t('profile.authBindings.providers.oidc', { providerName: oidcProviderName }),
    wechat: t('profile.authBindings.providers.wechat'),
    github: 'GitHub',
    google: 'Google'
  }

  function resolveThirdPartySource(
    rawSource: string | UserProfileSourceContext | null | undefined
  ): { provider: UserAuthProvider; label: string } | null {
    if (!rawSource) {
      return null
    }
    if (typeof rawSource === 'string') {
      const provider = normalizeProvider(rawSource)
      if (!provider || provider === 'email') {
        return null
      }
      return { provider, label: providerLabels[provider] }
    }

    const sourceRecord = rawSource as Record<string, unknown>
    const provider = normalizeProvider(readObjectString(sourceRecord, 'provider', 'source', 'provider_type', 'auth_provider'))
    if (!provider || provider === 'email') {
      return null
    }
    const explicitLabel = readObjectString(sourceRecord, 'provider_label', 'label', 'provider_name', 'providerName')
    return { provider, label: explicitLabel || providerLabels[provider] }
  }

  const sourceHints: Array<{ key: string; text: string }> = []
  if (user) {
    const avatarSource = resolveThirdPartySource(user.profile_sources?.avatar ?? user.avatar_source)
    const usernameSource = resolveThirdPartySource(
      user.profile_sources?.username ??
        user.profile_sources?.display_name ??
        user.profile_sources?.nickname ??
        user.display_name_source ??
        user.username_source ??
        user.nickname_source
    )
    if (avatarSource) {
      sourceHints.push({ key: 'avatar', text: t('profile.authBindings.source.avatar', { providerName: avatarSource.label }) })
    }
    if (usernameSource) {
      sourceHints.push({
        key: 'username',
        text: t('profile.authBindings.source.username', { providerName: usernameSource.label })
      })
    }
  }

  return (
    <div className={styles.root}>
      <section data-testid="profile-overview-hero" className={shared.panel}>
        <div className={styles.hero}>
          <div className={shared.avatarBox} style={{ width: 80, height: 80, fontSize: 24 }}>
            {avatarUrl ? <img src={avatarUrl} alt={displayName} /> : <span>{avatarInitial}</span>}
          </div>

          <div className={styles.heroBody}>
            <div className={styles.identity}>
              <div className={styles.nameRow}>
                <h2 className={styles.name}>{displayName}</h2>
                <Badge size="sm" tone={user?.role === 'admin' ? 'info' : 'neutral'}>
                  {user?.role === 'admin' ? t('profile.administrator') : t('profile.user')}
                </Badge>
                <Badge size="sm" tone={user?.status === 'active' ? 'success' : 'danger'}>
                  {user?.status === 'active' ? t('common.active') : t('common.disabled')}
                </Badge>
              </div>
              <p className={styles.email}>{primaryEmailDisplay}</p>
              {sourceHints.length > 0 && (
                <div className={styles.hints}>
                  {sourceHints.map((hint) => (
                    <span key={hint.key} className={styles.hint}>
                      <Link2 size={14} strokeWidth={1.75} aria-hidden="true" />
                      {hint.text}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.metrics}>
              <div data-testid="profile-overview-metric-balance" className={styles.metric}>
                <p className={styles.metricLabel}>{t('profile.accountBalance')}</p>
                <p className={styles.metricValue}>{formatCurrency(user?.balance || 0)}</p>
              </div>
              <div data-testid="profile-overview-metric-concurrency" className={styles.metric}>
                <p className={styles.metricLabel}>{t('profile.concurrencyLimit')}</p>
                <p className={styles.metricValue}>{user?.concurrency || 0}</p>
              </div>
              <div data-testid="profile-overview-metric-member-since" className={styles.metric}>
                <p className={styles.metricLabel}>{t('profile.memberSince')}</p>
                <p className={styles.metricValue}>{memberSinceLabel}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div data-testid="profile-main-column" className={styles.root}>
        <section data-testid="profile-basics-panel" className={shared.panel}>
          <div className={shared.panelHeader}>
            <div>
              <h2 className={shared.panelTitle}>{t('profile.basicsTitle')}</h2>
              <p className={shared.panelDescription}>{t('profile.basicsDescription')}</p>
            </div>
          </div>
          <div className={styles.basicsGrid}>
            <div className={styles.basicsCell}>
              <ProfileAvatarCard user={user} embedded />
            </div>
            <div className={styles.basicsCell}>
              <ProfileEditForm initialUsername={user?.username || ''} embedded />
            </div>
          </div>
        </section>

        <section data-testid="profile-auth-bindings-panel" className={`${shared.panel} ${shared.panelBody}`}>
          <ProfileIdentityBindingsSection
            user={user}
            linuxdoEnabled={linuxdoEnabled}
            dingtalkEnabled={dingtalkEnabled}
            oidcEnabled={oidcEnabled}
            oidcProviderName={oidcProviderName}
            wechatEnabled={wechatEnabled}
            wechatOpenEnabled={wechatOpenEnabled}
            wechatMpEnabled={wechatMpEnabled}
            embedded
            compact
          />
        </section>
      </div>

      <div data-testid="profile-side-column" className={styles.root}>
        {sourceHints.length > 0 && (
          <section className={shared.panel}>
            <div className={shared.panelHeader}>
              <div>
                <h2 className={shared.panelTitle}>{t('profile.linkedProfileSources')}</h2>
                <p className={shared.panelDescription}>{t('profile.linkedProfileSourcesDescription')}</p>
              </div>
            </div>
            <div className={`${shared.panelBody} ${styles.sourceList}`}>
              {sourceHints.map((hint) => (
                <div key={hint.key} className={styles.sourceItem}>
                  <Link2 size={14} strokeWidth={1.75} aria-hidden="true" />
                  <span>{hint.text}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
