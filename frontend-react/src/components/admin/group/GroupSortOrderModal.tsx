/**
 * 分组排序弹窗（Vue 版 GroupsView 中的 Sort Order Modal；VueDraggable 换成 @dnd-kit/sortable）。
 * 打开前由页面拉取全部分组并按 sort_order 排好；保存时按拖动后的位置写入 sort_order = index * 10。
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
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { useState } from 'react'

import { adminAPI } from '@/api/admin'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminGroup } from '@/types'
import { platformLabel } from '@/utils/platformColors'
import styles from './GroupSortOrderModal.module.css'

export interface GroupSortOrderModalProps {
  show: boolean
  /** 打开时的全部分组（已按 sort_order 排序） */
  groups: AdminGroup[]
  onClose: () => void
  onSaved: () => void
}

function SortableGroupItem({ group }: { group: AdminGroup }) {
  const { t } = useI18n()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.id })
  return (
    <div
      ref={setNodeRef}
      className={styles.item}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid="group-sort-order-item"
      {...attributes}
      {...listeners}
    >
      <GripVertical className={styles.grip} aria-hidden="true" />
      <div className={styles.itemText}>
        <div className={styles.itemName}>{group.name}</div>
        <Badge size="sm" tone="neutral">
          {t('admin.groups.platforms.' + group.platform, platformLabel(group.platform))}
        </Badge>
      </div>
      <div className={styles.itemId}>#{group.id}</div>
    </div>
  )
}

export default function GroupSortOrderModal({ show, groups, onClose, onSaved }: GroupSortOrderModalProps) {
  const { t } = useI18n()
  const [sortableGroups, setSortableGroups] = useState<AdminGroup[]>(groups)
  const [source, setSource] = useState(groups)
  const [submitting, setSubmitting] = useState(false)

  // 页面每次打开都会传入新的分组数组，此时重置拖动结果
  if (source !== groups) {
    setSource(groups)
    setSortableGroups(groups)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIndex = sortableGroups.findIndex((group) => group.id === active.id)
    const newIndex = sortableGroups.findIndex((group) => group.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    setSortableGroups(arrayMove(sortableGroups, oldIndex, newIndex))
  }

  // 保存排序
  const saveSortOrder = async () => {
    setSubmitting(true)
    try {
      const updates = sortableGroups.map((g, index) => ({ id: g.id, sort_order: index * 10 }))
      await adminAPI.groups.updateSortOrder(updates)
      useAppStore.getState().showSuccess(t('admin.groups.sortOrderUpdated'))
      onClose()
      onSaved()
    } catch (error: any) {
      useAppStore.getState().showError(error?.response?.data?.detail || t('admin.groups.failedToUpdateSortOrder'))
      console.error('Error updating sort order:', error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <BaseDialog
      show={show}
      title={t('admin.groups.sortOrder')}
      width="normal"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="primary" disabled={submitting} loading={submitting} onClick={saveSortOrder}>
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <p className={styles.hint}>{t('admin.groups.sortOrderHint')}</p>
        <div className={styles.scroller}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortableGroups.map((group) => group.id)} strategy={verticalListSortingStrategy}>
              <div className={styles.list}>
                {sortableGroups.map((group) => (
                  <SortableGroupItem key={group.id} group={group} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>
    </BaseDialog>
  )
}
