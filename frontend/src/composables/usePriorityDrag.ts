import { ref } from 'vue'

/**
 * 账号表格行内拖动排序。
 *
 * 只有按住拖拽把手（`.account-priority-drag-handle`）才会进入拖动，按住行其它
 * 地方仍然是表格原有的滑动多选（useSwipeSelect）——两者互不抢占。
 *
 * 拖动期间：
 *  - 被拖动的行跟随指针浮起（视觉反馈）
 *  - 目标插入位置显示一条指示线
 *  - 松手后按"新前后邻居"的优先级算出新值（见 utils/accountPriorityOrder）
 */

export interface PriorityDragRow {
  id: number
  priority: number
}

export interface PriorityDragDropResult<T extends PriorityDragRow> {
  moved: T
  /** 拖动结束后表格的完整顺序（含被拖动的行） */
  order: T[]
  /** 新前邻居，没有则 null */
  previous: T | null
  /** 新后邻居，没有则 null */
  next: T | null
}

export interface UsePriorityDragOptions<T extends PriorityDragRow> {
  /** 当前渲染的行（顺序即视觉顺序） */
  getRows: () => T[]
  /** 取得承载这些行的滚动容器，用于定位命中行 */
  getContainer: () => HTMLElement | null
  /** 松手时的回调；返回 Promise 以便调用方等待写入完成 */
  onDrop: (result: PriorityDragDropResult<T>) => void | Promise<void>
}

const DRAG_THRESHOLD = 4

