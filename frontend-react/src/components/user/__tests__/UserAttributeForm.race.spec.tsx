import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import UserAttributeForm from '../UserAttributeForm'

const mocks = vi.hoisted(() => ({ getUserAttributeValues: vi.fn(), listEnabledDefinitions: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { userAttributes: mocks } }))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listEnabledDefinitions.mockResolvedValue([{ id: 1, name: 'Team', type: 'text' }])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

function deferred() {
  let resolve!: (value: unknown) => void
  const promise = new Promise((res) => { resolve = res })
  return { promise, resolve }
}

function open(onChange = vi.fn()) {
  const view = render(<UserAttributeForm userId={1} value={{}} onChange={onChange} />)
  const setUserId = (userId: number | undefined) =>
    view.rerender(<UserAttributeForm userId={userId} value={{}} onChange={onChange} />)
  const input = () => view.container.querySelector('input') as HTMLInputElement
  return { onChange, setUserId, input }
}

describe('user attribute request ownership', () => {
  it('does not emit previous user values after a newer user has loaded', async () => {
    const old = deferred()
    mocks.getUserAttributeValues.mockReturnValueOnce(old.promise).mockResolvedValueOnce([{ attribute_id: 1, value: 'current' }])
    const w = open(); w.setUserId(2); await flushPromises()
    old.resolve([{ attribute_id: 1, value: 'old' }]); await flushPromises()
    expect(w.input().value).toBe('current')
    expect(w.onChange.mock.calls).toEqual([[{ 1: 'current' }]])
  })

  it('does not restore values after resetting to a new user', async () => {
    const old = deferred(); mocks.getUserAttributeValues.mockReturnValueOnce(old.promise)
    const w = open(); await flushPromises(); w.setUserId(undefined)
    old.resolve([{ attribute_id: 1, value: 'old' }]); await flushPromises()
    expect(w.input().value).toBe('')
    expect(w.onChange).not.toHaveBeenCalled()
  })

  it('clears the previous values before a new user request fails', async () => {
    mocks.getUserAttributeValues.mockResolvedValueOnce([{ attribute_id: 1, value: 'old' }]).mockRejectedValueOnce(new Error('unavailable'))
    const w = open(); await flushPromises(); w.setUserId(2); await flushPromises()
    expect(w.input().value).toBe('')
  })
})
