import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import enCommon from '@/i18n/locales/en/common'
import enSettings from '@/i18n/locales/en/admin/settings'
import zhCommon from '@/i18n/locales/zh/common'
import zhSettings from '@/i18n/locales/zh/admin/settings'
import type { PaymentProviderListProps } from '@/components/payment/PaymentProviderList'
import SettingsView from '../SettingsView'

const {
  getSettings,
  updateSettings,
  getWebSearchEmulationConfig,
  updateWebSearchEmulationConfig,
  getAdminApiKey,
  getOverloadCooldownSettings,
  getRateLimit429CooldownSettings,
  updateRateLimit429CooldownSettings,
  getPanelRateLimitSettings,
  updatePanelRateLimitSettings,
  getStreamTimeoutSettings,
  getRectifierSettings,
  getBetaPolicySettings,
  getUpstreamBillingProbeSettings,
  updateUpstreamBillingProbeSettings,
  getOllamaCloudUsageSettings,
  updateOllamaCloudUsageSettings,
  getOpenCodeGoUsageSettings,
  getGroups,
  listProxies,
  getProviders,
  updateProvider,
  createProvider,
  deleteProvider,
  fetchPublicSettings,
  adminSettingsFetch,
  showError,
  showSuccess,
  providerList
} = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getWebSearchEmulationConfig: vi.fn(),
  updateWebSearchEmulationConfig: vi.fn(),
  getAdminApiKey: vi.fn(),
  getOverloadCooldownSettings: vi.fn(),
  getRateLimit429CooldownSettings: vi.fn(),
  updateRateLimit429CooldownSettings: vi.fn(),
  getPanelRateLimitSettings: vi.fn().mockResolvedValue({
    enabled: true,
    user_rpm: 240,
    heavy_rpm: 60,
    exempt_admin: true,
    public_ip_rpm: 300
  }),
  updatePanelRateLimitSettings: vi.fn().mockImplementation(async (payload) => payload),
  getStreamTimeoutSettings: vi.fn(),
  getRectifierSettings: vi.fn(),
  getBetaPolicySettings: vi.fn(),
  getUpstreamBillingProbeSettings: vi.fn().mockResolvedValue({ enabled: true, all_accounts: false, interval_minutes: 30 }),
  updateUpstreamBillingProbeSettings: vi.fn().mockImplementation(async (payload) => payload),
  getOllamaCloudUsageSettings: vi.fn().mockResolvedValue({ enabled: false, interval_minutes: 60, debounce_minutes: 1 }),
  updateOllamaCloudUsageSettings: vi.fn().mockImplementation(async (payload) => payload),
  getOpenCodeGoUsageSettings: vi.fn().mockResolvedValue({ enabled: false, interval_minutes: 15, debounce_minutes: 1 }),
  getGroups: vi.fn(),
  listProxies: vi.fn(),
  getProviders: vi.fn(),
  updateProvider: vi.fn(),
  createProvider: vi.fn(),
  deleteProvider: vi.fn(),
  fetchPublicSettings: vi.fn(),
  adminSettingsFetch: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
  // PaymentProviderList 桩：记录最新 props，替代 Vue spec 中的组件桩
  providerList: { props: null as PaymentProviderListProps | null }
}))

const localeRef = vi.hoisted(() => ({ value: 'zh-CN' }))

vi.mock('@/api', () => ({
  adminAPI: {
    settings: {
      getSettings,
      updateSettings,
      getWebSearchEmulationConfig,
      updateWebSearchEmulationConfig,
      getAdminApiKey,
      getOverloadCooldownSettings,
      getRateLimit429CooldownSettings,
      updateRateLimit429CooldownSettings,
      getPanelRateLimitSettings,
      updatePanelRateLimitSettings,
      getStreamTimeoutSettings,
      getRectifierSettings,
      getBetaPolicySettings
    },
    accounts: {
      getUpstreamBillingProbeSettings,
      updateUpstreamBillingProbeSettings,
      getOllamaCloudUsageSettings,
      updateOllamaCloudUsageSettings,
      getOpenCodeGoUsageSettings,
      updateOpenCodeGoUsageSettings: vi.fn()
    },
    groups: { getAll: getGroups },
    proxies: { list: listProxies },
    payment: { getProviders, updateProvider, createProvider, deleteProvider }
  }
}))

vi.mock('@/stores', () => {
  const state = { showError, showSuccess, showWarning: vi.fn(), showInfo: vi.fn(), fetchPublicSettings }
  return { useAppStore: Object.assign((selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state), { getState: () => state }) }
})

vi.mock('@/stores/adminSettings', () => {
  const state = { fetch: adminSettingsFetch }
  return { useAdminSettingsStore: Object.assign(() => state, { getState: () => state }) }
})

vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copied: false, copyToClipboard: vi.fn() }) }))

vi.mock('@/utils/apiError', () => ({
  extractApiErrorMessage: () => 'error',
  extractI18nErrorMessage: () => 'error'
}))

// 与 Vue spec 相同的翻译表；未列出的键原样返回
vi.mock('@/i18n/useI18n', () => {
  const translations: Record<string, string> = {
    'admin.settings.wechatConnect.title': '微信登录',
    'admin.settings.wechatConnect.appSecretConfiguredPlaceholder': '密钥已配置，留空以保留当前值。',
    'admin.settings.authSourceDefaults.title': '认证来源默认值',
    'admin.settings.authSourceDefaults.grantOnFirstBindLabel': '首次绑定时授权',
    'admin.settings.authSourceDefaults.grantOnFirstBindHint': '已有账号首次绑定该来源时发放默认权益。',
    'admin.settings.payment.configGuide': '查看支付配置说明',
    'admin.settings.payment.findProvider': '查看支持的支付方式',
    'admin.settings.openaiExperimentalScheduler.title': 'OpenAI 实验调度策略',
    'admin.settings.openaiExperimentalScheduler.description':
      '默认关闭。开启后仅影响本网关在 OpenAI 账号间的实验性调度选择逻辑，不代表上游 OpenAI 官方能力。',
    'admin.settings.openaiExperimentalScheduler.lowRatePriorityTitle': '低倍率优先',
    'admin.settings.openaiExperimentalScheduler.lowRatePriorityDescription':
      '开启后仍先比较账号优先级；同等优先级内严格按已探测计费倍率从低到高尝试，低倍率不可用时才回退到更高倍率。该严格顺序优先于实验调度评分。',
    'admin.settings.openaiExperimentalScheduler.oauthRateTitle': 'OAuth 调度参考倍率',
    'admin.settings.openaiExperimentalScheduler.oauthRatePriorityDescription':
      'OAuth 账号按此参考倍率参与低倍率优先排序；留空时使用各自的账号倍率。API Key 账号优先使用有效探测倍率，无有效探测时使用账号倍率。',
    'admin.settings.openaiExperimentalScheduler.oauthRateWeightedDescription':
      '计算“计费倍率”得分时，OAuth 账号使用此参考倍率；留空时使用各自的账号倍率。API Key 账号优先使用有效探测倍率，无有效探测时使用账号倍率。',
    'admin.settings.openaiExperimentalScheduler.oauthRateInvalid': 'OAuth 调度参考倍率必须是非负数字，或留空以使用账号倍率。',
    'admin.settings.openaiExperimentalScheduler.stickyWeightedTitle': '粘性加权',
    'admin.settings.openaiExperimentalScheduler.subscriptionPriorityTitle': '订阅优先',
    'admin.settings.openaiExperimentalScheduler.weightsTitle': '调度权值覆盖',
    'admin.settings.openaiExperimentalScheduler.defaultPlaceholder': '配置/默认：{value}',
    'admin.settings.openaiExperimentalScheduler.upstreamCostWeight': '计费倍率',
    'admin.settings.upstreamBillingProbe.title': '上游倍率自动探测',
    'admin.settings.upstreamBillingProbe.saved': '上游倍率自动探测设置已保存',
    'admin.settings.openaiFastPolicy.summaryTargetModels': '目标模型',
    'admin.settings.openaiFastPolicy.summaryAllModels': '全部模型',
    'admin.settings.openaiFastPolicy.summaryOtherModels': '其他模型',
    'admin.settings.openaiFastPolicy.summaryAction.filter': '过滤',
    'admin.settings.openaiFastPolicy.summaryAction.pass': '透传',
    'admin.settings.security.passkeyDeploymentHint':
      '请由服务器运维在部署配置中将 webauthn.enabled 设为 true，填写 webauthn.rp_id（仅域名）与 webauthn.rp_origins（完整 HTTPS 来源），然后重启服务。',
    'admin.settings.site.uploadImage': '上传图片',
    'admin.settings.site.remove': '移除'
  }
  const t = (key: string, params?: Record<string, unknown>) =>
    (translations[key] ?? key).replace(/\{(\w+)\}/g, (_: string, token: string) => (params?.[token] != null ? String(params[token]) : `{${token}}`))
  return {
    useI18n: () => ({ t, te: () => true, locale: localeRef.value, setLocale: vi.fn() })
  }
})

