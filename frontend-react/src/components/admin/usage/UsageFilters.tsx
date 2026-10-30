import { X } from 'lucide-react'
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'

import { adminAPI } from '@/api/admin'
import type { SimpleApiKey, SimpleUser } from '@/api/admin/usage'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import Select, { type SelectOption, type SelectValue } from '@/components/common/Select'
import { useI18n } from '@/i18n/useI18n'
import { COMMON_ERROR_STATUS_CODES } from '@/utils/errorBadges'
import styles from './UsageFilters.module.css'

export type UsageFiltersValue = Record<string, any>

export type UsageFiltersMode = 'usage' | 'errors' | 'ranking'

export interface UsageFiltersHandle {
  getUserSearchRevision: () => number
  setUserKeyword: (email: string) => void
}

export interface UsageFiltersProps {
  /** 当前筛选（Vue 版 v-model） */
  value: UsageFiltersValue
  /** 筛选对象被修改（Vue 版就地修改 modelValue） */
  onValueChange?: (value: UsageFiltersValue) => void
  /** Vue 版 change 事件，携带修改后的筛选 */
  onChange?: (value: UsageFiltersValue) => void
  exporting: boolean
  startDate: string
  endDate: string
  /** 默认 true */
  showActions?: boolean
  modelOptions?: string[]
  /**
   * errors 模式:隐藏用量专属字段/按钮,显示错误类型+状态码(错误请求 tab 用)
   * ranking 模式:同 usage 但隐藏计费模式筛选与清理/导出按钮(用户排行 tab 用)
   */
  mode?: UsageFiltersMode
  /** 嵌入统一卡片内使用：去掉自身卡片外观 */
  flat?: boolean
  className?: string
  /** Vue 版 #after-reset 插槽 */
  afterReset?: ReactNode
  onRefresh?: () => void
  onReset?: () => void
  onExport?: () => void
  onCleanup?: () => void
  ref?: Ref<UsageFiltersHandle>
}

interface SimpleAccount {
  id: number
  name: string
}

