/**
 * 系统设置表单：类型、默认值与草稿结构（来自 Vue 版 SettingsView.vue 的 script 部分）。
 * 加载、保存与脏检查由 SettingsView.tsx 负责，各 Tab 只读写这里定义的草稿。
 */
import {
  normalizeAccountSchedulingThresholdsMap,
  normalizePlatformQuotasMap,
  type AuthSourceDefaultsState,
  type DefaultPlatformQuotasMap,
  type OpenAIFastPolicyRule,
  type SystemSettings,
  type WebSearchEmulationConfig
} from '@/api/admin/settings'
import type { NotifyEmailEntry } from '@/types'
import type { RechargeBonusMode, RechargeBonusTierDraft } from '@/utils/rechargeBonus'
import type { FingerprintSignalRow } from '@/views/admin/codexFingerprintSignals'
import { defaultClaudeOAuthSystemPromptBlocks, type ClaudeOAuthSystemPromptBlock } from './claudeOAuthBlocks'
import {
  defaultLoginAgreementDocuments,
  tablePageSizeDefault,
  type CodexClientRow,
  type CustomEndpoint,
  type CustomMenuItem,
  type LocalText
} from './settingsHelpers'

export type SettingsTab = 'general' | 'agreement' | 'features' | 'security' | 'users' | 'gateway' | 'payment' | 'email' | 'backup'

export const SETTINGS_TABS: SettingsTab[] = ['general', 'agreement', 'features', 'security', 'users', 'gateway', 'payment', 'email', 'backup']

// 人机验证 UI 状态：单卡片「总开关 + 服务商单选」，落库仍是三个独立
// enabled 键（与上游一致），由 captchaPatch 保证同一时间至多一家启用。
export type CaptchaProviderSelection = 'turnstile' | 'tencent' | 'aliyun'

/** 参与保存与脏检查的全部草稿 */
export interface SettingsDraft {
  form: SettingsForm
  authSourceDefaults: AuthSourceDefaultsState
  claudeBlocks: ClaudeOAuthSystemPromptBlock[]
  codexBlacklistRows: CodexClientRow[]
  codexWhitelistRows: CodexClientRow[]
  codexFingerprintRows: FingerprintSignalRow[]
  registrationEmailSuffixWhitelistTags: string[]
  tablePageSizeOptionsInput: string
  openaiFastPolicyRules: OpenAIFastPolicyRule[]
  webSearchConfig: WebSearchEmulationConfig
}

/** 不参与脏检查的界面状态（加载、保存后会被重置） */
export interface SettingsUiState {
  captchaProvider: CaptchaProviderSelection
  smtpPasswordManuallyEdited: boolean
  registrationEmailSuffixWhitelistDraft: string
  forwardedClientIpHeaderDraft: string
}

export function captchaPatch(provider: CaptchaProviderSelection | null): Partial<SettingsForm> {
  return {
    turnstile_enabled: provider === 'turnstile',
    tencent_captcha_enabled: provider === 'tencent',
    aliyun_captcha_enabled: provider === 'aliyun'
  }
}

export function syncedCaptchaProvider(form: SettingsForm, current: CaptchaProviderSelection): CaptchaProviderSelection {
  if (form.tencent_captcha_enabled) return 'tencent'
  if (form.aliyun_captcha_enabled) return 'aliyun'
  if (form.turnstile_enabled) return 'turnstile'
  return current
}

export type SettingsForm = Omit<
  SystemSettings,
  | 'wechat_connect_open_enabled'
  | 'wechat_connect_mp_enabled'
  | 'wechat_connect_mobile_enabled'
  | 'openai_oauth_scheduling_rate_multiplier'
  | 'payment_recharge_bonus_tiers'
