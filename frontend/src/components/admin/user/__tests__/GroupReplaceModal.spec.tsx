import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminGroup, AdminUser } from '@/types'
import GroupReplaceModal from '../GroupReplaceModal'

const mocks = vi.hoisted(() => ({ replaceGroup: vi.fn(), showError: vi.fn(), showSuccess: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { users: { replaceGroup: mocks.replaceGroup } } }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => mocks } }))
const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

afterEach(() => vi.restoreAllMocks())
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// Vue 版按 button.btn-primary 查找确认按钮，React 版按 data-testid 查找
const confirmButton = () => screen.getByTestId('group-replace-confirm')

function selectGroup() {
  const onSuccess = vi.fn()
  const onClose = vi.fn()
  render(
    <GroupReplaceModal
      show
      user={{ id: 10 } as AdminUser}
      oldGroup={{ id: 1, name: 'Old' }}
      allGroups={[{ id: 2, name: 'New', status: 'active', is_exclusive: true, subscription_type: 'standard' } as AdminGroup]}
      onSuccess={onSuccess}
      onClose={onClose}
    />
  )
  fireEvent.click(document.body.querySelector('input[type="radio"]')!)
  return { onSuccess, onClose }
}

describe('GroupReplaceModal feedback', () => {
  it.each([
    [{ message: 'Group is unavailable' }, 'Group is unavailable'],
    [{ response: { data: { detail: 'Permission denied' } } }, 'Permission denied'],
    [{}, 'common.error']
  ])('shows API errors and keeps the dialog available for retry', async (error, message) => {
    mocks.replaceGroup.mockRejectedValueOnce(error)
    const { onSuccess, onClose } = selectGroup()
    fireEvent.click(confirmButton())
    await flushPromises()
    expect(mocks.showError).toHaveBeenCalledWith(message)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(confirmButton()).not.toBeDisabled()
  })

  it('still reports successful migrations and closes', async () => {
    mocks.replaceGroup.mockResolvedValueOnce({ migrated_keys: 3 })
    const { onSuccess, onClose } = selectGroup()
    fireEvent.click(confirmButton())
    await flushPromises()
    expect(mocks.replaceGroup).toHaveBeenCalledWith(10, 1, 2)
    expect(mocks.showSuccess).toHaveBeenCalledWith('admin.users.replaceGroupSuccess')
    expect(mocks.showError).not.toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
