/**
 * 分组表单：模型系列、MCP XML 注入、Claude Code 限制、OpenAI Fast / Live / Messages 调度、账号过滤与无效请求兜底。
 * 分组已是全平台分组，多数区块一律展示；仍按平台判断的条件与 Vue 版保持一致。
 */
import { ArrowRight, Plus, Trash2 } from 'lucide-react'

import { FormSection } from '@/components/account/AccountFormLayout'
import Select, { type SelectOption } from '@/components/common/Select'
import { useI18n } from '@/i18n/useI18n'
import { supportsMessagesDispatchPlatform } from '@/views/admin/groupsMessagesDispatch'
import { supportsGroupOpenAIFast } from '@/views/admin/groupsOpenAIFast'
import { supportsLivePlatform } from './groupForm'
import { CheckField, HelpLabel, SwitchRow, TextField } from './GroupFormControls'
import styles from './GroupForm.module.css'
import type { GroupFormController } from './useGroupForm'

// 支持的模型系列
export function GroupSupportedScopesSection({ ctl }: { ctl: GroupFormController }) {
  const { t } = useI18n()
  const { form, update } = ctl
  const toggleScope = (scope: string) => {
    const scopes = form.supported_model_scopes
    update({
      supported_model_scopes: scopes.includes(scope) ? scopes.filter((s) => s !== scope) : [...scopes, scope]
    })
  }
  return (
    <FormSection>
      <HelpLabel label={t('admin.groups.supportedScopes.title')} help={t('admin.groups.supportedScopes.tooltip')} />
      <div className={styles.checkStack}>
        <CheckField
          label={t('admin.groups.supportedScopes.claude')}
          checked={form.supported_model_scopes.includes('claude')}
          onChange={() => toggleScope('claude')}
        />
        <CheckField
          label={t('admin.groups.supportedScopes.geminiText')}
          checked={form.supported_model_scopes.includes('gemini_text')}
          onChange={() => toggleScope('gemini_text')}
        />
        <CheckField
          label={t('admin.groups.supportedScopes.geminiImage')}
          checked={form.supported_model_scopes.includes('gemini_image')}
          onChange={() => toggleScope('gemini_image')}
        />
      </div>
      <p className={styles.hint}>{t('admin.groups.supportedScopes.hint')}</p>
    </FormSection>
  )
}

// MCP XML 协议注入
export function GroupMcpXmlSection({ ctl }: { ctl: GroupFormController }) {
  const { t } = useI18n()
  const { form, update } = ctl
  return (
    <FormSection>
      <SwitchRow
        label={t('admin.groups.mcpXml.title')}
        help={t('admin.groups.mcpXml.tooltip')}
        description={form.mcp_xml_inject ? t('admin.groups.mcpXml.enabled') : t('admin.groups.mcpXml.disabled')}
        checked={form.mcp_xml_inject}
        onChange={(mcp_xml_inject) => update({ mcp_xml_inject })}
      />
    </FormSection>
  )
}

// Claude Code 客户端限制
export function GroupClaudeCodeSection({
  ctl,
  fallbackOptions
}: {
  ctl: GroupFormController
  fallbackOptions: SelectOption[]
}) {
  const { t } = useI18n()
  const { form, update } = ctl
  return (
    <FormSection>
      <SwitchRow
        label={t('admin.groups.claudeCode.title')}
        help={t('admin.groups.claudeCode.tooltip')}
        description={form.claude_code_only ? t('admin.groups.claudeCode.enabled') : t('admin.groups.claudeCode.disabled')}
        checked={form.claude_code_only}
        onChange={(claude_code_only) => update({ claude_code_only })}
      >
        {/* 降级分组选择（仅当启用 claude_code_only 时显示） */}
        {form.claude_code_only ? (
          <div className={`${styles.indented} ${styles.field}`}>
            <span className={styles.label}>{t('admin.groups.claudeCode.fallbackGroup')}</span>
            <Select
              value={form.fallback_group_id}
              options={fallbackOptions}
              placeholder={t('admin.groups.claudeCode.noFallback')}
              aria-label={t('admin.groups.claudeCode.fallbackGroup')}
              onChange={(value) => update({ fallback_group_id: value as number | null })}
            />
            <p className={styles.hint}>{t('admin.groups.claudeCode.fallbackHint')}</p>
          </div>
        ) : null}
      </SwitchRow>
    </FormSection>
  )
}

