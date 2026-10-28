<template>
  <AppLayout>
    <TablePageLayout>
      <template #filters>
        <div class="flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <h1 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('admin.accounts.modelFingerprint.title') }}</h1>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('admin.accounts.modelFingerprint.description') }}</p>
          </div>
          <div class="min-w-[220px]">
            <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('admin.accounts.modelFingerprint.provider') }}</label>
            <Select v-model="platform" :options="providerOptions" value-key="value" label-key="label" />
          </div>
        </div>
      </template>
      <template #table>
        <div
          v-if="!platform"
          class="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center"
        >
          <Icon name="filter" size="lg" class="text-gray-400" />
          <div>
            <p class="font-medium text-gray-800 dark:text-gray-200">{{ t('admin.accounts.modelFingerprint.selectProvider') }}</p>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('admin.accounts.modelFingerprint.selectProviderHint') }}</p>
          </div>
        </div>
        <ModelFingerprintPanel
          v-else
          :accounts="filteredAccounts"
          :platform="platform"
          :active="true"
        />
      </template>
    </TablePageLayout>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import TablePageLayout from '@/components/layout/TablePageLayout.vue'
import Select from '@/components/common/Select.vue'
import Icon from '@/components/icons/Icon.vue'
import ModelFingerprintPanel from '@/components/admin/account/ModelFingerprintPanel.vue'
import { adminAPI } from '@/api/admin'
import type { Account } from '@/types'

const { t } = useI18n()
const accounts = ref<Account[]>([])
const platform = ref('')
const providerOptions = computed(() => {
  const platforms = Array.from(new Set(accounts.value.map(account => account.platform).filter(Boolean))).sort()
  return [
    { value: '', label: t('admin.accounts.modelFingerprint.selectProviderOption') },
    ...platforms.map(value => ({ value, label: value }))
  ]
})
const filteredAccounts = computed(() => platform.value ? accounts.value.filter(account => account.platform === platform.value) : [])

onMounted(async () => {
  try {
    const result = await adminAPI.accounts.list(1, 1000, { lite: 'true' })
    accounts.value = result.items || []
  } catch {
    accounts.value = []
  }
})
</script>
