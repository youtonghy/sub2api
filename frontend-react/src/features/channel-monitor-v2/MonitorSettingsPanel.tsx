/**
 * 渠道监控 V2 设置面板，对应 Vue 版 MonitorSettingsPanel.vue：
 * 开关与刷新间隔、按平台的模型清单、参与统计的分组、忽略的错误类别、健康阈值；
 * 草稿与服务端快照比较得出是否有改动，保存失败时重新拉取服务端配置。
 */
import { Check } from 'lucide-react'
import { useState, type ChangeEvent } from 'react'
import { Link } from 'react-router'

import { adminAPI } from '@/api/admin'
import { getConfig, MONITOR_ERROR_CATEGORIES, updateConfig, type MonitorConfig } from '@/api/channelMonitorV2'
import { Alert } from '@/components/arc/alert/alert'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import arcInput from '@/components/arc/input/input.module.css'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import Select from '@/components/common/Select'
import Toggle from '@/components/common/Toggle'
import { useMountOnce } from '@/composables/useMountOnce'
import { CONCRETE_PLATFORM_OPTIONS } from '@/constants/platforms'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminGroup } from '@/types'
import { extractApiErrorMessage } from '@/utils/apiError'
import { getChannelMonitorMode, isChannelMonitorV2Mode } from '@/utils/featureFlags'
import { defaultMonitorThresholds as defaultThresholds, normalizeMonitorConfig } from './monitorViewModel'
import styles from './MonitorSettingsPanel.module.css'

type PercentKey = 'warning_error_rate' | 'critical_error_rate' | 'warning_cache_rate' | 'critical_cache_rate'
type NumberKey = 'minimum_sample' | 'target_ttft_ms' | 'warning_ttft_ms' | 'critical_ttft_ms'

function platformLabel(value: string) {
  return (
    (
      {
        anthropic: 'Claude',
        openai: 'OpenAI',
        grok: 'Grok',
        kiro: 'Kiro',
        gemini: 'Gemini',
        antigravity: 'Antigravity',
        kimi: 'Kimi',
        zhipu: 'Zhipu GLM',
        deepseek: 'DeepSeek',
        minimax: 'MiniMax',
        composite: 'Composite'
      } as Record<string, string>
    )[value] || value
  )
}

