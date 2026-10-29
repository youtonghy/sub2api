import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AccountSortOrderModal from '../AccountSortOrderModal'

const list = vi.fn()
const updateSortOrder = vi.fn()
const getAll = vi.fn()

vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      list: (...args: unknown[]) => list(...args),
      updateSortOrder: (...args: unknown[]) => updateSortOrder(...args)
    },
    groups: { getAll: (...args: unknown[]) => getAll(...args) }
  }
}))

vi.mock('@/stores/app', () => ({
  useAppStore: { getState: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }
}))

const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

// 拖动库在 jsdom 里跑不起来：用透传子元素的壳替代 DndContext，记下 onDragEnd，由测试手动模拟拖放结果。
const dnd = vi.hoisted(() => ({ onDragEnd: null as null | ((event: unknown) => void) }))
vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core')
  return {
    ...actual,
    DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd: (event: unknown) => void }) => {
      dnd.onDragEnd = onDragEnd
      return <>{children}</>
    }
  }
})

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

const accountRow = (id: number, priority: number, name = `account-${id}`) => ({
  id,
  name,
  platform: 'openai',
  priority,
  group_ids: [1]
})

const items = () => screen.queryAllByTestId('account-sort-order-item')
const saveButton = () => screen.getByTestId('account-sort-order-save')

const mountModal = (onClose = vi.fn()) => render(<AccountSortOrderModal show onClose={onClose} />)

// Vue 版直接改写 v-model 再抛 end 事件；这里按当前顺序取出被拖账号与落点账号，调用 onDragEnd。
// 组件内部用 arrayMove 得到的新顺序与 Vue 测试传入的列表一致。
const drag = async (oldIndex: number, newIndex: number) => {
  const ids = items().map((node) => Number(node.getAttribute('data-account-id')))
  act(() => dnd.onDragEnd?.({ active: { id: ids[oldIndex] }, over: { id: ids[newIndex] } }))
  await flushPromises()
}

beforeEach(() => {
  list.mockReset()
  updateSortOrder.mockReset().mockResolvedValue({ message: 'ok' })
  getAll.mockReset().mockResolvedValue([{ id: 1, name: 'group-a' }])
  dnd.onDragEnd = null
})

