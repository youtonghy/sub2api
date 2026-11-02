/**
 * 账号调度顺序弹窗，对应 Vue 版 AccountSortOrderModal.vue（VueDraggable 换成 @dnd-kit/sortable）。
 * 打开时取全量账号（按 priority、id 排序），拖动后只为被拖动的账号推导新优先级，保存时只提交变化的行。
 */
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import Skeleton from '@/components/common/Skeleton'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AccountListItem, AccountPlatform, AdminGroup } from '@/types'
import { computeDropPriority } from '@/utils/accountPriorityOrder'
import { extractApiErrorMessage } from '@/utils/apiError'
import styles from './AccountSortOrderModal.module.css'

export interface AccountSortOrderModalProps {
  show: boolean
  onClose?: () => void
  onSaved?: () => void
}

// 一次分页请求尽量取全量：拖动排序必须看到同一条全局顺序，不能只排当前页。
const PAGE_SIZE = 1000
// 防御性上限，避免异常 total 把弹窗拖死（1000 × 10 = 1 万个账号）。
const MAX_PAGES = 10

type PriorityUpdate = { id: number; priority: number }

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

// 与打开弹窗时的原始优先级对比，只提交真正变了的行。
const computePlannedUpdates = (
  accounts: AccountListItem[],
  initial: Map<number, number>,
  current: Map<number, number>
): PriorityUpdate[] => {
  const updates: PriorityUpdate[] = []
  for (const account of accounts) {
    const original = initial.get(account.id)
    const value = current.get(account.id)
    if (value != null && value !== original) {
      updates.push({ id: account.id, priority: value })
    }
  }
  return updates
}

interface SortableItemProps {
  account: AccountListItem
  subtitle: string
  dragHint: string
}

function SortableAccountItem({ account, subtitle, dragHint }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: account.id })
  return (
    <div
      ref={setNodeRef}
      className={styles.item}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      title={dragHint}
      data-testid="account-sort-order-item"
      data-account-id={account.id}
      {...attributes}
      {...listeners}
    >
      <GripVertical className={styles.grip} aria-hidden="true" />
      <div className={styles.itemText}>
        <div className={styles.itemName}>{account.name}</div>
        <div className={styles.itemMeta}>{subtitle}</div>
      </div>
    </div>
  )
}