// OpenAI Fast 开关
export function GroupOpenAIFastSection({ ctl }: { ctl: GroupFormController }) {
  const { t } = useI18n()
  const { form, update, mode } = ctl
  if (!supportsGroupOpenAIFast(form.platform)) return null
  return (
    <FormSection title={t('admin.groups.openaiFast.title')}>
      <SwitchRow
        label={t('admin.groups.openaiFast.force')}
        description={t('admin.groups.openaiFast.hint')}
        data-testid={`${mode}-force-openai-fast`}
        checked={form.force_openai_fast}
        onChange={(force_openai_fast) => update({ force_openai_fast })}
      />
      <SwitchRow
        label={t('admin.groups.openaiFast.free')}
        description={t('admin.groups.openaiFast.freeHint')}
        data-testid={`${mode}-free-openai-fast`}
        checked={form.free_openai_fast}
        onChange={(free_openai_fast) => update({ free_openai_fast })}
      />
    </FormSection>
  )
}

// Codex Live 开关：打开前先确认后端能力，不支持时由页面弹出确认框
export function GroupLiveSection({ ctl, onToggleLive }: { ctl: GroupFormController; onToggleLive: () => void }) {
  const { t } = useI18n()
  const { form } = ctl
  if (!supportsLivePlatform(form.platform)) return null
  return (
    <FormSection title={t('admin.groups.openaiLive.title')}>
      <SwitchRow
        label={t('admin.groups.openaiLive.allow')}
        description={t('admin.groups.openaiLive.hint')}
        checked={form.allow_live}
        onChange={() => onToggleLive()}
      />
    </FormSection>
  )
}

