<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      v-if="!platform"
      class="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center"
    >
      <Icon name="filter" size="lg" class="text-gray-400" />
      <div>
        <p class="font-medium text-gray-800 dark:text-gray-200">{{ t('admin.accounts.modelTest.selectProvider') }}</p>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('admin.accounts.modelTest.selectProviderHint') }}</p>
      </div>
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-dark-700">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-semibold text-gray-900 dark:text-white">{{ providerLabel }}</span>
            <span class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('admin.accounts.modelTest.summary', { accounts: accounts.length, models: totalModels }) }}
            </span>
          </div>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ verificationOnly ? t('admin.accounts.modelTest.verificationHint') : t('admin.accounts.modelTest.hint') }}</p>
        </div>
        <button
          v-if="!verificationOnly"
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="loadingModels || batchRunning || testTargets.length === 0"
          @click="runAllTests"
        >
          <Icon name="play" size="sm" />
          <span>{{ batchRunning ? t('admin.accounts.modelTest.testingProgress', { done: completedTests, total: testTargets.length }) : t('admin.accounts.modelTest.testAll') }}</span>
        </button>
        <button
          v-if="verificationOnly"
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="loadingModels || verificationRunning || testTargets.length === 0"
          @click="runVerification"
        >
          <Icon name="shield" size="sm" />
          <span>{{ verificationRunning ? t('admin.accounts.modelTest.verifying') : t('admin.accounts.modelTest.verifyAuthenticity') }}</span>
        </button>
      </div>

      <div class="flex flex-wrap items-end gap-4 border-b border-gray-200 px-5 py-3 dark:border-dark-700">
        <div class="min-w-[220px]">
          <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('admin.accounts.modelTest.scope') }}</label>
          <Select v-model="selectedAccountId" :options="accountOptions" value-key="value" label-key="label" />
        </div>
        <div class="min-w-[260px] flex-1">
          <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('admin.accounts.modelTest.models') }}</label>
          <Select v-if="verificationOnly" v-model="selectedVerificationModel" :options="verificationModelOptions" value-key="value" label-key="label" :disabled="verificationRunning" />
          <div v-else class="flex max-h-24 flex-wrap gap-x-3 gap-y-1 overflow-y-auto rounded border border-gray-200 px-3 py-2 dark:border-dark-600">
            <label v-for="model in allModels" :key="model.id" class="inline-flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
              <input v-model="selectedModelIds" type="checkbox" :value="model.id" class="rounded border-gray-300 text-primary-600" />
              <span>{{ model.display_name || model.id }}</span>
            </label>
            <span v-if="allModels.length === 0" class="text-xs text-gray-400">{{ t('admin.accounts.modelTest.noModels') }}</span>
          </div>
        </div>
        <div v-if="verificationOnly" class="min-w-[150px]">
          <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('admin.accounts.modelTest.verificationLevel') }}</label>
          <Select v-model="verificationLevel" :options="verificationLevels" value-key="value" label-key="label" :disabled="verificationRunning" />
        </div>
      </div>

      <div v-if="verificationOnly && verificationError" class="mx-5 mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">{{ verificationError }}</div>
      <section v-if="verificationOnly && savedVerificationReports.length" class="mx-5 my-4 rounded border border-primary-200 bg-primary-50/50 p-4 dark:border-primary-900/50 dark:bg-primary-900/10">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 class="font-semibold text-gray-900 dark:text-white">{{ t('admin.accounts.modelTest.verificationReport') }}</h3>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('admin.accounts.modelTest.previousReports') }}</p>
          </div>
          <span class="text-xs text-gray-500 dark:text-gray-400">{{ savedVerificationReports.length }} {{ t('admin.accounts.modelTest.modelsReported') }}</span>
        </div>
        <div v-for="report in savedVerificationReports" :key="report.model_id || report.models[0]?.model_id" class="mb-4 last:mb-0">
          <template v-for="modelReport in report.models" :key="modelReport.model_id">
          <h4 class="mb-2 font-medium text-gray-800 dark:text-gray-100">{{ modelReport.model_id }}</h4>
          <div class="grid gap-2 md:grid-cols-2">
          <div v-for="result in modelReport.accounts" :key="`${modelReport.model_id}:${result.account_id}`" class="border border-gray-200 bg-white p-3 dark:border-dark-600 dark:bg-dark-800">
            <div class="flex items-center justify-between gap-2">
              <span class="font-medium text-gray-800 dark:text-gray-100">#{{ result.account_id }}</span>
              <span class="text-lg font-bold" :class="result.authenticity_percent >= 80 ? 'text-green-600' : result.authenticity_percent > 0 ? 'text-amber-600' : 'text-red-600'">{{ result.authenticity_percent.toFixed(0) }}%</span>
            </div>
            <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ result.matched_probes }}/{{ result.total_probes }} {{ t('admin.accounts.modelTest.probesMatched') }} · {{ result.status }}</div>
            <div v-if="result.verdict" class="mt-1 text-xs font-medium" :class="result.fingerprint_claim_mismatch || result.juice_state === 'mismatch' ? 'text-red-600' : 'text-gray-600 dark:text-gray-300'">{{ verificationVerdictLabel(result.verdict) }}<span v-if="result.fingerprint_claim_mismatch"> · {{ t('admin.accounts.modelTest.claimMismatch') }}</span></div>
            <div v-if="result.hard_anomalies?.length" class="mt-2 border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
              {{ result.hard_anomalies.join(' · ') }}
            </div>
            <div v-if="result.juice_evidence?.length" class="mt-2 text-[11px] text-gray-500 dark:text-gray-400">Juice: {{ result.juice_evidence.join(', ') }}</div>
            <div v-if="result.model_scores" class="mt-2 grid grid-cols-3 gap-1 text-[11px]">
              <div v-for="model in verificationModels" :key="model.id" class="border border-gray-200 px-1.5 py-1 text-center dark:border-dark-600">
                <div class="truncate text-gray-500 dark:text-gray-400">{{ model.display_name.replace('GPT-5.6 ', '') }}</div>
                <div class="font-semibold text-gray-800 dark:text-gray-100">{{ (result.model_scores[model.id] ?? 0).toFixed(1) }}%</div>
              </div>
            </div>
            <details class="mt-2 text-xs">
              <summary class="cursor-pointer text-primary-600 dark:text-primary-400">{{ t('admin.accounts.modelTest.viewEvidence') }}</summary>
              <div class="mt-2 max-h-32 space-y-1 overflow-y-auto font-mono text-gray-600 dark:text-gray-300">
                <div v-for="probe in result.probes" :key="probe.index" :class="probe.matched ? 'text-green-600' : 'text-red-600'">{{ probe.index }}. {{ probe.matched ? 'PASS' : 'FAIL' }} · {{ probe.response || probe.error || probe.status }}</div>
              </div>
            </details>
          </div>
          </div>
          </template>
        </div>
      </section>

      <div v-if="loadingModels" class="flex flex-1 items-center justify-center gap-2 py-12 text-sm text-gray-500 dark:text-gray-400">
        <Icon name="refresh" size="sm" class="animate-spin" />
        {{ t('admin.accounts.modelTest.loadingModels') }}
      </div>
      <div v-else-if="accounts.length === 0" class="flex flex-1 items-center justify-center py-12 text-sm text-gray-500 dark:text-gray-400">
        {{ t('admin.accounts.modelTest.noAccounts') }}
      </div>
      <div v-else-if="!verificationOnly" class="min-h-0 flex-1 overflow-y-auto">
        <section
          v-for="account in accounts"
          :key="account.id"
          class="border-b border-gray-100 px-5 py-4 last:border-b-0 dark:border-dark-700"
        >
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2">
              <span class="truncate font-medium text-gray-900 dark:text-white">{{ account.name }}</span>
              <span class="font-mono text-xs text-gray-400">#{{ account.id }}</span>
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                :class="account.status === 'active' ? 'bg-green-500' : 'bg-gray-400'"
              ></span>
            </div>
            <span class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('admin.accounts.modelTest.modelCount', { count: modelsByAccount[account.id]?.length || 0 }) }}
            </span>
          </div>

          <p v-if="modelErrors[account.id]" class="text-sm text-red-600 dark:text-red-400">
            {{ modelErrors[account.id] }}
          </p>
          <p v-else-if="!modelsByAccount[account.id]?.length" class="text-sm text-gray-500 dark:text-gray-400">
            {{ t('admin.accounts.modelTest.noModels') }}
          </p>
          <div v-else class="flex flex-wrap gap-2">
            <button
              v-if="!verificationOnly"
              v-for="model in modelsByAccount[account.id]"
              :key="model.id"
              type="button"
              class="inline-flex min-h-9 max-w-full items-center gap-2 border px-3 py-1.5 text-left text-sm transition-colors disabled:cursor-wait"
              :class="modelButtonClass(account.id, model.id)"
              :disabled="batchRunning || testStates[testKey(account.id, model.id)]?.status === 'running'"
              :title="testStates[testKey(account.id, model.id)]?.message || model.display_name || model.id"
              @click="runTest(account, model)"
            >
              <Icon
                :name="modelStatusIcon(account.id, model.id)"
                size="xs"
                :class="testStates[testKey(account.id, model.id)]?.status === 'running' ? 'animate-spin' : ''"
              />
              <span class="break-all">{{ model.display_name || model.id }}</span>
            </button>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { adminAPI } from '@/api/admin'
