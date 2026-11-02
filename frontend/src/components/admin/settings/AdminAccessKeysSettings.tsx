/**
 * 管理员受限访问密钥（对应 Vue 版 AdminAccessKeysSettings.vue）。
 * 列表在区域内展示，新建与编辑权限的长表单放在右侧 Arc 抽屉中。
 */
import { useCallback, useMemo, useState } from 'react'

import { Button } from '@/components/arc/button/button'
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer'
import * as api from '@/api/admin/adminAccessKeys'
import type { AccessRule, AdminKey, AdminKeyInput, Permission } from '@/api/admin/adminAccessKeys'
import { getAllIncludingInactive } from '@/api/admin/groups'
import TotpStepUpDialog from '@/components/auth/TotpStepUpDialog'
import { CONCRETE_PLATFORM_OPTIONS } from '@/constants/platforms'
import { useMountOnce } from '@/composables/useMountOnce'
import { isStepUpCancelled, useStepUp } from '@/composables/useStepUp'
import { useI18n } from '@/i18n/useI18n'
import { Notice, SettingsRegion } from './SettingsLayout'
import { cx } from './settingsUtils'
import s from './SettingsLayout.module.css'
import styles from './AdminAccessKeysSettings.module.css'

const accountTypes = ['oauth', 'setup-token', 'apikey', 'upstream', 'bedrock', 'service_account']

// Go 的空切片可能序列化为 null；统一为空数组且不增加任何授权。
function normalizeItem(item: AdminKey): AdminKey {
  return {
    ...item,
    allowed_ips: item.allowed_ips ?? [],
    policy: {
      global_permissions: item.policy?.global_permissions ?? [],
      rules: (item.policy?.rules ?? []).map((rule) => ({
        ...rule,
        permissions: rule.permissions ?? [],
        group_ids: rule.group_ids ?? [],
        account_types: rule.account_types ?? [],
        platforms: rule.platforms ?? []
      }))
    }
  }
}

function emptyRule(): AccessRule {
  return { permissions: [], group_ids: [], all_groups: false, include_ungrouped: false, account_types: [], platforms: [] }
}

function toggleValue<T>(list: T[], value: T, checked: boolean): T[] {
  if (checked) return list.includes(value) ? list : [...list, value]
  return list.filter((item) => item !== value)
}

