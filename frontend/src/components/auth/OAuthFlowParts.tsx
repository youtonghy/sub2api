/**
 * 第三方登录回调页的界面片段：资料采用选项、邀请码、选择账户、绑定登录、两步验证。
 * 文案与 data-testid 和 Vue 版模板一致，页面负责状态与请求。
 */
import type { FormEvent, ReactNode } from 'react'

import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { Input } from '@/components/arc/input/input'
import { OtpInput } from '@/components/arc/otp-input/otp-input'
import { PasswordField } from '@/components/arc/password-field/password-field'
import { useI18n } from '@/i18n/useI18n'
import styles from './oauthFlow.module.css'

function submitHandler(handler: () => void) {
  return (event: FormEvent) => {
    event.preventDefault()
    handler()
  }
}

export function OAuthFlowHint({ children }: { children: ReactNode }) {
  return <p className={styles.hint}>{children}</p>
}

/** 带标题与说明的浅色分组，对应 Vue 版的灰底圆角卡片 */
export function OAuthFlowCard({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <p className={styles.cardTitle}>{title}</p>
        <p className={styles.cardDescription}>{description}</p>
      </div>
      {children}
    </div>
  )
}

export interface OAuthProfileAdoptionProps {
  providerName: string
  suggestedDisplayName: string
  suggestedAvatarUrl: string
  adoptDisplayName: boolean
  adoptAvatar: boolean
  onAdoptDisplayNameChange: (value: boolean) => void
  onAdoptAvatarChange: (value: boolean) => void
}

export function OAuthProfileAdoption({
  providerName,
  suggestedDisplayName,
  suggestedAvatarUrl,
  adoptDisplayName,
  adoptAvatar,
  onAdoptDisplayNameChange,
  onAdoptAvatarChange
}: OAuthProfileAdoptionProps) {
  const { t } = useI18n()
  return (
    <OAuthFlowCard
      title={t('auth.oauthFlow.profileDetailsTitle', { providerName })}
      description={t('auth.oauthFlow.profileDetailsDescription', { providerName })}
    >
      {suggestedDisplayName && (
        <div className={styles.option}>
          <Checkbox
            checked={adoptDisplayName}
            onCheckedChange={(checked) => onAdoptDisplayNameChange(checked === true)}
            label={t('auth.oauthFlow.useDisplayName')}
            description={suggestedDisplayName}
          />
        </div>
      )}
      {suggestedAvatarUrl && (
        <div className={styles.option}>
          <Checkbox
            checked={adoptAvatar}
            onCheckedChange={(checked) => onAdoptAvatarChange(checked === true)}
            label={t('auth.oauthFlow.useAvatar')}
            description={suggestedAvatarUrl}
          />
          <img
            src={suggestedAvatarUrl}
            alt={t('auth.oauthFlow.avatarAlt', { providerName })}
            className={styles.avatar}
          />
        </div>
      )}
    </OAuthFlowCard>
  )
}

export interface OAuthInvitationFormProps {
  hint: string
  code: string
  onCodeChange: (value: string) => void
  isSubmitting: boolean
  submitLabel: string
  submittingLabel: string
  onSubmit: () => void
}

export function OAuthInvitationForm({
  hint,
  code,
  onCodeChange,
  isSubmitting,
  submitLabel,
  submittingLabel,
  onSubmit
}: OAuthInvitationFormProps) {
  const { t } = useI18n()
  return (
    <form className={styles.stack} onSubmit={submitHandler(onSubmit)} noValidate>
      <OAuthFlowHint>{hint}</OAuthFlowHint>
      <Input
        label={t('auth.invitationCodeLabel')}
        type="text"
        value={code}
        onChange={(event) => onCodeChange(event.target.value)}
        placeholder={t('auth.invitationCodePlaceholder')}
        disabled={isSubmitting}
      />
      <Button type="submit" className={styles.fullWidth} loading={isSubmitting} disabled={!isSubmitting && !code.trim()}>
        {isSubmitting ? submittingLabel : submitLabel}
      </Button>
    </form>
  )
}

export interface OAuthBindLoginFormProps {
  testIdPrefix: string
  email: string
  password: string
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  isSubmitting: boolean
  onSubmit: () => void
}

export function OAuthBindLoginForm({
  testIdPrefix,
  email,
  password,
  onEmailChange,
  onPasswordChange,
  isSubmitting,
  onSubmit
}: OAuthBindLoginFormProps) {
  const { t } = useI18n()
  return (
    <form className={styles.stack} onSubmit={submitHandler(onSubmit)} noValidate>
      <Input
        label={t('auth.emailLabel')}
        value={email}
        onChange={(event) => onEmailChange(event.target.value)}
        data-testid={`${testIdPrefix}-bind-login-email`}
        type="email"
        autoComplete="email"
        placeholder={t('auth.emailPlaceholder')}
        disabled={isSubmitting}
      />
      <PasswordField
        label={t('auth.passwordLabel')}
        value={password}
        onChange={(event) => onPasswordChange(event.target.value)}
        data-testid={`${testIdPrefix}-bind-login-password`}
        autoComplete="current-password"
        placeholder={t('auth.passwordPlaceholder')}
        disabled={isSubmitting}
        messages={{ showPassword: t('authUi.showPassword'), hidePassword: t('authUi.hidePassword') }}
      />
      <Button
        data-testid={`${testIdPrefix}-bind-login-submit`}
        type="submit"
        className={styles.fullWidth}
        loading={isSubmitting}
        disabled={!isSubmitting && (!email.trim() || !password)}
      >
        {isSubmitting ? t('common.processing') : t('auth.oauthFlow.logInAndBind')}
      </Button>
    </form>
  )
}

export interface OAuthTotpChallengeFormProps {
  testIdPrefix: string
  hint: string
  code: string
  onCodeChange: (value: string) => void
  isSubmitting: boolean
  onSubmit: () => void
}

export function OAuthTotpChallengeForm({ testIdPrefix, hint, code, onCodeChange, isSubmitting, onSubmit }: OAuthTotpChallengeFormProps) {
  const { t } = useI18n()
  return (
    <form className={styles.stack} onSubmit={submitHandler(onSubmit)} noValidate>
      <OAuthFlowHint>{hint}</OAuthFlowHint>
      <div data-testid={`${testIdPrefix}-bind-login-totp`}>
        <OtpInput label={t('profile.totp.loginTitle')} value={code} onChange={onCodeChange} disabled={isSubmitting} autoFocus />
      </div>
      <Button
        data-testid={`${testIdPrefix}-bind-login-totp-submit`}
        type="submit"
        className={styles.fullWidth}
        loading={isSubmitting}
        disabled={!isSubmitting && code.trim().length !== 6}
      >
        {isSubmitting ? t('common.processing') : t('auth.oauthFlow.verifyAndContinue')}
      </Button>
    </form>
  )
}