vi.mock('@/components/common/Select', () => ({
  default: ({
    value,
    options,
    placeholder,
    onChange
  }: {
    value: unknown
    options: Array<{ value: unknown; label: string }>
    placeholder?: string
    onChange?: (value: unknown, option: unknown) => void
  }) => (
    <select
      className="select-stub"
      value={value == null ? '' : String(value)}
      data-placeholder={placeholder}
      onChange={(event) => {
        const option = options.find((item) => String(item.value ?? '') === event.target.value) ?? null
        onChange?.(event.target.value, option)
      }}
    >
      {options.map((option) => (
        <option key={`${String(option.value)}:${option.label}`} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  )
}))

vi.mock('@/components/common/ImageUpload', () => ({
  default: ({ value, uploadLabel, removeLabel, hint }: { value: string; uploadLabel?: string; removeLabel?: string; hint?: string }) => (
    <div className="image-upload-stub" data-model-value={value} data-upload-label={uploadLabel} data-remove-label={removeLabel} data-hint={hint} />
  )
}))

vi.mock('@/components/payment/PaymentProviderList', () => ({
  default: (props: PaymentProviderListProps) => {
    providerList.props = props
    return (
      <button type="button" className="provider-toggle-stub" onClick={() => props.providers[0] && props.onToggleField(props.providers[0], 'enabled')}>
        toggle provider
      </button>
    )
  }
}))
vi.mock('@/components/payment/PaymentProviderDialog', () => ({ default: () => null }))
vi.mock('@/components/admin/settings/AdminAccessKeysSettings', () => ({ default: () => null }))
vi.mock('@/components/auth/TotpStepUpDialog', () => ({ default: () => null }))
vi.mock('../BackupView', () => ({ default: () => null }))
vi.mock('../settings/EmailTemplateEditor', () => ({ default: () => null }))
vi.mock('@/api/admin/affiliates', () => {
  const affiliatesAPI = { listUsers: vi.fn().mockResolvedValue({ items: [], total: 0 }) }
  return { affiliatesAPI, default: affiliatesAPI }
})

const baseSettingsResponse = {
  registration_enabled: true,
  email_verify_enabled: false,
  registration_email_suffix_whitelist: [],
  promo_code_enabled: true,
  invitation_code_enabled: false,
  password_reset_enabled: false,
  totp_enabled: false,
  totp_encryption_key_configured: false,
  passkey_enabled: true,
  passkey_configured: true,
  passkey_rp_id: 'sub3.nebula-spaces.com',
  passkey_rp_origins: ['https://sub3.nebula-spaces.com'],
  default_balance: 0,
  default_concurrency: 1,
  default_subscriptions: [],
  site_name: 'Sub2API',
  site_logo: '',
  site_subtitle: '',
  api_base_url: '',
  contact_info: '',
  doc_url: '',
  home_content: '',
  compact_home_enabled: false,
  hide_ccs_import_button: false,
  table_default_page_size: 20,
  table_page_size_options: [10, 20, 50, 100],
  backend_mode_enabled: false,
  custom_menu_items: [],
  custom_endpoints: [],
  frontend_url: '',
  smtp_host: '',
  smtp_port: 587,
  smtp_username: '',
  smtp_password_configured: false,
  smtp_from_email: '',
  smtp_from_name: '',
  smtp_use_tls: true,
  turnstile_enabled: false,
  turnstile_site_key: '',
  turnstile_secret_key_configured: false,
  tencent_captcha_enabled: false,
  tencent_captcha_app_id: '',
  tencent_captcha_app_secret_key_configured: false,
  tencent_captcha_cloud_secret_id_configured: false,
  tencent_captcha_cloud_secret_key_configured: false,
  api_key_acl_trust_forwarded_ip: true,
  forwarded_client_ip_headers: [],
  linuxdo_connect_enabled: false,
  linuxdo_connect_client_id: '',
  linuxdo_connect_client_secret_configured: false,
  linuxdo_connect_redirect_url: '',
  wechat_connect_enabled: true,
  wechat_connect_app_id: 'wx-app-id-123',
  wechat_connect_app_secret_configured: true,
  wechat_connect_open_enabled: false,
  wechat_connect_mp_enabled: true,
  wechat_connect_mode: 'mp',
  wechat_connect_scopes: '',
  wechat_connect_redirect_url: 'https://admin.example.com/api/v1/auth/oauth/wechat/callback',
  wechat_connect_frontend_redirect_url: '/auth/wechat/callback',
  oidc_connect_enabled: false,
  oidc_connect_provider_name: 'OIDC',
  oidc_connect_client_id: '',
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
  oidc_connect_use_pkce: true,
  oidc_connect_validate_id_token: true,
  oidc_connect_allowed_signing_algs: 'RS256,ES256,PS256',
  oidc_connect_clock_skew_seconds: 120,
  oidc_connect_require_email_verified: false,
  oidc_connect_userinfo_email_path: '',
  oidc_connect_userinfo_id_path: '',
  oidc_connect_userinfo_username_path: '',
  enable_model_fallback: false,
  fallback_model_anthropic: '',
  fallback_model_openai: '',
  fallback_model_gemini: '',
  fallback_model_antigravity: '',
  grok_default_text_model: 'grok-4.5',
  grok_cross_client_model_map_enabled: false,
  enable_identity_patch: false,
  identity_patch_prompt: '',
  ops_monitoring_enabled: false,
  ops_realtime_monitoring_enabled: false,
  ops_query_mode_default: 'auto',
  ops_metrics_interval_seconds: 60,
  min_claude_code_version: '',
  max_claude_code_version: '',
  allow_ungrouped_key_scheduling: false,
  strict_priority_fallback: true,
  openai_ttft_mode: 'semantic',
  enable_fingerprint_unification: true,
  enable_metadata_passthrough: false,
  rewrite_parallel_tool_calls_to_false: false,
  enable_cch_signing: false,
  enable_claude_oauth_system_prompt_injection: true,
  claude_oauth_system_prompt: '',
  claude_oauth_system_prompt_blocks: '',
  enable_anthropic_cache_ttl_1h_injection: false,
  rewrite_message_cache_control: false,
  enable_client_dateline_normalization: true,
  antigravity_user_agent_version: '',
  openai_codex_user_agent: '',
  payment_enabled: true,
  payment_min_amount: 1,
  payment_max_amount: 10000,
  payment_daily_limit: 50000,
  payment_order_timeout_minutes: 30,
  payment_max_pending_orders: 3,
  payment_enabled_types: [],
  payment_balance_disabled: false,
  payment_balance_recharge_multiplier: 1,
  payment_subscription_usd_to_cny_rate: 0,
  payment_recharge_fee_rate: 0,
  payment_recharge_bonus_tiers: [],
  payment_recharge_bonus_mode: 'bonus',
  payment_recharge_bonus_notice: '',
  payment_load_balance_strategy: 'round-robin',
  payment_product_name_prefix: '',
  payment_product_name_suffix: '',
  payment_help_image_url: '',
  payment_help_text: '',
  payment_cancel_rate_limit_enabled: false,
  payment_cancel_rate_limit_max: 10,
  payment_cancel_rate_limit_window: 1,
  payment_cancel_rate_limit_unit: 'day',
  payment_cancel_rate_limit_window_mode: 'rolling',
  payment_visible_method_alipay_source: 'alipay_direct',
  payment_visible_method_wxpay_source: 'invalid-source',
  payment_visible_method_alipay_enabled: true,
  payment_visible_method_wxpay_enabled: true,
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
  openai_advanced_scheduler_effective_lb_top_k: '7',
  openai_advanced_scheduler_effective_weight_priority: '1',
  openai_advanced_scheduler_effective_weight_load: '1',
  openai_advanced_scheduler_effective_weight_queue: '0.7',
  openai_advanced_scheduler_effective_weight_error_rate: '0.8',
  openai_advanced_scheduler_effective_weight_ttft: '0.5',
  openai_advanced_scheduler_effective_weight_reset: '0',
  openai_advanced_scheduler_effective_weight_quota_headroom: '0',
  openai_advanced_scheduler_effective_weight_upstream_cost: '0',
  openai_advanced_scheduler_effective_weight_previous_response: '5',
  openai_advanced_scheduler_effective_weight_session_sticky: '3',
  balance_low_notify_enabled: false,
  balance_low_notify_threshold: 0,
  balance_low_notify_recharge_url: '',
  subscription_expiry_notify_enabled: true,
  account_quota_notify_enabled: false,
  account_quota_notify_emails: [],
  // 平台限额嵌套字段（新后端契约）
  default_platform_quotas: {
    anthropic: { daily: null, weekly: null, monthly: null },
    openai: { daily: null, weekly: 12.5, monthly: null },
    gemini: { daily: null, weekly: null, monthly: 200 },
    antigravity: { daily: null, weekly: null, monthly: null }
  }
}

// ── harness ──
const flushPromises = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  })

function Wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

async function mountView() {
  const view = render(<SettingsView />, { wrapper: Wrapper })
  await flushPromises()
  return view
}

const text = () => document.body.textContent ?? ''
const q = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector)
function get<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector)
  if (!el) throw new Error(`missing ${selector}`)
  return el
}
const byTestId = <T extends Element = HTMLElement>(id: string, root: ParentNode = document) => get<T>(`[data-testid="${id}"]`, root)
const isOn = (el: Element) => el.getAttribute('aria-checked') === 'true' || (el as HTMLInputElement).checked === true