import type { ModelVerificationAccountReport, ModelVerificationReport } from '@/api/admin/accounts'
import { buildApiUrl } from '@/api/client'
import { ADMIN_UI_REQUEST_HEADER } from '@/api/adminUIRequest'
import Icon from '@/components/icons/Icon.vue'
import Select from '@/components/common/Select.vue'
import type { Account, ClaudeModel } from '@/types'

type TestStatus = 'idle' | 'running' | 'success' | 'error'
type TestState = { status: TestStatus; message: string }
type TestTarget = { account: Account; model: ClaudeModel }

const props = defineProps<{
  accounts: Account[]
  platform: string
  active: boolean
  verificationOnly?: boolean
}>()

const { t } = useI18n()
const modelsByAccount = ref<Record<number, ClaudeModel[]>>({})
const modelErrors = ref<Record<number, string>>({})
const testStates = ref<Record<string, TestState>>({})
const loadingModels = ref(false)
const batchRunning = ref(false)
const completedTests = ref(0)
const selectedAccountId = ref<string>('all')
const selectedModelIds = ref<string[]>([])
const loadSequence = ref(0)
const controllers = new Set<AbortController>()
const verificationModels: ClaudeModel[] = [
  { id: 'gpt-5.6-sol', display_name: 'GPT-5.6 Sol', type: 'model', created_at: '' },
  { id: 'gpt-5.6-terra', display_name: 'GPT-5.6 Terra', type: 'model', created_at: '' },
  { id: 'gpt-5.6-luna', display_name: 'GPT-5.6 Luna', type: 'model', created_at: '' }
]
const verificationLevel = ref<'low' | 'medium' | 'high'>('low')
const selectedVerificationModel = ref('gpt-5.6-sol')
const verificationRunning = ref(false)
const verificationError = ref('')
const verificationReport = ref<ModelVerificationReport | null>(null)
const verificationHistory = ref<Record<string, ModelVerificationReport>>({})
const savedVerificationReports = computed(() => Object.values(verificationHistory.value))
const verificationLevels = computed(() => [
  { value: 'low', label: t('admin.accounts.modelTest.levelLow') },
  { value: 'medium', label: t('admin.accounts.modelTest.levelMedium') },
  { value: 'high', label: t('admin.accounts.modelTest.levelHigh') }
])
const verificationModelOptions = verificationModels.map(model => ({ value: model.id, label: model.display_name }))
const verificationVerdictLabel = (code: string) => t(`admin.accounts.modelTest.verdicts.${code}`)

