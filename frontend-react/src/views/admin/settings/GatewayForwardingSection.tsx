/** 网关转发行为（Grok、首 token 统计、指纹、Claude OAuth system prompt 分块、版本号等），随整表保存 */
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, RefreshCw, Trash2 } from 'lucide-react'

import { Button } from '@/components/arc/button/button'
import { Field, SettingSwitch, SettingsRegion, ToggleRow } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { cx } from '@/components/admin/settings/settingsUtils'
import Select from '@/components/common/Select'
import { useI18n } from '@/i18n/useI18n'
import {
  createClaudeOAuthSystemPromptBlock,
  createDefaultClaudeOAuthSystemPromptBlocks,
  defaultClaudeCodeExpansionPrompt,
  defaultClaudeCodeSystemPrompt,
  detectClaudeOAuthSystemPromptPreset,
  serializeClaudeOAuthSystemPromptBlocksToJSON,
  type ClaudeOAuthSystemPromptBlock,
  type ClaudeOAuthSystemPromptPreset
} from './claudeOAuthBlocks'
import { useSettings } from './settingsContext'
import type { SettingsForm } from './settingsForm'
import styles from './GatewayForwardingSection.module.css'

function ClaudeSystemPromptBlocks() {
  const { t } = useI18n()
  const { draft, updateDraft } = useSettings()
  const blocks = draft.claudeBlocks

  const presetOptions = [
    { value: 'billing', label: t('admin.settings.gatewayForwarding.systemBlockPresetBilling') },
    { value: 'system', label: t('admin.settings.gatewayForwarding.systemBlockPresetIdentity') },
    { value: 'expansion', label: t('admin.settings.gatewayForwarding.systemBlockPresetExpansion') },
    { value: 'custom', label: t('admin.settings.gatewayForwarding.systemBlockPresetCustom') }
  ]
  const typeOptions = [{ value: 'text', label: t('admin.settings.gatewayForwarding.systemBlockTypeText') }]
  const ttlOptions = [
    { value: '5m', label: t('admin.settings.gatewayForwarding.cacheTTL5m') },
    { value: '1h', label: t('admin.settings.gatewayForwarding.cacheTTL1h') }
  ]
  const presetLabel = (preset: ClaudeOAuthSystemPromptPreset) =>
    presetOptions.find((option) => option.value === preset)?.label || t('admin.settings.gatewayForwarding.systemBlockPresetCustom')

  /** 修改分块并同步表单字段（对应 Vue 版 syncClaudeOAuthSystemPromptBlocksFormField） */
  function setBlocks(next: (list: ClaudeOAuthSystemPromptBlock[], form: SettingsForm) => ClaudeOAuthSystemPromptBlock[], sync = true) {
    updateDraft((d) => {
      const claudeBlocks = next(d.claudeBlocks, d.form)
      return sync
        ? {
            claudeBlocks,
            form: { ...d.form, claude_oauth_system_prompt_blocks: serializeClaudeOAuthSystemPromptBlocksToJSON(claudeBlocks) }
          }
        : { claudeBlocks }
    })
  }
  function updateBlock(index: number, patch: Partial<ClaudeOAuthSystemPromptBlock>, sync = true) {
    setBlocks((list) => list.map((block, i) => (i === index ? { ...block, ...patch } : block)), sync)
  }

  function applyPreset(index: number, value: string) {
    const preset = (value || 'custom') as ClaudeOAuthSystemPromptPreset
    setBlocks((list, form) =>
      list.map((block, i) => {
        if (i !== index) return block
        const next: ClaudeOAuthSystemPromptBlock = { ...block, preset, type: 'text' }
        if (preset === 'billing') Object.assign(next, { text: '{billing_header}', cacheControlEnabled: false, cacheControlTTL: '5m' })
        else if (preset === 'system')
          Object.assign(next, { text: defaultClaudeCodeSystemPrompt, cacheControlEnabled: false, cacheControlTTL: '5m' })
        else if (preset === 'expansion')
          Object.assign(next, {
            text: form.claude_oauth_system_prompt.trim() || defaultClaudeCodeExpansionPrompt,
            cacheControlEnabled: true,
            cacheControlTTL: '5m'
          })
        return next
      })
    )
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= blocks.length) return
    setBlocks((list) => {
      const next = [...list]
      const current = next[index]!
      next[index] = next[target]!
      next[target] = current
      return next
    })
  }

  return (
    <Field label={t('admin.settings.gatewayForwarding.claudeOAuthSystemPromptBlocks')}>
      <div className={s.columnTight}>
        {blocks.map((block, index) => (
          <div key={block.id} className={s.item}>
            <div className={s.itemHead}>
              <div className={s.columnTight}>
                <span className={s.itemTitle}>{t('admin.settings.gatewayForwarding.systemBlockTitle', { index: index + 1 })}</span>
                <span className={s.hint}>{presetLabel(block.preset)}</span>
              </div>
              <div className={s.inline}>
                <button
                  type="button"
                  className={s.iconButton}
                  title={block.expanded ? t('admin.settings.gatewayForwarding.systemBlockHide') : t('admin.settings.gatewayForwarding.systemBlockShow')}
                  aria-label={
                    block.expanded ? t('admin.settings.gatewayForwarding.systemBlockHide') : t('admin.settings.gatewayForwarding.systemBlockShow')
                  }
                  onClick={() => updateBlock(index, { expanded: !block.expanded }, false)}
                >
                  {block.expanded ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                </button>
                <button type="button" className={s.iconButton} aria-label="↑" disabled={index === 0} onClick={() => move(index, -1)}>
                  <ArrowUp size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={s.iconButton}
                  aria-label="↓"
                  disabled={index === blocks.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={14} aria-hidden="true" />
                </button>
                <SettingSwitch
                  checked={block.enabled}
                  aria-label={t('admin.settings.gatewayForwarding.systemBlockTitle', { index: index + 1 })}
                  onChange={(enabled) => updateBlock(index, { enabled }, false)}
                />
                <button
                  type="button"
                  className={cx(s.iconButton, s.iconButtonDanger)}
                  aria-label={t('common.delete')}
                  onClick={() => setBlocks((list) => list.filter((_, i) => i !== index))}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className={s.column} hidden={!block.expanded}>
              <div className={s.grid2}>
                <Field label={t('admin.settings.gatewayForwarding.systemBlockPreset')}>
                  <Select value={block.preset} options={presetOptions} onChange={(value) => applyPreset(index, String(value ?? ''))} />
                </Field>
                <Field label={t('admin.settings.gatewayForwarding.systemBlockType')}>
                  <Select value={block.type} options={typeOptions} onChange={() => updateBlock(index, { type: 'text' }, false)} />
                </Field>
              </div>
              <Field label={t('admin.settings.gatewayForwarding.systemBlockText')}>
                <textarea
                  rows={6}
                  className={cx(s.textarea, s.mono)}
                  value={block.text}
                  onChange={(e) =>
                    updateBlock(index, { text: e.target.value, preset: detectClaudeOAuthSystemPromptPreset(e.target.value) })
                  }
                />
              </Field>
              <div className={styles.cacheRow}>
                <div className={s.inline}>
                  <span className={s.hint}>{t('admin.settings.gatewayForwarding.systemBlockCacheControl')}</span>
                  <SettingSwitch
                    checked={block.cacheControlEnabled}
                    aria-label={t('admin.settings.gatewayForwarding.systemBlockCacheControl')}
                    onChange={(cacheControlEnabled) => updateBlock(index, { cacheControlEnabled }, false)}
                  />
                </div>
                {block.cacheControlEnabled ? (
                  <div className={styles.ttlSelect}>
                    <Select
                      value={block.cacheControlTTL}
                      options={ttlOptions}
                      onChange={(value) => updateBlock(index, { cacheControlTTL: String(value) }, false)}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ))}
        <div className={s.inline}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setBlocks((list) => [...list, createClaudeOAuthSystemPromptBlock({ expanded: true, preset: 'custom', text: '' })])}
          >
            <Plus size={14} aria-hidden="true" />
            {t('admin.settings.gatewayForwarding.addSystemBlock')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setBlocks((_, form) => createDefaultClaudeOAuthSystemPromptBlocks(form.claude_oauth_system_prompt))}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {t('admin.settings.gatewayForwarding.resetSystemBlocks')}
          </Button>
        </div>
        <p className={s.hint}>{t('admin.settings.gatewayForwarding.claudeOAuthSystemPromptBlocksHint')}</p>
      </div>
    </Field>
  )
}

export default function GatewayForwardingSection() {
  const { t } = useI18n()
  const { form, updateForm } = useSettings()
  const toggle = (key: keyof SettingsForm, labelKey: string, testId?: string) => (
    <ToggleRow
      label={t(`admin.settings.gatewayForwarding.${labelKey}`)}
      description={t(`admin.settings.gatewayForwarding.${labelKey}Hint`)}
      checked={Boolean(form[key])}
      onChange={(value) => updateForm({ [key]: value } as Partial<SettingsForm>)}
      switchTestId={testId}
    />
  )
  const codexSynced = form.openai_codex_client_version_synced?.trim()
  const claudeSynced = form.claude_code_client_version_synced?.trim()

  return (
    <SettingsRegion title={t('admin.settings.gatewayForwarding.title')} description={t('admin.settings.gatewayForwarding.description')}>
      <div className={s.column}>
        <div className={styles.grokRow}>
          <Field
            label={t('admin.settings.gatewayForwarding.grokDefaultTextModel')}
            htmlFor="grok-default-text-model"
            hint={t('admin.settings.gatewayForwarding.grokDefaultTextModelHint')}
          >
            <input
              id="grok-default-text-model"
              type="text"
              className={s.input}
              list="grok-default-text-model-options"
              data-testid="grok-default-text-model"
              placeholder="grok-4.5"
              value={form.grok_default_text_model}
              onChange={(e) => updateForm({ grok_default_text_model: e.target.value })}
              onBlur={(e) => updateForm({ grok_default_text_model: e.target.value.trim() })}
            />
            <datalist id="grok-default-text-model-options">
              <option value="grok-4.5" />
              <option value="grok-4.1-fast" />
              <option value="grok-4" />
            </datalist>
          </Field>
          <ToggleRow
            label={t('admin.settings.gatewayForwarding.grokCrossClientMap')}
            description={t('admin.settings.gatewayForwarding.grokCrossClientMapHint')}
            checked={form.grok_cross_client_model_map_enabled}
            onChange={(value) => updateForm({ grok_cross_client_model_map_enabled: value })}
            switchTestId="grok-cross-client-model-map-toggle"
          />
        </div>
        <Field
          label={t('admin.settings.gatewayForwarding.grokDefaultBaseURLMode')}
          htmlFor="grok-default-base-url-mode"
          hint={t('admin.settings.gatewayForwarding.grokDefaultBaseURLModeHint')}
        >
          <select
            id="grok-default-base-url-mode"
            className={s.select}
            data-testid="grok-default-base-url-mode"
            value={form.grok_default_base_url_mode}
            onChange={(e) => updateForm({ grok_default_base_url_mode: e.target.value as SettingsForm['grok_default_base_url_mode'] })}
          >
            <option value="cli">{t('admin.settings.gatewayForwarding.grokBaseURLModeCLI')}</option>
            <option value="api">{t('admin.settings.gatewayForwarding.grokBaseURLModeAPI')}</option>
            <option value="us-east-1">{t('admin.settings.gatewayForwarding.grokBaseURLModeUSEast1')}</option>
            <option value="us-west-2">{t('admin.settings.gatewayForwarding.grokBaseURLModeUSWest2')}</option>
            <option value="eu-west-1">{t('admin.settings.gatewayForwarding.grokBaseURLModeEUWest1')}</option>
          </select>
        </Field>
      </div>

      {/* OpenAI Responses 首 token 统计 */}
      <Field
        label={t('admin.settings.gatewayForwarding.openaiTTFTMode')}
        htmlFor="openai-ttft-mode"
        hint={t('admin.settings.gatewayForwarding.openaiTTFTModeHint')}
      >
        <select
          id="openai-ttft-mode"
          className={s.select}
          data-testid="openai-ttft-mode"
          value={form.openai_ttft_mode}
          onChange={(e) => updateForm({ openai_ttft_mode: e.target.value as SettingsForm['openai_ttft_mode'] })}
        >
          <option value="semantic">{t('admin.settings.gatewayForwarding.openaiTTFTModeSemantic')}</option>
          <option value="visible">{t('admin.settings.gatewayForwarding.openaiTTFTModeVisible')}</option>
        </select>
      </Field>

      {toggle('enable_fingerprint_unification', 'fingerprintUnification')}
      {toggle('enable_metadata_passthrough', 'metadataPassthrough')}
      {toggle('rewrite_parallel_tool_calls_to_false', 'rewriteParallelToolCalls', 'rewrite-parallel-tool-calls-toggle')}
      {toggle('enable_cch_signing', 'cchSigning')}
      {toggle('enable_claude_oauth_system_prompt_injection', 'claudeOAuthSystemPromptInjection')}
      <ClaudeSystemPromptBlocks />
      {toggle('enable_anthropic_cache_ttl_1h_injection', 'anthropicCacheTTL1hInjection')}
      {toggle('rewrite_message_cache_control', 'rewriteMessageCacheControl')}
      {toggle('enable_client_dateline_normalization', 'clientDatelineNormalization')}

      <Field
        label={t('admin.settings.gatewayForwarding.antigravityUserAgentVersion')}
        hint={t('admin.settings.gatewayForwarding.antigravityUserAgentVersionHint')}
      >
        <input
          type="text"
          className={cx(s.input, s.mono, s.inputMedium)}
          value={form.antigravity_user_agent_version}
          placeholder={t('admin.settings.gatewayForwarding.antigravityUserAgentVersionPlaceholder')}
          onChange={(e) => updateForm({ antigravity_user_agent_version: e.target.value })}
        />
      </Field>
      <Field
        label={t('admin.settings.gatewayForwarding.openaiCodexUserAgent')}
        hint={t('admin.settings.gatewayForwarding.openaiCodexUserAgentHint')}
      >
        <input
          type="text"
          className={cx(s.input, s.mono)}
          value={form.openai_codex_user_agent}
          placeholder={t('admin.settings.gatewayForwarding.openaiCodexUserAgentPlaceholder')}
          onChange={(e) => updateForm({ openai_codex_user_agent: e.target.value })}
        />
      </Field>
      <Field
        label={t('admin.settings.gatewayForwarding.openaiCodexClientVersion')}
        hint={t('admin.settings.gatewayForwarding.openaiCodexClientVersionHint')}
      >
        <input
          type="text"
          className={cx(s.input, s.mono)}
          value={form.openai_codex_client_version}
          placeholder={t('admin.settings.gatewayForwarding.openaiCodexClientVersionPlaceholder')}
          onChange={(e) => updateForm({ openai_codex_client_version: e.target.value })}
        />
      </Field>
      <ToggleRow
        label={t('admin.settings.gatewayForwarding.openaiCodexVersionAutoSync')}
        description={
          <>
            {t('admin.settings.gatewayForwarding.openaiCodexVersionAutoSyncHint')}
            {codexSynced ? (
              <>
                <br />
                {t('admin.settings.gatewayForwarding.openaiCodexVersionSyncedValue', { version: codexSynced })}
              </>
            ) : null}
          </>
        }
        checked={form.openai_codex_version_auto_sync_enabled}
        onChange={(value) => updateForm({ openai_codex_version_auto_sync_enabled: value })}
      />
      <Field
        label={t('admin.settings.gatewayForwarding.claudeCodeClientVersion')}
        hint={t('admin.settings.gatewayForwarding.claudeCodeClientVersionHint')}
      >
        <input
          type="text"
          className={cx(s.input, s.mono)}
          value={form.claude_code_client_version}
          placeholder="2.1.280"
          onChange={(e) => updateForm({ claude_code_client_version: e.target.value })}
        />
      </Field>
      <ToggleRow
        label={t('admin.settings.gatewayForwarding.claudeCodeVersionAutoSync')}
        description={
          <>
            {t('admin.settings.gatewayForwarding.claudeCodeVersionAutoSyncHint')}
            {claudeSynced ? (
              <>
                <br />
                {t('admin.settings.gatewayForwarding.claudeCodeVersionSyncedValue', { version: claudeSynced })}
              </>
            ) : null}
          </>
        }
        checked={form.claude_code_version_auto_sync_enabled}
        onChange={(value) => updateForm({ claude_code_version_auto_sync_enabled: value })}
      />
    </SettingsRegion>
  )
}
