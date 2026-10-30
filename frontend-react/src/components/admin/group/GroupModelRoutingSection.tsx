/**
 * 分组模型路由配置：按模型匹配模式把请求路由到指定账号（账号搜索仅限 anthropic 平台）。
 * 每条规则的账号搜索状态由规则行自己持有，删除规则或关闭表单（卸载）时一并取消。
 */
import { Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import { FormSection } from '@/components/account/AccountFormLayout'
import arcInput from '@/components/arc/input/input.module.css'
import { useKeyedDebouncedSearch } from '@/composables/useKeyedDebouncedSearch'
import { useI18n } from '@/i18n/useI18n'
import { createModelRoutingRule, type ModelRoutingRule, type SimpleAccount } from './groupForm'
import { SwitchRow } from './GroupFormControls'
import styles from './GroupForm.module.css'
import type { GroupFormController } from './useGroupForm'

function RoutingRuleRow({
  rule,
  onChange,
  onRemove
}: {
  rule: ModelRoutingRule
  onChange: (rule: ModelRoutingRule) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<SimpleAccount[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const runner = useKeyedDebouncedSearch<SimpleAccount[]>({
    delay: 300,
    search: async (value, { signal }) => {
      const res = await adminAPI.accounts.list(1, 20, { search: value, platform: 'anthropic' }, { signal })
      return res.items.map((account) => ({ id: account.id, name: account.name }))
    },
    onSuccess: (_key, result) => setResults(result),
    onError: () => setResults([])
  })

  // 点击外部关闭账号搜索下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  // 选择账号
  const selectAccount = (account: SimpleAccount) => {
    // 检查是否已选择
    if (!rule.accounts.some((a) => a.id === account.id)) {
      onChange({ ...rule, accounts: [...rule.accounts, account] })
    }
    // 清空搜索
    setKeyword('')
    setShowDropdown(false)
  }

  return (
    <div className={styles.rowCard}>
      <div className={styles.rowBody}>
        <div className={styles.field}>
          <label className={styles.subLabel} htmlFor={`${rule.id}-pattern`}>
            {t('admin.groups.modelRouting.modelPattern')}
          </label>
          <input
            id={`${rule.id}-pattern`}
            type="text"
            className={arcInput.input}
            value={rule.pattern}
            placeholder={t('admin.groups.modelRouting.modelPatternPlaceholder')}
            onChange={(event) => onChange({ ...rule, pattern: event.target.value })}
          />
        </div>
        <div className={styles.field}>
          <span className={styles.subLabel}>{t('admin.groups.modelRouting.accounts')}</span>
          {/* 已选账号标签 */}
          {rule.accounts.length > 0 ? (
            <div className={styles.chips}>
              {rule.accounts.map((account) => (
                <span key={account.id} className={styles.chip}>
                  {account.name}
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label={`${t('common.delete')} ${account.name}`}
                    onClick={() => onChange({ ...rule, accounts: rule.accounts.filter((a) => a.id !== account.id) })}
                  >
                    <X size={12} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {/* 账号搜索输入框 */}
          <div className={styles.searchAnchor} ref={containerRef}>
            <input
              type="text"
              className={arcInput.input}
              value={keyword}
              placeholder={t('admin.groups.modelRouting.searchAccountPlaceholder')}
              aria-label={t('admin.groups.modelRouting.accounts')}
              onChange={(event) => {
                setKeyword(event.target.value)
                runner.trigger('rule', event.target.value)
              }}
              onFocus={() => {
                setShowDropdown(true)
                // 如果没有搜索结果，触发一次搜索
                if (!results.length) runner.trigger('rule', keyword)
              }}
            />
            {/* 搜索结果下拉框 */}
            {showDropdown && results.length > 0 ? (
              <div className={styles.dropdown}>
                {results.map((account) => {
                  const selected = rule.accounts.some((a) => a.id === account.id)
                  return (
                    <button
                      key={account.id}
                      type="button"
                      className={styles.dropdownItem}
                      disabled={selected}
                      onClick={() => selectAccount(account)}
                    >
                      <span>{account.name}</span>
                      <span className={styles.dropdownMeta}>#{account.id}</span>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
          <p className={styles.hint}>{t('admin.groups.modelRouting.accountsHint')}</p>
        </div>
      </div>
      <button
        type="button"
        className={styles.iconButton}
        data-tone="danger"
        title={t('admin.groups.modelRouting.removeRule')}
        aria-label={t('admin.groups.modelRouting.removeRule')}
        onClick={onRemove}
      >
        <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  )
}

export default function GroupModelRoutingSection({ ctl }: { ctl: GroupFormController }) {
  const { t } = useI18n()
  const { form, update, routingRules, setRoutingRules } = ctl
  const replaceRule = (next: ModelRoutingRule) =>
    setRoutingRules(ctl.getLatest().routingRules.map((rule) => (rule.id === next.id ? next : rule)))

  return (
    <FormSection>
      <SwitchRow
        label={t('admin.groups.modelRouting.title')}
        help={t('admin.groups.modelRouting.tooltip')}
        description={
          form.model_routing_enabled ? t('admin.groups.modelRouting.enabled') : t('admin.groups.modelRouting.disabled')
        }
        checked={form.model_routing_enabled}
        onChange={(model_routing_enabled) => update({ model_routing_enabled })}
      />
      <p className={styles.hint}>
        {form.model_routing_enabled
          ? t('admin.groups.modelRouting.noRulesHint')
          : t('admin.groups.modelRouting.disabledHint')}
      </p>
      {/* 路由规则列表（仅在启用时显示） */}
      {form.model_routing_enabled ? (
        <div className={styles.rows}>
          {routingRules.map((rule) => (
            <RoutingRuleRow
              key={rule.id}
              rule={rule}
              onChange={replaceRule}
              onRemove={() => setRoutingRules(ctl.getLatest().routingRules.filter((r) => r.id !== rule.id))}
            />
          ))}
          {/* 添加规则按钮（仅在启用时显示） */}
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => setRoutingRules([...ctl.getLatest().routingRules, createModelRoutingRule()])}
          >
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            {t('admin.groups.modelRouting.addRule')}
          </button>
        </div>
      ) : null}
    </FormSection>
  )
}