const providerLabel = computed(() => {
  const labels: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    gemini: 'Gemini',
    antigravity: 'Antigravity',
    grok: 'Grok',
    kimi: 'Kimi',
    zhipu: 'Zhipu',
    deepseek: 'DeepSeek'
  }
  return labels[props.platform] || props.platform
})

const testTargets = computed<TestTarget[]>(() => props.accounts.flatMap(account =>
  (selectedAccountId.value !== 'all' && String(account.id) !== selectedAccountId.value ? [] : (modelsByAccount.value[account.id] || []))
    .filter(model => selectedModelIds.value.length === 0 || selectedModelIds.value.includes(model.id))
    .map(model => ({ account, model }))
))
const totalModels = computed(() => testTargets.value.length)
const accountOptions = computed(() => [
  { value: 'all', label: t('admin.accounts.modelTest.allAccounts') },
  ...props.accounts.map(account => ({ value: String(account.id), label: account.name }))
])
const allModels = computed(() => {
  if (props.verificationOnly) return verificationModels
  const map = new Map<string, ClaudeModel>()
  Object.values(modelsByAccount.value).flat().forEach(model => map.set(model.id, model))
  return Array.from(map.values())
})

const testKey = (accountId: number, modelId: string) => `${accountId}:${modelId}`

const modelButtonClass = (accountId: number, modelId: string) => {
  const status = testStates.value[testKey(accountId, modelId)]?.status || 'idle'
  if (status === 'success') return 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-700 dark:bg-green-900/20 dark:text-green-300'
  if (status === 'error') return 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300'
  if (status === 'running') return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
  return 'border-gray-200 bg-white text-gray-700 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 dark:border-dark-600 dark:bg-dark-800 dark:text-gray-300 dark:hover:border-primary-700 dark:hover:bg-primary-900/20'
}

