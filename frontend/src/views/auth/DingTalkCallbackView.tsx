import { apiClient } from '@/api/client'
import PendingOAuthCallbackPage, {
  type PendingActionResponse,
  type PendingOAuthCallbackConfig
} from '@/components/auth/PendingOAuthCallbackPage'
import { serializeAdoptionDecision } from '@/components/auth/oauthCallback'
import { oauthAffiliatePayload } from '@/utils/oauthAffiliate'

const dingTalkConfig: PendingOAuthCallbackConfig = {
  provider: 'dingtalk',
  initialProviderName: (t) => t('auth.dingtalkProviderName'),
  labels: (t) => ({
    title: t('auth.dingtalk.callbackTitle'),
    processing: t('auth.dingtalk.callbackProcessing'),
    hint: t('auth.dingtalk.callbackHint'),
    invitationRequired: t('auth.dingtalk.invitationRequired'),
    completing: t('auth.dingtalk.completing'),
    completeRegistration: t('auth.dingtalk.completeRegistration')
  }),
  missingTokenKey: 'auth.dingtalk.callbackMissingToken',
  completeRegistrationFailedKey: 'auth.dingtalk.completeRegistrationFailed',
  bindLoginStates: [
    'bind_login_required',
    'bind_login',
    'existing_account',
    'existing_account_required',
    'existing_account_binding_required',
    'adopt_existing_user_by_email'
  ],
  extractPendingAccountEmail: (completion) =>
    (
      completion.pending_email ||
      completion.existing_account_email ||
      completion.email ||
      completion.resolved_email ||
      completion.suggested_email ||
      ''
    ).trim(),
  completeRegistration: async ({ invitationCode, decision, affCode, legacyPendingOAuthToken }) => {
    const { data } = await apiClient.post<PendingActionResponse>('/auth/oauth/dingtalk/complete-registration', {
      pending_oauth_token: legacyPendingOAuthToken || undefined,
      invitation_code: invitationCode,
      ...oauthAffiliatePayload(affCode),
      ...serializeAdoptionDecision(decision)
    })
    return data
  },
  fragmentErrorMessage: (error, errorDescription, { t, te }) => {
    const i18nKey = `auth.dingtalk.error.${error}`
    return te(i18nKey) ? t(i18nKey) : (errorDescription || error)
  },
  emailCompletion: true
}

export default function DingTalkCallbackView() {
  return <PendingOAuthCallbackPage config={dingTalkConfig} />
}
