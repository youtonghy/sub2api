import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePriorityDrag } from '../usePriorityDrag'

type Row = { id: number; priority: number }

const rows: Row[] = [
  { id: 1, priority: 10 },
  { id: 2, priority: 20 },
  { id: 3, priority: 30 }
]

/** 构造假的表格容器：三行，每行 100px 高，从 y=0 开始。 */
const buildContainer = () => {
  const container = document.createElement('div')
  const tbody = document.createElement('tbody')
  rows.forEach((row, index) => {
    const tr = document.createElement('tr')
    tr.setAttribute('data-row-id', String(row.id))
    tr.setAttribute('data-index', String(index))
    tr.getBoundingClientRect = () =>
      ({ top: index * 100, bottom: index * 100 + 100, height: 100, left: 0, width: 600 }) as DOMRect
    tbody.appendChild(tr)
  })
  container.appendChild(tbody)
  container.getBoundingClientRect = () => ({ top: 0, bottom: 300, height: 300, left: 0, width: 600 }) as DOMRect
  document.body.appendChild(container)
  return container
}

const mouseMove = (clientY: number) =>
  document.dispatchEvent(new MouseEvent('mousemove', { clientY, clientX: 10, bubbles: true }))
const mouseUp = () => document.dispatchEvent(new MouseEvent('mouseup', { clientY: 0, clientX: 10, bubbles: true }))

describe('usePriorityDrag', () => {
  let container: HTMLDivElement
  let onDrop: ReturnType<typeof vi.fn>

  beforeEach(() => {
    document.body.innerHTML = ''
    container = buildContainer()
    onDrop = vi.fn()
  })

  const setup = () => {
    const drag = usePriorityDrag<Row>({
      getRows: () => rows,
      getContainer: () => container,
      onDrop
    })
    return drag
  }

  it('ignores movement below the drag threshold', () => {
    const drag = setup()
    drag.start(new MouseEvent('mousedown', { clientY: 10, clientX: 10, button: 0 }) as unknown as MouseEvent, rows[0])
    mouseMove(12)
    mouseUp()
    expect(drag.isDragging.value).toBe(false)
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('reports the new neighbours when a row is dragged down past the next row', () => {
    const drag = setup()
    drag.start(new MouseEvent('mousedown', { clientY: 10, clientX: 10, button: 0 }) as unknown as MouseEvent, rows[0])
    // 拖到第二行下半部分 → 插到第 2 行之后
    mouseMove(180)
    expect(drag.isDragging.value).toBe(true)
    mouseUp()

    expect(onDrop).toHaveBeenCalledTimes(1)
    const result = onDrop.mock.calls[0][0]
    expect(result.moved.id).toBe(1)
    expect(result.order.map((row: Row) => row.id)).toEqual([2, 1, 3])
    expect(result.previous?.id).toBe(2)
    expect(result.next?.id).toBe(3)
  })

  it('reports a null previous when dragged to the very top', () => {
    const drag = setup()
    drag.start(new MouseEvent('mousedown', { clientY: 210, clientX: 10, button: 0 }) as unknown as MouseEvent, rows[2])
    mouseMove(5)
    mouseUp()

    expect(onDrop).toHaveBeenCalledTimes(1)
    const result = onDrop.mock.calls[0][0]
    expect(result.order.map((row: Row) => row.id)).toEqual([3, 1, 2])
    expect(result.previous).toBeNull()
    expect(result.next?.id).toBe(1)
  })

  it('reports a null next when dragged to the very bottom', () => {
    const drag = setup()
    drag.start(new MouseEvent('mousedown', { clientY: 10, clientX: 10, button: 0 }) as unknown as MouseEvent, rows[0])
    mouseMove(295)
    mouseUp()

    const result = onDrop.mock.calls[0][0]
    expect(result.order.map((row: Row) => row.id)).toEqual([2, 3, 1])
    expect(result.next).toBeNull()
    expect(result.previous?.id).toBe(3)
  })

  it('does not call onDrop when the row lands back where it started', () => {
    const drag = setup()
    drag.start(new MouseEvent('mousedown', { clientY: 10, clientX: 10, button: 0 }) as unknown as MouseEvent, rows[1])
    mouseMove(110)
    mouseUp()
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('bails out when the gesture is mostly horizontal', () => {
    const drag = setup()
    drag.start(new MouseEvent('mousedown', { clientY: 10, clientX: 10, button: 0 }) as unknown as MouseEvent, rows[0])
    mouseMove(10)
    document.dispatchEvent(new MouseEvent('mousemove', { clientY: 12, clientX: 80, bubbles: true }))
    mouseUp()
    expect(drag.isDragging.value).toBe(false)
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('cleans up its overlays after a drop', () => {
    const drag = setup()
    drag.start(new MouseEvent('mousedown', { clientY: 10, clientX: 10, button: 0 }) as unknown as MouseEvent, rows[0])
    mouseMove(180)
    expect(document.body.querySelector('[data-priority-drag-row]')).not.toBeNull()
    mouseUp()
    expect(document.body.querySelector('[data-priority-drag-row]')).toBeNull()
    expect(drag.activeId.value).toBeNull()
  })
})
