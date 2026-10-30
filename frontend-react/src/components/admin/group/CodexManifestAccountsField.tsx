/**
 * 固定账号获取 Codex Model Manifest（仅 openai 分组编辑表单），对应 Vue 版 CodexManifestAccountsField.vue。
 * 开关打开后可搜索本分组内的 OpenAI 账号并多选，另有"回退到调度器"子开关；通过 ref 暴露 validate / resetValidation。
 */
import { X } from 'lucide-react'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'

import { adminAPI } from '@/api/admin'
import arcInput from '@/components/arc/input/input.module.css'
import { Switch } from '@/components/arc/switch/switch'
import { useKeyedDebouncedSearch } from '@/composables/useKeyedDebouncedSearch'
import { useI18n } from '@/i18n/useI18n'
import type { CodexModelsManifestConfig } from '@/types'
import type { SimpleAccount } from './groupForm'
import styles from './GroupForm.module.css'

export interface CodexManifestAccountsFieldHandle {
  /** 校验：开启后至少一个账号。返回是否通过；不通过时展示错误提示。 */
  validate: () => boolean
  resetValidation: () => void
}

export interface CodexManifestAccountsFieldProps {
  groupId: number
  modelValue: CodexModelsManifestConfig
  onModelValueChange: (value: CodexModelsManifestConfig) => void
  /** 已选账号 ID → 名称映射；无法解析的 ID 以 #<id> 展示 */
  accountNames?: Record<number, string>
  ref?: Ref<CodexManifestAccountsFieldHandle | null>
}

