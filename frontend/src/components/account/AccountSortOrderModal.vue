<template>
  <BaseDialog
    :show="show"
    :title="t('admin.accounts.sortOrder.title')"
    width="wide"
    @close="close"
  >
    <div class="space-y-4">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {{ t('admin.accounts.sortOrder.hint') }}
      </p>

      <div
        v-if="loading"
        class="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-6 text-sm text-gray-500 dark:border-dark-600 dark:bg-dark-700 dark:text-dark-300"
        data-testid="account-sort-order-loading"
      >
        <Icon name="refresh" size="sm" class="animate-spin" />
        <span>{{ t('admin.accounts.sortOrder.loading') }}</span>
      </div>

      <p
        v-else-if="loadError"
        class="rounded-lg border border-red-200 bg-red-50 px-3 py-4 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300"
        data-testid="account-sort-order-error"
      >
        {{ loadError }}
      </p>

      <div
        v-else-if="!sortableAccounts.length"
        class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-6 text-center text-sm text-gray-500 dark:border-dark-600 dark:bg-dark-700 dark:text-dark-300"
        data-testid="account-sort-order-empty"
      >
        {{ t('admin.accounts.sortOrder.empty') }}
      </div>

      <div v-else class="max-h-[60vh] overflow-y-auto pr-1">
        <VueDraggable
          v-model="sortableAccounts"
          :animation="200"
          ghost-class="opacity-40"
          chosen-class="shadow-lg ring-2 ring-primary-400"
          drag-class="shadow-xl"
          class="space-y-2"
          data-testid="account-sort-order-list"
          @end="handleDragEnd"
        >
          <div
            v-for="account in sortableAccounts"
            :key="account.id"
            class="flex cursor-grab touch-none select-none items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 transition-shadow hover:border-primary-300 hover:shadow-md active:cursor-grabbing dark:border-dark-600 dark:bg-dark-700 dark:hover:border-primary-700"
            :title="t('admin.accounts.sortOrder.dragHint')"
            data-testid="account-sort-order-item"
          >
            <div class="text-gray-400">
              <Icon name="menu" size="md" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium text-gray-900 dark:text-white">
                {{ account.name }}
              </div>
              <div class="truncate text-xs text-gray-500 dark:text-gray-400">
                {{ platformLabel(account.platform) }}
                <template v-if="groupNames(account).length">
                  · {{ groupNames(account).join(', ') }}
                </template>
              </div>
            </div>
          </div>
        </VueDraggable>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-3">
        <button class="btn btn-secondary" :disabled="saving" @click="close">
          {{ t('common.cancel') }}
        </button>
        <button
          class="btn btn-primary"
          :disabled="saving || loading || !!loadError || !sortableAccounts.length"
          data-testid="account-sort-order-save"
          @click="save"
        >
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueDraggable } from 'vue-draggable-plus'
import BaseDialog from '@/components/common/BaseDialog.vue'
import Icon from '@/components/icons/Icon.vue'
import { adminAPI } from '@/api/admin'
import { useAppStore } from '@/stores/app'
import { extractApiErrorMessage } from '@/utils/apiError'
import { computeDropPriority } from '@/utils/accountPriorityOrder'
import type { AccountListItem, AdminGroup, AccountPlatform } from '@/types'

// 一次分页请求尽量取全量：拖动排序必须看到同一条全局顺序，不能只排当前页。
const PAGE_SIZE = 1000
// 防御性上限，避免异常 total 把弹窗拖死（1000 × 10 = 1 万个账号）。
const MAX_PAGES = 10

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved'): void
}>()

const { t } = useI18n()
const appStore = useAppStore()

const sortableAccounts = ref<AccountListItem[]>([])
const groups = ref<AdminGroup[]>([])
const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
// 打开弹窗时的原始优先级，用于只提交真正变动的行。
const initialPriority = ref(new Map<number, number>())

const groupsByID = () => new Map(groups.value.map(group => [group.id, group]))

const platformLabel = (platform: AccountPlatform | string) =>
  t(`admin.accounts.platforms.${platform}`, platform)

const groupNames = (account: AccountListItem) => {
  const byID = groupsByID()
  return (account.group_ids ?? [])
    .map(id => byID.get(id)?.name)
    .filter((name): name is string => !!name)
}

const fetchAllAccounts = async () => {
  const collected: AccountListItem[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await adminAPI.accounts.list(page, PAGE_SIZE, {
      lite: '1',
      sort_by: 'priority',
      sort_order: 'asc'
    })
    collected.push(...response.items)
    const total = response.total ?? collected.length
    if (!response.items.length || collected.length >= total) break
  }
  // 服务端已按 priority 排序，这里再用 id 兜底保证同一优先级内的顺序稳定。
  return collected.sort((a, b) => a.priority - b.priority || a.id - b.id)
}

