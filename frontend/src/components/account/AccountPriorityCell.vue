<template>
  <span
    class="inline-flex h-7 min-w-[2.25rem] items-center justify-center rounded-lg border border-transparent bg-gray-50 px-1.5 font-mono text-sm tabular-nums text-gray-700 dark:bg-dark-700/60 dark:text-gray-200"
    :title="t('admin.accounts.priorityOrderHint')"
    data-testid="account-priority-cell"
  >
    <span data-testid="account-priority-rank">{{ rank }}</span>
  </span>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

// 只显示"第几个被使用"的位次，不暴露内部 priority 数值。
// 位次由父级按当前列表顺序（同优先级按 id 兜底）算好后传入，
// 保证与拖动后的视觉顺序始终一致。
defineProps<{ rank: number }>()

const { t } = useI18n()
</script>
