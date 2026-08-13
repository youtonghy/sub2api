<template>
  <div class="flex min-h-0 flex-1 flex-col bg-white dark:bg-dark-900">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-dark-700">
      <div>
        <div class="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {{ t('admin.accounts.failureHeatmap.title') }}
        </div>
        <div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {{ date || t('admin.accounts.failureHeatmap.today') }} · {{ timezone }}
        </div>
      </div>
      <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400" aria-label="failure-rate-legend">
        <span>{{ t('admin.accounts.failureHeatmap.legendLow') }}</span>
        <span class="h-3 w-3 border border-emerald-300 bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/60"></span>
        <span class="h-3 w-3 border border-yellow-300 bg-yellow-300 dark:border-yellow-600 dark:bg-yellow-700"></span>
        <span class="h-3 w-3 border border-orange-400 bg-orange-400 dark:border-orange-600 dark:bg-orange-700"></span>
        <span class="h-3 w-3 border border-red-500 bg-red-500 dark:border-red-600 dark:bg-red-700"></span>
        <span>{{ t('admin.accounts.failureHeatmap.legendHigh') }}</span>
      </div>
    </div>

    <div v-if="error" class="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
      {{ t('admin.accounts.failureHeatmap.loadFailed') }}
    </div>

    <div class="min-h-0 flex-1 overflow-auto">
      <div class="failure-grid min-w-max">
        <div class="sticky left-0 z-20 border-b border-r border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 dark:border-dark-700 dark:bg-dark-800 dark:text-gray-400">
          {{ t('admin.accounts.columns.name') }}
        </div>
        <div
          v-for="hour in hours"
          :key="`header-${hour}`"
          class="flex h-9 items-center justify-center border-b border-gray-200 text-[10px] text-gray-400 dark:border-dark-700 dark:text-gray-500"
        >
          {{ hour % 3 === 0 ? String(hour).padStart(2, '0') : '' }}
        </div>

        <template v-if="!loading">
          <template v-for="account in activeAccounts" :key="account.id">
            <div class="sticky left-0 z-10 flex min-w-0 items-center border-b border-r border-gray-100 bg-white px-3 py-2 dark:border-dark-800 dark:bg-dark-900">
              <div class="min-w-0">
                <div class="truncate text-sm font-medium text-gray-800 dark:text-gray-200" :title="account.name">
                  {{ account.name }}
                </div>
                <div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                  <span class="uppercase">{{ account.platform }}</span>
                  <span>#{{ account.id }}</span>
                  <span v-if="dailySummary(account.id).requestCount > 0" :class="dailyRateClass(account.id)">
                    {{ t('admin.accounts.failureHeatmap.todayRate') }} {{ formatRate(dailySummary(account.id).failureRate) }}
                  </span>
                </div>
              </div>
            </div>
            <div
              v-for="hour in hours"
              :key="`${account.id}-${hour}`"
              class="flex h-14 items-center justify-center border-b border-gray-100 dark:border-dark-800"
            >
              <button
                type="button"
                class="h-[18px] w-[18px] border transition-transform duration-150 hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 dark:focus:ring-offset-dark-900"
                :class="bucketClass(bucketFor(account.id, hour))"
                :title="bucketTitle(bucketFor(account.id, hour))"
                :aria-label="bucketTitle(bucketFor(account.id, hour))"
              ></button>
            </div>
          </template>
        </template>
      </div>

      <div v-if="loading" class="flex h-40 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        {{ t('common.loading') }}
      </div>
      <div v-else-if="activeAccounts.length === 0" class="flex h-40 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        {{ t('common.noData') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Account } from '@/types'
import type { AccountHourlyFailureBucket } from '@/api/admin/ops'

const props = withDefaults(defineProps<{
  accounts: Account[]
  byAccount?: Record<string, AccountHourlyFailureBucket[]>
  date?: string
  timezone?: string
  loading?: boolean
  error?: string | null
}>(), {
  byAccount: () => ({}),
  date: '',
  timezone: '',
  loading: false,
  error: null
})

const { t } = useI18n()
const hours = Array.from({ length: 24 }, (_, hour) => hour)

const activeAccounts = computed(() => props.accounts.filter(account => (
  props.byAccount[String(account.id)]?.some(bucket => bucket.request_count > 0) ?? false
)))

const emptyBucket = (accountID: number, hour: number): AccountHourlyFailureBucket => ({
  account_id: accountID,
  hour,
  request_count: 0,
  failure_count: 0,
  failure_rate: 0
})

const bucketFor = (accountID: number, hour: number): AccountHourlyFailureBucket => {
  return props.byAccount[String(accountID)]?.find(bucket => bucket.hour === hour) ?? emptyBucket(accountID, hour)
}

const bucketClass = (bucket: AccountHourlyFailureBucket): string => {
  if (bucket.request_count <= 0) return 'border-gray-200 bg-transparent dark:border-dark-600'
  if (bucket.failure_rate <= 0.05) return 'border-emerald-300 bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/60'
  if (bucket.failure_rate <= 0.15) return 'border-yellow-300 bg-yellow-300 dark:border-yellow-600 dark:bg-yellow-700'
  if (bucket.failure_rate <= 0.3) return 'border-orange-400 bg-orange-400 dark:border-orange-600 dark:bg-orange-700'
  return 'border-red-500 bg-red-500 dark:border-red-600 dark:bg-red-700'
}

const dailySummary = (accountID: number) => {
  const buckets = props.byAccount[String(accountID)] ?? []
  const requestCount = buckets.reduce((sum, bucket) => sum + bucket.request_count, 0)
  const failureCount = buckets.reduce((sum, bucket) => sum + bucket.failure_count, 0)
  return {
    requestCount,
    failureCount,
    failureRate: requestCount > 0 ? failureCount / requestCount : 0
  }
}

const formatRate = (rate: number): string => `${(rate * 100).toFixed(2)}%`

const dailyRateClass = (accountID: number): string => {
  const rate = dailySummary(accountID).failureRate
  if (rate <= 0.05) return 'font-medium text-emerald-600 dark:text-emerald-400'
  if (rate <= 0.15) return 'font-medium text-yellow-600 dark:text-yellow-400'
  if (rate <= 0.3) return 'font-medium text-orange-600 dark:text-orange-400'
  return 'font-medium text-red-600 dark:text-red-400'
}

const bucketTitle = (bucket: AccountHourlyFailureBucket): string => {
  const range = `${String(bucket.hour).padStart(2, '0')}:00-${String(bucket.hour).padStart(2, '0')}:59`
  if (bucket.request_count <= 0) {
    return `${range} · ${t('admin.accounts.failureHeatmap.noCalls')}`
  }
  const rate = formatRate(bucket.failure_rate)
  return `${range} · ${t('admin.accounts.failureHeatmap.requests')} ${bucket.request_count} · ${t('admin.accounts.failureHeatmap.failures')} ${bucket.failure_count} · ${t('admin.accounts.failureHeatmap.failureRate')} ${rate}`
}
</script>

<style scoped>
.failure-grid {
  display: grid;
  grid-template-columns: 210px repeat(24, 24px);
}
</style>