export function usePriorityDrag<T extends PriorityDragRow>(options: UsePriorityDragOptions<T>) {
  const activeId = ref<number | null>(null)
  const dropIndex = ref(-1)
  const isDragging = ref(false)

  let startY = 0
  let startX = 0
  let rowElements: HTMLElement[] = []
  let dragging: T | null = null
  let ghostEl: HTMLElement | null = null
  let indicatorEl: HTMLElement | null = null
  let armed = false

  const cleanup = () => {
    document.removeEventListener('mousemove', onPointerMove)
    document.removeEventListener('mouseup', onPointerUp)
    document.removeEventListener('touchmove', onPointerMove)
    document.removeEventListener('touchend', onPointerUp)
    document.removeEventListener('touchcancel', onPointerUp)
    document.removeEventListener('keydown', onKeyDown)
    ghostEl?.remove()
    ghostEl = null
    indicatorEl?.remove()
    indicatorEl = null
    activeId.value = null
    dropIndex.value = -1
    isDragging.value = false
    dragging = null
    rowElements = []
    armed = false
  }

  /** 找到指针当前落在哪两行之间，返回插入位置（0..rows.length）。 */
  const findDropIndex = (clientY: number) => {
    if (rowElements.length === 0) return 0
    for (let index = 0; index < rowElements.length; index++) {
      const rect = rowElements[index].getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) return index
    }
    return rowElements.length
  }

  const positionIndicator = () => {
    if (!indicatorEl || rowElements.length === 0) return
    const container = options.getContainer()
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const referenceRect =
      dropIndex.value >= rowElements.length
        ? rowElements[rowElements.length - 1].getBoundingClientRect()
        : rowElements[dropIndex.value].getBoundingClientRect()
    const top = dropIndex.value >= rowElements.length ? referenceRect.bottom : referenceRect.top
    Object.assign(indicatorEl.style, {
      position: 'fixed',
      left: `${containerRect.left}px`,
      width: `${containerRect.width}px`,
      top: `${top - 1}px`,
      height: '2px',
      background: 'rgb(59 130 246)',
      borderRadius: '1px',
      pointerEvents: 'none',
      zIndex: '9998'
    })
  }

  const createOverlay = (row: T, sourceRect: DOMRect) => {
    ghostEl = document.createElement('div')
    Object.assign(ghostEl.style, {
      position: 'fixed',
      left: `${sourceRect.left}px`,
      top: `${sourceRect.top}px`,
      width: `${sourceRect.width}px`,
      height: `${sourceRect.height}px`,
      pointerEvents: 'none',
      opacity: '0.85',
      background: 'rgba(59, 130, 246, 0.08)',
      border: '1.5px dashed rgba(59, 130, 246, 0.6)',
      borderRadius: '6px',
      zIndex: '9999'
    })
    ghostEl.dataset.priorityDragRow = String(row.id)
    document.body.appendChild(ghostEl)

    indicatorEl = document.createElement('div')
    document.body.appendChild(indicatorEl)
  }

  const startDrag = () => {
    if (!dragging) return
    isDragging.value = true
    const container = options.getContainer()
    // 收集当前渲染出来的数据行；虚拟滚动下只有可见行在 DOM 里。
    rowElements = container
      ? Array.from(container.querySelectorAll<HTMLElement>('tbody tr[data-row-id]')).filter(
          element => !element.hasAttribute('aria-hidden')
        )
      : []
    const source = rowElements.find(element => element.dataset.rowId === String(dragging!.id))
    if (source) createOverlay(dragging, source.getBoundingClientRect())
    dropIndex.value = findDropIndex(startY)
    positionIndicator()
  }

  const onPointerMove = (event: MouseEvent | TouchEvent) => {
    const point = 'touches' in event ? event.touches[0] : event
    if (!point) return
    // 阻止拖动过程中的页面滚动/文字选择
    if (isDragging.value && event.cancelable) event.preventDefault()

    if (!isDragging.value) {
      const deltaY = Math.abs(point.clientY - startY)
      const deltaX = Math.abs(point.clientX - startX)
      if (deltaY < DRAG_THRESHOLD && deltaX < DRAG_THRESHOLD) return
      if (deltaX > deltaY) {
        // 横向手势不归我们管，交回给原来的滑动多选。
        cleanup()
        return
      }
      startDrag()
      if (!isDragging.value) return
    }

    if (ghostEl) {
      ghostEl.style.transform = `translateY(${point.clientY - startY}px)`
    }
    dropIndex.value = findDropIndex(point.clientY)
    positionIndicator()
  }

  const onPointerUp = () => {
    const wasDragging = isDragging.value
    const targetIndex = dropIndex.value
    const moved = dragging
    const rows = options.getRows()
    const sourceIndex = moved ? rows.findIndex(row => row.id === moved.id) : -1

    cleanup()

    if (!wasDragging || !moved || sourceIndex < 0) return

    // dropIndex 是"插入到第几个之前"，删掉自己之后要修正下标。
    let insertIndex = targetIndex
    if (insertIndex > sourceIndex) insertIndex -= 1
    if (insertIndex === sourceIndex) return

    const order = [...rows]
    order.splice(sourceIndex, 1)
    order.splice(insertIndex, 0, moved)
    const previous = insertIndex > 0 ? order[insertIndex - 1] : null
    const next = insertIndex < order.length - 1 ? order[insertIndex + 1] : null

    void options.onDrop({ moved, order, previous, next })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') cleanup()
  }

  const preventSelection = (event: Event) => {
    if (isDragging.value || armed) event.preventDefault()
  }

  const start = (event: MouseEvent | TouchEvent, row: T) => {
    if ('button' in event && event.button !== 0) return
    const point = 'touches' in event ? event.touches[0] : event
    if (!point) return
    cleanup()
    dragging = row
    activeId.value = row.id
    startY = point.clientY
    startX = point.clientX
    armed = true

    // 用 passive:false 以允许 preventDefault，避免拖动时页面跟着滚动/选中文字。
    document.addEventListener('mousemove', onPointerMove, { passive: false })
    document.addEventListener('mouseup', onPointerUp)
    document.addEventListener('touchmove', onPointerMove, { passive: false })
    document.addEventListener('touchend', onPointerUp)
    document.addEventListener('touchcancel', onPointerUp)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('selectstart', preventSelection)
  }

  return { activeId, isDragging, start, cancel: cleanup }
}
