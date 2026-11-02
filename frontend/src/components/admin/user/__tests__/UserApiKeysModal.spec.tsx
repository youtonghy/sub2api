import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminUser } from '@/types'
import UserApiKeysModal from '../UserApiKeysModal'

const { getKeys } = vi.hoisted(() => ({ getKeys: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: {
  users: { getUserApiKeys: getKeys }, groups: { getAll: vi.fn().mockResolvedValue([]) }
} }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showError: vi.fn(), showSuccess: vi.fn() }) } }))
vi.mock('@/utils/format', () => ({ formatDateTime: (value: string) => value }))
const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))
vi.mock('@/components/common/GroupBadge', () => ({ default: () => null }))
vi.mock('@/components/common/GroupOptionItem', () => ({ default: () => null }))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

beforeEach(() => { getKeys.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())

function deferred() {
  let resolve!: (value: unknown) => void
  let reject!: (error: Error) => void
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const user = (id: number) => ({ id, email: `user${id}@example.com`, username: `user${id}` }) as AdminUser
const keys = (id: number, name: string) => ({ items: [{ id, name, key: 'sk-example-key-value-for-tests', status: 'active', created_at: '2026-09-20', group_id: null }] })

function open() {
  const view = render(<UserApiKeysModal show={false} user={user(1)} />)
  view.rerender(<UserApiKeysModal show user={user(1)} />)
  const setProps = (show: boolean, next: AdminUser) => view.rerender(<UserApiKeysModal show={show} user={next} />)
  return { setProps }
}
function switchUser(wrapper: ReturnType<typeof open>) {
  wrapper.setProps(false, user(1))
  wrapper.setProps(true, user(2))
}
const text = () => document.body.textContent ?? ''
// Vue 版断言 .animate-spin，React 版断言加载占位
const isLoading = () => screen.queryByTestId('api-keys-loading') !== null

describe('user API key loading', () => {
  it('does not display the previous user keys when the next load fails', async () => {
    getKeys.mockResolvedValueOnce(keys(1, 'first-user-key')).mockRejectedValueOnce(new Error('unavailable'))
    const wrapper = open(); await flushPromises()
    expect(text()).toContain('first-user-key')
    switchUser(wrapper); await flushPromises()
    expect(text()).toContain('user2@example.com')
    expect(text()).not.toContain('first-user-key')
  })

  it('does not replace current keys with a late previous response', async () => {
    const old = deferred()
    getKeys.mockReturnValueOnce(old.promise).mockResolvedValueOnce(keys(2, 'current-user-key'))
    const wrapper = open()
    switchUser(wrapper); await flushPromises()
    old.resolve(keys(1, 'old-user-key')); await flushPromises()
    expect(text()).toContain('current-user-key')
    expect(text()).not.toContain('old-user-key')
  })

  it('keeps the current request loading when an obsolete request fails', async () => {
    const old = deferred(); const current = deferred()
    getKeys.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const wrapper = open()
    switchUser(wrapper)
    old.reject(new Error('obsolete')); await flushPromises()
    expect(isLoading()).toBe(true)
    current.resolve(keys(2, 'current-user-key')); await flushPromises()
    expect(text()).toContain('current-user-key')
    expect(isLoading()).toBe(false)
  })

  it('loads keys when the selected user changes while the dialog is open', async () => {
    getKeys.mockResolvedValueOnce(keys(1, 'first-user-key')).mockResolvedValueOnce(keys(2, 'second-user-key'))
    const wrapper = open(); await flushPromises()
    wrapper.setProps(true, user(2)); await flushPromises()
    expect(getKeys).toHaveBeenLastCalledWith(2)
    expect(text()).toContain('second-user-key')
    expect(text()).not.toContain('first-user-key')
  })
})