export default function AdminAccessKeysSettings() {
  const { t } = useI18n()
  const stepUp = useStepUp()
  const [items, setItems] = useState<AdminKey[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [groups, setGroups] = useState<{ id: number; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [secret, setSecret] = useState('')
  const [draft, setDraft] = useState<AdminKeyInput | null>(null)
  const [editingID, setEditingID] = useState('')
  const [expiration, setExpiration] = useState('')
  const [initialExpiration, setInitialExpiration] = useState('')
  const [ips, setIps] = useState('')
  const [now] = useState(() => Date.now())

  const accountPermissions = useMemo(() => permissions.filter((p) => p.scope === 'account'), [permissions])
  const groupPermissions = useMemo(() => permissions.filter((p) => p.scope === 'group'), [permissions])
  const globalCategories = useMemo(() => {
    const categories = new Map<string, Permission[]>()
    for (const permission of permissions.filter((p) => p.scope === 'global')) {
      const name = permission.category || t('adminAccessKeys.other')
      categories.set(name, [...(categories.get(name) || []), permission])
    }
    return Array.from(categories, ([name, perms]) => ({ name, permissions: perms }))
  }, [permissions, t])

  const report = useCallback(
    (e: unknown) => {
      if (!isStepUpCancelled(e)) setError((e as { message?: string })?.message || t('adminAccessKeys.operationFailed'))
    },
    [t]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [result, allGroups] = await Promise.all([api.list(), getAllIncludingInactive()])
      setItems((result.items ?? []).map(normalizeItem))
      setPermissions(result.permissions ?? [])
      setGroups(allGroups ?? [])
      setLoaded(true)
    } catch (e) {
      report(e)
    } finally {
      setLoading(false)
    }
  }, [report])

  useMountOnce(load)

  function ruleSummary(rule: AccessRule): string {
    const selectedGroups = rule.all_groups
      ? t('adminAccessKeys.allGroupsSummary')
      : rule.group_ids
          .map((id) => groups.find((group) => group.id === id)?.name || t('adminAccessKeys.groupFallback', { id }))
          .join('、') || t('adminAccessKeys.noGroups')
    const groupLabel = selectedGroups + (rule.include_ungrouped ? t('adminAccessKeys.ungroupedSummary') : '')
    const types = rule.account_types.join('、') || t('adminAccessKeys.noAccountTypes')
    const platforms = rule.platforms.join('、') || t('adminAccessKeys.anyPlatform')
    return t('adminAccessKeys.ruleSummary', { groups: groupLabel, types, platforms, count: rule.permissions.length })
  }

  function edit(item?: AdminKey) {
    setError('')
    setNotice('')
    setSecret('')
    setEditingID(item?.id || '')
    setDraft(
      item
        ? JSON.parse(
            JSON.stringify({
              name: item.name,
              description: item.description,
              enabled: item.enabled,
              expires_at: item.expires_at,
              allowed_ips: item.allowed_ips,
              policy: item.policy
            })
          )
        : { name: '', description: '', enabled: true, expires_at: null, allowed_ips: [], policy: { rules: [emptyRule()], global_permissions: [] } }
    )
    const date = item?.expires_at ? new Date(item.expires_at) : null
    const local = date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''
    setExpiration(local)
    setInitialExpiration(local)
    setIps(item?.allowed_ips.join('\n') || '')
  }

  async function mutate(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    setSecret('')
    try {
      await stepUp.run(action)
    } catch (e) {
      report(e)
    } finally {
      setBusy(false)
    }
  }

  function replace(item: AdminKey) {
    setItems((prev) => [normalizeItem(item), ...prev.filter((key) => key.id !== item.id)])
  }

  async function save() {
    if (!draft) return
    if (!draft.name.trim()) {
      setError(t('adminAccessKeys.nameRequired'))
      return
    }
    const date = expiration ? new Date(expiration) : null
    if (date && !Number.isFinite(date.getTime())) {
      setError(t('adminAccessKeys.expirationInvalid'))
      return
    }
    const input: AdminKeyInput = JSON.parse(JSON.stringify(draft))
    input.name = input.name.trim()
    // 未修改日期时保留服务端原值，避免丢失秒数、微秒或时区精度。
    if (expiration !== initialExpiration) input.expires_at = date?.toISOString() || null
    input.allowed_ips = ips
      .split(/[\n,]/)
      .map((ip) => ip.trim())
      .filter(Boolean)
    await mutate(async () => {
      if (editingID) replace(await api.update(editingID, input))
      else {
        const result = await api.create(input)
        replace(result.item)
        setSecret(result.key)
      }
      setDraft(null)
      setNotice(t('adminAccessKeys.saved'))
    })
  }

  async function toggle(item: AdminKey) {
    await mutate(async () => {
      replace(
        await api.update(item.id, {
          name: item.name,
          description: item.description,
          enabled: !item.enabled,
          expires_at: item.expires_at,
          allowed_ips: item.allowed_ips,
          policy: item.policy
        })
      )
      setNotice(t('adminAccessKeys.statusUpdated'))
    })
  }

  async function rotateKey(item: AdminKey) {
    if (!confirm(t('adminAccessKeys.rotateConfirm', { name: item.name }))) return
    await mutate(async () => {
      const result = await api.rotate(item.id)
      replace(result.item)
      setSecret(result.key)
      setNotice(t('adminAccessKeys.rotated'))
    })
  }

  async function revokeKey(item: AdminKey) {
    if (!confirm(t('adminAccessKeys.revokeConfirm', { name: item.name }))) return
    await mutate(async () => {
      await api.revoke(item.id)
      replace({ ...item, enabled: false, revoked_at: new Date().toISOString() })
      if (editingID === item.id) setDraft(null)
      setNotice(t('adminAccessKeys.revoked'))
    })
  }

  async function deleteRecord(item: AdminKey) {
    if (busy || !item.revoked_at) return
    if (!confirm(t('adminAccessKeys.deleteConfirm', { name: item.name }))) return
    await mutate(async () => {
      await api.deleteRecord(item.id)
      setItems((prev) => prev.filter((key) => key.id !== item.id))
      if (editingID === item.id) setDraft(null)
      setNotice(t('adminAccessKeys.removed'))
    })
  }

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret)
      setNotice(t('adminAccessKeys.copied'))
    } catch {
      setError(t('adminAccessKeys.copyFailed'))
    }
  }

  function status(item: AdminKey) {
    if (item.revoked_at) return t('adminAccessKeys.statusRevoked')
    if (!item.enabled) return t('adminAccessKeys.statusDisabled')
    if (item.expires_at && new Date(item.expires_at).getTime() <= now) return t('adminAccessKeys.statusExpired')
    return t('adminAccessKeys.statusEnabled')
  }

  function updateDraft(patch: Partial<AdminKeyInput>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  function updateRule(index: number, patch: Partial<AccessRule>) {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            policy: {
              ...prev.policy,
              rules: prev.policy.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule))
            }
          }
        : prev
    )
  }

  function permissionCheckbox(rule: AccessRule, index: number, permission: Permission) {
    return (
      <label key={permission.id} className={s.checkboxLabel}>
        <input
          type="checkbox"
          value={permission.id}
          checked={rule.permissions.includes(permission.id)}
          onChange={(e) => updateRule(index, { permissions: toggleValue(rule.permissions, permission.id, e.target.checked) })}
        />
        {permission.label} <span className={s.hint}>{permission.id}</span>
      </label>
    )
  }

  return (
    <SettingsRegion title={t('adminAccessKeys.title')} description={t('adminAccessKeys.authorizationHint')}>
      <div className={s.column}>
        <Notice tone="warning">
          <p>{t('adminAccessKeys.sharedAccountWarning')}</p>
        </Notice>
        {error && !draft ? (
          <p role="alert" className={s.error}>
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className={s.success}>
            {notice}
          </p>
        ) : null}
        {secret ? (
          <Notice tone="warning">
            <p>{t('adminAccessKeys.secretWarning')}</p>
            <code className={s.codeBlock}>{secret}</code>
            <div className={s.inline}>
              <Button type="button" variant="secondary" size="sm" onClick={() => void copySecret()}>
                {t('adminAccessKeys.copySecret')}
              </Button>
              <Button type="button" variant="secondary" size="sm" data-test="dismiss-secret" onClick={() => setSecret('')}>
                {t('adminAccessKeys.dismissSecret')}
              </Button>
            </div>
          </Notice>
        ) : null}
        <div className={s.inline}>
          <Button type="button" data-test="create" disabled={busy || loading || !loaded} onClick={() => edit()}>
            {t('adminAccessKeys.create')}
          </Button>
          <Button type="button" variant="secondary" disabled={busy || loading} onClick={() => void load()}>
            {t('adminAccessKeys.refresh')}
          </Button>
        </div>
        {loading ? <p className={s.hint}>{t('adminAccessKeys.loading')}</p> : null}
        {items.map((item) => (
          <div key={item.id} className={s.item}>
            <p className={styles.itemName}>
              {item.name} <code className={s.code}>{item.key_prefix}…</code> · {status(item)}
            </p>
            <p className={s.hint}>
              {item.description || t('adminAccessKeys.noDescription')} ·{' '}
              {t('adminAccessKeys.expires', { value: item.expires_at || t('adminAccessKeys.never') })}
            </p>
            <p className={s.hint}>
              {t('adminAccessKeys.lastUsed', { value: item.last_used_at || t('adminAccessKeys.neverUsed') })} {item.last_used_ip}
            </p>
            <div className={s.columnTight} aria-label={t('adminAccessKeys.summaryLabel')}>
              <p className={s.hint}>
                {t('adminAccessKeys.summary', {
                  globals: item.policy.global_permissions.length,
                  rules: item.policy.rules.length
                })}
              </p>
              {item.policy.rules.map((rule, index) => (
                <p key={index} className={s.hint}>
                  {t('adminAccessKeys.ruleLine', { index: index + 1, summary: ruleSummary(rule) })}
                </p>
              ))}
            </div>
            {!item.revoked_at ? (
              <div key="active" className={s.inline}>
                <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => edit(item)}>
                  {t('adminAccessKeys.editPermissions')}
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void toggle(item)}>
                  {item.enabled ? t('adminAccessKeys.disable') : t('adminAccessKeys.enable')}
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void rotateKey(item)}>
                  {t('adminAccessKeys.rotate')}
                </Button>
                <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => void revokeKey(item)}>
                  {t('adminAccessKeys.revoke')}
                </Button>
              </div>
            ) : (
              <div key="revoked">
                <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => void deleteRecord(item)}>
                  {t('adminAccessKeys.deleteRecord')}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Drawer
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDraft(null)
        }}
      >
        <DrawerContent
          title={editingID ? t('adminAccessKeys.editTitle') : t('adminAccessKeys.createTitle')}
          side="right"
          className={styles.drawer}
        >
          {draft ? (
            <div className={styles.drawerInner}>
              <div className={styles.drawerBody}>
                {error ? (
                  <p role="alert" className={s.error}>
                    {error}
                  </p>
                ) : null}
                <label className={s.field}>
                  <span className={s.label}>{t('adminAccessKeys.name')}</span>
                  <input
                    data-test="name"
                    className={s.input}
                    maxLength={100}
                    value={draft.name}
                    onChange={(e) => updateDraft({ name: e.target.value })}
                  />
                </label>
                <label className={s.field}>
                  <span className={s.label}>{t('adminAccessKeys.description')}</span>
                  <textarea
                    className={s.textarea}
                    maxLength={1000}
                    value={draft.description}
                    onChange={(e) => updateDraft({ description: e.target.value })}
                  />
                </label>
                <label className={s.field}>
                  <span className={s.label}>{t('adminAccessKeys.expiration')}</span>
                  <input
                    type="datetime-local"
                    className={s.input}
                    value={expiration}
                    onChange={(e) => setExpiration(e.target.value)}
                  />
                </label>
                <label className={s.field}>
                  <span className={s.label}>{t('adminAccessKeys.allowedIps')}</span>
                  <textarea
                    className={s.textarea}
                    placeholder={'192.0.2.1\n2001:db8::/32'}
                    value={ips}
                    onChange={(e) => setIps(e.target.value)}
                  />
                </label>
                <label className={s.checkboxLabel}>
                  <input type="checkbox" checked={draft.enabled} onChange={(e) => updateDraft({ enabled: e.target.checked })} />
                  {t('adminAccessKeys.enabled')}
                </label>

                {draft.policy.rules.map((rule, index) => (
                  <fieldset key={index} className={styles.fieldset}>
                    <legend className={styles.legend}>{t('adminAccessKeys.ruleLegend', { index: index + 1 })}</legend>
                    <label className={s.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={rule.all_groups}
                        onChange={(e) => updateRule(index, { all_groups: e.target.checked })}
                      />
                      {t('adminAccessKeys.allGroups')}
                    </label>
                    <label className={s.field}>
                      <span className={s.label}>{t('adminAccessKeys.groups')}</span>
                      <select
                        data-test={`groups-${index}`}
                        multiple
                        className={cx(s.select, styles.multiSelect)}
                        disabled={rule.all_groups}
                        value={rule.group_ids.map(String)}
                        onChange={(e) =>
                          updateRule(index, {
                            group_ids: Array.from(e.target.selectedOptions, (option) => Number(option.value))
                          })
                        }
                      >
                        {groups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={s.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={rule.include_ungrouped}
                        onChange={(e) => updateRule(index, { include_ungrouped: e.target.checked })}
                      />
                      {t('adminAccessKeys.includeUngrouped')}
                    </label>
                    <div className={s.columnTight}>
                      <span className={s.label}>{t('adminAccessKeys.accountTypes')}</span>
                      <div className={s.inline}>
                        {accountTypes.map((type) => (
                          <label key={type} className={s.checkboxLabel}>
                            <input
                              type="checkbox"
                              value={type}
                              checked={rule.account_types.includes(type)}
                              onChange={(e) =>
                                updateRule(index, { account_types: toggleValue(rule.account_types, type, e.target.checked) })
                              }
                            />
                            {type}
                          </label>
                        ))}
                      </div>
                    </div>
                    <label className={s.field}>
                      <span className={s.label}>{t('adminAccessKeys.platforms')}</span>
                      <select
                        multiple
                        className={cx(s.select, styles.multiSelect)}
                        value={rule.platforms}
                        onChange={(e) =>
                          updateRule(index, { platforms: Array.from(e.target.selectedOptions, (option) => option.value) })
                        }
                      >
                        {CONCRETE_PLATFORM_OPTIONS.map((platform) => (
                          <option key={platform.value} value={platform.value}>
                            {platform.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className={s.columnTight}>
                      <span className={s.label}>{t('adminAccessKeys.accountOperations')}</span>
                      <div className={styles.permissionGrid}>
                        {accountPermissions.map((permission) => permissionCheckbox(rule, index, permission))}
                      </div>
                    </div>
                    {groupPermissions.length ? (
                      <Notice tone="warning">
                        <p>{t('adminAccessKeys.groupOperations')}</p>
                        <p className={s.hint}>{t('adminAccessKeys.modelAllowlistHint')}</p>
                        <div className={styles.permissionGrid}>
                          {groupPermissions.map((permission) => permissionCheckbox(rule, index, permission))}
                        </div>
                      </Notice>
                    ) : null}
                    <div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setDraft((prev) =>
                            prev
                              ? { ...prev, policy: { ...prev.policy, rules: prev.policy.rules.filter((_, i) => i !== index) } }
                              : prev
                          )
                        }
                      >
                        {t('adminAccessKeys.removeRule')}
                      </Button>
                    </div>
                  </fieldset>
                ))}
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-test="add-rule"
                    onClick={() =>
                      setDraft((prev) =>
                        prev ? { ...prev, policy: { ...prev.policy, rules: [...prev.policy.rules, emptyRule()] } } : prev
                      )
                    }
                  >
                    {t('adminAccessKeys.addRule')}
                  </Button>
                </div>
                <fieldset className={styles.fieldset}>
                  <legend className={styles.legend}>{t('adminAccessKeys.globalPermissions')}</legend>
                  {globalCategories.map((category) => (
                    <fieldset key={category.name} className={styles.fieldset}>
                      <legend className={styles.legend}>{category.name}</legend>
                      {category.permissions.map((permission) => (
                        <label key={permission.id} className={s.checkboxLabel}>
                          <input
                            type="checkbox"
                            value={permission.id}
                            checked={draft.policy.global_permissions.includes(permission.id)}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      policy: {
                                        ...prev.policy,
                                        global_permissions: toggleValue(
                                          prev.policy.global_permissions,
                                          permission.id,
                                          e.target.checked
                                        )
                                      }
                                    }
                                  : prev
                              )
                            }
                          />
                          {permission.label} <span className={s.hint}>{permission.id}</span>
                        </label>
                      ))}
                    </fieldset>
                  ))}
                </fieldset>
              </div>
              <div className={styles.drawerFooter}>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setDraft(null)}>
                  {t('adminAccessKeys.cancel')}
                </Button>
                <Button type="button" data-test="save" disabled={busy} onClick={() => void save()}>
                  {busy ? t('adminAccessKeys.processing') : t('adminAccessKeys.save')}
                </Button>
              </div>
            </div>
          ) : (
            <div />
          )}
        </DrawerContent>
      </Drawer>
      <TotpStepUpDialog controller={stepUp} />
    </SettingsRegion>
  )
}