async function click(el: Element) {
  await act(async () => {
    fireEvent.click(el)
  })
  await flushPromises()
}

/** Arc 开关或原生复选框：只在当前值不同的时候点击（对应 Vue 的 setValue） */
async function setSwitch(el: Element, value: boolean) {
  if (isOn(el) !== value) await click(el)
}

async function setValue(el: Element, value: string | number) {
  await act(async () => {
    fireEvent.change(el, { target: { value: String(value) } })
  })
}

async function submit() {
  await act(async () => {
    fireEvent.submit(get('form'))
  })
  await flushPromises()
}

async function openTab(key: string) {
  const tab = get(`#settings-tab-${key}`)
  expect(tab.textContent).toContain(`admin.settings.tabs.${key}`)
  await act(async () => {
    fireEvent.mouseDown(tab)
    fireEvent.click(tab)
  })
  await flushPromises()
}

/** 按标题找到设置区域（替代 Vue spec 中的 .card 查找） */
function region(titleKey: string): HTMLElement {
  const found = Array.from(document.querySelectorAll('section')).find((node) => node.querySelector('h2')?.textContent?.includes(titleKey))
  if (!found) throw new Error(`missing region ${titleKey}`)
  return found as HTMLElement
}

function resetMocks() {
  for (const mock of [
    getSettings,
    updateSettings,
    getWebSearchEmulationConfig,
    updateWebSearchEmulationConfig,
    getAdminApiKey,
    getOverloadCooldownSettings,
    getRateLimit429CooldownSettings,
    updateRateLimit429CooldownSettings,
    getStreamTimeoutSettings,
    getRectifierSettings,
    getBetaPolicySettings,
    getGroups,
    listProxies,
    getProviders,
    updateProvider,
    createProvider,
    deleteProvider,
    fetchPublicSettings,
    adminSettingsFetch,
    showError,
    showSuccess
  ]) {
    mock.mockReset()
  }
  providerList.props = null
  localeRef.value = 'zh-CN'
}

function defaultMocks() {
  getSettings.mockResolvedValue({ ...baseSettingsResponse })
  updateSettings.mockImplementation(async (payload) => ({ ...baseSettingsResponse, ...payload }))
  getWebSearchEmulationConfig.mockResolvedValue({ enabled: false, providers: [] })
  updateWebSearchEmulationConfig.mockResolvedValue({ enabled: false, providers: [] })
  getAdminApiKey.mockResolvedValue({ exists: false, masked_key: '' })
  getOverloadCooldownSettings.mockResolvedValue({ enabled: true, cooldown_minutes: 10 })
  getRateLimit429CooldownSettings.mockResolvedValue({ enabled: true, cooldown_seconds: 5 })
  updateRateLimit429CooldownSettings.mockImplementation(async (payload) => payload)
  getStreamTimeoutSettings.mockResolvedValue({
    enabled: true,
    action: 'temp_unsched',
    temp_unsched_minutes: 5,
    threshold_count: 3,
    threshold_window_minutes: 10
  })
  getRectifierSettings.mockResolvedValue({
    enabled: true,
    thinking_signature_enabled: true,
    thinking_budget_enabled: true,
    apikey_signature_enabled: false,
    apikey_signature_patterns: []
  })
  getBetaPolicySettings.mockResolvedValue({ rules: [] })
  getGroups.mockResolvedValue([])
  listProxies.mockResolvedValue({ items: [] })
  getProviders.mockResolvedValue({ data: [] })
  fetchPublicSettings.mockResolvedValue(undefined)
  adminSettingsFetch.mockResolvedValue(undefined)
}

afterEach(() => {
  cleanup()
})

describe('admin SettingsView email domain quota copy', () => {
  it('documents the email domain quota and empty-whitelist behavior in both locales', () => {
    expect(zhCommon.auth.emailDomainRegistrationLimit).toContain('主流邮箱')
    expect(zhCommon.auth.emailDomainRegistrationLimit).toContain('联系客服')
    expect(enCommon.auth.emailDomainRegistrationLimit).toContain('mainstream email')
    expect(enCommon.auth.emailDomainRegistrationLimit).toContain('contact support')

    // 白名单 hint 描述严格默认语义；额度语义移入独立开关的 hint。
    const zhWhitelistHint = zhSettings.settings.registration.emailSuffixWhitelistHint
    const enWhitelistHint = enSettings.settings.registration.emailSuffixWhitelistHint
    expect(zhWhitelistHint).toContain('留空则不限制')
    expect(enWhitelistHint).toContain('leave empty for no restriction')

    const zhQuotaHint = zhSettings.settings.registration.emailDomainQuotaHint
    const enQuotaHint = enSettings.settings.registration.emailDomainQuotaHint
    expect(zhQuotaHint).toContain('其他可注册主域名各限注册一个账户')
    expect(zhQuotaHint).toContain('关闭时非白名单域名直接拒绝')
    expect(enQuotaHint).toContain('one account')
    expect(enQuotaHint).toContain('When disabled')
  })
})

