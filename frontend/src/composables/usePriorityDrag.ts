import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

/**
 * 账号表格行内拖动排序，对应 Vue 版 composables/usePriorityDrag.ts。
 *
 * 只有按住拖拽把手才会进入拖动，按住行其它地方仍然是表格原有的滑动多选
 * （useSwipeSelect）——两者互不抢占。
 *
 * 拖动期间：
 *  - 被拖动的行跟随指针浮起（视觉反馈）
 *  - 目标插入位置显示一条指示线
 *  - 松手后按"新前后邻居"的优先级算出新值（见 utils/accountPriorityOrder）
 *
 * 与 Vue 版的差异：逻辑放在与框架无关的 createPriorityDrag 中（可直接单测），
 * Vue 版的 activeId.value / isDragging.value 变为 getActiveId() / isDragging()；
 * Hook 版额外返回渲染期快照 activeId，供把手高亮使用。
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

export function createPriorityDrag<T extends PriorityDragRow>(options: UsePriorityDragOptions<T>) {
  let activeId: number | null = null
  let dropIndex = -1
  let dragActive = false

  let startY = 0
  let startX = 0
  let rowElements: HTMLElement[] = []
  let dragging: T | null = null
  let ghostEl: HTMLElement | null = null
  let indicatorEl: HTMLElement | null = null
  let armed = false
  const listeners = new Set<() => void>()

  const notify = () => listeners.forEach((listener) => listener())

  const setActiveId = (next: number | null) => {
    if (activeId === next) return
    activeId = next
    notify()
  }

  const setDragActive = (next: boolean) => {
    if (dragActive === next) return
    dragActive = next
    notify()
  }

  const preventSelection = (event: Event) => {
    if (dragActive || armed) event.preventDefault()
  }

  const cleanup = () => {
    document.removeEventListener('mousemove', onPointerMove)
    document.removeEventListener('mouseup', onPointerUp)
    document.removeEventListener('touchmove', onPointerMove)
    document.removeEventListener('touchend', onPointerUp)
    document.removeEventListener('touchcancel', onPointerUp)
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('selectstart', preventSelection)
    ghostEl?.remove()
    ghostEl = null
    indicatorEl?.remove()
    indicatorEl = null
    dropIndex = -1
    dragging = null
    rowElements = []
    armed = false
    setActiveId(null)
    setDragActive(false)
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
      dropIndex >= rowElements.length
        ? rowElements[rowElements.length - 1].getBoundingClientRect()
        : rowElements[dropIndex].getBoundingClientRect()
    const top = dropIndex >= rowElements.length ? referenceRect.bottom : referenceRect.top
    Object.assign(indicatorEl.style, {
      position: 'fixed',
      left: `${containerRect.left}px`,
      width: `${containerRect.width}px`,
      top: `${top - 1}px`,
      height: '2px',
      background: 'var(--accent)',
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
      background: 'var(--accent-subtle)',
      border: '1.5px dashed var(--accent)',
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
    setDragActive(true)
    const container = options.getContainer()
    // 收集当前渲染出来的数据行；虚拟滚动下只有可见行在 DOM 里。
    rowElements = container
      ? Array.from(container.querySelectorAll<HTMLElement>('tbody tr[data-row-id]')).filter(
          (element) => !element.hasAttribute('aria-hidden')
        )
      : []
    const current = dragging
    const source = rowElements.find((element) => element.dataset.rowId === String(current.id))
    if (source) createOverlay(current, source.getBoundingClientRect())
    dropIndex = findDropIndex(startY)
    positionIndicator()
  }

  function onPointerMove(event: MouseEvent | TouchEvent) {
    const point = 'touches' in event ? event.touches[0] : event
    if (!point) return
    // 阻止拖动过程中的页面滚动/文字选择
    if (dragActive && event.cancelable) event.preventDefault()

    if (!dragActive) {
      const deltaY = Math.abs(point.clientY - startY)
      const deltaX = Math.abs(point.clientX - startX)
      if (deltaY < DRAG_THRESHOLD && deltaX < DRAG_THRESHOLD) return
      if (deltaX > deltaY) {
        // 横向手势不归我们管，交回给原来的滑动多选。
        cleanup()
        return
      }
      startDrag()
      if (!dragActive) return
    }

    if (ghostEl) {
      ghostEl.style.transform = `translateY(${point.clientY - startY}px)`
    }
    dropIndex = findDropIndex(point.clientY)
    positionIndicator()
  }

  function onPointerUp() {
    const wasDragging = dragActive
    const targetIndex = dropIndex
    const moved = dragging
    const rows = options.getRows()
    const sourceIndex = moved ? rows.findIndex((row) => row.id === moved.id) : -1

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

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') cleanup()
  }

  const start = (event: MouseEvent | TouchEvent, row: T) => {
    if ('button' in event && event.button !== 0) return
    const point = 'touches' in event ? event.touches[0] : event
    if (!point) return
    cleanup()
    dragging = row
    setActiveId(row.id)
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

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  return {
    getActiveId: () => activeId,
    isDragging: () => dragActive,
    subscribe,
    start,
    cancel: cleanup
  }
}

export type PriorityDragController<T extends PriorityDragRow> = ReturnType<typeof createPriorityDrag<T>>

/** Hook 版：选项每次渲染更新（读最新行），卸载时清理进行中的拖动 */
export function usePriorityDrag<T extends PriorityDragRow>(options: UsePriorityDragOptions<T>) {
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  // 闭包只在指针事件中读取 optionsRef，不在渲染期间
  // eslint-disable-next-line react-hooks/refs
  const [controller] = useState(() =>
    createPriorityDrag<T>({
      getRows: () => optionsRef.current.getRows(),
      getContainer: () => optionsRef.current.getContainer(),
      onDrop: (result) => optionsRef.current.onDrop(result)
    })
  )

  useEffect(() => () => controller.cancel(), [controller])

  const activeId = useSyncExternalStore(controller.subscribe, controller.getActiveId, controller.getActiveId)
  return { ...controller, activeId }
}
