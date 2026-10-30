/**
 * 系统设置的加载回填与保存载荷（来自 Vue 版 loadSettings / saveSettings），纯函数：
 * 输入当前草稿与接口返回，输出新的草稿；保存前的校验错误以文案返回，由调用方弹出。
 */
import {
  appendAuthSourceDefaultsToUpdateRequest,
  buildAuthSourceDefaultsState,
  defaultWeChatConnectScopesForMode,
  deriveWeChatConnectStoredMode,
  normalizeAccountSchedulingThresholdsMap,
  normalizeDefaultSubscriptionSettings,
  normalizePlatformQuotasMap,
  resolveWeChatConnectModeCapabilities,
  sanitizeAccountSchedulingThresholdsMap,
  sanitizePlatformQuotasMap,
  type OpenAIFastPolicyRule,
  type SystemSettings,
  type UpdateSettingsRequest,
  type WeChatConnectMode
} from '@/api/admin/settings'
import { normalizeRegistrationEmailSuffixDomains } from '@/utils/registrationEmailPolicy'
import {
  normalizeRechargeBonusMode,
  normalizeRechargeBonusTiers,
  sanitizeRechargeBonusTiersForSubmit
} from '@/utils/rechargeBonus'
import {
  defaultFingerprintSignalRows,
  parseFingerprintSignalsToRows,
  serializeFingerprintRowsToJSON
} from '@/views/admin/codexFingerprintSignals'
import type { AuthSourceMeta } from './authSourceMeta'
import {
  defaultClaudeOAuthSystemPromptBlocks,
  parseClaudeOAuthSystemPromptBlocks,
  serializeClaudeOAuthSystemPromptBlocksToJSON
} from './claudeOAuthBlocks'
import type { SettingsDraft, SettingsForm } from './settingsForm'
import {
  defaultLoginAgreementDocuments,
  findDuplicateDefaultSubscription,
  findDuplicateLoginAgreementDocumentId,
  formatTablePageSizeOptions,
  isValidHttpUrl,
  normalizeForwardedClientIpHeaders,
  normalizeLoginAgreementDocumentsForSave,
  parseCodexEntriesToRows,
  parseTablePageSizeOptionsInput,
  serializeCodexRowsToJSON,
  tablePageSizeMax,
  tablePageSizeMin,
  type LocalText
} from './settingsHelpers'

type Translate = (key: string, params?: Record<string, unknown>) => string

const currentOrigin = typeof window !== 'undefined' ? window.location.origin : ''

function copyRules(rules: OpenAIFastPolicyRule[]): OpenAIFastPolicyRule[] {
  return rules.map((rule) => ({
    ...rule,
    user_ids: rule.user_ids ? [...rule.user_ids] : [],
    model_whitelist: rule.model_whitelist ? [...rule.model_whitelist] : []
  }))
}

/** 把接口值写入表单：只覆盖非 null 字段（null 表示未配置，保留默认值） */
function mergeNonNull(form: SettingsForm, settings: SystemSettings, skip?: string): SettingsForm {
  const next = { ...form } as Record<string, unknown>
  for (const [key, value] of Object.entries(settings)) {
    if (key === skip) continue
    if (value !== null && value !== undefined) next[key] = value
  }
  const merged = next as SettingsForm
  // For this optional override, null explicitly selects per-account rates.
  if (settings.openai_oauth_scheduling_rate_multiplier === null) merged.openai_oauth_scheduling_rate_multiplier = null
  return merged
}

/** 对应 Vue 版 syncWeChatConnectMode：公众号与移动应用互斥，并据能力推导存储模式与 scopes */
export function syncWeChatConnectMode(form: SettingsForm, preferredMode?: WeChatConnectMode): Partial<SettingsForm> {
  let mpEnabled = form.wechat_connect_mp_enabled
  let mobileEnabled = form.wechat_connect_mobile_enabled
  if (mpEnabled && mobileEnabled) {
    if (preferredMode === 'mobile') mpEnabled = false
    else mobileEnabled = false
  }
  const capabilities = resolveWeChatConnectModeCapabilities(
    form.wechat_connect_open_enabled,
    mpEnabled,
    mobileEnabled,
    form.wechat_connect_mode
  )
  const mode = deriveWeChatConnectStoredMode(
    capabilities.openEnabled,
    capabilities.mpEnabled,
    capabilities.mobileEnabled,
    form.wechat_connect_mode
  )
  return {
    wechat_connect_open_enabled: capabilities.openEnabled,
    wechat_connect_mp_enabled: capabilities.mpEnabled,
    wechat_connect_mobile_enabled: capabilities.mobileEnabled,
    wechat_connect_mode: mode,
    wechat_connect_scopes: defaultWeChatConnectScopesForMode(mode)
  }
}

function applyWeChatCapabilities(form: SettingsForm, settings: SystemSettings): void {
  const capabilities = resolveWeChatConnectModeCapabilities(
    settings.wechat_connect_open_enabled,
    settings.wechat_connect_mp_enabled,
    settings.wechat_connect_mobile_enabled,
    settings.wechat_connect_mode
  )
  form.wechat_connect_open_enabled = capabilities.openEnabled
  form.wechat_connect_mp_enabled = capabilities.mpEnabled
  form.wechat_connect_mobile_enabled = capabilities.mobileEnabled
  form.wechat_connect_mode = deriveWeChatConnectStoredMode(
    capabilities.openEnabled,
    capabilities.mpEnabled,
    capabilities.mobileEnabled,
    settings.wechat_connect_mode
  )
}

