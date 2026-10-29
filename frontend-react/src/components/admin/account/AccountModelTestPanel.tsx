/**
 * 账号模型批量测试面板，对应 Vue 版 AccountModelTestPanel.vue。
 * 按平台加载每个账号的可用模型（并发 6），单个或批量（并发 3）发起 SSE 测试，
 * 测试流通过 fetch 读取（与 AccountTestModal 相同的 /admin/accounts/:id/test 接口）。
 */
import { Check, Filter, Play, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import { ADMIN_UI_REQUEST_HEADER } from '@/api/adminUIRequest'
import { buildApiUrl } from '@/api/client'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import Select from '@/components/common/Select'
import { useI18n } from '@/i18n/useI18n'
import type { Account, ClaudeModel } from '@/types'
import styles from './AccountModelTestPanel.module.css'

type TestStatus = 'idle' | 'running' | 'success' | 'error'
type TestState = { status: TestStatus; message: string }
type TestTarget = { account: Account; model: ClaudeModel }

export interface AccountModelTestPanelProps {
  accounts: Account[]
  platform: string
  active: boolean
}

const providerLabels: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  grok: 'Grok',
  kimi: 'Kimi',
  zhipu: 'Zhipu',
  deepseek: 'DeepSeek'
}

const testKey = (accountId: number, modelId: string) => `${accountId}:${modelId}`