export default function MonitorSettingsPanel() {
  const { t, te } = useI18n()
  const cachedPublicSettings = useAppStore((s) => s.cachedPublicSettings)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<MonitorConfig | null>(null)
  const [original, setOriginal] = useState('')
  const [groups, setGroups] = useState<AdminGroup[]>([])
  const [selectedPlatform, setSelectedPlatform] = useState('')

  const availablePlatforms = CONCRETE_PLATFORM_OPTIONS.filter(
    (option) => !draft?.platforms.some((platform) => platform.platform === option.value)
  )

  const dirty = draft ? JSON.stringify(draft) !== original : false
  const namedModelCount = draft?.platforms.filter((p) => p.enabled).reduce((sum, p) => sum + p.models.length, 0) || 0
  const errorCategories = MONITOR_ERROR_CATEGORIES
  const countedErrorCategoryCount = errorCategories.length - (draft?.ignored_error_categories?.length || 0)
  /** System settings mode must be v2 for aggregation to run; config remains editable for prep. */
  const systemModeV2 = isChannelMonitorV2Mode()
  const systemModeLabel = !cachedPublicSettings?.channel_monitor_enabled
    ? t('channelMonitorV2.settings.modeClosed')
    : getChannelMonitorMode() === 'v1'
      ? t('channelMonitorV2.settings.modeV1')
      : t('channelMonitorV2.settings.modeV2')

  const patchDraft = (updater: (value: MonitorConfig) => MonitorConfig) => setDraft((prev) => (prev ? updater(prev) : prev))

  const load = async () => {
    setLoading(true)
    try {
      const [value, groupRows] = await Promise.all([getConfig(), adminAPI.groups.getAllIncludingInactive()])
      const normalized = normalizeMonitorConfig(value)
      setDraft(structuredClone(normalized))
      setGroups(groupRows)
      setOriginal(JSON.stringify(normalized))
    } catch (error) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('channelMonitorV2.settings.loadFailed')))
    } finally {
      setLoading(false)
    }
  }

  useMountOnce(load)

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const payload = normalizeMonitorConfig(draft)
      const value = await updateConfig(payload)
      const normalized = normalizeMonitorConfig(value)
      setDraft(structuredClone(normalized))
      setOriginal(JSON.stringify(normalized))
      useAppStore.getState().showSuccess(t('channelMonitorV2.settings.saveSuccess'))
    } catch (error) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('channelMonitorV2.settings.saveFailed')))
      await load()
    } finally {
      setSaving(false)
    }
  }

  const addPlatform = () => {
    if (!draft || !availablePlatforms.some((option) => option.value === selectedPlatform)) return
    patchDraft((value) => ({ ...value, platforms: [...value.platforms, { platform: selectedPlatform, enabled: true, models: [] }] }))
    setSelectedPlatform('')
  }

  const setPlatform = (index: number, patch: Partial<MonitorConfig['platforms'][number]>) =>
    patchDraft((value) => ({ ...value, platforms: value.platforms.map((p, i) => (i === index ? { ...p, ...patch } : p)) }))

  const setModels = (index: number, raw: string) =>
    setPlatform(index, {
      models: [
        ...new Set(
          raw
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
        )
      ].sort()
    })

  const toggleGroup = (id: number) =>
    patchDraft((value) => ({
      ...value,
      group_ids: value.group_ids.includes(id)
        ? value.group_ids.filter((item) => item !== id)
        : [...value.group_ids, id].sort((a, b) => a - b)
    }))

  const isCategoryIgnored = (category: string) => Boolean(draft?.ignored_error_categories?.includes(category))

  const toggleIgnoredCategory = (category: string) =>
    patchDraft((value) => {
      const current = new Set(value.ignored_error_categories || [])
      if (current.has(category)) current.delete(category)
      else current.add(category)
      return { ...value, ignored_error_categories: [...current].sort() }
    })

  const categoryLabel = (category: string) => {
    const key = `channelMonitorV2.errorCategories.${category}`
    return te(key) ? t(key) : category
  }

  const percentValue = (key: PercentKey) => (draft?.health_thresholds?.[key] ?? defaultThresholds[key]) * 100
  const setPercent = (key: PercentKey, raw: string) =>
    patchDraft((value) => ({
      ...value,
      health_thresholds: { ...value.health_thresholds, [key]: Math.max(0, Math.min(100, Number(raw) || 0)) / 100 }
    }))

  // v-model.number：空输入保留空字符串，其余转为数字
  const setNumber = (key: NumberKey, event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value
    const next = (raw === '' ? '' : Number(raw)) as number
    patchDraft((value) => ({ ...value, health_thresholds: { ...value.health_thresholds, [key]: next } }))
  }

  const numberField = (key: NumberKey, labelKey: string, props: { min: string; max?: string; step?: string }) => (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{t(`channelMonitorV2.settings.fields.${labelKey}`)}</span>
      <input
        className={arcInput.input}
        type="number"
        {...props}
        value={draft ? String(draft.health_thresholds[key] ?? '') : ''}
        onChange={(event) => setNumber(key, event)}
      />
    </label>
  )

  const percentField = (key: PercentKey, labelKey: string) => (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{t(`channelMonitorV2.settings.fields.${labelKey}`)}</span>
      <input
        className={arcInput.input}
        type="number"
        min="0"
        max="100"
        step="0.1"
        value={String(percentValue(key))}
        onChange={(event) => setPercent(key, event.target.value)}
      />
    </label>
  )

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2 className={styles.title}>{t('channelMonitorV2.settings.title')}</h2>
          <p className={styles.description}>{t('channelMonitorV2.settings.description')}</p>
        </div>
        <Button type="button" variant="primary" disabled={saving || !dirty} onClick={() => void save()}>
          <Check size={16} strokeWidth={1.75} aria-hidden="true" />
          {t('channelMonitorV2.settings.save')}
        </Button>
      </header>

      {!systemModeV2 ? (
        <Alert
          tone="warning"
          role="status"
          title={t('channelMonitorV2.settings.modeBanner', { mode: systemModeLabel, modeV2: t('channelMonitorV2.settings.modeV2') })}
        >
          <Link className={styles.link} to="/admin/settings">
            {t('admin.settings.tabs.features')}
          </Link>
        </Alert>
      ) : null}

      {loading ? (
        <div className={styles.region}>
          <Skeleton label={t('channelMonitorV2.settings.loading')} lines={5} />
        </div>
      ) : draft ? (
        <>
          <div className={[styles.region, styles.rows].join(' ')}>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <strong className={styles.rowTitle}>{t('channelMonitorV2.settings.enableTitle')}</strong>
                <p className={styles.hint}>{t('channelMonitorV2.settings.enableHint')}</p>
              </div>
              <Toggle
                value={draft.enabled}
                aria-label={t('channelMonitorV2.settings.enableTitle')}
                onChange={(value) => patchDraft((d) => ({ ...d, enabled: value }))}
              />
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <strong className={styles.rowTitle}>{t('channelMonitorV2.settings.refreshTitle')}</strong>
                <p className={styles.hint}>{t('channelMonitorV2.settings.refreshHint')}</p>
              </div>
              <SegmentedControl
                label={t('channelMonitorV2.settings.refreshAria')}
                options={[
                  { value: '60', label: '1 min' },
                  { value: '300', label: '5 min' }
                ]}
                value={String(draft.refresh_interval_seconds)}
                onValueChange={(value) =>
                  patchDraft((d) => ({ ...d, refresh_interval_seconds: Number(value) as MonitorConfig['refresh_interval_seconds'] }))
                }
              />
            </div>
          </div>

          <div className={styles.region}>
            <div className={styles.regionHeader}>
              <h3 className={styles.regionTitle}>{t('channelMonitorV2.settings.platformsTitle')}</h3>
              <p className={styles.hint}>{t('channelMonitorV2.settings.platformsHint')}</p>
              {availablePlatforms.length ? (
                <div className={styles.addRow}>
                  <div className={styles.platformSelect}>
                    <Select
                      value={selectedPlatform}
                      options={availablePlatforms}
                      aria-label={t('channelMonitorV2.settings.selectPlatform')}
                      placeholder={t('channelMonitorV2.settings.selectPlatform')}
                      disabled={saving}
                      onChange={(value) => setSelectedPlatform(String(value ?? ''))}
                    />
                  </div>
                  <Button type="button" variant="secondary" size="sm" disabled={saving || !selectedPlatform} onClick={addPlatform}>
                    {t('channelMonitorV2.settings.addPlatform')}
                  </Button>
                </div>
              ) : null}
            </div>
            <div className={styles.divided}>
              {draft.platforms.map((platform, index) => (
                <div key={platform.platform} className={styles.platformRow}>
                  <Toggle
                    value={platform.enabled}
                    aria-label={platformLabel(platform.platform)}
                    onChange={(value) => setPlatform(index, { enabled: value })}
                  />
                  <strong className={styles.platformName}>{platformLabel(platform.platform)}</strong>
                  {/* 失焦或回车时提交（Vue 版 @change），提交后按去重排序的结果重建输入框 */}
                  <input
                    key={platform.models.join(', ')}
                    className={arcInput.input}
                    defaultValue={platform.models.join(', ')}
                    type="text"
                    aria-label={`${platformLabel(platform.platform)} ${t('channelMonitorV2.settings.modelsPlaceholder')}`}
                    placeholder={t('channelMonitorV2.settings.modelsPlaceholder')}
                    onBlur={(event) => setModels(index, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') setModels(index, event.currentTarget.value)
                    }}
                  />
                  <Badge size="sm" tone={platform.models.length ? 'neutral' : 'info'} className={styles.platformBadge}>
                    {platform.models.length ? t('channelMonitorV2.settings.badgeOther') : t('channelMonitorV2.settings.badgeAllModels')}
                  </Badge>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.region}>
            <div className={[styles.regionHeader, styles.regionHeaderRow].join(' ')}>
              <div>
                <h3 className={styles.regionTitle}>{t('channelMonitorV2.settings.groupsTitle')}</h3>
                <p className={styles.hint}>
                  {draft.group_ids.length
                    ? t('channelMonitorV2.settings.groupsSelected', { count: draft.group_ids.length })
                    : t('channelMonitorV2.settings.groupsAll')}
                </p>
              </div>
              {draft.group_ids.length ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => patchDraft((d) => ({ ...d, group_ids: [] }))}>
                  {t('channelMonitorV2.settings.groupsAll')}
                </Button>
              ) : null}
            </div>
            <div className={styles.scrollList}>
              <div className={styles.checkGrid}>
                {groups.map((group) => (
                  <div key={group.id} className={styles.checkItem}>
                    <Checkbox
                      checked={draft.group_ids.includes(group.id)}
                      aria-label={group.name}
                      onCheckedChange={() => toggleGroup(group.id)}
                    />
                    <span className={styles.checkLabel}>{group.name}</span>
                    <small className={styles.checkMeta}>
                      {platformLabel(group.platform)} · #{group.id}
                    </small>
                  </div>
                ))}
              </div>
              {groups.length === 0 ? <p className={styles.empty}>{t('channelMonitorV2.settings.groupsEmpty')}</p> : null}
            </div>
          </div>

          <div className={styles.region}>
            <div className={styles.regionHeader}>
              <h3 className={styles.regionTitle}>{t('channelMonitorV2.settings.errorsTitle')}</h3>
              <p className={styles.hint}>{t('channelMonitorV2.settings.errorsHint')}</p>
            </div>
            <div className={styles.scrollList}>
              <div className={styles.checkGrid}>
                {errorCategories.map((category) => (
                  <div key={category} className={styles.checkItem}>
                    <Checkbox
                      checked={isCategoryIgnored(category)}
                      aria-label={categoryLabel(category)}
                      onCheckedChange={() => toggleIgnoredCategory(category)}
                    />
                    <span className={styles.checkLabel}>{categoryLabel(category)}</span>
                    <small className={styles.code}>{category}</small>
                  </div>
                ))}
              </div>
            </div>
            <div className={styles.footer}>
              {t('channelMonitorV2.settings.ignoredSummary', {
                ignored: draft.ignored_error_categories?.length || 0,
                counted: countedErrorCategoryCount
              })}
            </div>
          </div>

          <div className={styles.region}>
            <div className={styles.regionHeader}>
              <h3 className={styles.regionTitle}>{t('channelMonitorV2.settings.healthTitle')}</h3>
              <p className={styles.hint}>{t('channelMonitorV2.settings.healthHint')}</p>
            </div>
            <div className={styles.fieldGrid}>
              {numberField('minimum_sample', 'minimumSample', { min: '1', max: '10000' })}
              {percentField('warning_error_rate', 'warningError')}
              {percentField('critical_error_rate', 'criticalError')}
              {numberField('target_ttft_ms', 'targetTtft', { min: '1', step: '100' })}
              {numberField('warning_ttft_ms', 'warningTtft', { min: '1', step: '100' })}
              {numberField('critical_ttft_ms', 'criticalTtft', { min: '1', step: '100' })}
              {percentField('warning_cache_rate', 'warningCache')}
              {percentField('critical_cache_rate', 'criticalCache')}
            </div>
          </div>

          <div className={styles.notes}>
            <Alert
              tone="info"
              title={
                namedModelCount === 0
                  ? t('channelMonitorV2.settings.namedModelsEmpty')
                  : t('channelMonitorV2.settings.namedModelsCount', { count: namedModelCount })
              }
            />
            <div className={styles.contract}>
              <p className={styles.contractTitle}>{t('channelMonitorV2.settings.userContractTitle')}</p>
              <ul className={styles.contractList}>
                <li>{t('channelMonitorV2.settings.userContract.health')}</li>
                <li>{t('channelMonitorV2.settings.userContract.trend')}</li>
                <li>{t('channelMonitorV2.settings.userContract.latency')}</li>
                <li>{t('channelMonitorV2.settings.userContract.models')}</li>
              </ul>
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
