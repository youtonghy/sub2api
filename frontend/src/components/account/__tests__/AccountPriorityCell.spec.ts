import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AccountPriorityCell from '../AccountPriorityCell.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

describe('AccountPriorityCell', () => {
  it('renders the usage rank', () => {
    const wrapper = mount(AccountPriorityCell, { props: { rank: 3 } })
    expect(wrapper.get('[data-testid="account-priority-rank"]').text()).toBe('3')
  })

  it('never renders the raw priority number', () => {
    // 组件只接收位次，签名上就没有 priority，避免数字泄回界面。
    const wrapper = mount(AccountPriorityCell, { props: { rank: 1 } })
    expect(wrapper.text()).toBe('1')
    expect(wrapper.props()).not.toHaveProperty('account')
  })

  it('exposes no manual editing controls', () => {
    const wrapper = mount(AccountPriorityCell, { props: { rank: 2 } })
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('follows rank changes pushed by the parent', async () => {
    const wrapper = mount(AccountPriorityCell, { props: { rank: 4 } })
    await wrapper.setProps({ rank: 9 })
    expect(wrapper.get('[data-testid="account-priority-rank"]').text()).toBe('9')
  })
})