describe('AccountSortOrderModal', () => {
  it('renders every account in global priority order', async () => {
    // 服务端按 priority 升序返回，弹窗需要保持这份全局顺序。
    list.mockResolvedValue({
      items: [accountRow(3, 1), accountRow(1, 2), accountRow(2, 2)],
      total: 3,
      page: 1,
      page_size: 1000
    })

    mountModal()
    await flushPromises()

    const names = items().map((node) => node.textContent ?? '')
    expect(names).toHaveLength(3)
    expect(names[0]).toContain('account-3')
    // 同一优先级内用 id 兜底，保证顺序稳定
    expect(names[1]).toContain('account-1')
    expect(names[2]).toContain('account-2')
  })

  it('derives the new priority from neighbours instead of renumbering everything', async () => {
    list.mockResolvedValue({
      items: [10, 20, 30].map((priority, index) => accountRow(index + 1, priority)),
      total: 3,
      page: 1,
      page_size: 1000
    })

    mountModal()
    await flushPromises()
    // #3（30）从末尾移到中间：新前邻居 10、新后邻居 20 → 取 15。
    await drag(2, 1)
    fireEvent.click(saveButton())
    await flushPromises()

    expect(updateSortOrder).toHaveBeenCalledTimes(1)
    expect(updateSortOrder).toHaveBeenCalledWith([{ id: 3, priority: 15 }])
  })

  it('uses one step below the new next neighbour when dragged to the top', async () => {
    list.mockResolvedValue({
      items: [10, 20, 30].map((priority, index) => accountRow(index + 1, priority)),
      total: 3,
      page: 1,
      page_size: 1000
    })

    mountModal()
    await flushPromises()
    // #3 拖到第一位：只有后邻居 10 → 取 9，其它账号不动。
    await drag(2, 0)
    fireEvent.click(saveButton())
    await flushPromises()

    expect(updateSortOrder).toHaveBeenCalledTimes(1)
    expect(updateSortOrder).toHaveBeenCalledWith([{ id: 3, priority: 9 }])
  })

  it('takes one slot above the next neighbour even when everything shares one priority', async () => {
    // 全部账号都是默认优先级 50：拖到第一位只需取 49，不需要整体重编号。
    list.mockResolvedValue({
      items: [50, 50, 50].map((priority, index) => accountRow(index + 1, priority)),
      total: 3,
      page: 1,
      page_size: 1000
    })

    mountModal()
    await flushPromises()
    await drag(2, 0)
    fireEvent.click(saveButton())
    await flushPromises()

    expect(updateSortOrder).toHaveBeenCalledTimes(1)
    expect(updateSortOrder).toHaveBeenCalledWith([{ id: 3, priority: 49 }])
  })

  it('falls back to renumbering when neighbours have no free integer slot', async () => {
    // 邻居 10 / 11 之间没有整数空位 → 只能整体按位置重编号。
    list.mockResolvedValue({
      items: [10, 11, 12].map((priority, index) => accountRow(index + 1, priority)),
      total: 3,
      page: 1,
      page_size: 1000
    })

    mountModal()
    await flushPromises()
    await drag(2, 1)
    fireEvent.click(saveButton())
    await flushPromises()

    expect(updateSortOrder).toHaveBeenCalledTimes(1)
    expect(updateSortOrder).toHaveBeenCalledWith([
      { id: 1, priority: 1 },
      { id: 3, priority: 2 },
      { id: 2, priority: 3 }
    ])
  })

  it('accumulates consecutive drags instead of recomputing from the original order', async () => {
    list.mockResolvedValue({
      items: [10, 20, 30].map((priority, index) => accountRow(index + 1, priority)),
      total: 3,
      page: 1,
      page_size: 1000
    })

    mountModal()
    await flushPromises()
    // 第一次：#3 → 10 与 20 之间 = 15（顺序变为 1, 3, 2）
    await drag(2, 1)
    // 第二次：再把 #2 拖到最前（它的新后邻居是 10）→ 9
    await drag(2, 0)
    fireEvent.click(saveButton())
    await flushPromises()

    expect(updateSortOrder).toHaveBeenCalledTimes(1)
    const payload = updateSortOrder.mock.calls[0][0] as Array<{ id: number; priority: number }>
    expect(payload).toEqual(
      expect.arrayContaining([
        { id: 3, priority: 15 },
        { id: 2, priority: 9 }
      ])
    )
    // 未被拖动的 #1 保持原优先级 10，不参与重写。
    expect(payload.find((update) => update.id === 1)).toBeUndefined()
  })

  it('does not render priority numbers in the drag list', async () => {
    list.mockResolvedValue({
      items: [accountRow(5, 7, 'alpha'), accountRow(4, 9, 'beta')],
      total: 2,
      page: 1,
      page_size: 1000
    })

    mountModal()
    await flushPromises()

    const rendered = items()
    // 卡片上只显示账号信息，序号/优先级数字由位置隐式表达。
    expect(rendered[0].textContent).not.toMatch(/\b7\b/)
    expect(rendered[0].textContent).not.toMatch(/^1\s/)
    expect(rendered[0].textContent).toContain('alpha')
    expect(rendered[1].textContent).toContain('beta')
    expect(screen.queryByTestId('account-sort-order-index')).toBeNull()
  })

  it('skips the API call when the order is unchanged', async () => {
    list.mockResolvedValue({
      items: [accountRow(5, 1), accountRow(4, 2)],
      total: 2,
      page: 1,
      page_size: 1000
    })

    const onClose = vi.fn()
    mountModal(onClose)
    await flushPromises()
    fireEvent.click(saveButton())
    await flushPromises()

    expect(updateSortOrder).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the empty state instead of an empty drag list', async () => {
    list.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 1000 })

    mountModal()
    await flushPromises()

    expect(screen.getByTestId('account-sort-order-empty')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })
})
