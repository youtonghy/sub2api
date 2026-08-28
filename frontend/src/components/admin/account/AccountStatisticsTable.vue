<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Account, WindowStats } from '@/types'
import type { AccountHourlyFailureBucket } from '@/api/admin/ops'
import { formatCurrency, formatNumber } from '@/utils/format'

const props = withDefaults(defineProps<{
  accounts: Account[]
  statsByAccount: Record<string, WindowStats>
  failuresByAccount: Record<string, AccountHourlyFailureBucket[]>
  loading?: boolean
  error?: string | null
}>(), {
  loading: false,
  error: null
})

const { t } = useI18n()

function statsFor(accountID: number): WindowStats | undefined {
  return props.statsByAccount[String(accountID)]
}

function hasConsumption(account: Account): boolean {
  const stats = statsFor(account.id)
  return (stats?.standard_cost ?? 0) > 0 || (stats?.cost ?? 0) > 0
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

function upstreamDeclaredRate(account: Account): number {
  const data = account.extra?.upstream_billing_probe?.data
  const effective = data?.effective_rate_multiplier
  if (typeof effective === 'number' && Number.isFinite(effective) && effective >= 0) return effective
  const resolved = data?.resolved_rate_multiplier
  if (typeof resolved === 'number' && Number.isFinite(resolved) && resolved >= 0) return resolved
  return 1
}

function realCost(account: Account, stats?: WindowStats): number {
  return (stats?.standard_cost ?? 0) * upstreamDeclaredRate(account)
}

function cacheHitRate(stats?: WindowStats): string {
  if (!stats) return '-'
  const inputTokens = stats.input_tokens ?? 0
  const cacheReadTokens = stats.cache_read_tokens ?? 0
  const eligibleTokens = inputTokens + cacheReadTokens
  return eligibleTokens > 0 ? formatPercent((cacheReadTokens / eligibleTokens) * 100) : '-'
}

function onlineRate(accountID: number): string {
  const buckets = props.failuresByAccount[String(accountID)] ?? []
  const totals = buckets.reduce((result, bucket) => {
    result.requests += bucket.request_count
    result.failures += bucket.failure_count
    return result
  }, { requests: 0, failures: 0 })
  if (totals.requests === 0) return '-'
  return formatPercent(((totals.requests - totals.failures) / totals.requests) * 100)
}

function formatTTFT(stats?: WindowStats): string {
  const value = stats?.average_first_token_ms ?? 0
  if (value <= 0) return '-'
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)}s`
  return `${Math.round(value)}ms`
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-auto">
    <div v-if="error" class="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400">
      {{ error }}
    </div>
    <table class="w-full min-w-[980px] border-collapse text-left">
      <thead class="sticky top-0 z-10 bg-gray-50 text-xs font-semibold text-gray-500 dark:bg-dark-900 dark:text-gray-400">
        <tr class="border-b border-gray-200 dark:border-dark-700">
          <th class="px-4 py-3">{{ t('admin.accounts.statistics.account') }}</th>
          <th class="px-4 py-3 text-right">{{ t('admin.accounts.statistics.tokens') }}</th>
          <th class="px-4 py-3 text-right">{{ t('admin.accounts.statistics.standardCost') }}</th>
          <th class="px-4 py-3 text-right">{{ t('admin.accounts.statistics.realCost') }}</th>
          <th class="px-4 py-3 text-right">{{ t('admin.accounts.statistics.cacheHitRate') }}</th>
          <th class="px-4 py-3 text-right">{{ t('admin.accounts.statistics.onlineRate') }}</th>
          <th class="px-4 py-3 text-right">{{ t('admin.accounts.statistics.firstTokenWait') }}</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100 bg-white dark:divide-dark-700 dark:bg-dark-800">
        <template v-if="loading && accounts.length === 0">
          <tr v-for="index in 5" :key="index">
            <td v-for="cell in 7" :key="cell" class="px-4 py-4"><div class="h-4 animate-pulse rounded bg-gray-100 dark:bg-dark-700"></div></td>
          </tr>
        </template>
        <tr v-else-if="accounts.length === 0">
          <td colspan="7" class="px-4 py-14 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('common.noData') }}</td>
        </tr>
        <template v-else>
          <tr v-for="account in accounts.filter(hasConsumption)" :key="account.id" :data-statistics-account-id="account.id" class="hover:bg-gray-50/70 dark:hover:bg-dark-700/40">
            <td class="px-4 py-3">
              <div class="max-w-[280px] truncate text-sm font-medium text-gray-900 dark:text-white" :title="account.name">{{ account.name }}</div>
              <div class="mt-0.5 text-xs text-gray-400">{{ account.platform }} · #{{ account.id }}</div>
            </td>
            <td class="px-4 py-3 text-right font-mono text-sm tabular-nums text-gray-700 dark:text-gray-200">{{ formatNumber(statsFor(account.id)?.tokens ?? 0) }}</td>
            <td class="px-4 py-3 text-right font-mono text-sm tabular-nums text-gray-700 dark:text-gray-200">{{ formatCurrency(statsFor(account.id)?.standard_cost ?? 0) }}</td>
            <td class="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{{ formatCurrency(realCost(account, statsFor(account.id))) }}</td>
            <td class="px-4 py-3 text-right font-mono text-sm tabular-nums text-gray-700 dark:text-gray-200">{{ cacheHitRate(statsFor(account.id)) }}</td>
            <td class="px-4 py-3 text-right font-mono text-sm tabular-nums text-gray-700 dark:text-gray-200">{{ onlineRate(account.id) }}</td>
            <td class="px-4 py-3 text-right font-mono text-sm tabular-nums text-gray-700 dark:text-gray-200">{{ formatTTFT(statsFor(account.id)) }}</td>
          </tr>
          <tr v-if="!loading && accounts.every(account => !hasConsumption(account))">
            <td colspan="7" class="px-4 py-14 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('admin.accounts.statistics.noConsumption') }}</td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
