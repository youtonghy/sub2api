import { act, fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import UserAttributeForm from '../UserAttributeForm'

const mocks = vi.hoisted(() => ({ listEnabledDefinitions: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { userAttributes: mocks } }))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

beforeEach(() => {
  mocks.listEnabledDefinitions.mockResolvedValue([
    { id: 1, name: 'Count', type: 'number', validation: { min: -10, max: 100 } },
    { id: 2, name: 'Note', type: 'text' }
  ])
})

// Vue 版断言 emitted('update:modelValue')，React 版断言 onChange 的调用
describe('UserAttributeForm numeric values', () => {
  it.each(['42', '0', '-3'])('emits %s as a string accepted by the values API', async (value) => {
    const onChange = vi.fn()
    const { container } = render(<UserAttributeForm value={{}} onChange={onChange} />)
    await flushPromises()
    fireEvent.change(container.querySelector('input[type="text"]')!, { target: { value: 'keep me' } })
    fireEvent.change(container.querySelector('input[type="number"]')!, { target: { value } })
    const emitted = onChange.mock.calls.at(-1)![0]
    expect(JSON.parse(JSON.stringify(emitted))).toEqual({ 1: value, 2: 'keep me' })
  })

  it('emits an empty string when the number is cleared', async () => {
    const onChange = vi.fn()
    const { container } = render(<UserAttributeForm value={{}} onChange={onChange} />)
    await flushPromises()
    const input = container.querySelector('input[type="number"]')!
    fireEvent.change(input, { target: { value: '42' } })
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange.mock.calls.at(-1)).toEqual([{ 1: '' }])
    expect(input.getAttribute('min')).toBe('-10')
    expect(input.getAttribute('max')).toBe('100')
    expect(input.getAttribute('type')).toBe('number')
  })
})