export default function CodexManifestAccountsField({
  groupId,
  modelValue,
  onModelValueChange,
  accountNames,
  ref
}: CodexManifestAccountsFieldProps) {
  const { t } = useI18n()
  const config = modelValue

  // 本次会话内新选账号的名称缓存：accountNames 只覆盖打开对话框时已存的
  // ID，搜索新选的账号名称由组件自己记住，避免标签闪现 #<id>。
  const [localNames, setLocalNames] = useState<Record<number, string>>({})
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searchResults, setSearchResults] = useState<SimpleAccount[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [showValidationError, setShowValidationError] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement>(null)

  // 连续两次子更新之间父组件可能尚未重新渲染，始终基于最新值合并
  const latest = useRef(modelValue)
  useEffect(() => {
    latest.current = modelValue
  })
  const emitUpdate = (patch: Partial<CodexModelsManifestConfig>) => {
    const next = { ...latest.current, ...patch }
    latest.current = next
    onModelValueChange(next)
  }

  const accountLabel = (id: number) => accountNames?.[id] ?? localNames[id] ?? `#${id}`

  // 点击下拉容器外部时收起（与分组表单模型路由下拉同一模式）。
  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('click', handleDocumentClick)
    return () => document.removeEventListener('click', handleDocumentClick)
  }, [])

  const searchRunner = useKeyedDebouncedSearch<SimpleAccount[]>({
    delay: 300,
    search: async (keyword, { signal }) => {
      const res = await adminAPI.accounts.list(
        1,
        20,
        {
          search: keyword,
          platform: 'openai',
          group: String(groupId)
        },
        { signal }
      )
      return res.items.map((account) => ({ id: account.id, name: account.name }))
    },
    onSuccess: (_key, result) => setSearchResults(result),
    onError: () => setSearchResults([])
  })

  const searchAccounts = (keyword: string) => {
    searchRunner.trigger('codex-manifest', keyword)
  }

  const onSearchFocus = () => {
    setShowDropdown(true)
    if (searchResults.length === 0) {
      searchAccounts(searchKeyword)
    }
  }

  const selectAccount = (account: SimpleAccount) => {
    if (latest.current.account_ids.includes(account.id)) return
    setLocalNames((names) => ({ ...names, [account.id]: account.name }))
    emitUpdate({ account_ids: [...latest.current.account_ids, account.id] })
    setSearchKeyword('')
    setShowDropdown(false)
    setShowValidationError(false)
  }

  const removeAccount = (id: number) => {
    emitUpdate({ account_ids: latest.current.account_ids.filter((accountId) => accountId !== id) })
  }

  useImperativeHandle(
    ref,
    () => ({
      validate: () => {
        if (latest.current.enabled && latest.current.account_ids.length === 0) {
          setShowValidationError(true)
          return false
        }
        setShowValidationError(false)
        return true
      },
      resetValidation: () => setShowValidationError(false)
    }),
    []
  )

  return (
    <div className={styles.block}>
      <div className={styles.toggleHead}>
        <div className={styles.toggleText}>
          <span className={styles.label}>{t('admin.groups.codexModelsManifest.title')}</span>
          <p className={styles.hint}>{t('admin.groups.codexModelsManifest.hint')}</p>
        </div>
        <Switch
          data-testid="codex-manifest-toggle"
          aria-label={t('admin.groups.codexModelsManifest.enable')}
          checked={config.enabled}
          onCheckedChange={(enabled) => emitUpdate({ enabled })}
        />
      </div>

      {config.enabled ? (
        <div className={styles.indented}>
          <p className={styles.hint}>{t('admin.groups.codexModelsManifest.enabledHint')}</p>

          <div className={styles.field}>
            <span className={styles.label}>{t('admin.groups.codexModelsManifest.accounts')}</span>

            {/* 已选账号标签 */}
            {config.account_ids.length > 0 ? (
              <div className={styles.chips} data-testid="codex-manifest-selected-tags">
                {config.account_ids.map((id) => (
                  <span key={id} className={styles.chip}>
                    {accountLabel(id)}
                    <button
                      type="button"
                      className={styles.chipRemove}
                      aria-label={`remove account ${id}`}
                      onClick={() => removeAccount(id)}
                    >
                      <X size={12} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            {/* 搜索输入 + 下拉 */}
            <div className={styles.searchAnchor} ref={searchContainerRef}>
              <input
                type="text"
                className={arcInput.input}
                data-testid="codex-manifest-search"
                value={searchKeyword}
                placeholder={t('admin.groups.codexModelsManifest.searchPlaceholder')}
                aria-label={t('admin.groups.codexModelsManifest.accounts')}
                onChange={(event) => {
                  setSearchKeyword(event.target.value)
                  searchAccounts(event.target.value)
                }}
                onFocus={onSearchFocus}
              />
              {showDropdown && (searchResults.length > 0 || searchKeyword.trim() !== '') ? (
                <div className={styles.dropdown} data-testid="codex-manifest-dropdown">
                  {searchResults.length === 0 ? (
                    <p className={styles.dropdownEmpty} data-testid="codex-manifest-search-empty">
                      {t('admin.groups.codexModelsManifest.searchEmpty')}
                    </p>
                  ) : null}
                  {searchResults.map((account) => {
                    const selected = config.account_ids.includes(account.id)
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
          </div>

          {/* 回退子开关 */}
          <div className={styles.toggleHead}>
            <div className={styles.toggleText}>
              <span className={styles.label}>{t('admin.groups.codexModelsManifest.fallback')}</span>
              <p className={styles.hint}>{t('admin.groups.codexModelsManifest.fallbackHint')}</p>
            </div>
            <Switch
              data-testid="codex-manifest-fallback-toggle"
              aria-label={t('admin.groups.codexModelsManifest.fallback')}
              checked={config.fallback_to_scheduler}
              onCheckedChange={(fallback_to_scheduler) => emitUpdate({ fallback_to_scheduler })}
            />
          </div>

          {showValidationError ? (
            <p className={styles.error} role="alert" data-testid="codex-manifest-validation-error">
              {t('admin.groups.codexModelsManifest.selectAtLeastOne')}
            </p>
          ) : null}
        </div>
      ) : (
        <p className={styles.hint}>{t('admin.groups.codexModelsManifest.disabledHint')}</p>
      )}
    </div>
  )
}
