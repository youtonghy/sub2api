<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import {
  opsAPI,
  type AccountAvailability,
  type AccountConcurrencyInfo,
  type OpsAccountAvailabilityStatsResponse,
  type OpsConcurrencyStatsResponse
} from '@/api/admin/ops'

interface Props {
  platformFilter?: string
  groupIdFilter?: number | null
}

const props = withDefaults(defineProps<Props>(), {
  platformFilter: '',
  groupIdFilter: null
})

type ProviderState = 'error' | 'cooling' | 'overloaded' | 'rate_limited' | 'saturated' | 'active' | 'idle'

interface ProviderRow {
  id: number
  name: string
  platform: string
  groupName: string
  current: number
  capacity: number
  queued: number
  load: number
  state: ProviderState
  detail: string
  cooldownRemaining: number
}

const { t, locale } = useI18n()
const loading = ref(true)
const refreshing = ref(false)
const errorMessage = ref('')
const concurrency = ref<OpsConcurrencyStatsResponse | null>(null)
const availability = ref<OpsAccountAvailabilityStatsResponse | null>(null)
const lastUpdated = ref<Date | null>(null)
const requestController = ref<AbortController | null>(null)

const realtimeEnabled = computed(() => (concurrency.value?.enabled ?? true) && (availability.value?.enabled ?? true))

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function tempCooldownRemainingSeconds(item: AccountAvailability): number {
  if (safeNumber(item.cooldown_remaining_sec) > 0) return safeNumber(item.cooldown_remaining_sec)
  if (!item.temp_unschedulable_until) return 0
  const remaining = Math.ceil((new Date(item.temp_unschedulable_until).getTime() - Date.now()) / 1000)
  return Math.max(0, remaining)
}

function stateRemainingSeconds(item: AccountAvailability): number {
  const cooldown = tempCooldownRemainingSeconds(item)
  if (cooldown > 0) return cooldown
  if (item.is_overloaded) return Math.max(0, safeNumber(item.overload_remaining_sec))
  if (item.is_rate_limited) return Math.max(0, safeNumber(item.rate_limit_remaining_sec))
  return 0
}

function resolveState(conc: Partial<AccountConcurrencyInfo>, avail: Partial<AccountAvailability>): ProviderState {
  if (avail.has_error) return 'error'
  if (tempCooldownRemainingSeconds(avail as AccountAvailability) > 0) return 'cooling'
  if (avail.is_overloaded) return 'overloaded'
  if (avail.is_rate_limited) return 'rate_limited'
  if (safeNumber(conc.load_percentage) >= 90 || safeNumber(conc.waiting_in_queue) > 0) return 'saturated'
  if (safeNumber(conc.current_in_use) > 0) return 'active'
  return 'idle'
}

function resolveDetail(state: ProviderState, avail: Partial<AccountAvailability>, cooldownRemaining: number): string {
  if (state === 'error') return avail.error_message || t('admin.ops.providerMonitor.accountError')
  if (state === 'cooling') {
    const reason = String(avail.temp_unschedulable_reason || '').trim()
    return reason || t('admin.ops.providerMonitor.strictFallbackCooldown')
  }
  if (state === 'overloaded') return t('admin.ops.providerMonitor.overloadedDetail')
  if (state === 'rate_limited') return t('admin.ops.providerMonitor.rateLimitedDetail')
  if (state === 'saturated') return t('admin.ops.providerMonitor.saturatedDetail')
  if (state === 'active') return t('admin.ops.providerMonitor.servingDetail')
  if (cooldownRemaining > 0) return t('admin.ops.providerMonitor.cooldownDetail')
  return t('admin.ops.providerMonitor.readyDetail')
}