describe('admin SettingsView payment visible method controls', () => {
  beforeEach(() => {
    resetMocks()
    getUpstreamBillingProbeSettings.mockReset()
    updateUpstreamBillingProbeSettings.mockReset()
    getOllamaCloudUsageSettings.mockReset()
    updateOllamaCloudUsageSettings.mockReset()
    defaultMocks()
    getUpstreamBillingProbeSettings.mockResolvedValue({ enabled: true, all_accounts: false, interval_minutes: 30 })
    updateUpstreamBillingProbeSettings.mockImplementation(async (payload) => payload)
    getOllamaCloudUsageSettings.mockResolvedValue({ enabled: false, interval_minutes: 60, debounce_minutes: 1 })
    updateOllamaCloudUsageSettings.mockImplementation(async (payload) => payload)
  })

  it('loads and saves the open button visibility for each custom menu', async () => {
    const menuItems = [
      { id: 'docs', label: 'Docs', url: 'https://example.com/docs', icon_svg: '', visibility: 'user', sort_order: 0 },
      { id: 'help', label: 'Help', url: 'https://example.com/help', icon_svg: '', visibility: 'user', sort_order: 1, hide_open_button: true }
    ]
    getSettings.mockResolvedValue({ ...baseSettingsResponse, custom_menu_items: menuItems })
    await mountView()

    const toggles = Array.from(document.querySelectorAll<HTMLInputElement>('[data-testid="custom-menu-hide-open-button"]'))
    expect(toggles.map((toggle) => toggle.checked)).toEqual([false, true])
    await setSwitch(toggles[0]!, true)
    await setSwitch(toggles[1]!, false)
    await submit()

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        custom_menu_items: [
          { ...menuItems[0], hide_open_button: true },
          { ...menuItems[1], hide_open_button: false }
        ]
      })
    )
  })

  it('submits the compact home page toggle', async () => {
    await mountView()

    const toggle = byTestId('compact-home-toggle')
    expect(isOn(toggle)).toBe(false)

    await setSwitch(toggle, true)
    await submit()

    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ compact_home_enabled: true }))
  })

  it('loads and saves the strict priority auto-failover switch', async () => {
    await mountView()
    await openTab('gateway')

    const toggle = byTestId('strict-priority-fallback-toggle')
    expect(isOn(toggle)).toBe(true)

    await setSwitch(toggle, false)
    await submit()

    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ strict_priority_fallback: false }))
  })

  it('renders panel rate limit card and saves settings', async () => {
    getPanelRateLimitSettings.mockClear()
    updatePanelRateLimitSettings.mockClear()
    getPanelRateLimitSettings.mockResolvedValue({ enabled: true, user_rpm: 240, heavy_rpm: 60, exempt_admin: true, public_ip_rpm: 300 })
    updatePanelRateLimitSettings.mockImplementation(async (payload) => payload)

    await mountView()

    expect(getPanelRateLimitSettings).toHaveBeenCalled()
    expect(text()).toContain('admin.settings.panelRateLimit.title')
    expect(text()).toContain('admin.settings.panelRateLimit.proxySafeNote')

    const userRpmInput = byTestId('panel-rate-limit-user-rpm')
    await setValue(userRpmInput, '120')

    await click(byTestId('panel-rate-limit-save'))

    expect(updatePanelRateLimitSettings).toHaveBeenCalledWith({
      enabled: true,
      user_rpm: 120,
      heavy_rpm: 60,
      exempt_admin: true,
      public_ip_rpm: 300
    })
    expect(showSuccess).toHaveBeenCalled()
  })

  it('does not render legacy visible payment method controls', async () => {
    await mountView()
    await openTab('payment')

    expect(text()).not.toContain('可见方式')
    expect(text()).not.toContain('支付来源')
  })

  it('shows valid passkey RP configuration and persists the sign-in toggle', async () => {
    await mountView()
    await openTab('security')

    const settings = byTestId('passkey-settings')
    const toggle = byTestId('passkey-toggle', settings)
    expect(toggle).not.toBeDisabled()
    expect(settings.textContent).toContain('sub3.nebula-spaces.com')
    expect(settings.textContent).toContain('https://sub3.nebula-spaces.com')
    expect(settings.textContent).not.toContain('webauthn.enabled')

    await setSwitch(toggle, false)
    await submit()

    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ passkey_enabled: false }))
  })

  it('人机验证切换到腾讯天御并保存四项配置', async () => {
    await mountView()
    await openTab('security')

    await setSwitch(byTestId('captcha-enabled-toggle'), true)
    // 默认选中 Turnstile
    expect(text()).toContain('admin.settings.turnstile.siteKey')

    await click(byTestId('captcha-provider-tencent'))

    const card = region('admin.settings.captcha.title')
    expect(card.textContent).not.toContain('admin.settings.turnstile.siteKey')
    get('a[href="https://console.cloud.tencent.com/captcha"]', card)
    get('a[href="https://console.cloud.tencent.com/cam/capi"]', card)
    get('a[href="https://cloud.tencent.com/document/product/1110/36841"]', card)
    const inputs = Array.from(card.querySelectorAll('input')).filter((input) => input.type !== 'checkbox')
    await setValue(inputs[0]!, '123456789')
    await setValue(inputs[1]!, 'app-secret-value')
    await setValue(inputs[2]!, 'cloud-secret-id-value')
    await setValue(inputs[3]!, 'cloud-secret-key-value')

    await submit()

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        turnstile_enabled: false,
        tencent_captcha_enabled: true,
        aliyun_captcha_enabled: false,
        tencent_captcha_app_id: '123456789',
        tencent_captcha_app_secret_key: 'app-secret-value',
        tencent_captcha_cloud_secret_id: 'cloud-secret-id-value',
        tencent_captcha_cloud_secret_key: 'cloud-secret-key-value',
        tencent_captcha_region: 'cn'
      })
    )
  })

  it('腾讯天御切换到国际站后保存站点并更新控制台入口', async () => {
    await mountView()
    await openTab('security')

    await setSwitch(byTestId('captcha-enabled-toggle'), true)
    await click(byTestId('captcha-provider-tencent'))
    await click(byTestId('tencent-captcha-region-intl'))

    const card = region('admin.settings.captcha.title')
    get('a[href="https://console.tencentcloud.com/captcha/graphical"]', card)
    get('a[href="https://console.tencentcloud.com/cam/capi"]', card)

    await submit()

    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ tencent_captcha_enabled: true, tencent_captcha_region: 'intl' }))
  })

  it('人机验证切换到阿里云并保存配置', async () => {
    await mountView()
    await openTab('security')

    await setSwitch(byTestId('captcha-enabled-toggle'), true)
    await click(byTestId('captcha-provider-aliyun'))

    const card = region('admin.settings.captcha.title')
    expect(card.textContent).toContain('admin.settings.aliyunCaptcha.region')
    expect(card.textContent).not.toContain('admin.settings.turnstile.siteKey')
    const inputs = Array.from(card.querySelectorAll('input')).filter((input) => input.type !== 'checkbox')
    await setValue(inputs[0]!, 'prefix-1')
    await setValue(inputs[1]!, 'scene-1')
    await setValue(inputs[2]!, 'ak-id')
    await setValue(inputs[3]!, 'ak-secret-value')

    await submit()

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        turnstile_enabled: false,
        tencent_captcha_enabled: false,
        aliyun_captcha_enabled: true,
        aliyun_captcha_prefix: 'prefix-1',
        aliyun_captcha_scene_id: 'scene-1',
        aliyun_captcha_access_key_id: 'ak-id',
        aliyun_captcha_access_key_secret: 'ak-secret-value',
        aliyun_captcha_region: 'cn'
      })
    )
  })

  it('关闭人机验证总开关会同时关闭所有服务商', async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      tencent_captcha_enabled: true,
      tencent_captcha_app_id: '123456789',
      tencent_captcha_app_secret_key_configured: true,
      tencent_captcha_cloud_secret_id_configured: true,
      tencent_captcha_cloud_secret_key_configured: true
    })
    await mountView()
    await openTab('security')

    const masterToggle = byTestId('captcha-enabled-toggle')
    expect(isOn(masterToggle)).toBe(true)
    // 加载后选中项跟随已启用的服务商
    expect(text()).toContain('admin.settings.tencentCaptcha.appId')

    await setSwitch(masterToggle, false)
    await submit()

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ turnstile_enabled: false, tencent_captcha_enabled: false, aliyun_captcha_enabled: false })
    )
  })

  it('disables passkey sign-in when the RP configuration is unavailable', async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      passkey_enabled: false,
      passkey_configured: false,
      passkey_rp_id: '',
      passkey_rp_origins: []
    })
    await mountView()
    await openTab('security')

    const settings = byTestId('passkey-settings')
    expect(byTestId('passkey-toggle', settings)).toBeDisabled()
    const status = byTestId('passkey-config-status', settings)
    expect(status.textContent).toContain('admin.settings.security.passkeyNotConfigured')
    expect(status.textContent).toContain('webauthn.enabled')
    expect(status.textContent).toContain('webauthn.rp_id')
    expect(status.textContent).toContain('webauthn.rp_origins')
    expect(status.textContent).toContain('然后重启服务')
  })

  it('loads, edits, validates, and saves forwarded client-IP headers', async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      api_key_acl_trust_forwarded_ip: false,
      forwarded_client_ip_headers: ['cf-connecting-ip', 'X-Real-IP']
    })
    await mountView()
    await openTab('security')

    const card = region('admin.settings.apiKeyAcl.title')
    const toggle = get('[role="switch"]', card)
    expect(isOn(toggle)).toBe(false)
    expect(q('[data-testid="forwarded-client-ip-headers-input"]', card)).toBeNull()

    await setSwitch(toggle, true)
    expect(card.querySelectorAll('[data-testid="forwarded-client-ip-header-tag"]')).toHaveLength(2)
    expect(card.textContent).toContain('Cf-Connecting-Ip')
    expect(card.textContent).toContain('X-Real-Ip')
    showError.mockClear()

    const input = () => byTestId('forwarded-client-ip-headers-input', card)
    const enter = async () => {
      await act(async () => {
        fireEvent.keyDown(input(), { key: 'Enter' })
      })
    }
    await setValue(input(), 'x-client-ip')
    await enter()
    await setValue(input(), 'X-CLIENT-IP')
    await enter()
    await setValue(input(), 'invalid header')
    await enter()
    expect(showError).toHaveBeenCalledTimes(1)
    expect(card.querySelectorAll('[data-testid="forwarded-client-ip-header-tag"]')).toHaveLength(3)

    const realIpTag = Array.from(card.querySelectorAll('[data-testid="forwarded-client-ip-header-tag"]')).find((tag) =>
      tag.textContent?.includes('X-Real-Ip')
    )
    expect(realIpTag).toBeDefined()
    await click(get('button', realIpTag!))
    expect(card.textContent).not.toContain('X-Real-Ip')

    await setSwitch(toggle, false)
    expect(q('[data-testid="forwarded-client-ip-headers-input"]', card)).toBeNull()
    await setSwitch(toggle, true)
    expect(card.textContent).toContain('X-Client-Ip')

    await submit()

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        api_key_acl_trust_forwarded_ip: true,
        forwarded_client_ip_headers: ['Cf-Connecting-Ip', 'X-Client-Ip']
      })
    )
  })

  it('loads, edits, and saves recharge bonus tiers and the notice', async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      payment_recharge_bonus_tiers: [
        { min_amount: 500, bonus_percent: 30 },
        { min_amount: 100, bonus_percent: 20 }
      ],
      payment_recharge_bonus_notice: '满 100 送 20%'
    })
    await mountView()
    await openTab('payment')

    const rows = () => Array.from(document.querySelectorAll('[data-testid="recharge-bonus-tier-row"]'))
    const minInput = (row: Element) => byTestId<HTMLInputElement>('recharge-bonus-tier-min-input', row)
    const percentInput = (row: Element) => byTestId<HTMLInputElement>('recharge-bonus-tier-percent-input', row)
    // 回填按阈值升序，并渲染区间预览（首段为「不赠送」）
    expect(rows()).toHaveLength(2)
    expect(minInput(rows()[0]!).value).toBe('100')
    expect(minInput(rows()[1]!).value).toBe('500')
    expect(byTestId('recharge-bonus-tier-preview').textContent).toContain('admin.settings.payment.rechargeBonus.previewRangeNone')

    await click(byTestId('recharge-bonus-tier-add'))
    expect(rows()).toHaveLength(3)
    expect(q('[data-testid="recharge-bonus-tier-incomplete"]', rows()[2]!)).not.toBeNull()

    // 与已有档位重复的阈值行内报错，改成新阈值后消失
    await setValue(minInput(rows()[2]!), '100')
    await setValue(percentInput(rows()[2]!), '25')
    expect(q('[data-testid="recharge-bonus-tier-error"]', rows()[2]!)).not.toBeNull()
    await setValue(minInput(rows()[2]!), '1000')
    expect(q('[data-testid="recharge-bonus-tier-error"]', rows()[2]!)).toBeNull()

    // 切到折扣模式：百分比 ≥ 100 行内报错，改回 < 100 后消失
    await click(get('[data-testid="recharge-bonus-tier-editor"] button[data-value="discount"]'))
    await setValue(percentInput(rows()[2]!), '100')
    expect(byTestId('recharge-bonus-tier-error', rows()[2]!).textContent).toContain('invalidDiscountPercent')
    await setValue(percentInput(rows()[2]!), '25')
    expect(q('[data-testid="recharge-bonus-tier-error"]', rows()[2]!)).toBeNull()
    expect(byTestId('recharge-bonus-tier-preview').textContent).toContain('admin.settings.payment.rechargeBonus.previewRangeDiscount')

    const notice = byTestId<HTMLTextAreaElement>('recharge-bonus-notice-input')
    expect(notice.value).toBe('满 100 送 20%')
    await setValue(notice, '**新活动**')

    await submit()

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_recharge_bonus_tiers: [
          { min_amount: 100, bonus_percent: 20 },
          { min_amount: 500, bonus_percent: 30 },
          { min_amount: 1000, bonus_percent: 25 }
        ],
        payment_recharge_bonus_mode: 'discount',
        payment_recharge_bonus_notice: '**新活动**'
      })
    )
  })

  it('drops incomplete recharge bonus rows and submits an empty list when cleared', async () => {
    getSettings.mockResolvedValueOnce({ ...baseSettingsResponse, payment_recharge_bonus_tiers: [{ min_amount: 100, bonus_percent: 20 }] })
    await mountView()
    await openTab('payment')

    await click(byTestId('recharge-bonus-tier-remove'))
    await click(byTestId('recharge-bonus-tier-add'))
    expect(document.querySelectorAll('[data-testid="recharge-bonus-tier-row"]')).toHaveLength(1)

    await submit()

    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ payment_recharge_bonus_tiers: [] }))
  })

  it('links payment guidance to README sections instead of removed payment docs', async () => {
    await mountView()
    await openTab('payment')

    const paymentLinks = Array.from(document.querySelectorAll('a')).filter((node) =>
      ['查看支付配置说明', '查看支持的支付方式'].includes(node.textContent ?? '')
    )

    expect(paymentLinks).toHaveLength(2)
    expect(paymentLinks[0]?.getAttribute('href')).toBe('https://github.com/Wei-Shaw/sub2api/blob/main/docs/PAYMENT_CN.md')
    expect(paymentLinks[1]?.getAttribute('href')).toBe('https://github.com/Wei-Shaw/sub2api/blob/main/docs/PAYMENT_CN.md#支持的支付方式')
    for (const link of paymentLinks) expect(link.getAttribute('href')).toContain('docs/PAYMENT')
  })

  it('does not submit legacy visible payment method settings', async () => {
    await mountView()
    await openTab('payment')
    await submit()

    expect(updateSettings).toHaveBeenCalledTimes(1)
    const payload = updateSettings.mock.calls[0]?.[0]
    expect(payload).not.toHaveProperty('payment_visible_method_alipay_source')
    expect(payload).not.toHaveProperty('payment_visible_method_wxpay_source')
    expect(payload).not.toHaveProperty('payment_visible_method_alipay_enabled')
    expect(payload).not.toHaveProperty('payment_visible_method_wxpay_enabled')
  })

  it.each([
    ['submits the admin recharge affiliate rebate setting', { affiliate_enabled: true, affiliate_admin_recharge_enabled: true }, { affiliate_admin_recharge_enabled: true }],
    ['submits Anthropic cache TTL injection gateway setting', { enable_anthropic_cache_ttl_1h_injection: true }, { enable_anthropic_cache_ttl_1h_injection: true }],
    ['submits message cache_control rewrite gateway setting', { rewrite_message_cache_control: true }, { rewrite_message_cache_control: true }],
    ['submits Antigravity user agent version gateway setting', { antigravity_user_agent_version: '1.23.2' }, { antigravity_user_agent_version: '1.23.2' }]
  ])('%s', async (_name, overrides, expected) => {
    getSettings.mockResolvedValueOnce({ ...baseSettingsResponse, ...overrides })
    await mountView()
    await submit()

    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining(expected))
  })

  it('submits Claude OAuth system prompt injection gateway settings', async () => {
    const blocks = `[{"type":"text","text":"custom block","cache_control":true}]`
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      enable_claude_oauth_system_prompt_injection: false,
      claude_oauth_system_prompt_blocks: blocks
    })
    await mountView()
    await submit()

    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ enable_claude_oauth_system_prompt_injection: false }))
    const payload = updateSettings.mock.calls[0]![0] as { claude_oauth_system_prompt_blocks: string }
    expect(JSON.parse(payload.claude_oauth_system_prompt_blocks)).toEqual([
      { enabled: true, type: 'text', text: 'custom block', cache_control: { type: 'ephemeral', ttl: '5m' } }
    ])
  })

  it('updates provider enablement immediately and reloads providers', async () => {
    const provider = {
      id: 7,
      provider_key: 'alipay',
      name: 'Official Alipay',
      config: {},
      supported_types: ['alipay'],
      enabled: false,
      payment_mode: '',
      refund_enabled: false,
      allow_user_refund: false,
      limits: '',
      sort_order: 0
    }
    getProviders.mockReset()
    getProviders.mockResolvedValueOnce({ data: [provider] }).mockResolvedValueOnce({ data: [{ ...provider, enabled: true }] })
    updateProvider.mockResolvedValue({ data: { ...provider, enabled: true } })

    await mountView()
    await openTab('payment')
    await click(get('.provider-toggle-stub'))

    expect(updateProvider).toHaveBeenCalledWith(7, { enabled: true })
    expect(getProviders).toHaveBeenCalledTimes(2)
  })

  it('renders advanced scheduler copy as local experimental gateway policy', async () => {
    await mountView()

    expect(text()).toContain('OpenAI 实验调度策略')
    expect(text()).toContain('默认关闭。开启后仅影响本网关在 OpenAI 账号间的实验性调度选择逻辑')
    expect(text()).not.toContain('OpenAI 高级调度器')
  })

  it('summarizes target and other-model actions, then switches to all models', async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      openai_fast_policy_settings: {
        rules: [{ service_tier: 'all', action: 'filter', scope: 'all', model_whitelist: ['gpt-5.6-sol'], fallback_action: 'pass' }]
      }
    })
    await mountView()
    await openTab('gateway')

    const summary = byTestId('openai-fast-policy-summary-0')
    expect(summary.textContent).toContain('目标模型')
    expect(summary.textContent).toContain('过滤')
    expect(summary.textContent).toContain('其他模型')
    expect(summary.textContent).toContain('透传')

    await setValue(get('[role="group"][aria-labelledby="openai-fast-policy-models-label-0"] input[type="text"]'), '')
    const updated = byTestId('openai-fast-policy-summary-0')
    expect(updated.textContent).toContain('全部模型')
    expect(updated.textContent).toContain('过滤')
    expect(updated.textContent).not.toContain('其他模型')
    expect(updated.textContent).not.toContain('透传')
  })

  it('loads and saves upstream billing probe settings from the gateway tab', async () => {
    getUpstreamBillingProbeSettings.mockResolvedValueOnce({ enabled: false, all_accounts: false, interval_minutes: 45 })

    await mountView()
    await openTab('gateway')

    const card = byTestId('upstream-billing-probe-settings')
    expect(card).toBeVisible()
    expect(card.textContent).toContain('上游倍率自动探测')
    expect(isOn(byTestId('upstream-billing-probe-enabled', card))).toBe(false)
    expect(q('[data-testid="upstream-billing-probe-interval"]', card)).toBeNull()

    await setSwitch(byTestId('upstream-billing-probe-enabled', card), true)
    await setSwitch(byTestId('upstream-billing-probe-all-accounts', card), true)
    await setValue(byTestId('upstream-billing-probe-interval', card), 60)
    await click(byTestId('upstream-billing-probe-save', card))

    expect(updateUpstreamBillingProbeSettings).toHaveBeenCalledWith({ enabled: true, all_accounts: true, interval_minutes: 60 })
    expect(showSuccess).toHaveBeenCalledWith('上游倍率自动探测设置已保存')
  })

  it('loads and saves configurable Grok cross-client model mapping', async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      grok_default_text_model: 'grok-4.1-fast',
      grok_cross_client_model_map_enabled: true
    })
    await mountView()
    await openTab('gateway')

    const modelInput = byTestId<HTMLInputElement>('grok-default-text-model')
    const mappingToggle = byTestId('grok-cross-client-model-map-toggle')
    expect(modelInput.value).toBe('grok-4.1-fast')
    expect(isOn(mappingToggle)).toBe(true)

    await setValue(modelInput, 'grok-custom-text')
    await setSwitch(mappingToggle, false)
    await submit()

    const payload = updateSettings.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(payload.grok_default_text_model).toBe('grok-custom-text')
    expect(payload.grok_cross_client_model_map_enabled).toBe(false)
  })

  it('loads and saves the OpenAI Responses first-token metric mode', async () => {
    getSettings.mockResolvedValueOnce({ ...baseSettingsResponse, openai_ttft_mode: 'visible' })
    await mountView()
    await openTab('gateway')

    const modeSelect = byTestId<HTMLSelectElement>('openai-ttft-mode')
    expect(modeSelect.value).toBe('visible')

    await setValue(modeSelect, 'semantic')
    await submit()

    const payload = updateSettings.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(payload.openai_ttft_mode).toBe('semantic')
  })

  it('loads fail-safe-off Ollama Cloud usage refresh settings and saves an explicit opt-in', async () => {
    await mountView()
    await openTab('gateway')

    const card = byTestId('ollama-cloud-usage-global-settings')
    expect(card).toBeVisible()
    expect(isOn(byTestId('ollama-cloud-usage-global-enabled', card))).toBe(false)
    expect(q('[data-testid="ollama-cloud-usage-global-interval"]', card)).toBeNull()

    await setSwitch(byTestId('ollama-cloud-usage-global-enabled', card), true)
    await setValue(byTestId('ollama-cloud-usage-global-debounce', card), 3)
    await setValue(byTestId('ollama-cloud-usage-global-interval', card), 90)
    await click(byTestId('ollama-cloud-usage-global-save', card))

    expect(updateOllamaCloudUsageSettings).toHaveBeenCalledWith({ enabled: true, interval_minutes: 90, debounce_minutes: 3 })
  })

  it.each([false, true])('clears the OAuth rate without losing zero (weighted=%s)', async (weighted) => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      openai_low_upstream_rate_priority_enabled: !weighted,
      openai_advanced_scheduler_enabled: weighted,
      openai_oauth_scheduling_rate_multiplier: 0.7
    })
    await mountView()
    const input = () => byTestId<HTMLInputElement>('openai-oauth-scheduling-rate-multiplier')
    expect(input()).not.toHaveAttribute('required')
    await setValue(input(), '')
    await submit()
    expect(updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ openai_oauth_scheduling_rate_multiplier: null }))
    await setValue(input(), '0')
    await submit()
    expect(updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ openai_oauth_scheduling_rate_multiplier: 0 }))
    updateSettings.mockClear()
    await setValue(input(), '-1')
    await submit()
    expect(updateSettings).not.toHaveBeenCalled()
    expect(showError).toHaveBeenCalledWith('OAuth 调度参考倍率必须是非负数字，或留空以使用账号倍率。')
  })

  it('loads and preserves an explicitly cleared OAuth rate', async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      openai_advanced_scheduler_enabled: true,
      openai_oauth_scheduling_rate_multiplier: null
    })
    await mountView()
    expect(byTestId<HTMLInputElement>('openai-oauth-scheduling-rate-multiplier').value).toBe('')
    await submit()
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ openai_oauth_scheduling_rate_multiplier: null }))
  })

  it('places and explains rate controls for both scheduling modes', async () => {
    await mountView()
    expect(q('[data-testid="openai-oauth-scheduling-rate-multiplier"]')).toBeNull()

    await setSwitch(byTestId('openai-low-rate-priority-toggle'), true)
    const priorityModeText = text()
    expect(priorityModeText).toContain('OAuth 账号按此参考倍率参与低倍率优先排序；留空时使用各自的账号倍率。')
    expect(priorityModeText.indexOf('低倍率优先')).toBeLessThan(priorityModeText.indexOf('OAuth 调度参考倍率'))
    expect(priorityModeText.indexOf('OAuth 调度参考倍率')).toBeLessThan(priorityModeText.indexOf('OpenAI 实验调度策略'))

    await setValue(byTestId('openai-oauth-scheduling-rate-multiplier'), '0.05')
    await submit()

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ openai_low_upstream_rate_priority_enabled: true, openai_oauth_scheduling_rate_multiplier: 0.05 })
    )

    await setSwitch(byTestId('openai-advanced-scheduler-toggle'), true)
    expect(q('[data-testid="openai-low-rate-priority-toggle"]')).toBeNull()
    expect(q('[data-testid="openai-oauth-scheduling-rate-multiplier"]')).not.toBeNull()
    const weightedModeText = text()
    expect(weightedModeText).toContain('计算“计费倍率”得分时，OAuth 账号使用此参考倍率；留空时使用各自的账号倍率。')
    expect(weightedModeText).not.toContain('OAuth 账号按此参考倍率参与低倍率优先排序；')
    expect(weightedModeText.indexOf('订阅优先')).toBeLessThan(weightedModeText.indexOf('OAuth 调度参考倍率'))
    expect(weightedModeText.indexOf('OAuth 调度参考倍率')).toBeLessThan(weightedModeText.indexOf('调度权值覆盖'))
    expect(weightedModeText).toContain('计费倍率')
  })

  it('passes translated upload and remove labels to the payment help image uploader', async () => {
    await mountView()
    await openTab('payment')

    const imageUploads = Array.from(document.querySelectorAll('.image-upload-stub'))
    expect(imageUploads.length).toBeGreaterThan(0)

    // React 版 ImageUpload 无 placeholder 属性，说明文案放在字段提示里；按所在字段定位支付帮助图片
    const paymentHelpImageUpload = imageUploads.find((node) =>
      node.closest('div')?.parentElement?.textContent?.includes('admin.settings.payment.helpImagePlaceholder')
    )

    expect(paymentHelpImageUpload).toBeDefined()
    expect(paymentHelpImageUpload?.getAttribute('data-upload-label')).toBe('上传图片')
    expect(paymentHelpImageUpload?.getAttribute('data-remove-label')).toBe('移除')
  })

  it('normalizes null supported_types from API so provider card stays visible', async () => {
    // Backend returns null for supported_types when the list is empty
    // (Go nil slice → JSON null). Without normalization, ProviderCard's
    // isSelected() throws TypeError on null.includes(), causing the card
    // to vanish from the list.
    const providerWithNullTypes = {
      id: 42,
      provider_key: 'easypay',
      name: 'EasyPay',
      config: {},
      supported_types: null as unknown as string[],
      enabled: true,
      payment_mode: '',
      refund_enabled: false,
      allow_user_refund: false,
      limits: '',
      sort_order: 0
    }
    getProviders.mockReset()
    getProviders.mockResolvedValue({ data: [providerWithNullTypes] })

    await mountView()
    await openTab('payment')

    const receivedProviders = providerList.props?.providers ?? []
    // The provider should still be in the list
    expect(receivedProviders.length).toBe(1)
    // supported_types should be normalized to an empty array, not null
    expect(Array.isArray(receivedProviders[0]!.supported_types)).toBe(true)
    expect(receivedProviders[0]!.supported_types).toEqual([])
  })
})

