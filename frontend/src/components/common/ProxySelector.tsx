import { Check, ChevronDown, Loader2, Play, Search } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import { useI18n } from '@/i18n/useI18n'
import type { Proxy } from '@/types'
import styles from './ProxySelector.module.css'

export interface ProxyTestResult {
  success: boolean
  message: string
  latency_ms?: number
  ip_address?: string
  city?: string
  region?: string
  country?: string
}

export interface ProxySelectorProps {
  /** 选中的代理 ID，null 表示不使用代理（Vue 版 v-model） */
  value: number | null
  onChange: (value: number | null) => void
  proxies: Proxy[]
  disabled?: boolean
}

/** 代理选择下拉：支持搜索、单个/批量测试连通性，显示国家与延迟 */
export default function ProxySelector({ value, onChange, proxies, disabled = false }: ProxySelectorProps) {
  const { t } = useI18n()
  const listboxId = useId()
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Test state：测试中集合用 ref 做同步判重（批量测试不会重复发起正在进行的单个测试），state 用于渲染
  const [testResults, setTestResults] = useState<Record<number, ProxyTestResult>>({})
  const testingRef = useRef(new Set<number>())
  const [testingProxyIds, setTestingProxyIds] = useState<ReadonlySet<number>>(() => new Set())
  const [batchTesting, setBatchTesting] = useState(false)

  const close = () => {
    setIsOpen(false)
    setSearchQuery('')
  }

  // 表单禁用时收起下拉
  const [prevDisabled, setPrevDisabled] = useState(disabled)
  if (prevDisabled !== disabled) {
    setPrevDisabled(disabled)
    if (disabled) close()
  }

  useEffect(() => {
    if (isOpen) searchInputRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) close()
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('click', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  const selectedProxy = value === null ? null : proxies.find((p) => p.id === value) || null
  const selectedLabel = selectedProxy
    ? `${selectedProxy.name} (${selectedProxy.protocol}://${selectedProxy.host}:${selectedProxy.port})`
    : t('admin.accounts.noProxy')

  const query = searchQuery.toLowerCase()
  const filteredProxies = query
    ? proxies.filter((proxy) => proxy.name.toLowerCase().includes(query) || proxy.host.toLowerCase().includes(query))
    : proxies

  const toggle = () => {
    if (disabled) return
    if (isOpen) close()
    else setIsOpen(true)
  }

  const selectOption = (next: number | null) => {
    onChange(next)
    close()
  }

  const setTesting = (id: number, testing: boolean) => {
    if (testing) testingRef.current.add(id)
    else testingRef.current.delete(id)
    setTestingProxyIds(new Set(testingRef.current))
  }

  const handleTestProxy = async (proxy: Proxy) => {
    if (testingRef.current.has(proxy.id)) return

    setTesting(proxy.id, true)
    try {
      const result = await adminAPI.proxies.testProxy(proxy.id)
      setTestResults((prev) => ({ ...prev, [proxy.id]: result }))
    } catch (error: any) {
      setTestResults((prev) => ({
        ...prev,
        [proxy.id]: { success: false, message: error?.response?.data?.detail || 'Test failed' }
      }))
    } finally {
      setTesting(proxy.id, false)
    }
  }

  const handleBatchTest = async () => {
    if (batchTesting || proxies.length === 0) return
    setBatchTesting(true)
    // Test all proxies in parallel
    await Promise.all(proxies.map(handleTestProxy))
    setBatchTesting(false)
  }

  return (
    <div className={styles.root} ref={containerRef}>
      <button
        type="button"
        className={styles.trigger}
        data-open={isOpen ? '' : undefined}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        onClick={toggle}
      >
        <span className={styles.value}>{selectedLabel}</span>
        <ChevronDown className={styles.chevron} size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      {isOpen && (
        <div className={styles.dropdown}>
          {/* Search and Batch Test Header */}
          <div className={styles.header}>
            <div className={styles.search}>
              <Search size={16} strokeWidth={1.75} aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="text"
                className={styles.searchInput}
                value={searchQuery}
                placeholder={t('admin.proxies.searchProxies')}
                aria-label={t('admin.proxies.searchProxies')}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
            {proxies.length > 0 && (
              <button
                type="button"
                className={styles.iconButton}
                disabled={batchTesting}
                title={t('admin.proxies.batchTest')}
                aria-label={t('admin.proxies.batchTest')}
                onClick={(event) => {
                  event.stopPropagation()
                  void handleBatchTest()
                }}
              >
                {batchTesting
                  ? <Loader2 className={styles.spin} size={16} strokeWidth={1.75} aria-hidden="true" />
                  : <Play size={16} strokeWidth={1.75} aria-hidden="true" />}
              </button>
            )}
          </div>

          {/* Options list */}
          <div id={listboxId} className={styles.options} role="listbox" aria-label={t('admin.accounts.proxy')}>
            {/* No Proxy option */}
            <div
              role="option"
              aria-selected={value === null}
              className={styles.option}
              data-selected={value === null ? '' : undefined}
              onClick={() => selectOption(null)}
            >
              <span className={styles.optionLabel}>{t('admin.accounts.noProxy')}</span>
              {value === null && <Check className={styles.check} size={16} strokeWidth={1.75} aria-hidden="true" />}
            </div>

            {/* Proxy options */}
            {filteredProxies.map((proxy) => {
              const result = testResults[proxy.id]
              const testing = testingProxyIds.has(proxy.id)
              return (
                <div
                  key={proxy.id}
                  role="option"
                  aria-selected={value === proxy.id}
                  className={styles.option}
                  data-selected={value === proxy.id ? '' : undefined}
                  onClick={() => selectOption(proxy.id)}
                >
                  <div className={styles.optionMain}>
                    <div className={styles.optionTitle}>
                      <span className={styles.optionName}>{proxy.name}</span>
                      {/* Account count badge */}
                      {proxy.account_count !== undefined && <span className={styles.chip}>{proxy.account_count}</span>}
                      {/* Test result badges */}
                      {result && (result.success ? (
                        <span className={styles.chip} data-tone="success">
                          {result.country && <span>{result.country}</span>}
                          {result.latency_ms ? <span>{result.latency_ms}ms</span> : null}
                        </span>
                      ) : (
                        <span className={styles.chip} data-tone="danger">{t('admin.proxies.testFailed')}</span>
                      ))}
                    </div>
                    <div className={styles.optionMeta}>
                      {proxy.protocol}://{proxy.host}:{proxy.port}
                    </div>
                  </div>

                  {/* Individual test button */}
                  <button
                    type="button"
                    className={styles.iconButton}
                    disabled={testing}
                    title={t('admin.proxies.testConnection')}
                    aria-label={t('admin.proxies.testConnection')}
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleTestProxy(proxy)
                    }}
                  >
                    {testing
                      ? <Loader2 className={styles.spin} size={14} strokeWidth={1.75} aria-hidden="true" />
                      : <Play size={12} strokeWidth={1.75} aria-hidden="true" />}
                  </button>

                  {value === proxy.id && <Check className={styles.check} size={16} strokeWidth={1.75} aria-hidden="true" />}
                </div>
              )
            })}

            {/* Empty state */}
            {filteredProxies.length === 0 && searchQuery && <div className={styles.empty}>{t('common.noOptionsFound')}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