> & {
  /** Form always binds a concrete boolean (SystemSettings marks this optional). */
  channel_monitor_hide_throughput: boolean
  channel_monitor_show_quota: boolean
  channel_monitor_hide_user_ranking: boolean
  smtp_password: string
  turnstile_secret_key: string
  tencent_captcha_app_secret_key: string
  tencent_captcha_cloud_secret_id: string
  tencent_captcha_cloud_secret_key: string
  aliyun_captcha_access_key_secret: string
  linuxdo_connect_client_secret: string
  dingtalk_connect_client_secret: string
  wechat_connect_app_secret: string
  wechat_connect_open_app_secret: string
  wechat_connect_mp_app_secret: string
  wechat_connect_mobile_app_secret: string
  wechat_connect_open_enabled: boolean
  wechat_connect_mp_enabled: boolean
  wechat_connect_mobile_enabled: boolean
  oidc_connect_client_secret: string
  github_oauth_client_secret: string
  google_oauth_client_secret: string
  force_email_on_third_party_signup: boolean
  openai_low_upstream_rate_priority_enabled: boolean
  openai_oauth_scheduling_rate_multiplier: number | '' | null
  openai_advanced_scheduler_enabled: boolean
  openai_advanced_scheduler_sticky_weighted_enabled: boolean
  openai_advanced_scheduler_subscription_priority_enabled: boolean
  openai_advanced_scheduler_lb_top_k: string
  openai_advanced_scheduler_weight_priority: string
  openai_advanced_scheduler_weight_load: string
  openai_advanced_scheduler_weight_queue: string
  openai_advanced_scheduler_weight_error_rate: string
  openai_advanced_scheduler_weight_ttft: string
  openai_advanced_scheduler_weight_reset: string
  openai_advanced_scheduler_weight_quota_headroom: string
  openai_advanced_scheduler_weight_upstream_cost: string
  openai_advanced_scheduler_weight_previous_response: string
  openai_advanced_scheduler_weight_session_sticky: string
  // 充值赠送阶梯编辑态：允许留空的行，提交时清洗为 RechargeBonusTier[]
  payment_recharge_bonus_tiers: RechargeBonusTierDraft[]
  payment_recharge_bonus_mode: RechargeBonusMode
  payment_recharge_bonus_notice: string
  // 系统全局平台限额 map；form 内始终归一化为全部平台对象（模板非空绑定依赖此不变量）
  default_platform_quotas: DefaultPlatformQuotasMap
  account_scheduling_thresholds: ReturnType<typeof normalizeAccountSchedulingThresholdsMap>
}