function clearSecrets(form: SettingsForm, includeTencent: boolean): void {
  form.smtp_password = ''
  form.turnstile_secret_key = ''
  if (includeTencent) {
    form.tencent_captcha_app_secret_key = ''
    form.tencent_captcha_cloud_secret_id = ''
    form.tencent_captcha_cloud_secret_key = ''
  }
  form.aliyun_captcha_access_key_secret = ''
  form.linuxdo_connect_client_secret = ''
  form.dingtalk_connect_client_secret = ''
  form.github_oauth_client_secret = ''
  form.google_oauth_client_secret = ''
  form.wechat_connect_app_secret = ''
  form.wechat_connect_open_app_secret = ''
  form.wechat_connect_mp_app_secret = ''
  form.wechat_connect_mobile_app_secret = ''
}

// bypass_registration 与身份同步三开关仅在 internal_only 模式下生效。切换 policy 到其它值时，
// 立即把相关字段重置为 false，避免保存请求里残留旧值。后端 admin handler 与
// 配置加载层都有 coerce 兜底，这里是 UX 层的同步而非安全防线。
export function dingtalkPolicyPatch(policy: string): Partial<SettingsForm> {
  if (policy === 'internal_only') return {}
  return {
    dingtalk_connect_bypass_registration: false,
    dingtalk_connect_sync_corp_email: false,
    dingtalk_connect_sync_display_name: false,
    dingtalk_connect_sync_dept: false
  }
}

export interface LoadedSettingsResult {
  draft: SettingsDraft
  /** openai_fast_policy_settings 是否真的随响应返回 */
  fastPolicyLoaded: boolean
}

/** 对应 Vue 版 loadSettings 中 getSettings 之后的回填逻辑 */
export function applyLoadedSettings(raw: SystemSettings, prev: SettingsDraft, localText: LocalText): LoadedSettingsResult {
  const settings = { ...raw, payment_load_balance_strategy: raw.payment_load_balance_strategy || 'round-robin' }
  const prevPolicy = prev.form.dingtalk_connect_corp_restriction_policy
  const form = mergeNonNull(prev.form, settings)
  if (!form.claude_oauth_system_prompt_blocks?.trim()) {
    form.claude_oauth_system_prompt_blocks = defaultClaudeOAuthSystemPromptBlocks
  }
  const claudeBlocks = parseClaudeOAuthSystemPromptBlocks(form.claude_oauth_system_prompt_blocks, form.claude_oauth_system_prompt)
  form.claude_oauth_system_prompt_blocks = serializeClaudeOAuthSystemPromptBlocksToJSON(claudeBlocks)
  const codexBlacklistRows = parseCodexEntriesToRows(form.codex_cli_only_blacklist)
  const codexWhitelistRows = parseCodexEntriesToRows(form.codex_cli_only_whitelist)
  const codexFingerprintRows = form.codex_cli_only_engine_fingerprint_signals
    ? parseFingerprintSignalsToRows(form.codex_cli_only_engine_fingerprint_signals)
    : defaultFingerprintSignalRows()
  form.login_agreement_mode = settings.login_agreement_mode === 'checkbox' ? 'checkbox' : 'modal'
  form.channel_monitor_mode = settings.channel_monitor_mode === 'v2' ? 'v2' : 'v1'
  form.channel_monitor_hide_throughput = Boolean(settings.channel_monitor_hide_throughput)
  form.channel_monitor_show_quota = Boolean(settings.channel_monitor_show_quota)
  form.channel_monitor_hide_user_ranking = Boolean(settings.channel_monitor_hide_user_ranking)
  form.login_agreement_updated_at = settings.login_agreement_updated_at || '2026-03-31'
  form.login_agreement_documents =
    Array.isArray(settings.login_agreement_documents) && settings.login_agreement_documents.length > 0
      ? settings.login_agreement_documents.map((doc) => ({
          id: doc.id || '',
          title: doc.title || '',
          content_md: doc.content_md || ''
        }))
      : defaultLoginAgreementDocuments(localText)
  form.payment_recharge_bonus_tiers = normalizeRechargeBonusTiers(settings.payment_recharge_bonus_tiers)
  form.payment_recharge_bonus_mode = normalizeRechargeBonusMode(settings.payment_recharge_bonus_mode)
  form.payment_recharge_bonus_notice = settings.payment_recharge_bonus_notice || ''
  form.default_platform_quotas = normalizePlatformQuotasMap(settings.default_platform_quotas)
  form.account_scheduling_thresholds = normalizeAccountSchedulingThresholdsMap(settings.account_scheduling_thresholds)
  form.backend_mode_enabled = settings.backend_mode_enabled
  form.default_subscriptions = normalizeDefaultSubscriptionSettings(settings.default_subscriptions)
  form.forwarded_client_ip_headers = normalizeForwardedClientIpHeaders(settings.forwarded_client_ip_headers)
  clearSecrets(form, true)
  applyWeChatCapabilities(form, settings)
  const legacyWeChatAppID = String(settings.wechat_connect_app_id || '').trim()
  const legacyWeChatSecretConfigured = Boolean(settings.wechat_connect_app_secret_configured)
  if (!form.wechat_connect_open_app_id && form.wechat_connect_open_enabled) form.wechat_connect_open_app_id = legacyWeChatAppID
  if (!form.wechat_connect_mp_app_id && form.wechat_connect_mp_enabled) form.wechat_connect_mp_app_id = legacyWeChatAppID
  if (!form.wechat_connect_mobile_app_id && form.wechat_connect_mobile_enabled) form.wechat_connect_mobile_app_id = legacyWeChatAppID
  if (!form.wechat_connect_open_app_secret_configured && form.wechat_connect_open_enabled) {
    form.wechat_connect_open_app_secret_configured = legacyWeChatSecretConfigured
  }
  if (!form.wechat_connect_mp_app_secret_configured && form.wechat_connect_mp_enabled) {
    form.wechat_connect_mp_app_secret_configured = legacyWeChatSecretConfigured
  }
  if (!form.wechat_connect_mobile_app_secret_configured && form.wechat_connect_mobile_enabled) {
    form.wechat_connect_mobile_app_secret_configured = legacyWeChatSecretConfigured
  }
  form.wechat_connect_scopes = defaultWeChatConnectScopesForMode(form.wechat_connect_mode)
  form.oidc_connect_client_secret = ''
  // 对应 Vue 版 watch(dingtalk_connect_corp_restriction_policy)
  if (form.dingtalk_connect_corp_restriction_policy !== prevPolicy) {
    Object.assign(form, dingtalkPolicyPatch(form.dingtalk_connect_corp_restriction_policy))
  }

  // Load OpenAI fast/flex policy rules from bulk settings.
  // 仅当 payload 真的包含该字段时填充并标记为已加载；否则保持表单空值，
  // 让 saveSettings 在未加载时跳过该字段，防止覆盖后端默认规则。
  const fastPolicyLoaded = Boolean(
    settings.openai_fast_policy_settings && Array.isArray(settings.openai_fast_policy_settings.rules)
  )

  return {
    fastPolicyLoaded,
    draft: {
      ...prev,
      form,
      authSourceDefaults: buildAuthSourceDefaultsState(settings),
      claudeBlocks,
      codexBlacklistRows,
      codexWhitelistRows,
      codexFingerprintRows,
      registrationEmailSuffixWhitelistTags: normalizeRegistrationEmailSuffixDomains(settings.registration_email_suffix_whitelist),
      tablePageSizeOptionsInput: formatTablePageSizeOptions(
        Array.isArray(settings.table_page_size_options) ? settings.table_page_size_options : [10, 20, 50, 100]
      ),
      openaiFastPolicyRules: fastPolicyLoaded
        ? copyRules(settings.openai_fast_policy_settings!.rules)
        : prev.openaiFastPolicyRules
    }
  }
}

