<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { opsAPI, type OpsAccountTTFTItem } from '@/api/admin/ops'

interface Props {
  platformFilter?: string
  groupIdFilter?: number | null
}

const props = withDefaults(defineProps<Props>(), {
  platformFilter: '',
  groupIdFilter: null
})

const { t } = useI18n()
const loading = ref(true)
const errorMessage = ref('')
const items = ref<OpsAccountTTFTItem[]>([])
const requestController = ref<AbortController | null>(null)

const rows = computed(() => [...items.value].sort((a, b) => b.avg_ms - a.avg_ms || b.p95_ms - a.p95_ms || a.account_id - b.account_id))
const maxAverage = computed(() => rows.value[0]?.avg_ms || 1)

function formatMs(value: number): string {
  if (!Number.isFinite(value)) return '-'
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)}s`
  return `${Math.round(value)}ms`
}

function barClass(index: number): string {
  if (index === 0) return 'bg-red-500'
  if (index < 3) return 'bg-orange-500'
  if (index < 6) return 'bg-amber-500'
  return 'bg-sky-500'
}

async function loadData() {
  requestController.value?.abort()
  const controller = new AbortController()
  requestController.value = controller
  errorMessage.value = ''
  try {
    const data = await opsAPI.getAccountTTFTStats(props.platformFilter, props.groupIdFilter)
    if (!controller.signal.aborted) items.value = data.items || []
  } catch (err: any) {
    if (controller.signal.aborted || err?.code === 'ERR_CANCELED') return
    errorMessage.value = err?.response?.data?.detail || t('admin.ops.accountTTFT.loadFailed')
  } finally {
    if (requestController.value === controller) loading.value = false
  }
}

const { pause, resume } = useIntervalFn(loadData, 30_000, { immediate: false })

watch(() => [props.platformFilter, props.groupIdFilter] as const, loadData)
onMounted(() => {
  loadData()
  resume()
})
onBeforeUnmount(() => {
  pause()
  requestController.value?.abort()
})
</script>

<template>
  <section class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-900/5 dark:bg-dark-800 dark:ring-dark-700">
    <header class="flex items-center justify-between gap-4 border-b border-gray-100 px-5 py-4 dark:border-dark-700">
      <div>
        <h2 class="text-sm font-bold text-gray-900 dark:text-white">{{ t('admin.ops.accountTTFT.title') }}</h2>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.ops.accountTTFT.description') }}</p>
      </div>
      <button type="button" class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-dark-700" :title="t('common.refresh')" @click="loadData">
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
      </button>
    </header>

    <div v-if="errorMessage" class="border-b border-red-100 bg-red-50 px-5 py-3 text-xs text-red-600 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400">{{ errorMessage }}</div>
    <div v-if="loading" class="space-y-3 px-5 py-6"><div v-for="index in 4" :key="index" class="h-10 animate-pulse rounded bg-gray-100 dark:bg-dark-700"></div></div>
    <div v-else-if="rows.length === 0" class="px-5 py-12 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('admin.ops.accountTTFT.empty') }}</div>
    <div v-else class="max-h-[520px] overflow-y-auto">
      <div class="hidden grid-cols-[minmax(200px,1.2fr)_minmax(220px,2fr)_90px_90px_76px] gap-4 border-b border-gray-100 bg-gray-50/70 px-5 py-2 text-[10px] font-semibold uppercase text-gray-400 dark:border-dark-700 dark:bg-dark-900/60 md:grid">
        <span>{{ t('admin.ops.accountTTFT.account') }}</span><span>{{ t('admin.ops.accountTTFT.average') }}</span><span>P95</span><span>{{ t('admin.ops.accountTTFT.maximum') }}</span><span>{{ t('admin.ops.accountTTFT.samples') }}</span>
      </div>
      <div v-for="(row, index) in rows" :key="row.account_id" :data-ttft-account-id="row.account_id" class="grid gap-2 border-b border-gray-100 px-5 py-3 last:border-b-0 dark:border-dark-700 md:grid-cols-[minmax(200px,1.2fr)_minmax(220px,2fr)_90px_90px_76px] md:items-center md:gap-4">
        <div class="min-w-0"><div class="truncate text-xs font-semibold text-gray-900 dark:text-white" :title="row.account_name">{{ row.account_name }}</div><div class="mt-0.5 text-[10px] uppercase text-gray-400">{{ row.platform }} · #{{ row.account_id }}</div></div>
        <div class="flex items-center gap-3"><span class="w-16 text-right font-mono text-xs font-bold text-gray-800 dark:text-gray-200">{{ formatMs(row.avg_ms) }}</span><div class="h-2 flex-1 overflow-hidden rounded-sm bg-gray-100 dark:bg-dark-700"><div class="h-full rounded-sm" :class="barClass(index)" :style="{ width: `${Math.max(2, (row.avg_ms / maxAverage) * 100)}%` }"></div></div></div>
        <div class="text-xs"><span class="mr-1 text-gray-400 md:hidden">P95</span><span class="font-mono text-gray-700 dark:text-gray-300">{{ formatMs(row.p95_ms) }}</span></div>
        <div class="text-xs"><span class="mr-1 text-gray-400 md:hidden">{{ t('admin.ops.accountTTFT.maximum') }}</span><span class="font-mono text-gray-700 dark:text-gray-300">{{ formatMs(row.max_ms) }}</span></div>
        <div class="font-mono text-xs text-gray-500 dark:text-gray-400">{{ row.sample_count }}</div>
      </div>
    </div>
  </section>
</template>
