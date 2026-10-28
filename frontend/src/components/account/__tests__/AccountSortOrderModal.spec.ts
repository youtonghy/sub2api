import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AccountSortOrderModal from '../AccountSortOrderModal.vue'

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
  useAppStore: () => ({ showSuccess: vi.fn(), showError: vi.fn() })
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const accountRow = (id: number, priority: number, name = `account-${id}`) => ({
  id,
  name,
  platform: 'openai',
  priority,
  group_ids: [1]
})

const mountModal = () =>
  mount(AccountSortOrderModal, {
    props: { show: true },
    global: {
      stubs: {
        // BaseDialog 会 Teleport 到 body，测试里用同步渲染的壳替代。
        BaseDialog: {
          props: ['show'],
          template: '<div v-if="show"><slot /><slot name="footer" /></div>'
        },
        // 拖动库在 jsdom 里跑不起来，用能转发 v-model 的壳替代，由测试手动模拟拖动结果。
        VueDraggable: {
          name: 'VueDraggable',
          props: ['modelValue'],
          emits: ['update:modelValue', 'end'],
          template: '<div><slot /></div>'
        }
      }
    }
  })

beforeEach(() => {
  list.mockReset()
  updateSortOrder.mockReset().mockResolvedValue({ message: 'ok' })
  getAll.mockReset().mockResolvedValue([{ id: 1, name: 'group-a' }])
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

    const wrapper = mountModal()
    await flushPromises()

    const names = wrapper
      .findAll('[data-testid="account-sort-order-item"]')
      .map(node => node.text())
    expect(names).toHaveLength(3)
    expect(names[0]).toContain('account-3')
    // 同一优先级内用 id 兜底，保证顺序稳定
    expect(names[1]).toContain('account-1')
    expect(names[2]).toContain('account-2')
  })

  // 拖动库在 jsdom 里跑不起来：直接更新 v-model 再抛 end 事件，模拟一次真实拖放。
  const drag = async (
    wrapper: ReturnType<typeof mountModal>,
    items: Array<{ id: number; name: string; platform: string; priority: number; group_ids: number[] }>,
    oldIndex: number,
    newIndex: number
  ) => {
    const draggable = wrapper.findComponent({ name: 'VueDraggable' })
    draggable.vm.$emit('update:modelValue', items)
    await flushPromises()
    draggable.vm.$emit('end', { oldIndex, newIndex })
    await flushPromises()
  }

  it('derives the new priority from neighbours instead of renumbering everything', async () => {
    list.mockResolvedValue({
      items: [10, 20, 30].map((priority, index) => accountRow(index + 1, priority)),
      total: 3,
      page: 1,
      page_size: 1000
    })

    const wrapper = mountModal()
    await flushPromises()
    // #3（30）从末尾移到中间：新前邻居 10、新后邻居 20 → 取 15。
    await drag(
      wrapper,
      [accountRow(1, 10), accountRow(3, 30), accountRow(2, 20)],
      2,
      1
    )
    await wrapper.get('[data-testid="account-sort-order-save"]').trigger('click')
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

    const wrapper = mountModal()
    await flushPromises()
    // #3 拖到第一位：只有后邻居 10 → 取 9，其它账号不动。
    await drag(
      wrapper,
      [accountRow(3, 30), accountRow(1, 10), accountRow(2, 20)],
      2,
      0
    )
    await wrapper.get('[data-testid="account-sort-order-save"]').trigger('click')
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

    const wrapper = mountModal()
    await flushPromises()
    await drag(
      wrapper,
      [accountRow(3, 50), accountRow(1, 50), accountRow(2, 50)],
      2,
      0
    )
    await wrapper.get('[data-testid="account-sort-order-save"]').trigger('click')
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

    const wrapper = mountModal()
    await flushPromises()
    await drag(
      wrapper,
      [accountRow(1, 10), accountRow(3, 12), accountRow(2, 11)],
      2,
      1
    )
    await wrapper.get('[data-testid="account-sort-order-save"]').trigger('click')
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

    const wrapper = mountModal()
    await flushPromises()
    // 第一次：#3 → 10 与 20 之间 = 15
    await drag(wrapper, [accountRow(1, 10), accountRow(3, 30), accountRow(2, 20)], 2, 1)
    // 第二次：再把 #2 拖到最前（它的新后邻居是 10）→ 9
    await drag(wrapper, [accountRow(2, 20), accountRow(1, 10), accountRow(3, 30)], 2, 0)
    await wrapper.get('[data-testid="account-sort-order-save"]').trigger('click')
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
    expect(payload.find(update => update.id === 1)).toBeUndefined()
  })

  it('does not render priority numbers in the drag list', async () => {
    list.mockResolvedValue({
      items: [accountRow(5, 7, 'alpha'), accountRow(4, 9, 'beta')],
      total: 2,
      page: 1,
      page_size: 1000
    })

    const wrapper = mountModal()
    await flushPromises()

    const items = wrapper.findAll('[data-testid="account-sort-order-item"]')
    // 卡片上只显示账号信息，序号/优先级数字由位置隐式表达。
    expect(items[0].text()).not.toMatch(/\b7\b/)
    expect(items[0].text()).not.toMatch(/^1\s/)
    expect(items[0].text()).toContain('alpha')
    expect(items[1].text()).toContain('beta')
    expect(wrapper.find('[data-testid="account-sort-order-index"]').exists()).toBe(false)
  })

  it('skips the API call when the order is unchanged', async () => {
    list.mockResolvedValue({
      items: [accountRow(5, 1), accountRow(4, 2)],
      total: 2,
      page: 1,
      page_size: 1000
    })

    const wrapper = mountModal()
    await flushPromises()
    await wrapper.get('[data-testid="account-sort-order-save"]').trigger('click')
    await flushPromises()

    expect(updateSortOrder).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('shows the empty state instead of an empty drag list', async () => {
    list.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 1000 })

    const wrapper = mountModal()
    await flushPromises()

    expect(wrapper.find('[data-testid="account-sort-order-empty"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="account-sort-order-save"]').attributes('disabled')).toBeDefined()
  })
})