const modelStatusIcon = (accountId: number, modelId: string) => {
  const status = testStates.value[testKey(accountId, modelId)]?.status || 'idle'
  if (status === 'success') return 'check'
  if (status === 'error') return 'x'
  if (status === 'running') return 'refresh'
  return 'play'
}

const abortTests = () => {
  controllers.forEach(controller => controller.abort())
  controllers.clear()
  batchRunning.value = false
}

const loadModels = async () => {
  const sequence = ++loadSequence.value
  abortTests()
  loadingModels.value = false
  modelsByAccount.value = {}
  modelErrors.value = {}
  testStates.value = {}
  completedTests.value = 0
  if (!props.active || !props.platform || props.accounts.length === 0) return

  loadingModels.value = true
  const queue = [...props.accounts]
  const entries: Array<{ accountId: number; models: ClaudeModel[]; error: string }> = []
  const worker = async () => {
    while (queue.length > 0 && sequence === loadSequence.value) {
      const account = queue.shift()
      if (!account) break
      try {
        if (props.verificationOnly) {
          entries.push({ accountId: account.id, models: verificationModels, error: '' })
          continue
        }
        const models = await adminAPI.accounts.getAvailableModels(account.id)
        entries.push({ accountId: account.id, models, error: '' })
      } catch (error) {
        const message = error instanceof Error ? error.message : t('admin.accounts.modelTest.loadFailed')
        entries.push({ accountId: account.id, models: [], error: message })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker))
  if (sequence !== loadSequence.value) return

  modelsByAccount.value = Object.fromEntries(entries.map(entry => [entry.accountId, entry.models]))
  modelErrors.value = Object.fromEntries(entries.filter(entry => entry.error).map(entry => [entry.accountId, entry.error]))
  loadingModels.value = false
  selectedModelIds.value = []
  if (props.verificationOnly) {
    try {
      const history: Record<string, ModelVerificationReport> = {}
      verificationModels.forEach(model => {
        const saved = localStorage.getItem(`sub2api:model-verification:${props.platform}:${model.id}`)
        if (saved) history[model.id] = JSON.parse(saved) as ModelVerificationReport
      })
      if (Object.keys(history).length === 0) {
        const legacy = localStorage.getItem(`sub2api:model-verification:${props.platform}`)
        if (legacy) {
          const report = JSON.parse(legacy) as ModelVerificationReport
          const modelID = report.model_id || report.models?.[0]?.model_id
          if (modelID) history[modelID] = report
        }
      }
      try {
        const persisted = await adminAPI.accounts.getModelVerificationHistory(props.accounts.map(account => account.id))
        const grouped: Record<string, ModelVerificationAccountReport[]> = {}
        ;(Object.values(persisted.accounts).flat() as Array<Record<string, unknown>>).forEach((entry) => {
          const modelID = String(entry.model_id || '')
          if (!modelID) return
          const accountID = Number(entry.account_id || 0)
          if (!accountID) return
          ;(grouped[modelID] ||= []).push({
            account_id: accountID,
            model_id: modelID,
            authenticity_percent: Number(entry.authenticity_percent || 0),
            matched_probes: Number(entry.matched_probes || 0),
            completed_probes: Number(entry.completed_probes || 0),
            total_probes: Number(entry.total_probes || 0),
            status: String(entry.status || 'inconclusive'),
            probes: [],
            scoring_mode: String(entry.scoring_mode || 'baseline_softmax'),
            model_scores: entry.model_scores && typeof entry.model_scores === 'object' ? entry.model_scores as Record<string, number> : undefined,
            evidence_quality: Number(entry.evidence_quality || 0),
            hard_anomalies: Array.isArray(entry.hard_anomalies) ? entry.hard_anomalies as string[] : [],
            juice_evidence: Array.isArray(entry.juice_evidence) ? entry.juice_evidence as string[] : [],
            juice_classifications: Array.isArray(entry.juice_classifications) ? entry.juice_classifications as string[] : [],
            juice_state: entry.juice_state ? String(entry.juice_state) : undefined,
            verdict: entry.verdict ? String(entry.verdict) : undefined,
            fingerprint_model: entry.fingerprint_model ? String(entry.fingerprint_model) : undefined,
            fingerprint_claim_mismatch: Boolean(entry.fingerprint_claim_mismatch)
          })
        })
        Object.entries(grouped).forEach(([modelID, accounts]) => {
          if (!history[modelID]) history[modelID] = { model_id: modelID, level: 'persisted', started_at: '', finished_at: '', models: [{ model_id: modelID, accounts }] }
        })
      } catch { /* local history remains available when the server is offline */ }
      verificationHistory.value = history
      verificationReport.value = history[selectedVerificationModel.value] || null
    } catch { verificationHistory.value = {}; verificationReport.value = null }
  }
}

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
    buffer = done ? '' : (lines.pop() || '')
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
  if (testStates.value[key]?.status === 'running') return
  testStates.value[key] = { status: 'running', message: t('admin.accounts.modelTest.testing') }
  const controller = new AbortController()
  controllers.add(controller)
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
    testStates.value[key] = { status: result.success ? 'success' : 'error', message: result.message }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    testStates.value[key] = {
      status: 'error',
      message: error instanceof Error ? error.message : t('admin.accounts.testFailed')
    }
  } finally {
    controllers.delete(controller)
  }
}