/** 对应 Vue 版 saveSettings 成功后的回填逻辑 */
export function applySavedSettings(updated: SystemSettings, prev: SettingsDraft): LoadedSettingsResult {
  const form = mergeNonNull(prev.form, updated, 'openai_fast_policy_settings')
  form.default_platform_quotas = normalizePlatformQuotasMap(updated.default_platform_quotas)
  form.account_scheduling_thresholds = normalizeAccountSchedulingThresholdsMap(updated.account_scheduling_thresholds)
  form.forwarded_client_ip_headers = normalizeForwardedClientIpHeaders(updated.forwarded_client_ip_headers)
  clearSecrets(form, false)
  applyWeChatCapabilities(form, updated)
  form.wechat_connect_scopes = defaultWeChatConnectScopesForMode(form.wechat_connect_mode)
  form.oidc_connect_client_secret = ''
  // Refresh OpenAI fast/flex policy from server response
  const fastPolicyLoaded = Boolean(
    updated.openai_fast_policy_settings && Array.isArray(updated.openai_fast_policy_settings.rules)
  )
  return {
    fastPolicyLoaded,
    draft: {
      ...prev,
      form,
      authSourceDefaults: buildAuthSourceDefaultsState(updated),
      registrationEmailSuffixWhitelistTags: normalizeRegistrationEmailSuffixDomains(updated.registration_email_suffix_whitelist),
      tablePageSizeOptionsInput: formatTablePageSizeOptions(
        Array.isArray(updated.table_page_size_options) ? updated.table_page_size_options : [10, 20, 50, 100]
      ),
      openaiFastPolicyRules: fastPolicyLoaded ? copyRules(updated.openai_fast_policy_settings!.rules) : prev.openaiFastPolicyRules
    }
  }
}

export type PrepareSaveResult =
  | { ok: false; error: string; draft: SettingsDraft }
  | { ok: true; draft: SettingsDraft; payload: UpdateSettingsRequest }

/**
 * 对应 Vue 版 saveSettings 在调用接口之前的部分：逐项校验并规范化草稿，构造请求载荷。
 * 与 Vue 版一致，校验失败前已规范化的字段也会写回草稿。
 */
