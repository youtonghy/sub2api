import { apiClient } from '@/api/client'
import { completeLinuxDoOAuthRegistration } from '@/api/auth'
import PendingOAuthCallbackPage, {
  type PendingActionResponse,
  type PendingOAuthCallbackConfig
} from '@/components/auth/PendingOAuthCallbackPage'
import { serializeAdoptionDecision } from '@/components/auth/oauthCallback'
import { oauthAffiliatePayload } from '@/utils/oauthAffiliate'

const linuxDoConfig: PendingOAuthCallbackConfig = {
  provider: 'linuxdo',
  initialProviderName: () => 'LinuxDo',
  labels: (t) => ({
    title: t('auth.linuxdo.callbackTitle'),
    processing: t('auth.linuxdo.callbackProcessing'),
    hint: t('auth.linuxdo.callbackHint'),
    invitationRequired: t('auth.linuxdo.invitationRequired'),
    completing: t('auth.linuxdo.completing'),
    completeRegistration: t('auth.linuxdo.completeRegistration')
  }),
  missingTokenKey: 'auth.linuxdo.callbackMissingToken',
  completeRegistrationFailedKey: 'auth.linuxdo.completeRegistrationFailed',
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
  completeRegistration: async ({ invitationCode, decision, affCode, legacyPendingOAuthToken }) =>
    legacyPendingOAuthToken
      ? (
          await apiClient.post<PendingActionResponse>('/auth/oauth/linuxdo/complete-registration', {
            pending_oauth_token: legacyPendingOAuthToken,
            invitation_code: invitationCode,
            ...oauthAffiliatePayload(affCode),
            ...serializeAdoptionDecision(decision)
          })
        ).data
      : affCode
        ? await completeLinuxDoOAuthRegistration(invitationCode, decision, affCode)
        : await completeLinuxDoOAuthRegistration(invitationCode, decision)
}

export default function LinuxDoCallbackView() {
  return <PendingOAuthCallbackPage config={linuxDoConfig} />
}