describe('admin SettingsView wechat connect controls', () => {
  beforeEach(() => {
    resetMocks()
    defaultMocks()
    getSettings.mockResolvedValue({ ...baseSettingsResponse, payment_visible_method_wxpay_source: 'official_wxpay' })
    updateSettings.mockImplementation(async (payload) => ({
      ...baseSettingsResponse,
      payment_visible_method_wxpay_source: 'official_wxpay',
      ...payload
    }))
  })

  it('loads and echoes WeChat Connect fields from the backend payload', async () => {
    await mountView()
    await openTab('security')

    expect(byTestId<HTMLInputElement>('wechat-connect-mp-app-id').value).toBe('wx-app-id-123')
    expect(isOn(byTestId('wechat-connect-open-enabled'))).toBe(false)
    expect(isOn(byTestId('wechat-connect-mp-enabled'))).toBe(true)
    expect(q('[data-testid="wechat-connect-scopes"]')).toBeNull()
    expect(byTestId('wechat-connect-mp-app-secret').getAttribute('placeholder')).toContain('密钥已配置')
    expect(byTestId<HTMLInputElement>('wechat-connect-frontend-redirect-url').value).toBe('/auth/wechat/callback')
  })

  it('links GitHub OAuth Apps guide to GitHub developer settings', async () => {
    getSettings.mockResolvedValueOnce({ ...baseSettingsResponse, github_oauth_enabled: true })
    await mountView()
    await openTab('security')

    const link = byTestId('github-oauth-apps-guide-link')
    expect(link.textContent).toContain('OAuth Apps')
    expect(link.getAttribute('href')).toBe('https://github.com/settings/developers')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('saves WeChat Connect fields using the backend contract and clears the secret after save', async () => {
    await mountView()
    await openTab('security')

    await setValue(byTestId('wechat-connect-mp-app-id'), 'wx-app-id-updated')
    await setValue(byTestId('wechat-connect-mp-app-secret'), 'new-secret')
    await setSwitch(byTestId('wechat-connect-open-enabled'), true)
    await setSwitch(byTestId('wechat-connect-mp-enabled'), true)
    await setValue(byTestId('wechat-connect-redirect-url'), 'https://admin.example.com/api/v1/auth/oauth/wechat/callback')
    await setValue(byTestId('wechat-connect-frontend-redirect-url'), '/auth/wechat/callback')
    await submit()

    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        wechat_connect_enabled: true,
        wechat_connect_app_id: 'wx-app-id-updated',
        wechat_connect_open_enabled: true,
        wechat_connect_mp_enabled: true,
        wechat_connect_mp_app_id: 'wx-app-id-updated',
        wechat_connect_mp_app_secret: 'new-secret',
        wechat_connect_redirect_url: 'https://admin.example.com/api/v1/auth/oauth/wechat/callback',
        wechat_connect_frontend_redirect_url: '/auth/wechat/callback'
      })
    )
    expect(byTestId<HTMLInputElement>('wechat-connect-mp-app-secret').value).toBe('')
    expect(byTestId('wechat-connect-mp-app-secret').getAttribute('placeholder')).toContain('密钥已配置')
  })

  it('collapses auth source defaults until the source is enabled', async () => {
    await mountView()
    await openTab('users')

    expect(isOn(byTestId('auth-source-email-enabled'))).toBe(false)
    expect(q('[data-testid="auth-source-email-panel"]')).toBeNull()
    expect(text()).not.toContain('注册即授权')

    await setSwitch(byTestId('auth-source-email-enabled'), true)

    expect(q('[data-testid="auth-source-email-panel"]')).not.toBeNull()
    expect(text()).toContain('首次绑定时授权')
  })

  it('preserves optional OIDC compatibility flags instead of forcing them on save', async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      oidc_connect_enabled: true,
      oidc_connect_use_pkce: false,
      oidc_connect_validate_id_token: false
    })
    await mountView()
    await openTab('security')
    await submit()

    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ oidc_connect_use_pkce: false, oidc_connect_validate_id_token: false }))
  })
})