const rows = computed<ProviderRow[]>(() => {
  const concMap = concurrency.value?.account || {}
  const availMap = availability.value?.account || {}
  const ids = new Set([...Object.keys(concMap), ...Object.keys(availMap)])
  const stateRank: Record<ProviderState, number> = {
    error: 0,
    cooling: 1,
    overloaded: 2,
    rate_limited: 3,
    saturated: 4,
    active: 5,
    idle: 6
  }

  return Array.from(ids)
    .map((key) => {
      const conc = concMap[key] || ({} as AccountConcurrencyInfo)
      const avail = availMap[key] || ({} as AccountAvailability)
      const cooldownRemaining = stateRemainingSeconds(avail)
      const state = resolveState(conc, avail)
      const id = safeNumber(conc.account_id || avail.account_id || Number(key))
      return {
        id,
        name: String(conc.account_name || avail.account_name || `Provider ${id}`),
        platform: String(conc.platform || avail.platform || ''),
        groupName: String(conc.group_name || avail.group_name || ''),
        current: safeNumber(conc.current_in_use),
        capacity: safeNumber(conc.max_capacity),
        queued: safeNumber(conc.waiting_in_queue),
        load: Math.max(0, safeNumber(conc.load_percentage)),
        state,
        detail: resolveDetail(state, avail, cooldownRemaining),
        cooldownRemaining
      }
    })
    .sort((a, b) => stateRank[a.state] - stateRank[b.state] || b.load - a.load || a.id - b.id)
})

const activeCount = computed(() => rows.value.filter((row) => row.current > 0).length)
const coolingCount = computed(() => rows.value.filter((row) => ['cooling', 'overloaded', 'rate_limited'].includes(row.state)).length)
const errorCount = computed(() => rows.value.filter((row) => row.state === 'error' || row.state === 'saturated').length)
const totalCurrent = computed(() => rows.value.reduce((sum, row) => sum + row.current, 0))
const totalCapacity = computed(() => rows.value.reduce((sum, row) => sum + row.capacity, 0))
const totalLoad = computed(() => totalCapacity.value > 0 ? Math.round((totalCurrent.value / totalCapacity.value) * 100) : 0)

function stateLabel(state: ProviderState): string {
  return t(`admin.ops.providerMonitor.states.${state}`)
}

function stateDotClass(state: ProviderState): string {
  if (state === 'error' || state === 'saturated') return 'bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.12)]'
  if (state === 'cooling' || state === 'overloaded' || state === 'rate_limited') return 'bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,0.12)]'
  if (state === 'active') return 'bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]'
  return 'bg-gray-300 dark:bg-gray-600'
}

function stateTextClass(state: ProviderState): string {
  if (state === 'error' || state === 'saturated') return 'text-red-600 dark:text-red-400'
  if (state === 'cooling' || state === 'overloaded' || state === 'rate_limited') return 'text-amber-600 dark:text-amber-400'
  if (state === 'active') return 'text-emerald-600 dark:text-emerald-400'
  return 'text-gray-500 dark:text-gray-400'
}

