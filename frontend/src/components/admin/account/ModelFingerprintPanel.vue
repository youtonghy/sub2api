<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    <!-- Header: bank version + run controls -->
    <div class="border-b border-gray-200 px-5 py-4 dark:border-dark-700">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="font-semibold text-gray-900 dark:text-white">{{ t('admin.accounts.modelFingerprint.title') }}</h2>
          <p class="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
            {{ t('admin.accounts.modelFingerprint.description') }}
          </p>
          <p v-if="bank" class="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {{ t('admin.accounts.modelFingerprint.bankInfo', { models: bank.models.length, builtAt: formatTime(bank.built_at) }) }}
          </p>
          <p v-else-if="bankError" class="mt-1 text-xs text-red-600 dark:text-red-400">{{ bankError }}</p>
        </div>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="running || !canRun"
          data-testid="model-fingerprint-run"
          @click="run"
        >
          <Icon :name="running ? 'refresh' : 'shield'" size="sm" :class="running ? 'animate-spin' : ''" />
          <span>
            {{ running
              ? t('admin.accounts.modelFingerprint.runningProgress', { done: progress.completed, total: progress.total })
              : t('admin.accounts.modelFingerprint.run') }}
          </span>
        </button>
      </div>

      <div v-if="estimate.total > 0" class="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
        {{ t('admin.accounts.modelFingerprint.estimate', { combinations: estimate.combinations, rounds: rounds, requests: estimate.total, accounts: selectedAccountIds.length, models: selectedModelIds.length }) }}
      </div>
    </div>

    <div class="grid gap-4 border-b border-gray-200 px-5 py-4 dark:border-dark-700 lg:grid-cols-2">
      <!-- Accounts -->
      <section>
        <div class="mb-2 flex items-center justify-between gap-2">
          <label class="text-xs font-medium text-gray-600 dark:text-gray-300">{{ t('admin.accounts.modelFingerprint.accounts') }}</label>
          <div class="flex items-center gap-2 text-xs">
            <span class="text-gray-400">{{ t('admin.accounts.modelFingerprint.selectedCount', { count: selectedAccountIds.length, total: accounts.length }) }}</span>
            <button type="button" class="text-primary-600 hover:underline dark:text-primary-400" :disabled="running" @click="selectAllAccounts">
              {{ t('admin.accounts.modelFingerprint.selectAll') }}
            </button>
            <button type="button" class="text-gray-500 hover:underline dark:text-gray-400" :disabled="running" @click="selectedAccountIds = []">
              {{ t('admin.accounts.modelFingerprint.clear') }}
            </button>
          </div>
        </div>
        <div class="max-h-56 overflow-y-auto rounded border border-gray-200 dark:border-dark-600">
          <label
            v-for="account in accounts"
            :key="account.id"
            class="flex cursor-pointer items-center gap-2 border-b border-gray-100 px-3 py-1.5 text-xs last:border-b-0 hover:bg-gray-50 dark:border-dark-700 dark:hover:bg-dark-700/60"
          >
            <input
              v-model="selectedAccountIds"
              type="checkbox"
              :value="account.id"
              :disabled="running"
              class="rounded border-gray-300 text-primary-600"
              data-testid="model-fingerprint-account"
            />
            <span class="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">{{ account.name }}</span>
            <span class="font-mono text-[11px] text-gray-400">#{{ account.id }}</span>
          </label>
          <div v-if="accounts.length === 0" class="px-3 py-6 text-center text-xs text-gray-400">
            {{ t('admin.accounts.modelFingerprint.noAccounts') }}
          </div>
        </div>
      </section>

      <!-- Models -->
      <section>
        <div class="mb-2 flex items-center justify-between gap-2">
          <label class="text-xs font-medium text-gray-600 dark:text-gray-300">{{ t('admin.accounts.modelFingerprint.models') }}</label>
          <div class="flex items-center gap-2 text-xs">
            <span class="text-gray-400">{{ t('admin.accounts.modelFingerprint.selectedCount', { count: selectedModelIds.length, total: availableModels.length }) }}</span>
            <button type="button" class="text-primary-600 hover:underline dark:text-primary-400" :disabled="running" @click="selectAllModels">
              {{ t('admin.accounts.modelFingerprint.selectAll') }}
            </button>
            <button type="button" class="text-gray-500 hover:underline dark:text-gray-400" :disabled="running" @click="selectedModelIds = []">
              {{ t('admin.accounts.modelFingerprint.clear') }}
            </button>
          </div>
        </div>
        <input
          v-model="modelSearch"
          type="text"
          class="input mb-2 h-8 text-xs"
          :placeholder="t('admin.accounts.modelFingerprint.searchModels')"
        />
        <div class="max-h-48 overflow-y-auto rounded border border-gray-200 dark:border-dark-600">
          <label
            v-for="model in filteredModels"
            :key="model.id"
            class="flex cursor-pointer items-center gap-2 border-b border-gray-100 px-3 py-1.5 text-xs last:border-b-0 hover:bg-gray-50 dark:border-dark-700 dark:hover:bg-dark-700/60"
          >
            <input
              v-model="selectedModelIds"
              type="checkbox"
              :value="model.id"
              :disabled="running"
              class="rounded border-gray-300 text-primary-600"
              data-testid="model-fingerprint-model"
            />
            <span class="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">{{ model.id }}</span>
            <span
              v-if="bankModelIds.has(model.id.toLowerCase())"
              class="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
              :title="t('admin.accounts.modelFingerprint.comparableHint')"
            >
              {{ t('admin.accounts.modelFingerprint.comparable') }}
            </span>
          </label>
          <div v-if="loadingModels" class="px-3 py-6 text-center text-xs text-gray-400">
            {{ t('admin.accounts.modelFingerprint.loadingModels') }}
          </div>
          <div v-else-if="filteredModels.length === 0" class="px-3 py-6 text-center text-xs text-gray-400">
            {{ t('admin.accounts.modelFingerprint.noModels') }}
          </div>
        </div>
        <p v-if="incomparableCount > 0" class="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
          {{ t('admin.accounts.modelFingerprint.incomparableHint', { count: incomparableCount }) }}
        </p>
      </section>
    </div>

    <!-- Options -->
    <div class="flex flex-wrap items-end gap-4 border-b border-gray-200 px-5 py-3 dark:border-dark-700">
      <div class="min-w-[150px]">
        <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('admin.accounts.modelFingerprint.rounds') }}</label>
        <Select v-model.number="rounds" :options="roundOptions" value-key="value" label-key="label" :disabled="running" />
      </div>
      <div class="min-w-[150px]">
        <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('admin.accounts.modelFingerprint.concurrency') }}</label>
        <Select v-model.number="concurrency" :options="concurrencyOptions" value-key="value" label-key="label" :disabled="running" />
      </div>
      <p class="flex-1 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.accounts.modelFingerprint.roundsHint') }}</p>
    </div>

    <div v-if="error" class="mx-5 mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
      {{ error }}
    </div>

    <!-- Results -->
    <div v-if="report" class="px-5 py-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="font-semibold text-gray-900 dark:text-white">{{ t('admin.accounts.modelFingerprint.report') }}</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ t('admin.accounts.modelFingerprint.reportSummary', {
              total: report.results.length,
              matched: matchedCount,
              mismatch: mismatchCount,
              unscorable: unscorableCount
            }) }}
          </p>
        </div>
        <span class="text-xs text-gray-400">{{ formatTime(report.finished_at || report.started_at) }}</span>
      </div>

      <div v-for="groupError in report.errors || []" :key="groupError" class="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
        {{ groupError }}
      </div>

      <div class="overflow-x-auto rounded border border-gray-200 dark:border-dark-600">
        <table class="min-w-full text-xs">
          <thead class="bg-gray-50 text-left dark:bg-dark-700">
            <tr class="text-gray-500 dark:text-gray-400">
              <th class="px-3 py-2 font-medium">{{ t('admin.accounts.modelFingerprint.columns.account') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.accounts.modelFingerprint.columns.requested') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.accounts.modelFingerprint.columns.verdict') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.accounts.modelFingerprint.columns.prediction') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.accounts.modelFingerprint.columns.confidence') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.accounts.modelFingerprint.columns.samples') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.accounts.modelFingerprint.columns.evidence') }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="result in report.results" :key="`${result.account_id}:${result.model_id}`">
              <tr class="border-t border-gray-100 align-top dark:border-dark-700" data-testid="model-fingerprint-row">
                <td class="px-3 py-2">
                  <div class="font-medium text-gray-800 dark:text-gray-100">{{ result.account_name || `#${result.account_id}` }}</div>
                  <div class="font-mono text-[11px] text-gray-400">#{{ result.account_id }}<template v-if="result.platform"> · {{ result.platform }}</template></div>
                </td>
                <td class="px-3 py-2 font-mono text-[11px] text-gray-700 dark:text-gray-300">
                  {{ result.requested_model || result.model_id }}
                  <div v-if="result.model_id && result.model_id !== result.requested_model" class="text-gray-400">→ {{ result.model_id }}</div>
                </td>
                <td class="px-3 py-2">
                  <span class="inline-flex items-center rounded-full px-2 py-0.5 font-medium" :class="verdictClass(result)">
                    {{ verdictLabel(result) }}
                  </span>
                </td>
                <td class="px-3 py-2">
                  <template v-if="result.prediction">
                    <div class="font-medium text-gray-800 dark:text-gray-100">{{ result.prediction_name || result.prediction }}</div>
                    <div class="text-[11px] text-gray-400">{{ result.family_name || result.family_prediction }}</div>
                  </template>
                  <span v-else class="text-gray-400">—</span>
                </td>
                <td class="px-3 py-2">
                  <template v-if="typeof result.probability === 'number'">
                    <div class="font-semibold" :class="probabilityClass(result.probability)">{{ formatPercent(result.probability) }}</div>
                    <div class="text-[11px] text-gray-400">{{ t('admin.accounts.modelFingerprint.closedSet') }}</div>
                  </template>
                  <span v-else class="text-gray-400" :title="t('admin.accounts.modelFingerprint.noConfidenceHint')">—</span>
                </td>
                <td class="px-3 py-2">
                  <div :class="result.used_outputs >= 3 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'">
                    {{ result.used_outputs }}/{{ result.requested_rounds }}
                  </div>
                  <div class="text-[11px] text-gray-400">{{ t('admin.accounts.modelFingerprint.validSamples') }}</div>
                </td>
                <td class="px-3 py-2">
                  <button type="button" class="text-primary-600 hover:underline dark:text-primary-400" @click="toggleExpanded(result)">
                    {{ expandedKey === `${result.account_id}:${result.model_id}` ? t('admin.accounts.modelFingerprint.hideDetail') : t('admin.accounts.modelFingerprint.showDetail') }}
                  </button>
                </td>
              </tr>
              <tr v-if="expandedKey === `${result.account_id}:${result.model_id}`" class="border-t border-gray-100 bg-gray-50/70 dark:border-dark-700 dark:bg-dark-700/40">
                <td colspan="7" class="px-3 py-3">
                  <div v-if="result.error" class="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
                    {{ result.error }}
                  </div>
                  <div v-if="result.evidence" class="mb-2 text-[11px] text-gray-500 dark:text-gray-400">{{ result.evidence }}</div>
                  <div v-if="result.sequence" class="mb-2 text-[11px] text-gray-500 dark:text-gray-400">
                    {{ t('admin.accounts.modelFingerprint.sequenceLine', {
                      autocorrelation: result.sequence.autocorrelation.toFixed(3),
                      smallStep: (result.sequence.small_step_share * 100).toFixed(1),
                      modelLike: result.sequence.model_like ? t('admin.accounts.modelFingerprint.yes') : t('admin.accounts.modelFingerprint.no')
                    }) }}
                  </div>
                  <div class="grid gap-3 md:grid-cols-2">
                    <div>
                      <div class="mb-1 font-medium text-gray-700 dark:text-gray-200">{{ t('admin.accounts.modelFingerprint.sampleDetail') }}</div>
                      <div class="space-y-1">
                        <div v-for="sample in result.samples" :key="sample.index" class="rounded border border-gray-200 bg-white px-2 py-1 dark:border-dark-600 dark:bg-dark-800">
                          <div class="flex items-center justify-between gap-2 text-[11px]">
                            <span :class="sample.accepted ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'">
                              #{{ sample.index + 1 }} {{ sample.accepted ? t('admin.accounts.modelFingerprint.sampleAccepted') : t('admin.accounts.modelFingerprint.sampleRejected') }}
                            </span>
                            <span class="text-gray-400">{{ sample.parsed_numbers }}/{{ sample.expected_count }} · {{ sample.latency_ms }}ms</span>
                          </div>
                          <div v-if="sample.error" class="text-[11px] text-amber-600 dark:text-amber-400">{{ sample.error }}</div>
                          <div v-if="sample.preview" class="mt-1 break-all font-mono text-[11px] text-gray-400 line-clamp-2">{{ sample.preview }}</div>
                        </div>
                      </div>
                    </div>
                    <div>
                      <div class="mb-1 font-medium text-gray-700 dark:text-gray-200">{{ t('admin.accounts.modelFingerprint.candidates') }}</div>
                      <div class="space-y-0.5">
                        <div
                          v-for="candidate in (result.candidates || []).slice(0, 8)"
                          :key="candidate.model"
                          class="flex items-center justify-between gap-2 rounded px-2 py-0.5 text-[11px]"
                          :class="candidate.model === result.requested_model || candidate.model === result.model_id ? 'bg-primary-50 font-medium text-primary-700 dark:bg-primary-900/20 dark:text-primary-300' : 'text-gray-600 dark:text-gray-300'"
                        >
                          <span class="truncate">{{ candidate.display_name || candidate.model }}</span>
                          <span class="font-mono text-gray-400">
                            {{ candidate.probability != null ? formatPercent(candidate.probability) : candidate.score.toFixed(2) }}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p class="mt-2 text-[11px] text-gray-400">{{ t('admin.accounts.modelFingerprint.disclaimer') }}</p>
    </div>

    <div v-else-if="!running" class="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-14 text-center text-sm text-gray-500 dark:text-gray-400">
      <Icon name="shield" size="lg" class="text-gray-300 dark:text-dark-500" />
      <p>{{ t('admin.accounts.modelFingerprint.emptyState') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
import Select from '@/components/common/Select.vue'
import { adminAPI } from '@/api/admin'
import type { Account, ClaudeModel } from '@/types'
import type {
  ModelFingerprintBankInfo,
  ModelFingerprintJob,
  ModelFingerprintReport,
  ModelFingerprintResult
} from '@/api/admin/accounts'

const props = defineProps<{
  accounts: Account[]
  platform: string
  active: boolean
}>()

const { t } = useI18n()

const selectedAccountIds = ref<number[]>([])
const selectedModelIds = ref<string[]>([])
const modelSearch = ref('')
const rounds = ref(3)
const concurrency = ref(2)
const running = ref(false)
const error = ref('')
const report = ref<ModelFingerprintReport | null>(null)
const expandedKey = ref('')
const progress = ref<ModelFingerprintJob['progress']>({ total: 0, completed: 0, matched: 0 })
const bank = ref<ModelFingerprintBankInfo | null>(null)
const bankError = ref('')
const accountModels = ref<Record<number, string[]>>({})
const loadingModels = ref(false)

const roundOptions = computed(() => [
  { value: 3, label: t('admin.accounts.modelFingerprint.roundsCalibrated') },
  { value: 1, label: t('admin.accounts.modelFingerprint.roundsQuick') }
])
const concurrencyOptions = [1, 2, 3, 4].map(value => ({ value, label: String(value) }))

// 参考库内的模型 ID（小写）用于标注哪些请求模型可"声称比对"。
const bankModelIds = computed(() => new Set((bank.value?.models || []).map(model => model.id.toLowerCase())))

// 模型清单 = 选中账号可用模型的并集（按账号真实能力，而不是写死的清单）。
const availableModels = computed(() => {
  const seen = new Map<string, ClaudeModel>()
  const ids = selectedAccountIds.value.length ? selectedAccountIds.value : props.accounts.map(account => account.id)
  ids.forEach((id) => {
    (accountModels.value[id] || []).forEach((modelID) => {
      if (!modelID) return
      if (!seen.has(modelID)) seen.set(modelID, { id: modelID, display_name: modelID, type: 'model', created_at: '' })
    })
  })
  return Array.from(seen.values()).sort((left, right) => left.id.localeCompare(right.id))
})

const filteredModels = computed(() => {
  const keyword = modelSearch.value.trim().toLowerCase()
  if (!keyword) return availableModels.value
  return availableModels.value.filter(model => model.id.toLowerCase().includes(keyword))
})

const incomparableCount = computed(() =>
  selectedModelIds.value.filter(modelID => !bankModelIds.value.has(modelID.toLowerCase())).length
)

const estimate = computed(() => {
  const combinations = selectedAccountIds.value.length * selectedModelIds.value.length
  return { combinations, total: combinations * rounds.value }
})

const canRun = computed(() => selectedAccountIds.value.length > 0 && selectedModelIds.value.length > 0)

const matchedCount = computed(() => (report.value?.results || []).filter(result => result.matches_claim).length)
const mismatchCount = computed(() => (report.value?.results || []).filter(result => result.claim_comparable && !result.matches_claim).length)
const unscorableCount = computed(() =>
  (report.value?.results || []).filter(result => result.decision === 'unscorable' || result.decision === 'error' || result.decision === 'not_model').length
)

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`
const formatTime = (value?: string) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

const probabilityClass = (value: number) => {
  if (value >= 0.8) return 'text-emerald-600 dark:text-emerald-400'
  if (value >= 0.5) return 'text-amber-600 dark:text-amber-400'
  return 'text-gray-600 dark:text-gray-300'
}

const verdictLabel = (result: ModelFingerprintResult) => {
  if (result.decision === 'error') return t('admin.accounts.modelFingerprint.verdicts.error')
  if (result.decision === 'not_model') return t('admin.accounts.modelFingerprint.verdicts.notModel')
  if (result.decision === 'unscorable') return t('admin.accounts.modelFingerprint.verdicts.unscorable')
  if (!result.claim_comparable) return t('admin.accounts.modelFingerprint.verdicts.incomparable')
  if (result.matches_claim) return t('admin.accounts.modelFingerprint.verdicts.matches')
  return t('admin.accounts.modelFingerprint.verdicts.mismatch')
}

const verdictClass = (result: ModelFingerprintResult) => {
  if (result.decision === 'error' || result.decision === 'not_model') {
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  }
  if (result.decision === 'unscorable') return 'bg-gray-100 text-gray-600 dark:bg-dark-700 dark:text-gray-300'
  if (!result.claim_comparable) return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
  if (result.matches_claim) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
}

const toggleExpanded = (result: ModelFingerprintResult) => {
  const key = `${result.account_id}:${result.model_id}`
  expandedKey.value = expandedKey.value === key ? '' : key
}

const selectAllAccounts = () => {
  selectedAccountIds.value = props.accounts.map(account => account.id)
}

const selectAllModels = () => {
  selectedModelIds.value = filteredModels.value.map(model => model.id)
}

const loadBank = async () => {
  bankError.value = ''
  try {
    bank.value = await adminAPI.accounts.getModelFingerprintBank()
  } catch (loadError) {
    bank.value = null
    bankError.value = loadError instanceof Error ? loadError.message : t('admin.accounts.modelFingerprint.bankFailed')
  }
}

// 逐个账号取可用模型（服务端已有并发保护，这里限制在 6 个并发）。
const loadModels = async () => {
  if (!props.active || props.accounts.length === 0) return
  loadingModels.value = true
  const queue = [...props.accounts.map(account => account.id)]
  const loaded: Record<number, string[]> = {}
  const worker = async () => {
    while (queue.length > 0) {
      const accountID = queue.shift()
      if (accountID == null) break
      try {
        const models = await adminAPI.accounts.getAvailableModels(accountID)
        loaded[accountID] = models.map(model => model.id).filter(Boolean)
      } catch {
        loaded[accountID] = []
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker))
  accountModels.value = loaded
  loadingModels.value = false
  // 默认全选：批量检测的常见用法是"把所有账号的某个模型都跑一遍"。
  selectedAccountIds.value = props.accounts.map(account => account.id)
  const union = new Set<string>()
  Object.values(loaded).forEach(ids => ids.forEach(id => union.add(id)))
  selectedModelIds.value = Array.from(union)
}

const run = async () => {
  if (running.value || !canRun.value) return
  running.value = true
  error.value = ''
  report.value = null
  expandedKey.value = ''
  progress.value = { total: estimate.value.combinations, completed: 0, matched: 0 }
  try {
    report.value = await adminAPI.accounts.modelFingerprint(
      {
        account_ids: selectedAccountIds.value,
        model_ids: selectedModelIds.value,
        rounds: rounds.value,
        concurrency: concurrency.value
      },
      {
        onProgress: (next) => {
          progress.value = next
        }
      }
    )
  } catch (runError) {
    error.value = runError instanceof Error ? runError.message : t('admin.accounts.modelFingerprint.failed')
  } finally {
    running.value = false
  }
}

onMounted(() => {
  void loadBank()
})

watch(
  () => [props.active, props.platform, props.accounts.map(account => account.id).join(',')],
  () => {
    report.value = null
    error.value = ''
    void loadModels()
  },
  { immediate: true }
)
</script>