describe('admin SettingsView platform quota matrix', () => {
  beforeEach(() => {
    resetMocks()
    defaultMocks()
    getOverloadCooldownSettings.mockResolvedValue({})
    getRateLimit429CooldownSettings.mockResolvedValue({})
    updateRateLimit429CooldownSettings.mockResolvedValue({})
    getStreamTimeoutSettings.mockResolvedValue({})
    getRectifierSettings.mockResolvedValue({})
    getBetaPolicySettings.mockResolvedValue({})
  })

  it('从 baseSettings 加载默认平台配额数据并在 Users tab 渲染 6 平台行', async () => {
    const view = await mountView()
    await openTab('users')

    expect(getSettings).toHaveBeenCalled()

    const html = view.container.innerHTML
    // 表格行的平台字段：等宽字体渲染纯英文 platform key
    expect(html).toContain('anthropic')
    expect(html).toContain('openai')
    expect(html).toContain('gemini')
    expect(html).toContain('antigravity')
    expect(html).toContain('typesafe')
  })

  it('保存时 updateSettings payload 应包含嵌套 default_platform_quotas 对象（含全 6 平台）', async () => {
    await mountView()
    await openTab('users')
    await submit()

    expect(updateSettings).toHaveBeenCalled()
    const payload = updateSettings.mock.calls.at(-1)![0] as Record<string, unknown>

    // 应携带嵌套对象，而非扁平字段
    expect(payload).toHaveProperty('default_platform_quotas')
    const quotas = payload['default_platform_quotas'] as Record<string, unknown>
    for (const p of ['anthropic', 'openai', 'gemini', 'antigravity', 'grok', 'typesafe']) {
      expect(quotas).toHaveProperty(p)
      const pq = quotas[p] as Record<string, unknown>
      expect(pq).toHaveProperty('daily')
      expect(pq).toHaveProperty('weekly')
      expect(pq).toHaveProperty('monthly')
    }

    // 不应存在旧扁平字段
    expect(payload).not.toHaveProperty('default_platform_quota_anthropic_daily')
    expect(payload).not.toHaveProperty('default_platform_quota_openai_weekly')
  })

  it('加载后 form.default_platform_quotas 含全 6 平台，从嵌套 JSON 正确读取数值', async () => {
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      default_platform_quotas: {
        anthropic: { daily: 5, weekly: null, monthly: null },
        openai: { daily: null, weekly: 12.5, monthly: null }
        // gemini / antigravity 缺失 → 应被归一化为全 null
      }
    })
    await mountView()
    await openTab('users')
    await submit()

    const payload = updateSettings.mock.calls.at(-1)![0] as Record<string, unknown>
    const quotas = payload['default_platform_quotas'] as Record<string, Record<string, unknown>>

    expect(quotas['anthropic']?.['daily']).toBe(5)
    expect(quotas['openai']?.['weekly']).toBe(12.5)
    // 缺失平台应补全为 null
    expect(quotas['gemini']).toEqual({ daily: null, weekly: null, monthly: null })
    expect(quotas['antigravity']).toEqual({ daily: null, weekly: null, monthly: null })
    expect(quotas['typesafe']).toEqual({ daily: null, weekly: null, monthly: null })
  })

  it('空输入（v-model.number 产出 ""）在提交时清洗为 null 而非空字符串', async () => {
    // 模拟后端返回带有 anthropic daily 值的配额
    getSettings.mockResolvedValueOnce({
      ...baseSettingsResponse,
      default_platform_quotas: {
        anthropic: { daily: 10, weekly: null, monthly: null },
        openai: { daily: null, weekly: null, monthly: null },
        gemini: { daily: null, weekly: null, monthly: null },
        antigravity: { daily: null, weekly: null, monthly: null }
      }
    })
    await mountView()
    await openTab('users')

    // 找到 anthropic daily 输入框并清空（模拟用户删除值）
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"]'))
    const anthropicDailyInput = inputs.find((i) => i.closest('tr')?.textContent?.includes('anthropic'))
    if (anthropicDailyInput) {
      // 设置为空字符串，模拟清空时产出 ""
      await setValue(anthropicDailyInput, '')
    }

    await submit()

    const payload = updateSettings.mock.calls.at(-1)![0] as Record<string, unknown>
    const quotas = payload['default_platform_quotas'] as Record<string, Record<string, unknown>>
    // 不管输入是什么，提交值应为 null（而非 "" 或 NaN）
    expect(quotas['anthropic']?.['daily']).toBe(null)
  })
})