export function createDefaultSettingsForm(localText: LocalText): SettingsForm {
  return {
    registration_enabled: true,
    email_verify_enabled: false,
    registration_email_suffix_whitelist: [],
    registration_email_domain_quota_enabled: false,
    promo_code_enabled: true,
    invitation_code_enabled: false,
    password_reset_enabled: false,
    totp_enabled: false,
    totp_encryption_key_configured: false,
    passkey_enabled: false,
    passkey_configured: false,
    passkey_rp_id: '',
    passkey_rp_origins: [],
    session_binding_enabled: false,
    step_up_enabled: false,
    audit_log_retention_days: 180,
    login_agreement_enabled: false,
    login_agreement_mode: 'modal',
    login_agreement_updated_at: '2026-03-31',
    login_agreement_documents: defaultLoginAgreementDocuments(localText),
    default_balance: 0,
    default_platform_quotas: normalizePlatformQuotasMap() as DefaultPlatformQuotasMap,
    account_scheduling_thresholds: normalizeAccountSchedulingThresholdsMap(),
    affiliate_rebate_rate: 20,
    affiliate_rebate_freeze_hours: 0,
    affiliate_rebate_duration_days: 0,
    affiliate_rebate_per_invitee_cap: 0,
    affiliate_admin_recharge_enabled: false,
    default_concurrency: 1,
    default_subscriptions: [],
    force_email_on_third_party_signup: false,
    default_user_rpm_limit: 0,
    site_name: 'RetooAi',
    site_logo: '',
    site_subtitle: 'Subscription to API Conversion Platform',
    api_base_url: '',
    contact_info: '',
    doc_url: '',
    home_content: '',
    compact_home_enabled: false,
    backend_mode_enabled: false,
    hide_ccs_import_button: false,
    payment_enabled: false,
    risk_control_enabled: false,
    cyber_policy_user_allowlist: '',
    cyber_session_block_enabled: false,
    cyber_session_block_ttl_seconds: 3600,
    payment_min_amount: 1,
    payment_max_amount: 10000,
    payment_daily_limit: 50000,
    payment_max_pending_orders: 3,
    payment_order_timeout_minutes: 30,
    payment_balance_disabled: false,
    payment_balance_recharge_multiplier: 1,
    payment_subscription_usd_to_cny_rate: 0,
    payment_recharge_fee_rate: 0,
    payment_recharge_bonus_tiers: [],
    payment_recharge_bonus_mode: 'bonus',
    payment_recharge_bonus_notice: '',
    payment_enabled_types: [],
    payment_help_image_url: '',
    payment_help_text: '',
    payment_product_name_prefix: '',
    payment_product_name_suffix: '',
    payment_load_balance_strategy: 'round-robin',
    payment_cancel_rate_limit_enabled: false,
    payment_cancel_rate_limit_max: 10,
    payment_cancel_rate_limit_window: 1,
    payment_cancel_rate_limit_unit: 'day',
    payment_cancel_rate_limit_window_mode: 'rolling',
    payment_alipay_force_qrcode: false,
    payment_alipay_mobile_precreate_deep_link: false,
    table_default_page_size: tablePageSizeDefault,
    table_page_size_options: [10, 20, 50, 100],
    custom_menu_items: [] as CustomMenuItem[],
    custom_endpoints: [] as CustomEndpoint[],
    frontend_url: '',
    smtp_host: '',
    smtp_port: 587,
    smtp_username: '',
    smtp_password: '',
    smtp_password_configured: false,
    smtp_from_email: '',
    smtp_from_name: '',
    smtp_use_tls: true,
    // Cloudflare Turnstile
    turnstile_enabled: false,
    turnstile_site_key: '',
    turnstile_secret_key: '',
    turnstile_secret_key_configured: false,
    tencent_captcha_enabled: false,
    tencent_captcha_app_id: '',
    tencent_captcha_app_secret_key: '',
    tencent_captcha_app_secret_key_configured: false,
    tencent_captcha_cloud_secret_id: '',
    tencent_captcha_cloud_secret_id_configured: false,
    tencent_captcha_cloud_secret_key: '',
    tencent_captcha_cloud_secret_key_configured: false,
    tencent_captcha_region: 'cn',
    aliyun_captcha_enabled: false,
    aliyun_captcha_access_key_id: '',
    aliyun_captcha_access_key_secret: '',
    aliyun_captcha_access_key_secret_configured: false,
    aliyun_captcha_scene_id: '',
    aliyun_captcha_prefix: '',
    aliyun_captcha_region: 'cn',
    api_key_acl_trust_forwarded_ip: true,
    forwarded_client_ip_headers: [],
    // LinuxDo Connect OAuth 登录
    linuxdo_connect_enabled: false,
    linuxdo_connect_client_id: '',
    linuxdo_connect_client_secret: '',
    linuxdo_connect_client_secret_configured: false,
    linuxdo_connect_redirect_url: '',
    // DingTalk Connect OAuth 登录
    dingtalk_connect_enabled: false,
    dingtalk_connect_client_id: '',
    dingtalk_connect_client_secret: '',
    dingtalk_connect_client_secret_configured: false,
    dingtalk_connect_redirect_url: '',
    dingtalk_connect_corp_restriction_policy: 'none',
    dingtalk_connect_internal_corp_id: '',
    dingtalk_connect_bypass_registration: false,
    dingtalk_connect_sync_corp_email: false,
    dingtalk_connect_sync_display_name: false,
    dingtalk_connect_sync_dept: false,
    dingtalk_connect_sync_corp_email_attr_key: 'dingtalk_email',
    dingtalk_connect_sync_display_name_attr_key: 'dingtalk_name',
    dingtalk_connect_sync_dept_attr_key: 'dingtalk_department',
    dingtalk_connect_sync_corp_email_attr_name: localText('钉钉企业邮箱', 'DingTalk Corporate Email'),
    dingtalk_connect_sync_display_name_attr_name: localText('钉钉姓名', 'DingTalk Name'),
    dingtalk_connect_sync_dept_attr_name: localText('钉钉部门', 'DingTalk Department'),
    wechat_connect_enabled: false,
    wechat_connect_app_id: '',
    wechat_connect_app_secret: '',
    wechat_connect_app_secret_configured: false,
    wechat_connect_open_app_id: '',
    wechat_connect_open_app_secret: '',
    wechat_connect_open_app_secret_configured: false,
    wechat_connect_mp_app_id: '',
    wechat_connect_mp_app_secret: '',
    wechat_connect_mp_app_secret_configured: false,
    wechat_connect_mobile_app_id: '',
    wechat_connect_mobile_app_secret: '',
    wechat_connect_mobile_app_secret_configured: false,
    wechat_connect_open_enabled: false,
    wechat_connect_mp_enabled: false,
    wechat_connect_mobile_enabled: false,
    wechat_connect_mode: 'open',
    wechat_connect_scopes: 'snsapi_login',
    wechat_connect_redirect_url: '',
    wechat_connect_frontend_redirect_url: '/auth/wechat/callback',
    // Generic OIDC OAuth 登录
    oidc_connect_enabled: false,
    oidc_connect_provider_name: 'OIDC',
    oidc_connect_client_id: '',
    oidc_connect_client_secret: '',
    oidc_connect_client_secret_configured: false,
    oidc_connect_issuer_url: '',
    oidc_connect_discovery_url: '',
    oidc_connect_authorize_url: '',
    oidc_connect_token_url: '',
    oidc_connect_userinfo_url: '',
    oidc_connect_jwks_url: '',
    oidc_connect_scopes: 'openid email profile',
    oidc_connect_redirect_url: '',
    oidc_connect_frontend_redirect_url: '/auth/oidc/callback',
    oidc_connect_token_auth_method: 'client_secret_post',
    oidc_connect_use_pkce: false,
    oidc_connect_validate_id_token: false,
    oidc_connect_allowed_signing_algs: 'RS256,ES256,PS256',
    oidc_connect_clock_skew_seconds: 120,
    oidc_connect_require_email_verified: false,
    oidc_connect_userinfo_email_path: '',
    oidc_connect_userinfo_id_path: '',
    oidc_connect_userinfo_username_path: '',
    // GitHub / Google 邮箱快捷登录
    github_oauth_enabled: false,
    github_oauth_client_id: '',
    github_oauth_client_secret: '',
    github_oauth_client_secret_configured: false,
    github_oauth_redirect_url: '',
    github_oauth_frontend_redirect_url: '/auth/oauth/callback',
    google_oauth_enabled: false,
    google_oauth_client_id: '',
    google_oauth_client_secret: '',
    google_oauth_client_secret_configured: false,
    google_oauth_redirect_url: '',
    google_oauth_frontend_redirect_url: '/auth/oauth/callback',
    // Model fallback
    enable_model_fallback: false,
    fallback_model_anthropic: 'claude-3-5-sonnet-20241022',
    fallback_model_openai: 'gpt-4o',
    fallback_model_gemini: 'gemini-2.5-pro',
    fallback_model_antigravity: 'gemini-2.5-pro',
    grok_default_text_model: 'grok-4.5',
    grok_cross_client_model_map_enabled: false,
    grok_default_base_url_mode: 'cli',
    // Identity patch (Claude -> Gemini)
    enable_identity_patch: true,
    identity_patch_prompt: '',
    // Ops monitoring (vNext)
    ops_monitoring_enabled: true,
    ops_realtime_monitoring_enabled: true,
    ops_query_mode_default: 'auto',
    ops_metrics_interval_seconds: 60,
    // Claude Code version check
    min_claude_code_version: '',
    max_claude_code_version: '',
    // 分组隔离
    allow_ungrouped_key_scheduling: false,
    strict_priority_fallback: false,
    strict_priority_retry_count: 0,
    strict_priority_cooldown_minutes: 0,
    openai_low_upstream_rate_priority_enabled: false,
    openai_oauth_scheduling_rate_multiplier: 1,
    openai_advanced_scheduler_enabled: false,
    openai_advanced_scheduler_sticky_weighted_enabled: false,
    openai_advanced_scheduler_subscription_priority_enabled: false,
    openai_advanced_scheduler_lb_top_k: '',
    openai_advanced_scheduler_weight_priority: '',
    openai_advanced_scheduler_weight_load: '',
    openai_advanced_scheduler_weight_queue: '',
    openai_advanced_scheduler_weight_error_rate: '',
    openai_advanced_scheduler_weight_ttft: '',
    openai_advanced_scheduler_weight_reset: '',
    openai_advanced_scheduler_weight_quota_headroom: '',
    openai_advanced_scheduler_weight_upstream_cost: '',
    openai_advanced_scheduler_weight_previous_response: '',
    openai_advanced_scheduler_weight_session_sticky: '',
    // Gateway forwarding behavior
    openai_ttft_mode: 'semantic',
    enable_fingerprint_unification: true,
    enable_metadata_passthrough: false,
    rewrite_parallel_tool_calls_to_false: false,
    enable_cch_signing: false,
    enable_claude_oauth_system_prompt_injection: true,
    claude_oauth_system_prompt: '',
    claude_oauth_system_prompt_blocks: defaultClaudeOAuthSystemPromptBlocks,
    enable_anthropic_cache_ttl_1h_injection: false,
    rewrite_message_cache_control: false,
    enable_client_dateline_normalization: true,
    antigravity_user_agent_version: '',
    openai_codex_user_agent: '',
    openai_codex_client_version: '',
    // 只读展示：自动同步任务写入的官方最新稳定版，不参与提交（提交载荷按字段显式构造）
    openai_codex_client_version_synced: '',
    openai_codex_version_auto_sync_enabled: true,
    claude_code_client_version: '',
    // 只读展示：自动同步任务写入的官方最新稳定版，不参与提交（提交载荷按字段显式构造）
    claude_code_client_version_synced: '',
    claude_code_version_auto_sync_enabled: true,
    // codex_cli_only 加固
    min_codex_version: '',
    max_codex_version: '',
    codex_cli_only_blacklist: '',
    codex_cli_only_whitelist: '',
    codex_cli_only_allow_app_server_clients: false,
    codex_cli_only_engine_fingerprint_signals: '',
    // 余额、订阅到期与账号限额通知
    balance_low_notify_enabled: false,
    balance_low_notify_threshold: 0,
    balance_low_notify_recharge_url: '',
    subscription_expiry_notify_enabled: true,
    account_quota_notify_enabled: false,
    account_quota_notify_emails: [] as NotifyEmailEntry[],
    // Channel Monitor feature switch
    channel_monitor_enabled: true,
    channel_monitor_mode: 'v1' as 'v1' | 'v2',
    channel_monitor_default_interval_seconds: 60,
    channel_monitor_hide_throughput: false,
    channel_monitor_show_quota: false,
    channel_monitor_hide_user_ranking: false,
    // Available Channels feature switch
    available_channels_enabled: false,
    // Subscription feature switch (user sidebar 'My Subscriptions' entry)
    subscription_enabled: true,
    // Model Plaza feature switches + description
    model_plaza_enabled: false,
    model_plaza_require_auth: false,
    model_plaza_description: '',
    // Plugin management menu visibility; plugin runtime is unaffected.
    plugin_management_enabled: false,
    // Affiliate (邀请返利) feature switch
    affiliate_enabled: false,
    // Allow user view error requests
    allow_user_view_error_requests: false,
  }
}