export default function AccountSortOrderModal({ show, onClose, onSaved }: AccountSortOrderModalProps) {
  const { t } = useI18n()

  const [sortableAccounts, setSortableAccounts] = useState<AccountListItem[]>([])
  const [groups, setGroups] = useState<AdminGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  // 打开弹窗时的原始优先级，用于只提交真正变动的行。
  const [initialPriority, setInitialPriority] = useState(() => new Map<number, number>())
  const [priorityState, setPriorityState] = useState(() => new Map<number, number>())
  const [plannedUpdates, setPlannedUpdates] = useState<PriorityUpdate[]>([])
  const savingRef = useRef(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    if (!show) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 关闭时清空列表
      setSortableAccounts([])
      setLoadError('')
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError('')
    Promise.all([fetchAllAccounts(), adminAPI.groups.getAll().catch(() => [] as AdminGroup[])])
      .then(([accounts, allGroups]) => {
        if (cancelled) return
        const initial = new Map(accounts.map((account) => [account.id, account.priority]))
        setSortableAccounts(accounts)
        setGroups(allGroups ?? [])
        setInitialPriority(initial)
        setPriorityState(new Map(initial))
        setPlannedUpdates([])
      })
      .catch((error) => {
        if (cancelled) return
        setLoadError(extractApiErrorMessage(error, t('admin.accounts.sortOrder.loadFailed')))
        setSortableAccounts([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [show, t])

  const groupsByID = new Map(groups.map((group) => [group.id, group]))
  const platformLabel = (platform: AccountPlatform | string) => t(`admin.accounts.platforms.${platform}`, platform)
  const groupNames = (account: AccountListItem) =>
    (account.group_ids ?? []).map((id) => groupsByID.get(id)?.name).filter((name): name is string => !!name)

  const close = () => {
    if (savingRef.current) return
    setSortableAccounts([])
    setLoadError('')
    setInitialPriority(new Map())
    setPriorityState(new Map())
    setPlannedUpdates([])
    onClose?.()
  }

  // 拖动结束后按"前后邻居"推导这一个账号的新优先级，界面上不出现任何数字。
  //
  // 规则：新优先级严格落在新前邻居与新后邻居之间；拖到两端则取相邻一侧之外一格。
  // 只写这个账号，其它账号优先级保持原值 —— 不会因为一次拖动就把全局重编号。
  // 连续拖动多次时，每次都基于上一次算出的结果继续推导（priorityState 累积）。
  // 邻居之间确实没有整数空位时，才退回整体按位置重编号 1..N。
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return
    const oldIndex = sortableAccounts.findIndex((account) => account.id === active.id)
    const newIndex = sortableAccounts.findIndex((account) => account.id === over.id)
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return

    const reordered = arrayMove(sortableAccounts, oldIndex, newIndex)
    const moved = reordered[newIndex]
    const previous = newIndex > 0 ? reordered[newIndex - 1] : null
    const next = newIndex < reordered.length - 1 ? reordered[newIndex + 1] : null

    // 已被其它账号占用的优先级（不含被拖动的账号）。
    const taken = new Set<number>()
    for (const [id, value] of priorityState) {
      if (id !== moved.id) taken.add(value)
    }

    const target = computeDropPriority({
      lowerBound: previous ? priorityState.get(previous.id) ?? null : null,
      upperBound: next ? priorityState.get(next.id) ?? null : null,
      taken
    })

    let nextState: Map<number, number>
    if (target != null) {
      nextState = new Map(priorityState).set(moved.id, target)
    } else {
      // 邻居之间没有空位：整体按位置重编号，仍然只是一次批量写入。
      nextState = new Map()
      reordered.forEach((account, index) => nextState.set(account.id, index + 1))
    }
    setSortableAccounts(reordered)
    setPriorityState(nextState)
    setPlannedUpdates(computePlannedUpdates(reordered, initialPriority, nextState))
  }

  const save = async () => {
    if (savingRef.current || !sortableAccounts.length) return
    const updates = plannedUpdates
    if (updates.length === 0) {
      close()
      return
    }
    savingRef.current = true
    setSaving(true)
    try {
      await adminAPI.accounts.updateSortOrder(updates)
      useAppStore.getState().showSuccess(t('admin.accounts.sortOrder.updated'))
      savingRef.current = false
      setSaving(false)
      close()
      onSaved?.()
    } catch (error) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.accounts.sortOrder.updateFailed')))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  let body
  if (loading) {
    body = (
      <div className={styles.loading} aria-busy="true" data-testid="account-sort-order-loading">
        <span className={styles.srOnly}>{t('admin.accounts.sortOrder.loading')}</span>
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} height={56} />
        ))}
      </div>
    )
  } else if (loadError) {
    body = <Alert tone="danger" title={loadError} data-testid="account-sort-order-error" />
  } else if (!sortableAccounts.length) {
    body = (
      <div className={styles.empty} data-testid="account-sort-order-empty">
        {t('admin.accounts.sortOrder.empty')}
      </div>
    )
  } else {
    body = (
      <div className={styles.scroller}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortableAccounts.map((account) => account.id)} strategy={verticalListSortingStrategy}>
            <div className={styles.list} data-testid="account-sort-order-list">
              {sortableAccounts.map((account) => {
                const names = groupNames(account)
                const subtitle = names.length
                  ? `${platformLabel(account.platform)} · ${names.join(', ')}`
                  : platformLabel(account.platform)
                return (
                  <SortableAccountItem
                    key={account.id}
                    account={account}
                    subtitle={subtitle}
                    dragHint={t('admin.accounts.sortOrder.dragHint')}
                  />
                )
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    )
  }

  return (
    <BaseDialog
      show={show}
      title={t('admin.accounts.sortOrder.title')}
      width="wide"
      onClose={close}
      footer={
        <>
          <Button variant="secondary" type="button" disabled={saving} onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={saving || loading || !!loadError || !sortableAccounts.length}
            data-testid="account-sort-order-save"
            onClick={save}
          >
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <p className={styles.hint}>{t('admin.accounts.sortOrder.hint')}</p>
        {body}
      </div>
    </BaseDialog>
  )
}