export default function UsageFilters({
  value,
  onValueChange,
  onChange,
  exporting,
  startDate,
  endDate,
  showActions = true,
  modelOptions: modelOptionsProp,
  mode = 'usage',
  flat = false,
  className,
  afterReset,
  onRefresh,
  onReset,
  onExport,
  onCleanup,
  ref
}: UsageFiltersProps) {
  const { t } = useI18n()

  // 与 Vue 版就地修改语义一致：同一轮里的多次修改基于最新值叠加
  const filtersRef = useRef(value)
  const callbacksRef = useRef({ onValueChange, onChange })
  useLayoutEffect(() => {
    filtersRef.current = value
    callbacksRef.current = { onValueChange, onChange }
  })

  const update = (patch: UsageFiltersValue, emitChange: boolean) => {
    const next = { ...filtersRef.current, ...patch }
    filtersRef.current = next
    callbacksRef.current.onValueChange?.(next)
    if (emitChange) callbacksRef.current.onChange?.(next)
  }
  const emitChange = () => callbacksRef.current.onChange?.(filtersRef.current)

  const userSearchRef = useRef<HTMLDivElement>(null)
  const apiKeySearchRef = useRef<HTMLDivElement>(null)
  const accountSearchRef = useRef<HTMLDivElement>(null)

  const [userKeyword, setUserKeywordState] = useState('')
  const [userResults, setUserResults] = useState<SimpleUser[]>([])
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const userSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userSearchSequence = useRef(0)

  const [apiKeyKeyword, setApiKeyKeyword] = useState('')
  const apiKeyKeywordRef = useRef('')
  const [apiKeyResults, setApiKeyResults] = useState<SimpleApiKey[]>([])
  const [showApiKeyDropdown, setShowApiKeyDropdown] = useState(false)
  const apiKeySearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [accountKeyword, setAccountKeyword] = useState('')
  const accountKeywordRef = useRef('')
  const [accountResults, setAccountResults] = useState<SimpleAccount[]>([])
  const [showAccountDropdown, setShowAccountDropdown] = useState(false)
  const accountSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [groupOptions, setGroupOptions] = useState<SelectOption[]>([])

  const modelOptions = useMemo<SelectOption[]>(
    () => [{ value: null, label: t('admin.usage.allModels') }, ...(modelOptionsProp ?? []).map((m) => ({ value: m, label: m }))],
    [modelOptionsProp, t]
  )
  const allGroupOptions = useMemo<SelectOption[]>(
    () => [{ value: null, label: t('admin.usage.allGroups') }, ...groupOptions],
    [groupOptions, t]
  )

  const requestTypeOptions: SelectOption[] = [
    { value: null, label: t('admin.usage.allTypes') },
    { value: 'ws_v2', label: t('usage.ws') },
    { value: 'live', label: t('usage.live') },
    { value: 'stream', label: t('usage.stream') },
    { value: 'sync', label: t('usage.sync') },
    { value: 'cyber', label: t('usage.cyber') }
  ]

  const compactionOptions: SelectOption[] = [
    { value: null, label: t('usage.allCompactionTypes') },
    { value: true, label: t('usage.compactionOnly') }
  ]

  const billingTypeOptions: SelectOption[] = [
    { value: null, label: t('admin.usage.allBillingTypes') },
    { value: 0, label: t('admin.usage.billingTypeBalance') },
    { value: 1, label: t('admin.usage.billingTypeSubscription') }
  ]

  // 错误类型对应后端 phase 参数(与错误表"类型"徽章同语义)
  const errorPhaseOptions: SelectOption[] = [
    { value: null, label: t('admin.usage.allTypes') },
    { value: 'upstream', label: t('admin.ops.errorLog.typeUpstream') },
    { value: 'account_auth', label: t('admin.ops.errorLog.typeAccountAuth') },
    { value: 'request', label: t('admin.ops.errorLog.typeRequest') },
    { value: 'auth', label: t('admin.ops.errorLog.typeAuth') },
    { value: 'routing', label: t('admin.ops.errorLog.typeRouting') },
    { value: 'internal', label: t('admin.ops.errorLog.typeInternal') }
  ]

  // 分类码同用户端 /usage 错误筛选;"other" 无法反查为过滤条件,刻意不列
  const errorCategoryCodes = ['auth', 'rate_limit', 'quota', 'invalid_request', 'service_unavailable', 'upstream', 'internal', 'cyber']

  const errorCategoryOptions: SelectOption[] = [
    { value: null, label: t('usage.errors.allCategories') },
    ...errorCategoryCodes.map((c) => ({ value: c, label: t('usage.errors.categories.' + c) }))
  ]

  const statusCodeOptions: SelectOption[] = [
    { value: null, label: t('usage.errors.allStatuses') },
    ...COMMON_ERROR_STATUS_CODES.map((c) => ({ value: c, label: String(c) }))
  ]

  const billingModeOptions: SelectOption[] = [
    { value: null, label: t('admin.usage.allBillingModes') },
    { value: 'token', label: t('admin.usage.billingModeToken') },
    { value: 'per_request', label: t('admin.usage.billingModePerRequest') },
    { value: 'image', label: t('admin.usage.billingModeImage') },
    { value: 'video', label: t('admin.usage.billingModeVideo') }
  ]

  const upstreamModelMismatchOptions: SelectOption[] = [
    { value: null, label: t('admin.usage.allUpstreamModelAudit') },
    { value: true, label: t('admin.usage.upstreamModelMismatchOnly') },
    { value: false, label: t('admin.usage.upstreamModelMatchedOnly') }
  ]

  const clearPendingUserSearch = () => {
    if (userSearchTimeout.current) {
      clearTimeout(userSearchTimeout.current)
      userSearchTimeout.current = null
    }
    userSearchSequence.current += 1
  }

  const debounceUserSearch = (keyword: string) => {
    clearPendingUserSearch()
    const query = keyword.trim()
    if (!query) {
      setUserResults([])
      return
    }

    const sequence = userSearchSequence.current
    userSearchTimeout.current = setTimeout(async () => {
      userSearchTimeout.current = null
      try {
        const results = await adminAPI.usage.searchUsers(query)
        if (sequence === userSearchSequence.current) {
          setUserResults(results.sort((a, b) => Number(a.deleted) - Number(b.deleted)))
        }
      } catch {
        if (sequence === userSearchSequence.current) {
          setUserResults([])
        }
      }
    }, 300)
  }

  const debounceApiKeySearch = () => {
    if (apiKeySearchTimeout.current) clearTimeout(apiKeySearchTimeout.current)
    apiKeySearchTimeout.current = setTimeout(async () => {
      try {
        setApiKeyResults(await adminAPI.usage.searchApiKeys(filtersRef.current.user_id, apiKeyKeywordRef.current || ''))
      } catch {
        setApiKeyResults([])
      }
    }, 300)
  }

  const clearApiKeyState = () => {
    setApiKeyKeyword('')
    apiKeyKeywordRef.current = ''
    setApiKeyResults([])
    setShowApiKeyDropdown(false)
  }

  const selectUser = async (u: SimpleUser) => {
    clearPendingUserSearch()
    setUserKeywordState(u.email)
    setShowUserDropdown(false)
    clearApiKeyState()
    update({ user_id: u.id, api_key_id: undefined }, false)

    // Auto-load API keys for this user
    try {
      setApiKeyResults(await adminAPI.usage.searchApiKeys(u.id, ''))
    } catch {
      setApiKeyResults([])
    }

    emitChange()
  }

  const clearUser = () => {
    clearPendingUserSearch()
    setUserKeywordState('')
    setUserResults([])
    setShowUserDropdown(false)
    clearApiKeyState()
    update({ user_id: undefined, api_key_id: undefined }, true)
  }

  const selectApiKey = (k: SimpleApiKey) => {
    setApiKeyKeyword(k.name || String(k.id))
    apiKeyKeywordRef.current = k.name || String(k.id)
    setShowApiKeyDropdown(false)
    update({ api_key_id: k.id }, true)
  }

  const onClearApiKey = () => {
    clearApiKeyState()
    update({ api_key_id: undefined }, true)
  }

  const debounceAccountSearch = () => {
    if (accountSearchTimeout.current) clearTimeout(accountSearchTimeout.current)
    accountSearchTimeout.current = setTimeout(async () => {
      if (!accountKeywordRef.current) {
        setAccountResults([])
        return
      }
      try {
        const res = await adminAPI.accounts.list(1, 20, { search: accountKeywordRef.current })
        setAccountResults(res.items.map((a) => ({ id: a.id, name: a.name })))
      } catch {
        setAccountResults([])
      }
    }, 300)
  }

  const selectAccount = (a: SimpleAccount) => {
    setAccountKeyword(a.name)
    accountKeywordRef.current = a.name
    setShowAccountDropdown(false)
    update({ account_id: a.id }, true)
  }

  const clearAccount = () => {
    setAccountKeyword('')
    accountKeywordRef.current = ''
    setAccountResults([])
    setShowAccountDropdown(false)
    update({ account_id: undefined }, true)
  }

  const onApiKeyFocus = () => {
    setShowApiKeyDropdown(true)
    // Trigger search if no results yet
    if (apiKeyResults.length === 0) {
      debounceApiKeySearch()
    }
  }

  const setField = (key: string, next: SelectValue) => update({ [key]: next }, true)

  // 起止日期随外部日期同步（Vue 版 immediate watch）
  useEffect(() => {
    if (filtersRef.current.start_date === startDate && filtersRef.current.end_date === endDate) return
    update({ start_date: startDate, end_date: endDate }, false)
  }, [startDate, endDate])

  // 外部清空 user_id / api_key_id / account_id 时同步清空输入框（Vue 版非 immediate watch，首次挂载不触发）
  const watched = useRef({ user_id: value.user_id, api_key_id: value.api_key_id, account_id: value.account_id })
  useEffect(() => {
    if (value.user_id === watched.current.user_id) return
    watched.current.user_id = value.user_id
    if (!value.user_id) {
      clearPendingUserSearch()
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 与 Vue 版 watch(user_id) 一致，外部清空时同步清空输入框
      setUserKeywordState('')
      setUserResults([])
    }
  }, [value.user_id])
  useEffect(() => {
    if (value.api_key_id === watched.current.api_key_id) return
    watched.current.api_key_id = value.api_key_id
    if (!value.api_key_id) {
      apiKeyKeywordRef.current = ''
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 与 Vue 版 watch(api_key_id) 一致，外部清空时同步清空输入框
      setApiKeyKeyword('')
      setApiKeyResults([])
    }
  }, [value.api_key_id])
  useEffect(() => {
    if (value.account_id === watched.current.account_id) return
    watched.current.account_id = value.account_id
    if (!value.account_id) {
      accountKeywordRef.current = ''
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 与 Vue 版 watch(account_id) 一致，外部清空时同步清空输入框
      setAccountKeyword('')
      setAccountResults([])
    }
  }, [value.account_id])

  useEffect(() => {
    const onDocumentClick = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (!(userSearchRef.current?.contains(target) ?? false)) setShowUserDropdown(false)
      if (!(apiKeySearchRef.current?.contains(target) ?? false)) setShowApiKeyDropdown(false)
      if (!(accountSearchRef.current?.contains(target) ?? false)) setShowAccountDropdown(false)
    }
    document.addEventListener('click', onDocumentClick)
    let cancelled = false
    void (async () => {
      try {
        const gs = await adminAPI.groups.list(1, 1000)
        if (!cancelled) setGroupOptions(gs.items.map((g) => ({ value: g.id, label: g.name })))
      } catch {
        // Ignore filter option loading errors (page still usable)
      }
    })()
    return () => {
      cancelled = true
      clearPendingUserSearch()
      if (apiKeySearchTimeout.current) clearTimeout(apiKeySearchTimeout.current)
      if (accountSearchTimeout.current) clearTimeout(accountSearchTimeout.current)
      document.removeEventListener('click', onDocumentClick)
    }
  }, [])

  // 供外部(如用户排行下钻)在程序化设置 user_id 后回显选中的用户邮箱
  useImperativeHandle(ref, () => ({
    getUserSearchRevision: () => userSearchSequence.current,
    setUserKeyword: (email: string) => {
      clearPendingUserSearch()
      setUserKeywordState(email)
      setUserResults([])
      setShowUserDropdown(false)
    }
  }))

  const field = (label: string, control: ReactNode, size: string, testId?: string) => (
    <div className={`${styles.field} ${size}`} data-testid={testId}>
      <span className={styles.label}>{label}</span>
      {control}
    </div>
  )

  return (
    <div className={[flat ? styles.flat : styles.root, className].filter(Boolean).join(' ')}>
      <div className={styles.toolbar}>
        <div className={styles.fields}>
          {/* User Search */}
          <div ref={userSearchRef} className={`${styles.field} ${styles.fieldWide} ${styles.search}`} data-testid="usage-filter-user">
            <Input
              label={t('admin.usage.userFilter')}
              type="text"
              value={userKeyword}
              className={styles.searchInput}
              placeholder={t('admin.usage.searchUserPlaceholder')}
              onChange={(e) => {
                setUserKeywordState(e.target.value)
                debounceUserSearch(e.target.value)
              }}
              onFocus={() => setShowUserDropdown(true)}
            />
            {value.user_id ? (
              <button type="button" className={styles.clear} onClick={clearUser} aria-label="Clear user filter">
                <X size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            ) : null}
            {showUserDropdown && (userResults.length > 0 || userKeyword) ? (
              <div className={styles.dropdown} role="listbox">
                {userResults.map((u) => (
                  <button key={u.id} type="button" role="option" aria-selected={false} className={styles.option} onClick={() => void selectUser(u)}>
                    <span className={styles.optionName}>
                      {u.email}
                      {u.deleted ? <span className={styles.muted}>（{t('admin.usage.userDeletedBadge')}）</span> : null}
                    </span>
                    <span className={styles.muted}>#{u.id}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* API Key Search */}
          <div ref={apiKeySearchRef} className={`${styles.field} ${styles.fieldWide} ${styles.search}`} data-testid="usage-filter-api-key">
            <Input
              label={t('usage.apiKeyFilter')}
              type="text"
              value={apiKeyKeyword}
              className={styles.searchInput}
              placeholder={t('admin.usage.searchApiKeyPlaceholder')}
              onChange={(e) => {
                setApiKeyKeyword(e.target.value)
                apiKeyKeywordRef.current = e.target.value
                debounceApiKeySearch()
              }}
              onFocus={onApiKeyFocus}
            />
            {value.api_key_id ? (
              <button type="button" className={styles.clear} onClick={onClearApiKey} aria-label="Clear API key filter">
                <X size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            ) : null}
            {showApiKeyDropdown && apiKeyResults.length > 0 ? (
              <div className={styles.dropdown} role="listbox">
                {apiKeyResults.map((k) => (
                  <button key={k.id} type="button" role="option" aria-selected={false} className={styles.option} onClick={() => selectApiKey(k)}>
                    <span className={styles.optionName}>{k.name || `#${k.id}`}</span>
                    <span className={styles.muted}>#{k.id}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Model Filter */}
          {field(
            t('usage.model'),
            <Select value={value.model} options={modelOptions} searchable aria-label={t('usage.model')} onChange={(next) => setField('model', next)} />,
            styles.fieldMedium
          )}

          {/* Account Filter */}
          <div ref={accountSearchRef} className={`${styles.field} ${styles.fieldMedium} ${styles.search}`} data-testid="usage-filter-account">
            <Input
              label={t('admin.usage.account')}
              type="text"
              value={accountKeyword}
              className={styles.searchInput}
              placeholder={t('admin.usage.searchAccountPlaceholder')}
              onChange={(e) => {
                setAccountKeyword(e.target.value)
                accountKeywordRef.current = e.target.value
                debounceAccountSearch()
              }}
              onFocus={() => setShowAccountDropdown(true)}
            />
            {value.account_id ? (
              <button type="button" className={styles.clear} onClick={clearAccount} aria-label="Clear account filter">
                <X size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            ) : null}
            {showAccountDropdown && (accountResults.length > 0 || accountKeyword) ? (
              <div className={styles.dropdown} role="listbox">
                {accountResults.map((a) => (
                  <button key={a.id} type="button" role="option" aria-selected={false} className={styles.option} onClick={() => selectAccount(a)}>
                    <span className={styles.optionName}>{a.name}</span>
                    <span className={styles.muted}>#{a.id}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Request Type Filter (usage only) */}
          {mode !== 'errors'
            ? field(
                t('usage.type'),
                <Select value={value.request_type} options={requestTypeOptions} aria-label={t('usage.type')} onChange={(next) => setField('request_type', next)} />,
                ''
              )
            : null}

          {/* Native compaction is independent of the transport request type. */}
          {mode !== 'errors'
            ? field(
                t('usage.compactionFilter'),
                <Select
                  value={value.native_compaction_v2}
                  options={compactionOptions}
                  aria-label={t('usage.compactionFilter')}
                  onChange={(next) => setField('native_compaction_v2', next)}
                />,
                ''
              )
            : null}

          {/* Billing Type Filter (usage only) */}
          {mode !== 'errors'
            ? field(
                t('admin.usage.billingType'),
                <Select value={value.billing_type} options={billingTypeOptions} aria-label={t('admin.usage.billingType')} onChange={(next) => setField('billing_type', next)} />,
                styles.fieldNarrow
              )
            : null}

          {/* Billing Mode Filter (usage only；用户排行的 user-breakdown 接口不支持该维度) */}
          {mode === 'usage'
            ? field(
                t('admin.usage.billingMode'),
                <Select value={value.billing_mode} options={billingModeOptions} aria-label={t('admin.usage.billingMode')} onChange={(next) => setField('billing_mode', next)} />,
                styles.fieldNarrow
              )
            : null}

          {mode === 'usage'
            ? field(
                t('admin.usage.upstreamModelAudit'),
                <Select
                  value={value.upstream_model_mismatch}
                  options={upstreamModelMismatchOptions}
                  aria-label={t('admin.usage.upstreamModelAudit')}
                  onChange={(next) => setField('upstream_model_mismatch', next)}
                />,
                styles.fieldMedium
              )
            : null}

          {/* Error Phase Filter (errors only) */}
          {mode === 'errors'
            ? field(
                t('admin.ops.errorLog.type'),
                <Select value={value.error_phase} options={errorPhaseOptions} aria-label={t('admin.ops.errorLog.type')} onChange={(next) => setField('error_phase', next)} />,
                ''
              )
            : null}

          {/* Error Category Filter (errors only) */}
          {mode === 'errors'
            ? field(
                t('usage.errors.category'),
                <Select value={value.error_category} options={errorCategoryOptions} aria-label={t('usage.errors.category')} onChange={(next) => setField('error_category', next)} />,
                ''
              )
            : null}

          {/* Status Code Filter (errors only) */}
          {mode === 'errors'
            ? field(
                t('admin.ops.errorLog.status'),
                <Select value={value.status_code} options={statusCodeOptions} aria-label={t('admin.ops.errorLog.status')} onChange={(next) => setField('status_code', next)} />,
                ''
              )
            : null}

          {/* Group Filter */}
          {field(
            t('admin.usage.group'),
            <Select value={value.group_id} options={allGroupOptions} searchable aria-label={t('admin.usage.group')} onChange={(next) => setField('group_id', next)} />,
            styles.fieldNarrow
          )}
        </div>

        {/* Right: actions */}
        {showActions ? (
          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={() => onRefresh?.()}>
              {t('common.refresh')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => onReset?.()}>
              {t('common.reset')}
            </Button>
            {afterReset}
            {mode === 'usage' ? (
              <>
                <Button type="button" variant="danger" onClick={() => onCleanup?.()}>
                  {t('admin.usage.cleanup.button')}
                </Button>
                <Button type="button" variant="primary" disabled={exporting} onClick={() => onExport?.()}>
                  {t('usage.exportExcel')}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