// OpenAI Messages 调度配置
export function GroupMessagesDispatchSection({ ctl }: { ctl: GroupFormController }) {
  const { t } = useI18n()
  const { form, update } = ctl
  if (!supportsMessagesDispatchPlatform(form.platform)) return null

  const rows = form.exact_model_mappings
  const setRow = (index: number, patch: Partial<(typeof rows)[number]>) =>
    update({ exact_model_mappings: rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) })
  const addRow = () => update({ exact_model_mappings: [...rows, { claude_model: '', target_model: '' }] })
  const removeRow = (index: number) => update({ exact_model_mappings: rows.filter((_, i) => i !== index) })

  return (
    <FormSection title={t('admin.groups.openaiMessages.title')}>
      <SwitchRow
        label={t('admin.groups.openaiMessages.allowDispatch')}
        description={t('admin.groups.openaiMessages.allowDispatchHint')}
        checked={form.allow_messages_dispatch}
        onChange={(allow_messages_dispatch) => update({ allow_messages_dispatch })}
      />
      {form.allow_messages_dispatch ? (
        <div className={styles.indented}>
          <div className={styles.toggleText}>
            <span className={styles.label}>{t('admin.groups.openaiMessages.familyMappingTitle')}</span>
            <p className={styles.hint}>{t('admin.groups.openaiMessages.familyMappingHint')}</p>
          </div>
          <div className={styles.grid3}>
            <TextField
              label={t('admin.groups.openaiMessages.opusModel')}
              value={form.opus_mapped_model}
              placeholder={t('admin.groups.openaiMessages.opusModelPlaceholder')}
              onChange={(opus_mapped_model) => update({ opus_mapped_model })}
            />
            <TextField
              label={t('admin.groups.openaiMessages.sonnetModel')}
              value={form.sonnet_mapped_model}
              placeholder={t('admin.groups.openaiMessages.sonnetModelPlaceholder')}
              onChange={(sonnet_mapped_model) => update({ sonnet_mapped_model })}
            />
            <TextField
              label={t('admin.groups.openaiMessages.haikuModel')}
              value={form.haiku_mapped_model}
              placeholder={t('admin.groups.openaiMessages.haikuModelPlaceholder')}
              onChange={(haiku_mapped_model) => update({ haiku_mapped_model })}
            />
          </div>

          <div className={styles.toggleText}>
            <span className={styles.label}>{t('admin.groups.openaiMessages.exactMappingTitle')}</span>
            <p className={styles.hint}>{t('admin.groups.openaiMessages.exactMappingHint')}</p>
          </div>
          {rows.length === 0 ? (
            <div className={styles.emptyRow}>
              <span>{t('admin.groups.openaiMessages.noExactMappings')}</span>
              <button type="button" className={styles.linkButton} onClick={addRow}>
                <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
                {t('admin.groups.openaiMessages.addExactMapping')}
              </button>
            </div>
          ) : (
            <div className={styles.rows}>
              {rows.map((row, index) => (
                // 行没有稳定 ID（请求体原样展开表单，不能附加字段）；输入框受控，用下标作 key 不会错位
                <div key={index} className={styles.rowCard}>
                  <div className={`${styles.rowBody} ${styles.mappingGrid}`}>
                    <TextField
                      label={t('admin.groups.openaiMessages.claudeModel')}
                      value={row.claude_model}
                      placeholder={t('admin.groups.openaiMessages.claudeModelPlaceholder')}
                      onChange={(claude_model) => setRow(index, { claude_model })}
                    />
                    <div className={styles.mappingArrow} aria-hidden="true">
                      <ArrowRight size={16} strokeWidth={1.75} />
                    </div>
                    <TextField
                      label={t('admin.groups.openaiMessages.targetModel')}
                      value={row.target_model}
                      placeholder={t('admin.groups.openaiMessages.targetModelPlaceholder')}
                      onChange={(target_model) => setRow(index, { target_model })}
                    />
                  </div>
                  <button
                    type="button"
                    className={styles.iconButton}
                    data-tone="danger"
                    title={t('admin.groups.openaiMessages.removeExactMapping')}
                    aria-label={t('admin.groups.openaiMessages.removeExactMapping')}
                    onClick={() => removeRow(index)}
                  >
                    <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <button type="button" className={styles.linkButton} onClick={addRow}>
                <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
                {t('admin.groups.openaiMessages.addExactMapping')}
              </button>
            </div>
          )}
        </div>
      ) : null}
    </FormSection>
  )
}

// 账号过滤控制 (OpenAI/Antigravity/Anthropic/Gemini)
export function GroupAccountFiltersSection({ ctl }: { ctl: GroupFormController }) {
  const { t } = useI18n()
  const { form, update } = ctl
  if (!['openai', 'antigravity', 'anthropic', 'gemini'].includes(form.platform)) return null
  return (
    <FormSection title={t('admin.groups.accountFilters.title')}>
      <SwitchRow
        label={t('admin.groups.accountFilters.oauthOnly')}
        description={
          form.require_oauth_only
            ? t('admin.groups.accountFilters.oauthOnlyEnabled')
            : t('admin.groups.accountFilters.disabled')
        }
        checked={form.require_oauth_only}
        onChange={(require_oauth_only) => update({ require_oauth_only })}
      />
      <SwitchRow
        label={t('admin.groups.accountFilters.privacySetOnly')}
        description={
          form.require_privacy_set
            ? t('admin.groups.accountFilters.privacySetOnlyEnabled')
            : t('admin.groups.accountFilters.disabled')
        }
        checked={form.require_privacy_set}
        onChange={(require_privacy_set) => update({ require_privacy_set })}
      />
    </FormSection>
  )
}

// 无效请求兜底（仅 anthropic/antigravity 平台，且非订阅分组）
export function GroupInvalidRequestFallbackSection({
  ctl,
  options
}: {
  ctl: GroupFormController
  options: SelectOption[]
}) {
  const { t } = useI18n()
  const { form, update } = ctl
  if (!['anthropic', 'antigravity'].includes(form.platform) || form.subscription_type === 'subscription') return null
  return (
    <FormSection>
      <div className={styles.field}>
        <span className={styles.label}>{t('admin.groups.invalidRequestFallback.title')}</span>
        <Select
          value={form.fallback_group_id_on_invalid_request}
          options={options}
          placeholder={t('admin.groups.invalidRequestFallback.noFallback')}
          aria-label={t('admin.groups.invalidRequestFallback.title')}
          onChange={(value) => update({ fallback_group_id_on_invalid_request: value as number | null })}
        />
        <p className={styles.hint}>{t('admin.groups.invalidRequestFallback.hint')}</p>
      </div>
    </FormSection>
  )
}