const load = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const [accounts, allGroups] = await Promise.all([
      fetchAllAccounts(),
      adminAPI.groups.getAll().catch(() => [] as AdminGroup[])
    ])
    sortableAccounts.value = accounts
    groups.value = allGroups ?? []
    initialPriority.value = new Map(accounts.map(account => [account.id, account.priority]))
    priorityState.value = new Map(initialPriority.value)
    plannedUpdates.value = []
  } catch (error) {
    loadError.value = extractApiErrorMessage(error, t('admin.accounts.sortOrder.loadFailed'))
    sortableAccounts.value = []
  } finally {
    loading.value = false
  }
}

const close = () => {
  if (saving.value) return
  sortableAccounts.value = []
  loadError.value = ''
  initialPriority.value = new Map()
  priorityState.value = new Map()
  plannedUpdates.value = []
  emit('close')
}

// 拖动结束后按"前后邻居"推导这一个账号的新优先级，界面上不出现任何数字。
//
// 规则：新优先级严格落在新前邻居与新后邻居之间；拖到两端则取相邻一侧之外一格。
// 只写这个账号，其它账号优先级保持原值 —— 不会因为一次拖动就把全局重编号。
// 连续拖动多次时，每次都基于上一次算出的结果继续推导（priorityState 累积）。
// 邻居之间确实没有整数空位时，才退回整体按位置重编号 1..N。
const priorityState = ref(new Map<number, number>())
const plannedUpdates = ref<Array<{ id: number; priority: number }>>([])

const priorityOf = (accountId: number) => priorityState.value.get(accountId)

// 已被其它账号占用的优先级（不含被拖动的账号）。
const takenPriorities = (movedId: number) => {
  const taken = new Set<number>()
  for (const [id, value] of priorityState.value) {
    if (id !== movedId) taken.add(value)
  }
  return taken
}

const handleDragEnd = (event: { oldIndex?: number; newIndex?: number }) => {
  const { oldIndex, newIndex } = event
  if (oldIndex == null || newIndex == null || oldIndex === newIndex) return
  const moved = sortableAccounts.value[newIndex]
  if (!moved) return

  const previous = newIndex > 0 ? sortableAccounts.value[newIndex - 1] : null
  const next = newIndex < sortableAccounts.value.length - 1 ? sortableAccounts.value[newIndex + 1] : null
  const target = computeDropPriority({
    lowerBound: previous ? priorityOf(previous.id) ?? null : null,
    upperBound: next ? priorityOf(next.id) ?? null : null,
    taken: takenPriorities(moved.id)
  })

  if (target != null) {
    priorityState.value = new Map(priorityState.value).set(moved.id, target)
    plannedUpdates.value = recomputePlannedUpdates()
    return
  }
  // 邻居之间没有空位：整体按位置重编号，仍然只是一次批量写入。
  const renumbered = new Map<number, number>()
  sortableAccounts.value.forEach((account, index) => renumbered.set(account.id, index + 1))
  priorityState.value = renumbered
  plannedUpdates.value = recomputePlannedUpdates()
}

// 与打开弹窗时的原始优先级对比，只提交真正变了的行。
const recomputePlannedUpdates = () => {
  const updates: Array<{ id: number; priority: number }> = []
  for (const account of sortableAccounts.value) {
    const original = initialPriority.value.get(account.id)
    const current = priorityState.value.get(account.id)
    if (current != null && current !== original) {
      updates.push({ id: account.id, priority: current })
    }
  }
  return updates
}

const buildSortUpdates = () => plannedUpdates.value

const save = async () => {
  if (saving.value || !sortableAccounts.value.length) return
  saving.value = true
  try {
    const updates = buildSortUpdates()
    if (updates.length === 0) {
      saving.value = false
      close()
      return
    }
    await adminAPI.accounts.updateSortOrder(updates)
    appStore.showSuccess(t('admin.accounts.sortOrder.updated'))
    saving.value = false
    close()
    emit('saved')
  } catch (error) {
    appStore.showError(extractApiErrorMessage(error, t('admin.accounts.sortOrder.updateFailed')))
  } finally {
    saving.value = false
  }
}

watch(
  () => props.show,
  (visible) => {
    if (visible) {
      void load()
    } else {
      sortableAccounts.value = []
      loadError.value = ''
    }
  },
  { immediate: true }
)
</script>
