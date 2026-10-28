import { apiClient } from '@/api/client'
import { completeOIDCOAuthRegistration, getPublicSettings } from '@/api/auth'
import PendingOAuthCallbackPage, {
  type PendingActionResponse,
  type PendingOAuthCallbackConfig
} from '@/components/auth/PendingOAuthCallbackPage'
import { serializeAdoptionDecision } from '@/components/auth/oauthCallback'
import { oauthAffiliatePayload } from '@/utils/oauthAffiliate'

const oidcConfig: PendingOAuthCallbackConfig = {
  provider: 'oidc',
  initialProviderName: () => 'OIDC',
  loadProviderName: async () => {
    const settings = await getPublicSettings()
    return settings.oidc_oauth_provider_name?.trim() || undefined
  },
  labels: (t, providerName) => ({
    title: t('auth.oidc.callbackTitle', { providerName }),
    processing: t('auth.oidc.callbackProcessing', { providerName }),
    hint: t('auth.oidc.callbackHint'),
    invitationRequired: t('auth.oidc.invitationRequired', { providerName }),
    completing: t('auth.oidc.completing'),
    completeRegistration: t('auth.oidc.completeRegistration')
  }),
  missingTokenKey: 'auth.oidc.callbackMissingToken',
  completeRegistrationFailedKey: 'auth.oidc.completeRegistrationFailed',
  bindLoginStates: [
    'bind_login_required',
    'bind_login',
    'existing_account_binding_required',
    'existing_account_required',
    'adopt_existing_user_by_email'
  ],
  extractPendingAccountEmail: (completion) =>
    (
      completion.pending_email ||
      completion.existing_account_email ||
      completion.compat_email ||
      completion.resolved_email ||
      completion.email ||
      completion.suggested_email ||
      ''
    ).trim(),
  completeRegistration: async ({ invitationCode, decision, affCode, legacyPendingOAuthToken }) =>
    legacyPendingOAuthToken
      ? (
          await apiClient.post<PendingActionResponse>('/auth/oauth/oidc/complete-registration', {
            pending_oauth_token: legacyPendingOAuthToken,
            invitation_code: invitationCode,
            ...oauthAffiliatePayload(affCode),
            ...serializeAdoptionDecision(decision)
          })
        ).data
      : affCode
        ? await completeOIDCOAuthRegistration(invitationCode, decision, affCode)
        : await completeOIDCOAuthRegistration(invitationCode, decision)
}

export default function OidcCallbackView() {
  return <PendingOAuthCallbackPage config={oidcConfig} />
}
