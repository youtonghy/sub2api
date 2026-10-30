import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminUser } from '@/types'
import UserAllowedGroupsModal from '../UserAllowedGroupsModal'

const mocks = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { groups: { list: mocks.list }, users: { update: mocks.update } } }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) } }))
const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))
vi.mock('@/components/common/PlatformIcon', () => ({ default: () => null }))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

afterEach(() => vi.restoreAllMocks())
const response = { items: [{ id: 7, name: 'Exclusive', platform: 'openai', is_exclusive: true, subscription_type: 'standard', status: 'active', rate_multiplier: 1 }] }
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.list.mockResolvedValue(response)
  mocks.update.mockResolvedValue(undefined)
})

const user = { id: 1, email: 'user@example.com', allowed_groups: [7], group_rates: { 7: 0.5 } } as unknown as AdminUser

function openDialog() {
  const onSuccess = vi.fn()
  const view = render(<UserAllowedGroupsModal show={false} user={user} onSuccess={onSuccess} />)
  view.rerender(<UserAllowedGroupsModal show user={user} onSuccess={onSuccess} />)
  const setShow = (show: boolean) => view.rerender(<UserAllowedGroupsModal show={show} user={user} onSuccess={onSuccess} />)
  return { onSuccess, setShow }
}

// Vue 版按 button.btn-primary 查找保存按钮，React 版按 data-testid 查找
const saveButton = () => screen.getByTestId('allowed-groups-save')

describe('UserAllowedGroupsModal load readiness', () => {
  it('cannot save an empty configuration while groups are loading', async () => {
    let resolve!: (value: typeof response) => void
    mocks.list.mockReturnValueOnce(new Promise((res) => { resolve = res }))
    openDialog()
    expect(saveButton()).toBeDisabled()
    fireEvent.click(saveButton())
    expect(mocks.update).not.toHaveBeenCalled()
    resolve(response)
    await flushPromises()
    expect(saveButton()).not.toBeDisabled()
  })

  it('cannot save after loading fails', async () => {
    mocks.list.mockRejectedValueOnce(new Error('Offline'))
    openDialog()
    await flushPromises()
    expect(saveButton()).toBeDisabled()
    fireEvent.click(saveButton())
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('does not reuse a previous successful load after reopening fails', async () => {
    const { setShow } = openDialog()
    await flushPromises()
    setShow(false)
    mocks.list.mockRejectedValueOnce(new Error('Offline'))
    setShow(true)
    await flushPromises()
    expect(saveButton()).toBeDisabled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('preserves existing grants and rates on a successful save', async () => {
    const { onSuccess } = openDialog()
    await flushPromises()
    fireEvent.click(saveButton())
    await flushPromises()
    expect(mocks.update).toHaveBeenCalledWith(1, { allowed_groups: [7], restrict_public_groups: false, group_rates: { 7: 0.5 } })
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })
})
