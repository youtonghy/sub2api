/**
 * 系统设置（对应 Vue 版 SettingsView.vue）。
 * 本组件只负责：表单草稿、加载、整表保存、脏检查与 Tab 外壳；
 * 每个 Tab 的内容在 views/admin/settings/ 下各自一个组件，通过 useSettings() 读写草稿。
 * 与 Vue 版的 v-show 一致，所有 Tab 都保持挂载，只隐藏未激活的面板。
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { BadgeCheck, CreditCard, Database, FileText, Home, Mail, Server, Shield, User, Zap } from 'lucide-react'

import { adminAPI } from '@/api'
import { buildAuthSourceDefaultsState, type WebSearchProviderConfig } from '@/api/admin/settings'
import { Button } from '@/components/arc/button/button'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs'
import TotpStepUpDialog from '@/components/auth/TotpStepUpDialog'
import { useMountOnce } from '@/composables/useMountOnce'
import { isStepUpBlocked, isStepUpCancelled, stepUpBlockReason, useStepUp } from '@/composables/useStepUp'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores'
import { useAdminSettingsStore } from '@/stores/adminSettings'
import type { AdminGroup, Proxy } from '@/types'
import { extractApiErrorMessage } from '@/utils/apiError'
import BackupView from './BackupView'
import AgreementTab from './settings/AgreementTab'
import { authSourceDefaultsMeta } from './settings/authSourceMeta'
import { createDefaultClaudeOAuthSystemPromptBlocks, serializeClaudeOAuthSystemPromptBlocksToJSON } from './settings/claudeOAuthBlocks'
import EmailTab from './settings/EmailTab'
import FeaturesTab from './settings/FeaturesTab'
import GatewayTab from './settings/GatewayTab'
import GeneralTab from './settings/GeneralTab'
import PaymentTab from './settings/PaymentTab'
import SecurityTab from './settings/SecurityTab'
import { SettingsContext, type DraftPatch, type FormPatch, type SettingsContextValue } from './settings/settingsContext'
import {
  SETTINGS_TABS,
  createDefaultSettingsForm,
  syncedCaptchaProvider,
  type SettingsDraft,
  type SettingsTab,
  type SettingsUiState
} from './settings/settingsForm'
import { applyLoadedSettings, applySavedSettings, prepareSettingsSave } from './settings/settingsPersistence'
import UsersTab from './settings/UsersTab'
import styles from './settings/SettingsView.module.css'

const TAB_ICONS: Record<SettingsTab, typeof Home> = {
  general: Home,
  agreement: FileText,
  features: Zap,
  security: Shield,
  users: User,
  gateway: Server,
  payment: CreditCard,
  email: Mail,
  backup: Database
}

function createInitialDraft(localText: (zh: string, en: string) => string): SettingsDraft {
  return {
    form: createDefaultSettingsForm(localText),
    authSourceDefaults: buildAuthSourceDefaultsState({}),
    claudeBlocks: createDefaultClaudeOAuthSystemPromptBlocks(),
    codexBlacklistRows: [],
    codexWhitelistRows: [],
    codexFingerprintRows: [],
    registrationEmailSuffixWhitelistTags: [],
    tablePageSizeOptionsInput: '10, 20, 50, 100',
    openaiFastPolicyRules: [],
    webSearchConfig: { enabled: false, providers: [] }
  }
}

const initialUi: SettingsUiState = {
  captchaProvider: 'turnstile',
  smtpPasswordManuallyEdited: false,
  registrationEmailSuffixWhitelistDraft: '',
  forwardedClientIpHeaderDraft: ''
}

/** 脏检查用的快照：分块按提交时的 JSON 比较，忽略展开状态等纯界面字段 */
function dirtyKey(draft: SettingsDraft): string {
  return JSON.stringify({
    ...draft,
    form: { ...draft.form, claude_oauth_system_prompt_blocks: undefined },
    claudeBlocks: serializeClaudeOAuthSystemPromptBlocksToJSON(draft.claudeBlocks)
  })
}