function segmentClass(row: ProviderRow, index: number): string {
  const filled = index < Math.ceil(Math.min(100, row.load) / 5)
  if (!filled) return 'bg-gray-100 dark:bg-dark-700'
  if (row.load >= 90 || row.state === 'error') return 'bg-red-500'
  if (row.load >= 70 || ['cooling', 'overloaded', 'rate_limited'].includes(row.state)) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return ''
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.ceil(minutes / 60)}h`
}

const updatedLabel = computed(() => {
  if (!lastUpdated.value) return '--:--:--'
  return new Intl.DateTimeFormat(locale.value, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(lastUpdated.value)
})

async function loadData(showSpinner = false) {
  requestController.value?.abort()
  const controller = new AbortController()
  requestController.value = controller
  if (showSpinner) refreshing.value = true
  errorMessage.value = ''
  try {
    const [concData, availData] = await Promise.all([
      opsAPI.getConcurrencyStats(props.platformFilter, props.groupIdFilter),
      opsAPI.getAccountAvailabilityStats(props.platformFilter, props.groupIdFilter)
    ])
    if (controller.signal.aborted) return
    concurrency.value = concData
    availability.value = availData
    lastUpdated.value = new Date()
  } catch (err: any) {
    if (controller.signal.aborted || err?.code === 'ERR_CANCELED') return
    errorMessage.value = err?.response?.data?.detail || t('admin.ops.providerMonitor.loadFailed')
  } finally {
    if (requestController.value === controller) {
      loading.value = false
      refreshing.value = false
    }
  }
}

const { pause, resume } = useIntervalFn(() => loadData(false), 2000, { immediate: false })

watch(
  () => [props.platformFilter, props.groupIdFilter] as const,
  () => loadData(true)
)

onMounted(() => {
  loadData(false)
  resume()
})

onBeforeUnmount(() => {
  pause()
  requestController.value?.abort()
})
</script>

<template>
  <section class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-900/5 dark:bg-dark-800 dark:ring-dark-700">
    <header class="flex flex-col gap-4 border-b border-gray-100 px-5 py-4 dark:border-dark-700 md:flex-row md:items-center md:justify-between">
      <div class="min-w-0">
        <div class="flex items-center gap-2.5">
          <span class="relative flex h-2.5 w-2.5">
            <span v-if="realtimeEnabled" class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50"></span>
            <span class="relative inline-flex h-2.5 w-2.5 rounded-full" :class="realtimeEnabled ? 'bg-emerald-500' : 'bg-gray-400'"></span>
          </span>
          <h2 class="text-sm font-bold text-gray-900 dark:text-white">{{ t('admin.ops.providerMonitor.title') }}</h2>
          <span class="text-[11px] text-gray-400 dark:text-gray-500">{{ t('admin.ops.providerMonitor.refreshRate') }}</span>
        </div>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.ops.providerMonitor.description') }}</p>
      </div>
      <div class="flex items-center gap-3">
        <span class="font-mono text-[11px] text-gray-400 dark:text-gray-500">{{ updatedLabel }}</span>
        <button
          type="button"
          class="grid h-8 w-8 place-items-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-dark-700 dark:hover:text-white"
          :disabled="refreshing"
          :title="t('common.refresh')"
          @click="loadData(true)"
        >
          <svg class="h-4 w-4" :class="{ 'animate-spin': refreshing }" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
    </header>

    <div class="grid grid-cols-2 border-b border-gray-100 dark:border-dark-700 lg:grid-cols-4">
      <div class="border-b border-r border-gray-100 px-5 py-3 dark:border-dark-700 lg:border-b-0">
        <div class="text-[10px] font-semibold uppercase text-gray-400">{{ t('admin.ops.providerMonitor.activeProviders') }}</div>
        <div class="mt-1 text-xl font-bold text-gray-900 dark:text-white">{{ activeCount }}<span class="ml-1 text-xs font-medium text-gray-400">/ {{ rows.length }}</span></div>
      </div>
      <div class="border-b border-gray-100 px-5 py-3 dark:border-dark-700 lg:border-b-0 lg:border-r">
        <div class="text-[10px] font-semibold uppercase text-gray-400">{{ t('admin.ops.providerMonitor.aggregateLoad') }}</div>
        <div class="mt-1 text-xl font-bold" :class="totalLoad >= 90 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'">{{ totalLoad }}%</div>
      </div>
      <div class="border-r border-gray-100 px-5 py-3 dark:border-dark-700">
        <div class="text-[10px] font-semibold uppercase text-gray-400">{{ t('admin.ops.providerMonitor.coolingProviders') }}</div>
        <div class="mt-1 text-xl font-bold text-amber-600 dark:text-amber-400">{{ coolingCount }}</div>
      </div>
      <div class="px-5 py-3">
        <div class="text-[10px] font-semibold uppercase text-gray-400">{{ t('admin.ops.providerMonitor.attentionProviders') }}</div>
        <div class="mt-1 text-xl font-bold" :class="errorCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'">{{ errorCount }}</div>
      </div>
    </div>

    <div v-if="errorMessage" class="border-b border-red-100 bg-red-50 px-5 py-3 text-xs text-red-600 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400">
      {{ errorMessage }}
    </div>

    <div v-if="!realtimeEnabled" class="px-5 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
      {{ t('admin.ops.concurrency.disabledHint') }}
    </div>
    <div v-else-if="loading" class="space-y-4 px-5 py-6">
      <div v-for="index in 4" :key="index" class="h-12 animate-pulse rounded-lg bg-gray-100 dark:bg-dark-700"></div>
    </div>
    <div v-else-if="rows.length === 0" class="px-5 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
      {{ t('admin.ops.providerMonitor.empty') }}
    </div>
    <div v-else class="max-h-[520px] overflow-y-auto">
      <div class="hidden grid-cols-[minmax(190px,1.1fr)_minmax(240px,2fr)_minmax(170px,1fr)] gap-5 border-b border-gray-100 bg-gray-50/70 px-5 py-2 text-[10px] font-semibold uppercase text-gray-400 dark:border-dark-700 dark:bg-dark-900/60 md:grid">
        <span>{{ t('admin.ops.providerMonitor.provider') }}</span>
        <span>{{ t('admin.ops.providerMonitor.liveLoad') }}</span>
        <span>{{ t('admin.ops.providerMonitor.state') }}</span>
      </div>
      <div
        v-for="row in rows"
        :key="row.id"
        :data-provider-id="row.id"
        :data-provider-state="row.state"
        class="grid gap-3 border-b border-gray-100 px-5 py-3.5 transition-colors last:border-b-0 hover:bg-gray-50/80 dark:border-dark-700 dark:hover:bg-dark-900/50 md:grid-cols-[minmax(190px,1.1fr)_minmax(240px,2fr)_minmax(170px,1fr)] md:items-center md:gap-5"
      >
        <div class="flex min-w-0 items-center gap-3">
          <span class="h-2.5 w-2.5 shrink-0 rounded-full transition-all" :class="stateDotClass(row.state)"></span>
          <div class="min-w-0">
            <div class="truncate text-xs font-semibold text-gray-900 dark:text-white" :title="row.name">{{ row.name }}</div>
            <div class="mt-0.5 flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
              <span class="uppercase">{{ row.platform }}</span>
              <span v-if="row.groupName" class="truncate">{{ row.groupName }}</span>
              <span>#{{ row.id }}</span>
            </div>
          </div>
        </div>

        <div>
          <div class="mb-1.5 flex items-center justify-between gap-3 text-[11px]">
            <span class="font-mono font-semibold text-gray-700 dark:text-gray-300">
              {{ row.current }}/{{ row.capacity > 0 ? row.capacity : t('admin.ops.providerMonitor.unlimited') }} {{ t('admin.ops.providerMonitor.calls') }}
            </span>
            <span class="font-mono font-bold" :class="row.load >= 90 ? 'text-red-600 dark:text-red-400' : row.load >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-700 dark:text-gray-300'">
              {{ Math.round(row.load) }}%
            </span>
          </div>
          <div class="grid gap-0.5" style="grid-template-columns: repeat(20, minmax(0, 1fr))" :aria-label="`${row.name} ${Math.round(row.load)}%`">
            <span v-for="index in 20" :key="index" class="h-2 rounded-[2px] transition-colors duration-300" :class="segmentClass(row, index - 1)"></span>
          </div>
          <div v-if="row.queued > 0" class="mt-1.5 text-[10px] font-medium text-red-600 dark:text-red-400">
            {{ t('admin.ops.providerMonitor.queued', { count: row.queued }) }}
          </div>
        </div>

        <div class="min-w-0">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-bold" :class="stateTextClass(row.state)">{{ stateLabel(row.state) }}</span>
            <span v-if="row.cooldownRemaining > 0" class="font-mono text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              {{ formatDuration(row.cooldownRemaining) }}
            </span>
          </div>
          <p class="mt-0.5 truncate text-[10px] text-gray-500 dark:text-gray-400" :title="row.detail">{{ row.detail }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