export function prepareSettingsSave(
  draft: SettingsDraft,
  options: { t: Translate; localText: LocalText; authSources: AuthSourceMeta[]; fastPolicyLoaded: boolean }
): PrepareSaveResult {
  const { t, localText, authSources, fastPolicyLoaded } = options
  const f: SettingsForm = { ...draft.form }
  const authSourceDefaults = { ...draft.authSourceDefaults }
  const result = (error: string): PrepareSaveResult => ({ ok: false, error, draft: { ...draft, form: f, authSourceDefaults } })

  const normalizedTableDefaultPageSize = Math.floor(Number(f.table_default_page_size))
  if (
    !Number.isInteger(normalizedTableDefaultPageSize) ||
    normalizedTableDefaultPageSize < tablePageSizeMin ||
    normalizedTableDefaultPageSize > tablePageSizeMax
  ) {
    return result(t('admin.settings.site.tableDefaultPageSizeRangeError', { min: tablePageSizeMin, max: tablePageSizeMax }))
  }

  const normalizedTablePageSizeOptions = parseTablePageSizeOptionsInput(draft.tablePageSizeOptionsInput)
  if (!normalizedTablePageSizeOptions) {
    return result(t('admin.settings.site.tablePageSizeOptionsFormatError', { min: tablePageSizeMin, max: tablePageSizeMax }))
  }

  f.table_default_page_size = normalizedTableDefaultPageSize
  f.table_page_size_options = normalizedTablePageSizeOptions

  const normalizedLoginAgreementDocuments = normalizeLoginAgreementDocumentsForSave(f.login_agreement_documents)
  if (f.login_agreement_enabled && normalizedLoginAgreementDocuments.length === 0) {
    return result(localText('启用登录条款确认时，至少需要保留一份文档。', 'At least one document is required when login agreement is enabled.'))
  }
  if (normalizedLoginAgreementDocuments.find((doc) => !doc.title)) {
    return result(localText('登录条款文档名称不能为空。', 'Login agreement document title cannot be empty.'))
  }
  const duplicateLoginAgreementDocumentId = findDuplicateLoginAgreementDocumentId(normalizedLoginAgreementDocuments)
  if (duplicateLoginAgreementDocumentId) {
    return result(
      localText(
        `登录条款文档路由不能重复：/legal/${duplicateLoginAgreementDocumentId}`,
        `Login agreement document routes cannot be duplicated: /legal/${duplicateLoginAgreementDocumentId}`
      )
    )
  }
  f.login_agreement_mode = f.login_agreement_mode === 'checkbox' ? 'checkbox' : 'modal'
  f.login_agreement_documents = normalizedLoginAgreementDocuments
  f.forwarded_client_ip_headers = normalizeForwardedClientIpHeaders(f.forwarded_client_ip_headers)

  const normalizedDefaultSubscriptions = normalizeDefaultSubscriptionSettings(f.default_subscriptions)
  const duplicateDefaultSubscription = findDuplicateDefaultSubscription(normalizedDefaultSubscriptions)
  if (duplicateDefaultSubscription) {
    return result(t('admin.settings.defaults.defaultSubscriptionsDuplicate', { groupId: duplicateDefaultSubscription.group_id }))
  }

  for (const authSource of authSources) {
    const subscriptions = normalizeDefaultSubscriptionSettings(authSourceDefaults[authSource.source].subscriptions)
    authSourceDefaults[authSource.source] = { ...authSourceDefaults[authSource.source], subscriptions }
    const duplicate = findDuplicateDefaultSubscription(subscriptions)
    if (duplicate) {
      return result(`${authSource.title}: ${t('admin.settings.defaults.defaultSubscriptionsDuplicate', { groupId: duplicate.group_id })}`)
    }
  }

  if (f.wechat_connect_mp_enabled && f.wechat_connect_mobile_enabled) {
    return result(localText('公众号和移动应用不能同时启用。', 'Official Account and Mobile App cannot be enabled at the same time.'))
  }
  // Validate URL fields — novalidate disables browser-native checks, so we validate here
  // Optional URL fields: auto-clear invalid values so they don't cause backend 400 errors
  if (!isValidHttpUrl(f.frontend_url)) f.frontend_url = ''
  if (!isValidHttpUrl(f.doc_url)) f.doc_url = ''
  Object.assign(f, syncWeChatConnectMode(f))
  const wechatStoredMode = deriveWeChatConnectStoredMode(
    f.wechat_connect_open_enabled,
    f.wechat_connect_mp_enabled,
    f.wechat_connect_mobile_enabled,
    f.wechat_connect_mode
  )
  const claudeOAuthSystemPromptBlocksJSON = serializeClaudeOAuthSystemPromptBlocksToJSON(draft.claudeBlocks)
  f.claude_oauth_system_prompt_blocks = claudeOAuthSystemPromptBlocksJSON

  const oauthSchedulingRate = f.openai_oauth_scheduling_rate_multiplier
  if (
    oauthSchedulingRate !== '' &&
    oauthSchedulingRate !== null &&
    (!Number.isFinite(oauthSchedulingRate) || oauthSchedulingRate < 0)
  ) {
    return result(t('admin.settings.openaiExperimentalScheduler.oauthRateInvalid'))
  }

  f.balance_low_notify_recharge_url = f.balance_low_notify_recharge_url || currentOrigin

  const payload: UpdateSettingsRequest = {
    registration_enabled: f.registration_enabled,
    email_verify_enabled: f.email_verify_enabled,
    registration_email_suffix_whitelist:
      draft.registrationEmailSuffixWhitelistTags.map((suffix) =>
        suffix.startsWith('*.') ? suffix : `@${suffix}`,
      ),
    registration_email_domain_quota_enabled:
      f.registration_email_domain_quota_enabled,
    promo_code_enabled: f.promo_code_enabled,
    invitation_code_enabled: f.invitation_code_enabled,
    password_reset_enabled: f.password_reset_enabled,
    totp_enabled: f.totp_enabled,
    passkey_enabled: f.passkey_enabled,
    session_binding_enabled: f.session_binding_enabled,
    step_up_enabled: f.step_up_enabled,
    // 清空数字框时 v-model.number 会得到空串，后端 int 字段解析空串会 400 拒绝整次保存；
    // 空/非法值回退默认 180（与后端 parseAuditLogRetentionDays('') 语义一致，0 仍表示永久保留）。
    audit_log_retention_days: Number.isFinite(f.audit_log_retention_days)
      ? f.audit_log_retention_days
      : 180,
    login_agreement_enabled: f.login_agreement_enabled,
    login_agreement_mode: f.login_agreement_mode,
    login_agreement_updated_at: f.login_agreement_updated_at,
    login_agreement_documents: f.login_agreement_documents,
    default_balance: f.default_balance,
    affiliate_rebate_rate: Math.min(
      100,
      Math.max(0, Number(f.affiliate_rebate_rate) || 0),
    ),
    affiliate_rebate_freeze_hours: Math.max(0, Math.min(720, Number(f.affiliate_rebate_freeze_hours) || 0)),
    affiliate_rebate_duration_days: Math.max(0, Math.min(3650, Math.floor(Number(f.affiliate_rebate_duration_days) || 0))),
    affiliate_rebate_per_invitee_cap: Math.max(0, Number(f.affiliate_rebate_per_invitee_cap) || 0),
    affiliate_admin_recharge_enabled: f.affiliate_admin_recharge_enabled,
    default_concurrency: f.default_concurrency,
    default_subscriptions: normalizedDefaultSubscriptions,
    force_email_on_third_party_signup: f.force_email_on_third_party_signup,
    default_user_rpm_limit: f.default_user_rpm_limit,
    site_name: f.site_name,
    site_logo: f.site_logo,
    site_subtitle: f.site_subtitle,
    api_base_url: f.api_base_url,
    contact_info: f.contact_info,
    doc_url: f.doc_url,
    home_content: f.home_content,
    compact_home_enabled: f.compact_home_enabled,
    backend_mode_enabled: f.backend_mode_enabled,
    hide_ccs_import_button: f.hide_ccs_import_button,
    table_default_page_size: f.table_default_page_size,
    table_page_size_options: f.table_page_size_options,
    custom_menu_items: f.custom_menu_items,
    custom_endpoints: f.custom_endpoints,
    frontend_url: f.frontend_url,
    smtp_host: f.smtp_host,
    smtp_port: f.smtp_port,
    smtp_username: f.smtp_username,
    smtp_password: f.smtp_password || undefined,
    smtp_from_email: f.smtp_from_email,
    smtp_from_name: f.smtp_from_name,
    smtp_use_tls: f.smtp_use_tls,
    turnstile_enabled: f.turnstile_enabled,
    turnstile_site_key: f.turnstile_site_key,
    turnstile_secret_key: f.turnstile_secret_key || undefined,
    tencent_captcha_enabled: f.tencent_captcha_enabled,
    tencent_captcha_app_id: f.tencent_captcha_app_id,
    tencent_captcha_app_secret_key:
      f.tencent_captcha_app_secret_key || undefined,
    tencent_captcha_cloud_secret_id:
      f.tencent_captcha_cloud_secret_id || undefined,
    tencent_captcha_cloud_secret_key:
      f.tencent_captcha_cloud_secret_key || undefined,
    tencent_captcha_region: f.tencent_captcha_region,
    aliyun_captcha_enabled: f.aliyun_captcha_enabled,
    aliyun_captcha_access_key_id: f.aliyun_captcha_access_key_id,
    aliyun_captcha_access_key_secret:
      f.aliyun_captcha_access_key_secret || undefined,
    aliyun_captcha_scene_id: f.aliyun_captcha_scene_id,
    aliyun_captcha_prefix: f.aliyun_captcha_prefix,
    aliyun_captcha_region: f.aliyun_captcha_region,
    api_key_acl_trust_forwarded_ip: f.api_key_acl_trust_forwarded_ip,
    forwarded_client_ip_headers: f.forwarded_client_ip_headers,
    linuxdo_connect_enabled: f.linuxdo_connect_enabled,
    linuxdo_connect_client_id: f.linuxdo_connect_client_id,
    linuxdo_connect_client_secret:
      f.linuxdo_connect_client_secret || undefined,
    linuxdo_connect_redirect_url: f.linuxdo_connect_redirect_url,
    dingtalk_connect_enabled: f.dingtalk_connect_enabled,
    dingtalk_connect_client_id: f.dingtalk_connect_client_id,
    dingtalk_connect_client_secret:
      f.dingtalk_connect_client_secret || undefined,
    dingtalk_connect_redirect_url: f.dingtalk_connect_redirect_url,
    dingtalk_connect_corp_restriction_policy:
      f.dingtalk_connect_corp_restriction_policy,
    dingtalk_connect_internal_corp_id: f.dingtalk_connect_internal_corp_id,
    dingtalk_connect_bypass_registration: f.dingtalk_connect_bypass_registration,
    dingtalk_connect_sync_corp_email: f.dingtalk_connect_sync_corp_email,
    dingtalk_connect_sync_display_name: f.dingtalk_connect_sync_display_name,
    dingtalk_connect_sync_dept: f.dingtalk_connect_sync_dept,
    dingtalk_connect_sync_corp_email_attr_key: f.dingtalk_connect_sync_corp_email_attr_key,
    dingtalk_connect_sync_display_name_attr_key: f.dingtalk_connect_sync_display_name_attr_key,
    dingtalk_connect_sync_dept_attr_key: f.dingtalk_connect_sync_dept_attr_key,
    dingtalk_connect_sync_corp_email_attr_name: f.dingtalk_connect_sync_corp_email_attr_name,
    dingtalk_connect_sync_display_name_attr_name: f.dingtalk_connect_sync_display_name_attr_name,
    dingtalk_connect_sync_dept_attr_name: f.dingtalk_connect_sync_dept_attr_name,
    wechat_connect_enabled: f.wechat_connect_enabled,
    wechat_connect_app_id:
      f.wechat_connect_open_app_id ||
      f.wechat_connect_mp_app_id ||
      f.wechat_connect_mobile_app_id ||
      f.wechat_connect_app_id,
    wechat_connect_app_secret: f.wechat_connect_app_secret || undefined,
    wechat_connect_open_app_id: f.wechat_connect_open_app_id,
    wechat_connect_open_app_secret:
      f.wechat_connect_open_app_secret || undefined,
    wechat_connect_mp_app_id: f.wechat_connect_mp_app_id,
    wechat_connect_mp_app_secret:
      f.wechat_connect_mp_app_secret || undefined,
    wechat_connect_mobile_app_id: f.wechat_connect_mobile_app_id,
    wechat_connect_mobile_app_secret:
      f.wechat_connect_mobile_app_secret || undefined,
    wechat_connect_open_enabled: f.wechat_connect_open_enabled,
    wechat_connect_mp_enabled: f.wechat_connect_mp_enabled,
    wechat_connect_mobile_enabled: f.wechat_connect_mobile_enabled,
    wechat_connect_mode: wechatStoredMode,
    wechat_connect_scopes:
      defaultWeChatConnectScopesForMode(wechatStoredMode),
    wechat_connect_redirect_url: f.wechat_connect_redirect_url,
    wechat_connect_frontend_redirect_url:
      f.wechat_connect_frontend_redirect_url,
    oidc_connect_enabled: f.oidc_connect_enabled,
    oidc_connect_provider_name: f.oidc_connect_provider_name,
    oidc_connect_client_id: f.oidc_connect_client_id,
    oidc_connect_client_secret: f.oidc_connect_client_secret || undefined,
    oidc_connect_issuer_url: f.oidc_connect_issuer_url,
    oidc_connect_discovery_url: f.oidc_connect_discovery_url,
    oidc_connect_authorize_url: f.oidc_connect_authorize_url,
    oidc_connect_token_url: f.oidc_connect_token_url,
    oidc_connect_userinfo_url: f.oidc_connect_userinfo_url,
    oidc_connect_jwks_url: f.oidc_connect_jwks_url,
    oidc_connect_scopes: f.oidc_connect_scopes,
    oidc_connect_redirect_url: f.oidc_connect_redirect_url,
    oidc_connect_frontend_redirect_url:
      f.oidc_connect_frontend_redirect_url,
    oidc_connect_token_auth_method: f.oidc_connect_token_auth_method,
    oidc_connect_use_pkce: f.oidc_connect_use_pkce,
    oidc_connect_validate_id_token: f.oidc_connect_validate_id_token,
    oidc_connect_allowed_signing_algs: f.oidc_connect_allowed_signing_algs,
    oidc_connect_clock_skew_seconds: f.oidc_connect_clock_skew_seconds,
    oidc_connect_require_email_verified:
      f.oidc_connect_require_email_verified,
    oidc_connect_userinfo_email_path: f.oidc_connect_userinfo_email_path,
    oidc_connect_userinfo_id_path: f.oidc_connect_userinfo_id_path,
    oidc_connect_userinfo_username_path:
      f.oidc_connect_userinfo_username_path,
    github_oauth_enabled: f.github_oauth_enabled,
    github_oauth_client_id: f.github_oauth_client_id,
    github_oauth_client_secret:
      f.github_oauth_client_secret || undefined,
    github_oauth_redirect_url: f.github_oauth_redirect_url,
    github_oauth_frontend_redirect_url:
      f.github_oauth_frontend_redirect_url,
    google_oauth_enabled: f.google_oauth_enabled,
    google_oauth_client_id: f.google_oauth_client_id,
    google_oauth_client_secret:
      f.google_oauth_client_secret || undefined,
    google_oauth_redirect_url: f.google_oauth_redirect_url,
    google_oauth_frontend_redirect_url:
      f.google_oauth_frontend_redirect_url,
    enable_model_fallback: f.enable_model_fallback,
    fallback_model_anthropic: f.fallback_model_anthropic,
    fallback_model_openai: f.fallback_model_openai,
    fallback_model_gemini: f.fallback_model_gemini,
    fallback_model_antigravity: f.fallback_model_antigravity,
    grok_default_text_model:
      f.grok_default_text_model.trim() || 'grok-4.5',
    grok_cross_client_model_map_enabled:
      f.grok_cross_client_model_map_enabled,
    grok_default_base_url_mode: f.grok_default_base_url_mode,
    enable_identity_patch: f.enable_identity_patch,
    identity_patch_prompt: f.identity_patch_prompt,
    min_claude_code_version: f.min_claude_code_version,
    max_claude_code_version: f.max_claude_code_version,
    allow_ungrouped_key_scheduling: f.allow_ungrouped_key_scheduling,
    strict_priority_fallback: f.strict_priority_fallback,
    strict_priority_retry_count: f.strict_priority_retry_count,
    strict_priority_cooldown_minutes: f.strict_priority_cooldown_minutes,
    openai_ttft_mode:
      f.openai_ttft_mode === 'visible' ? 'visible' : 'semantic',
    enable_fingerprint_unification: f.enable_fingerprint_unification,
    enable_metadata_passthrough: f.enable_metadata_passthrough,
    rewrite_parallel_tool_calls_to_false:
      f.rewrite_parallel_tool_calls_to_false,
    enable_cch_signing: f.enable_cch_signing,
    enable_claude_oauth_system_prompt_injection:
      f.enable_claude_oauth_system_prompt_injection,
    claude_oauth_system_prompt: f.claude_oauth_system_prompt?.trim()
      ? f.claude_oauth_system_prompt
      : '',
    claude_oauth_system_prompt_blocks: claudeOAuthSystemPromptBlocksJSON,
    enable_anthropic_cache_ttl_1h_injection:
      f.enable_anthropic_cache_ttl_1h_injection,
    rewrite_message_cache_control: f.rewrite_message_cache_control,
    enable_client_dateline_normalization:
      f.enable_client_dateline_normalization,
    antigravity_user_agent_version:
      f.antigravity_user_agent_version?.trim() || '',
    openai_codex_user_agent:
      f.openai_codex_user_agent?.trim() || '',
    openai_codex_client_version:
      f.openai_codex_client_version?.trim() || '',
    openai_codex_version_auto_sync_enabled:
      f.openai_codex_version_auto_sync_enabled,
    claude_code_client_version: f.claude_code_client_version?.trim() || '',
    claude_code_version_auto_sync_enabled:
      f.claude_code_version_auto_sync_enabled,
    min_codex_version: f.min_codex_version?.trim() || '',
    max_codex_version: f.max_codex_version?.trim() || '',
    codex_cli_only_allow_app_server_clients:
      f.codex_cli_only_allow_app_server_clients,
    codex_cli_only_engine_fingerprint_signals: serializeFingerprintRowsToJSON(
      draft.codexFingerprintRows,
    ),
    codex_cli_only_blacklist: serializeCodexRowsToJSON(
      draft.codexBlacklistRows,
    ),
    codex_cli_only_whitelist: serializeCodexRowsToJSON(
      draft.codexWhitelistRows,
    ),
    // Payment configuration
    payment_enabled: f.payment_enabled,
    risk_control_enabled: f.risk_control_enabled,
    cyber_policy_user_allowlist: f.cyber_policy_user_allowlist,
    cyber_session_block_enabled: f.cyber_session_block_enabled,
    cyber_session_block_ttl_seconds:
      Number(f.cyber_session_block_ttl_seconds) || 3600,
    payment_min_amount: Number(f.payment_min_amount) || 0,
    payment_max_amount: Number(f.payment_max_amount) || 0,
    payment_daily_limit: Number(f.payment_daily_limit) || 0,
    payment_max_pending_orders: Number(f.payment_max_pending_orders) || 0,
    payment_order_timeout_minutes:
      Number(f.payment_order_timeout_minutes) || 0,
    payment_balance_disabled: f.payment_balance_disabled,
    payment_balance_recharge_multiplier:
      Number(f.payment_balance_recharge_multiplier) || 1,
    payment_subscription_usd_to_cny_rate:
      Number(f.payment_subscription_usd_to_cny_rate) || 0,
    payment_recharge_fee_rate: Number(f.payment_recharge_fee_rate) || 0,
    payment_recharge_bonus_tiers: sanitizeRechargeBonusTiersForSubmit(
      f.payment_recharge_bonus_tiers,
    ),
    payment_recharge_bonus_mode: f.payment_recharge_bonus_mode,
    payment_recharge_bonus_notice: f.payment_recharge_bonus_notice,
    payment_enabled_types: f.payment_enabled_types,
    payment_load_balance_strategy: f.payment_load_balance_strategy,
    payment_product_name_prefix: f.payment_product_name_prefix,
    payment_product_name_suffix: f.payment_product_name_suffix,
    payment_help_image_url: f.payment_help_image_url,
    payment_help_text: f.payment_help_text,
    payment_cancel_rate_limit_enabled: f.payment_cancel_rate_limit_enabled,
    payment_cancel_rate_limit_max:
      Number(f.payment_cancel_rate_limit_max) || 10,
    payment_cancel_rate_limit_window:
      Number(f.payment_cancel_rate_limit_window) || 1,
    payment_cancel_rate_limit_unit: f.payment_cancel_rate_limit_unit,
    payment_cancel_rate_limit_window_mode:
      f.payment_cancel_rate_limit_window_mode,
    payment_alipay_force_qrcode: f.payment_alipay_force_qrcode,
    payment_alipay_mobile_precreate_deep_link:
      f.payment_alipay_mobile_precreate_deep_link,
    openai_low_upstream_rate_priority_enabled:
      f.openai_low_upstream_rate_priority_enabled,
    openai_oauth_scheduling_rate_multiplier:
      oauthSchedulingRate === '' ? null : oauthSchedulingRate,
    openai_advanced_scheduler_enabled: f.openai_advanced_scheduler_enabled,
    openai_advanced_scheduler_sticky_weighted_enabled:
      f.openai_advanced_scheduler_sticky_weighted_enabled,
    openai_advanced_scheduler_subscription_priority_enabled:
      f.openai_advanced_scheduler_subscription_priority_enabled,
    openai_advanced_scheduler_lb_top_k:
      f.openai_advanced_scheduler_lb_top_k.trim(),
    openai_advanced_scheduler_weight_priority:
      f.openai_advanced_scheduler_weight_priority.trim(),
    openai_advanced_scheduler_weight_load:
      f.openai_advanced_scheduler_weight_load.trim(),
    openai_advanced_scheduler_weight_queue:
      f.openai_advanced_scheduler_weight_queue.trim(),
    openai_advanced_scheduler_weight_error_rate:
      f.openai_advanced_scheduler_weight_error_rate.trim(),
    openai_advanced_scheduler_weight_ttft:
      f.openai_advanced_scheduler_weight_ttft.trim(),
    openai_advanced_scheduler_weight_reset:
      f.openai_advanced_scheduler_weight_reset.trim(),
    openai_advanced_scheduler_weight_quota_headroom:
      f.openai_advanced_scheduler_weight_quota_headroom.trim(),
    openai_advanced_scheduler_weight_upstream_cost:
      f.openai_advanced_scheduler_weight_upstream_cost.trim(),
    openai_advanced_scheduler_weight_previous_response:
      f.openai_advanced_scheduler_weight_previous_response.trim(),
    openai_advanced_scheduler_weight_session_sticky:
      f.openai_advanced_scheduler_weight_session_sticky.trim(),
    // 余额、订阅到期与账号限额通知
    balance_low_notify_enabled: f.balance_low_notify_enabled,
    balance_low_notify_threshold:
      Number(f.balance_low_notify_threshold) || 0,
    balance_low_notify_recharge_url: f.balance_low_notify_recharge_url,
    subscription_expiry_notify_enabled:
      f.subscription_expiry_notify_enabled,
    account_quota_notify_enabled: f.account_quota_notify_enabled,
    account_quota_notify_emails: (
      f.account_quota_notify_emails || []
    ).filter((e) => e.email.trim() !== ''),
    // Channel Monitor feature switch
    channel_monitor_enabled: f.channel_monitor_enabled,
    channel_monitor_mode: f.channel_monitor_mode === 'v1' ? 'v1' : 'v2',
    channel_monitor_default_interval_seconds:
      Number(f.channel_monitor_default_interval_seconds) || 60,
    channel_monitor_hide_throughput: Boolean(f.channel_monitor_hide_throughput),
    channel_monitor_show_quota: Boolean(f.channel_monitor_show_quota),
    channel_monitor_hide_user_ranking: Boolean(f.channel_monitor_hide_user_ranking),
    // Available Channels feature switch
    available_channels_enabled: f.available_channels_enabled,
    // Subscription feature switch
    subscription_enabled: f.subscription_enabled,
    // Model Plaza feature switches + description
    model_plaza_enabled: f.model_plaza_enabled,
    model_plaza_require_auth: f.model_plaza_require_auth,
    model_plaza_description: f.model_plaza_description,
    plugin_management_enabled: f.plugin_management_enabled,
    // Affiliate (邀请返利) feature switch
    affiliate_enabled: f.affiliate_enabled,
    allow_user_view_error_requests: f.allow_user_view_error_requests,
  }

  // 仅当 openai_fast_policy_settings 已成功从后端加载时才回写，
  // 否则省略整个字段，让后端保留既有规则（含默认值）。
  if (fastPolicyLoaded) {
    payload.openai_fast_policy_settings = {
      rules: draft.openaiFastPolicyRules.map((rule) => {
        const whitelist = (rule.model_whitelist || []).map((p) => p.trim()).filter((p) => p !== '')
        const hasWhitelist = whitelist.length > 0
        return {
          service_tier: rule.service_tier,
          action: rule.action,
          scope: rule.scope,
          user_ids: rule.user_ids && rule.user_ids.length > 0 ? [...rule.user_ids] : undefined,
          error_message: rule.action === 'block' ? rule.error_message : undefined,
          model_whitelist: hasWhitelist ? whitelist : undefined,
          fallback_action: hasWhitelist ? rule.fallback_action || 'pass' : undefined,
          fallback_error_message: hasWhitelist && rule.fallback_action === 'block' ? rule.fallback_error_message : undefined
        }
      })
    }
  }

  payload.default_platform_quotas = sanitizePlatformQuotasMap(f.default_platform_quotas)
  payload.account_scheduling_thresholds = sanitizeAccountSchedulingThresholdsMap(f.account_scheduling_thresholds)
  appendAuthSourceDefaultsToUpdateRequest(payload, authSourceDefaults)

  return { ok: true, payload, draft: { ...draft, form: f, authSourceDefaults } }
}