export default function SettingsView() {
  const { t, locale } = useI18n()
  // 关闭 step-up 开关是敏感操作：后端返回 STEP_UP_REQUIRED 时弹 TOTP 码重试
  const settingsStepUp = useStepUp()
  const isZhLocale = locale.startsWith('zh')
  const localText = useCallback((zh: string, en: string) => (isZhLocale ? zh : en), [isZhLocale])

  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<SettingsDraft>(() => createInitialDraft(localText))
  const [baseline, setBaseline] = useState<string | null>(null)
  const [ui, setUi] = useState<SettingsUiState>(initialUi)
  const [subscriptionGroups, setSubscriptionGroups] = useState<AdminGroup[]>([])
  const [webSearchProxies, setWebSearchProxies] = useState<Proxy[]>([])
  // 标记 openai_fast_policy_settings 是否已成功从后端加载，
  // 避免后端 GET 出错或字段缺失时，保存把默认规则覆盖成空数组。
  const fastPolicyLoaded = useRef(false)

  // 异步保存（支付服务商保存后会再调用）需要读取最新草稿
  const draftRef = useRef(draft)
  useLayoutEffect(() => {
    draftRef.current = draft
  }, [draft])

  const currentKey = useMemo(() => dirtyKey(draft), [draft])
  const dirty = baseline !== null && currentKey !== baseline

  const updateForm = useCallback((patch: FormPatch) => {
    setDraft((prev) => ({ ...prev, form: { ...prev.form, ...(typeof patch === 'function' ? patch(prev.form) : patch) } }))
  }, [])
  const updateDraft = useCallback((patch: DraftPatch) => {
    setDraft((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }))
  }, [])
  const updateUi = useCallback((patch: Partial<SettingsUiState>) => {
    setUi((prev) => ({ ...prev, ...patch }))
  }, [])

  const commitDraft = useCallback((next: SettingsDraft) => {
    draftRef.current = next
    setDraft(next)
    setBaseline(dirtyKey(next))
  }, [])

  async function loadWebSearchConfig(): Promise<Pick<SettingsDraft, 'webSearchConfig'> | null> {
    try {
      const [resp, proxiesResp] = await Promise.all([
        adminAPI.settings.getWebSearchEmulationConfig(),
        adminAPI.proxies.list().catch(() => ({ items: [] as Proxy[] }))
      ])
      setWebSearchProxies(proxiesResp.items || [])
      if (resp) return { webSearchConfig: { enabled: resp.enabled || false, providers: resp.providers || [] } }
      return null
    } catch (err: unknown) {
      // 404 is expected when config hasn't been created yet; show error for other failures
      const status = (err as { status?: number })?.status
      if (status !== 404 && status !== undefined) {
        useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
      }
      return null
    }
  }

  async function loadSettings() {
    setLoading(true)
    setLoadFailed(false)
    try {
      const settings = await adminAPI.settings.getSettings()
      const loaded = applyLoadedSettings(settings, draftRef.current, localText)
      if (loaded.fastPolicyLoaded) fastPolicyLoaded.current = true
      setUi((prev) => ({
        ...prev,
        captchaProvider: syncedCaptchaProvider(loaded.draft.form, prev.captchaProvider),
        smtpPasswordManuallyEdited: false,
        registrationEmailSuffixWhitelistDraft: '',
        forwardedClientIpHeaderDraft: ''
      }))
      // Load web search emulation config separately
      const webSearch = await loadWebSearchConfig()
      commitDraft(webSearch ? { ...loaded.draft, ...webSearch } : loaded.draft)
    } catch (error: unknown) {
      setLoadFailed(true)
      useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.settings.failedToLoad')))
    } finally {
      setLoading(false)
    }
  }

  async function loadSubscriptionGroups() {
    try {
      const groups = await adminAPI.groups.getAll()
      setSubscriptionGroups(groups.filter((group) => group.subscription_type === 'subscription' && group.status === 'active'))
    } catch {
      setSubscriptionGroups([])
    }
  }

  useMountOnce(() => {
    void loadSettings()
    void loadSubscriptionGroups()
  })

  async function saveWebSearchConfig(current: SettingsDraft): Promise<boolean> {
    try {
      for (const p of current.webSearchConfig.providers) {
        const raw = p.quota_limit
        if (raw != null && Number(raw) !== 0 && Number(raw) < 1) {
          useAppStore.getState().showError(t('admin.settings.webSearchEmulation.quotaLimitMustBePositive'))
          return false
        }
      }
      const providers = current.webSearchConfig.providers.map((p: WebSearchProviderConfig) => ({
        ...p,
        quota_limit: Number(p.quota_limit) > 0 ? Number(p.quota_limit) : null
      }))
      await adminAPI.settings.updateWebSearchEmulationConfig({ enabled: current.webSearchConfig.enabled, providers })
      return true
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
      return false
    }
  }

  const saveSettings = async () => {
    const appStore = useAppStore.getState()
    setSaving(true)
    try {
      const prepared = prepareSettingsSave(draftRef.current, {
        t,
        localText,
        authSources: authSourceDefaultsMeta(t, localText),
        fastPolicyLoaded: fastPolicyLoaded.current
      })
      draftRef.current = prepared.draft
      setDraft(prepared.draft)
      if (!prepared.ok) {
        appStore.showError(prepared.error)
        return
      }

      const updated = await settingsStepUp.run(() => adminAPI.settings.updateSettings(prepared.payload))
      const saved = applySavedSettings(updated, draftRef.current)
      if (saved.fastPolicyLoaded) fastPolicyLoaded.current = true
      setUi((prev) => ({
        ...prev,
        smtpPasswordManuallyEdited: false,
        registrationEmailSuffixWhitelistDraft: '',
        forwardedClientIpHeaderDraft: ''
      }))
      commitDraft(saved.draft)
      // Save web search emulation config separately (errors handled internally)
      const wsOk = await saveWebSearchConfig(saved.draft)
      // Refresh cached settings so sidebar/header update immediately
      await appStore.fetchPublicSettings(true)
      await useAdminSettingsStore.getState().fetch(true)
      if (wsOk) appStore.showSuccess(t('admin.settings.settingsSaved'))
    } catch (error: unknown) {
      // 用户取消 step-up 验证：静默返回，不弹错误
      if (isStepUpCancelled(error)) return
      if (isStepUpBlocked(error)) {
        appStore.showError(
          stepUpBlockReason(error) === 'STEP_UP_ADMIN_API_KEY_FORBIDDEN' ? t('stepUp.adminApiKeyForbidden') : t('stepUp.notEnabled')
        )
        return
      }
      // 开启 step-up 开关但本人未启用 2FA：给出可操作的专用提示
      if ((error as { reason?: string })?.reason === 'STEP_UP_ENABLE_REQUIRES_TOTP') {
        appStore.showError(t('admin.settings.security.stepUpEnableRequiresTotp'))
        return
      }
      appStore.showError(extractApiErrorMessage(error, t('admin.settings.failedToSave')))
    } finally {
      setSaving(false)
    }
  }
  const saveSettingsRef = useRef(saveSettings)
  useLayoutEffect(() => {
    saveSettingsRef.current = saveSettings
  })
  const stableSave = useCallback(() => saveSettingsRef.current(), [])

  const contextValue = useMemo<SettingsContextValue>(
    () => ({
      draft,
      form: draft.form,
      ui,
      updateForm,
      updateDraft,
      updateUi,
      subscriptionGroups,
      webSearchProxies,
      saveSettings: stableSave,
      localText,
      loadFailed
    }),
    [draft, ui, updateForm, updateDraft, updateUi, subscriptionGroups, webSearchProxies, stableSave, localText, loadFailed]
  )

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // 弹窗通过 Portal 渲染，其内部表单的 submit 会沿 React 树冒泡到这里，只处理本表单自身的提交
    if (event.target !== event.currentTarget) return
    void saveSettings()
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <Skeleton label={t('common.loading')} lines={8} />
      </div>
    )
  }

  return (
    <SettingsContext.Provider value={contextValue}>
      <div className={styles.page}>
        <form className={styles.form} noValidate onSubmit={handleSubmit}>
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as SettingsTab)} className={styles.tabs}>
            <div className={styles.tabBar}>
              <TabsList aria-label={t('admin.settings.title')}>
                {SETTINGS_TABS.map((tab) => {
                  const Icon = TAB_ICONS[tab]
                  return (
                    <TabsTrigger key={tab} value={tab} id={`settings-tab-${tab}`}>
                      <span className={styles.tabLabel}>
                        <Icon size={15} aria-hidden="true" />
                        {t(`admin.settings.tabs.${tab}`)}
                      </span>
                    </TabsTrigger>
                  )
                })}
              </TabsList>
            </div>
            <TabsContent value="general" forceMount className={styles.panel}>
              <GeneralTab />
            </TabsContent>
            <TabsContent value="agreement" forceMount className={styles.panel}>
              <AgreementTab />
            </TabsContent>
            <TabsContent value="features" forceMount className={styles.panel}>
              <FeaturesTab />
            </TabsContent>
            <TabsContent value="security" forceMount className={styles.panel}>
              <SecurityTab />
            </TabsContent>
            <TabsContent value="users" forceMount className={styles.panel}>
              <UsersTab />
            </TabsContent>
            <TabsContent value="gateway" forceMount className={styles.panel}>
              <GatewayTab />
            </TabsContent>
            <TabsContent value="payment" forceMount className={styles.panel}>
              <PaymentTab />
            </TabsContent>
            <TabsContent value="email" forceMount className={styles.panel}>
              <EmailTab />
            </TabsContent>
            <TabsContent value="backup" forceMount className={styles.panel}>
              <BackupView />
            </TabsContent>
          </Tabs>

          {activeTab !== 'backup' ? (
            <div className={styles.saveBar}>
              <span className={styles.saveStatus} role="status" data-dirty={dirty || undefined}>
                {baseline === null ? null : dirty ? (
                  t('settingsUi.unsavedChanges')
                ) : (
                  <>
                    <BadgeCheck size={14} aria-hidden="true" />
                    {t('settingsUi.allSaved')}
                  </>
                )}
              </span>
              <Button type="submit" loading={saving} disabled={saving || loadFailed} data-testid="settings-save">
                {saving ? t('admin.settings.saving') : t('admin.settings.saveSettings')}
              </Button>
            </div>
          ) : null}
        </form>
        {/* 关闭 step-up 开关等敏感保存操作触发的 TOTP 二次验证 */}
        <TotpStepUpDialog controller={settingsStepUp} />
      </div>
    </SettingsContext.Provider>
  )
}