export default function AccountModelTestPanel({ accounts, platform, active }: AccountModelTestPanelProps) {
  const { t } = useI18n()
  const [modelsByAccount, setModelsByAccount] = useState<Record<number, ClaudeModel[]>>({})
  const [modelErrors, setModelErrors] = useState<Record<number, string>>({})
  const [testStates, setTestStates] = useState<Record<string, TestState>>({})
  const [loadingModels, setLoadingModels] = useState(false)
  const [batchRunning, setBatchRunningState] = useState(false)
  const [completedTests, setCompletedTests] = useState(0)
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all')
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])

  const loadSequence = useRef(0)
  const controllers = useRef(new Set<AbortController>())
  // 批量测试的 worker 循环需要读取最新值，用 ref 同步保存
  const batchRunningRef = useRef(false)
  const testStatesRef = useRef(testStates)
  const propsRef = useRef({ accounts, platform, active, t })
  useEffect(() => {
    propsRef.current = { accounts, platform, active, t }
  })

  const setBatchRunning = useCallback((value: boolean) => {
    batchRunningRef.current = value
    setBatchRunningState(value)
  }, [])

  const updateTestState = useCallback((key: string, state: TestState) => {
    testStatesRef.current = { ...testStatesRef.current, [key]: state }
    setTestStates(testStatesRef.current)
  }, [])

  const resetTestStates = useCallback(() => {
    testStatesRef.current = {}
    setTestStates({})
  }, [])

  const providerLabel = providerLabels[platform] || platform

  const testTargets = useMemo<TestTarget[]>(
    () =>
      accounts.flatMap((account) =>
        (selectedAccountId !== 'all' && String(account.id) !== selectedAccountId ? [] : modelsByAccount[account.id] || [])
          .filter((model) => selectedModelIds.length === 0 || selectedModelIds.includes(model.id))
          .map((model) => ({ account, model }))
      ),
    [accounts, modelsByAccount, selectedAccountId, selectedModelIds]
  )
  const totalModels = testTargets.length
  const accountOptions = useMemo(
    () => [
      { value: 'all', label: t('admin.accounts.modelTest.allAccounts') },
      ...accounts.map((account) => ({ value: String(account.id), label: account.name }))
    ],
    [accounts, t]
  )
  const allModels = useMemo(() => {
    const map = new Map<string, ClaudeModel>()
    Object.values(modelsByAccount)
      .flat()
      .forEach((model) => map.set(model.id, model))
    return Array.from(map.values())
  }, [modelsByAccount])

  const abortTests = useCallback(() => {
    controllers.current.forEach((controller) => controller.abort())
    controllers.current.clear()
    setBatchRunning(false)
  }, [setBatchRunning])

  const loadModels = useCallback(async () => {
    const sequence = ++loadSequence.current
    abortTests()
    setLoadingModels(false)
    setModelsByAccount({})
    setModelErrors({})
    resetTestStates()
    setCompletedTests(0)
    const current = propsRef.current
    if (!current.active || !current.platform || current.accounts.length === 0) return

    setLoadingModels(true)
    const queue = [...current.accounts]
    const entries: Array<{ accountId: number; models: ClaudeModel[]; error: string }> = []
    const worker = async () => {
      while (queue.length > 0 && sequence === loadSequence.current) {
        const account = queue.shift()
        if (!account) break
        try {
          const models = await adminAPI.accounts.getAvailableModels(account.id)
          entries.push({ accountId: account.id, models, error: '' })
        } catch (error) {
          const message = error instanceof Error ? error.message : current.t('admin.accounts.modelTest.loadFailed')
          entries.push({ accountId: account.id, models: [], error: message })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker))
    if (sequence !== loadSequence.current) return

    setModelsByAccount(Object.fromEntries(entries.map((entry) => [entry.accountId, entry.models])))
    setModelErrors(Object.fromEntries(entries.filter((entry) => entry.error).map((entry) => [entry.accountId, entry.error])))
    setLoadingModels(false)
    setSelectedModelIds([])
  }, [abortTests, resetTestStates])

  const consumeTestStream = async (response: Response): Promise<{ success: boolean; message: string }> => {
    if (!response.ok) return { success: false, message: `HTTP ${response.status}` }
    if (!response.body) return { success: false, message: t('admin.accounts.modelTest.noResponse') }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let result: { success: boolean; message: string } | null = null

    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const lines = buffer.split('\n')
      buffer = done ? '' : lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        try {
          const event = JSON.parse(line.slice(5).trim()) as { type?: string; success?: boolean; error?: string }
          if (event.type === 'error') result = { success: false, message: event.error || t('admin.accounts.testFailed') }
          if (event.type === 'test_complete') {
            result = event.success
              ? { success: true, message: t('admin.accounts.testCompleted') }
              : { success: false, message: event.error || t('admin.accounts.testFailed') }
          }
        } catch {
          // Ignore non-JSON SSE lines such as keep-alives.
        }
      }
      if (done) break
    }
    return result || { success: false, message: t('admin.accounts.modelTest.incompleteResponse') }
  }

  const runTest = async (account: Account, model: ClaudeModel) => {
    const key = testKey(account.id, model.id)
    if (testStatesRef.current[key]?.status === 'running') return
    updateTestState(key, { status: 'running', message: t('admin.accounts.modelTest.testing') })
    const controller = new AbortController()
    controllers.current.add(controller)
    try {
      const response = await fetch(buildApiUrl(`/admin/accounts/${account.id}/test`), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
          'Content-Type': 'application/json',
          [ADMIN_UI_REQUEST_HEADER]: '1'
        },
        body: JSON.stringify({ model_id: model.id, prompt: '', mode: account.platform === 'grok' ? 'text' : 'default' }),
        signal: controller.signal
      })
      const result = await consumeTestStream(response)
      updateTestState(key, { status: result.success ? 'success' : 'error', message: result.message })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      updateTestState(key, {
        status: 'error',
        message: error instanceof Error ? error.message : t('admin.accounts.testFailed')
      })
    } finally {
      controllers.current.delete(controller)
    }
  }

  const runAllTests = async () => {
    if (batchRunningRef.current) return
    setBatchRunning(true)
    setCompletedTests(0)
    const queue = [...testTargets]
    const worker = async () => {
      while (queue.length > 0 && batchRunningRef.current) {
        const target = queue.shift()
        if (!target) break
        await runTest(target.account, target.model)
        setCompletedTests((count) => count + 1)
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker))
    setBatchRunning(false)
  }

  const accountIdsKey = accounts.map((account) => account.id).join(',')
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 与 Vue 版 watch 一致：面板激活或账号变化时重新加载模型
    void loadModels()
  }, [active, platform, accountIdsKey, loadModels])

  useEffect(
    () => () => {
      loadSequence.current++
      controllers.current.forEach((controller) => controller.abort())
      controllers.current.clear()
      batchRunningRef.current = false
    },
    []
  )

  const toggleModel = (modelId: string, checked: boolean) => {
    setSelectedModelIds((ids) => (checked ? (ids.includes(modelId) ? ids : [...ids, modelId]) : ids.filter((id) => id !== modelId)))
  }

  const statusIcon = (status: TestStatus) => {
    if (status === 'success') return <Check size={12} aria-hidden="true" />
    if (status === 'error') return <X size={12} aria-hidden="true" />
    if (status === 'running') return <RefreshCw size={12} className={styles.spin} aria-hidden="true" />
    return <Play size={12} aria-hidden="true" />
  }

  if (!platform) {
    return (
      <div className={styles.root}>
        <div className={styles.placeholder}>
          <Filter size={24} className={styles.placeholderIcon} aria-hidden="true" />
          <div>
            <p className={styles.placeholderTitle}>{t('admin.accounts.modelTest.selectProvider')}</p>
            <p className={styles.placeholderHint}>{t('admin.accounts.modelTest.selectProviderHint')}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.titleRow}>
            <span className={styles.provider}>{providerLabel}</span>
            <span className={styles.summary}>
              {t('admin.accounts.modelTest.summary', { accounts: accounts.length, models: totalModels })}
            </span>
          </div>
          <p className={styles.hint}>{t('admin.accounts.modelTest.hint')}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={loadingModels || batchRunning || testTargets.length === 0}
          onClick={() => void runAllTests()}
        >
          <Play size={14} aria-hidden="true" />
          <span>
            {batchRunning
              ? t('admin.accounts.modelTest.testingProgress', { done: completedTests, total: testTargets.length })
              : t('admin.accounts.modelTest.testAll')}
          </span>
        </Button>
      </div>

      <div className={styles.filters}>
        <div className={styles.scope}>
          <span className={styles.label}>{t('admin.accounts.modelTest.scope')}</span>
          <Select
            value={selectedAccountId}
            onChange={(value) => setSelectedAccountId(String(value ?? 'all'))}
            options={accountOptions}
            aria-label={t('admin.accounts.modelTest.scope')}
          />
        </div>
        <div className={styles.modelsField}>
          <span className={styles.label}>{t('admin.accounts.modelTest.models')}</span>
          <div className={styles.modelChecks}>
            {allModels.map((model) => (
              <Checkbox
                key={model.id}
                value={model.id}
                label={model.display_name || model.id}
                checked={selectedModelIds.includes(model.id)}
                onCheckedChange={(checked) => toggleModel(model.id, checked === true)}
              />
            ))}
            {allModels.length === 0 ? <span className={styles.muted}>{t('admin.accounts.modelTest.noModels')}</span> : null}
          </div>
        </div>
      </div>

      {loadingModels ? (
        <div className={styles.state}>
          <RefreshCw size={16} className={styles.spin} aria-hidden="true" />
          {t('admin.accounts.modelTest.loadingModels')}
        </div>
      ) : accounts.length === 0 ? (
        <div className={styles.state}>{t('admin.accounts.modelTest.noAccounts')}</div>
      ) : (
        <div className={styles.list}>
          {accounts.map((account) => {
            const models = modelsByAccount[account.id] || []
            return (
              <section key={account.id} className={styles.account}>
                <div className={styles.accountHeader}>
                  <div className={styles.accountName}>
                    <span className={styles.name}>{account.name}</span>
                    <span className={styles.id}>#{account.id}</span>
                    <span className={styles.dot} data-active={account.status === 'active' ? 'true' : 'false'} />
                  </div>
                  <span className={styles.summary}>
                    {t('admin.accounts.modelTest.modelCount', { count: models.length || 0 })}
                  </span>
                </div>

                {modelErrors[account.id] ? (
                  <p className={styles.error}>{modelErrors[account.id]}</p>
                ) : !models.length ? (
                  <p className={styles.muted}>{t('admin.accounts.modelTest.noModels')}</p>
                ) : (
                  <div className={styles.models}>
                    {models.map((model) => {
                      const state = testStates[testKey(account.id, model.id)]
                      const status = state?.status || 'idle'
                      return (
                        <button
                          key={model.id}
                          type="button"
                          className={styles.model}
                          data-status={status}
                          disabled={batchRunning || status === 'running'}
                          title={state?.message || model.display_name || model.id}
                          onClick={() => void runTest(account, model)}
                        >
                          {statusIcon(status)}
                          <span className={styles.modelName}>{model.display_name || model.id}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