const runAllTests = async () => {
  if (batchRunning.value) return
  batchRunning.value = true
  completedTests.value = 0
  const queue = [...testTargets.value]
  const worker = async () => {
    while (queue.length > 0 && batchRunning.value) {
      const target = queue.shift()
      if (!target) break
      await runTest(target.account, target.model)
      completedTests.value++
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker))
  batchRunning.value = false
}

const runVerification = async () => {
  if (verificationRunning.value) return
  verificationRunning.value = true
  verificationError.value = ''
  verificationReport.value = null
  try {
    const modelID = selectedVerificationModel.value
    const accountIds = selectedAccountId.value === 'all'
      ? props.accounts.map(account => account.id)
      : props.accounts.filter(account => String(account.id) === selectedAccountId.value).map(account => account.id)
    verificationReport.value = await adminAPI.accounts.verifyModels({ account_ids: accountIds, model_ids: [modelID], level: verificationLevel.value })
    verificationHistory.value = { ...verificationHistory.value, [modelID]: verificationReport.value }
    localStorage.setItem(`sub2api:model-verification:${props.platform}:${modelID}`, JSON.stringify(verificationReport.value))
  } catch (error) {
    verificationError.value = error instanceof Error ? error.message : t('admin.accounts.modelTest.verificationFailed')
  } finally {
    verificationRunning.value = false
  }
}

watch(
  () => [props.active, props.platform, props.accounts.map(account => account.id).join(',')],
  () => void loadModels(),
  { immediate: true }
)

onUnmounted(() => {
  loadSequence.value++
  abortTests()
})
</script>
