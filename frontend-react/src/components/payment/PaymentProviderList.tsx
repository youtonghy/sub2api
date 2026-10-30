/**
 * 服务商实例列表，对应 Vue 版 PaymentProviderList.vue（VueDraggable 换成 @dnd-kit/sortable）。
 * 只能通过左侧拖动手柄排序；松手后按新顺序回调 onReorder（sort_order 为下标）。
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
import { GripVertical, RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Button } from '@/components/arc/button/button'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { useI18n } from '@/i18n/useI18n'
import type { ProviderInstance } from '@/types/payment'
import ProviderCard, { type ProviderToggleField } from './ProviderCard'
import type { TypeOption } from './providerConfig'
import { getAvailableTypes } from './providerConfig'
import styles from './PaymentProviderList.module.css'

export interface PaymentProviderListProps {
  providers: ProviderInstance[]
  loading: boolean
  canCreate: boolean
  enabledPaymentTypes: string[]
  allPaymentTypes: TypeOption[]
  redirectLabel: string
  onRefresh?: () => void
  onCreate?: () => void
  onEdit?: (provider: ProviderInstance) => void
  onDelete?: (provider: ProviderInstance) => void
  onToggleField?: (provider: ProviderInstance, field: ProviderToggleField) => void
  onToggleType?: (provider: ProviderInstance, type: string) => void
  onReorder?: (providers: { id: number; sort_order: number }[]) => void
}

interface SortableProviderProps {
  provider: ProviderInstance
  handleLabel: string
  children: ReactNode
}

function SortableProvider({ provider, handleLabel, children }: SortableProviderProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: provider.id
  })
  return (
    <div
      ref={setNodeRef}
      className={styles.item}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className={styles.handle}
        aria-label={handleLabel}
        title={handleLabel}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={18} aria-hidden="true" />
      </button>
      <div className={styles.card}>{children}</div>
    </div>
  )
}

export default function PaymentProviderList({
  providers,
  loading,
  canCreate,
  enabledPaymentTypes,
  allPaymentTypes,
  redirectLabel,
  onRefresh,
  onCreate,
  onEdit,
  onDelete,
  onToggleField,
  onToggleType,
  onReorder
}: PaymentProviderListProps) {
  const { t } = useI18n()

  // 本地排序副本：props.providers 变化时重置（Vue 版 watch immediate）
  const [localProviders, setLocalProviders] = useState<ProviderInstance[]>(() => [...providers])
  const [lastProviders, setLastProviders] = useState(providers)
  if (lastProviders !== providers) {
    setLastProviders(providers)
    setLocalProviders([...providers])
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    let next = localProviders
    if (over && active.id !== over.id) {
      const oldIndex = localProviders.findIndex((p) => p.id === active.id)
      const newIndex = localProviders.findIndex((p) => p.id === over.id)
      if (oldIndex !== -1 && newIndex !== -1) {
        next = arrayMove(localProviders, oldIndex, newIndex)
        setLocalProviders(next)
      }
    }
    onReorder?.(next.map((p, idx) => ({ id: p.id, sort_order: idx })))
  }

  const isEnabled = (providerKey: string) => enabledPaymentTypes.includes(providerKey)

  const getTypes = (providerKey: string): TypeOption[] =>
    getAvailableTypes(providerKey, allPaymentTypes, redirectLabel).map((opt) =>
      opt.label === opt.value ? { ...opt, label: t(`payment.methods.${opt.value}`, opt.value) } : opt
    )

  return (
    <section className={styles.panel} aria-labelledby="payment-provider-list-title">
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 id="payment-provider-list-title" className={styles.title}>
            {t('admin.settings.payment.providerManagement')}
          </h2>
          <p className={styles.description}>{t('admin.settings.payment.providerManagementDesc')}</p>
        </div>
        <div className={styles.headerActions}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onRefresh?.()}
            disabled={loading}
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
          >
            <RefreshCw size={14} className={loading ? styles.spin : undefined} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant={canCreate ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => onCreate?.()}
            disabled={!canCreate}
          >
            {t('admin.settings.payment.createProvider')}
          </Button>
        </div>
      </div>

      {/* List */}
      <div className={styles.body}>
        {loading && !providers.length ? (
          <Skeleton lines={3} label={t('common.loading')} />
        ) : providers.length ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={localProviders.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <div className={styles.list}>
                {localProviders.map((p) => (
                  <SortableProvider key={p.id} provider={p} handleLabel={t('admin.users.attributes.dragToReorder')}>
                    <ProviderCard
                      provider={p}
                      enabled={isEnabled(p.provider_key)}
                      availableTypes={getTypes(p.provider_key)}
                      onToggleField={(field) => onToggleField?.(p, field)}
                      onToggleType={(type) => onToggleType?.(p, type)}
                      onEdit={() => onEdit?.(p)}
                      onDelete={() => onDelete?.(p)}
                    />
                  </SortableProvider>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : !loading ? (
          <div className={styles.empty}>
            <p className={styles.emptyText}>
              {canCreate ? t('admin.settings.payment.noProviders') : t('admin.settings.payment.enableTypesFirst')}
            </p>
            {canCreate && (
              <Button type="button" variant="primary" size="sm" onClick={() => onCreate?.()}>
                {t('admin.settings.payment.createProvider')}
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}
