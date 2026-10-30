import { act, fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import UserEditModal from '../UserEditModal'

const { update, updateUserAttributeValues, showSuccess, showError } = vi.hoisted(() => ({
  update: vi.fn(),
  updateUserAttributeValues: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    users: { update },
    userAttributes: { updateUserAttributeValues }
  }
}))

vi.mock('@/stores/app', () => ({
  useAppStore: { getState: () => ({ showSuccess, showError }) }
}))

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({ copyToClipboard: vi.fn() })
}))

const i18n = vi.hoisted(() => ({
  t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
  te: () => true,
  locale: 'en'
}))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

// Vue 版 stubs: Select / Icon / UserAttributeForm / TotpStepUpDialog
vi.mock('@/components/user/UserAttributeForm', () => ({ default: () => null }))
vi.mock('@/components/auth/TotpStepUpDialog', () => ({ default: () => null }))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

const mountModal = (concurrency: number) => {
  const onSuccess = vi.fn()
  render(
    <UserEditModal
      show
      user={{ id: 7, email: 'user@example.test', username: 'user', notes: '', role: 'user', concurrency, rpm_limit: 0 } as never}
      onSuccess={onSuccess}
    />
  )
  return { onSuccess }
}

const submitForm = () => fireEvent.submit(document.getElementById('edit-user-form')!)

describe('UserEditModal concurrency', () => {
  beforeEach(() => {
    update.mockReset()
    updateUserAttributeValues.mockReset()
    showSuccess.mockReset()
    showError.mockReset()
    update.mockResolvedValue({})
  })

  // Regression coverage for issue #5977: the gateway treats concurrency <= 0 as
  // unlimited (AcquireUserSlot) and both the batch limits endpoint and the bulk
  // edit modal accept 0, so this dialog must not be the only place that rejects
  // it — doing so blocked every other edit on such a user.
  it('saves an unlimited (0) concurrency instead of blocking the whole form', async () => {
    const { onSuccess } = mountModal(0)

    submitForm()
    await flushPromises()

    expect(showError).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(7, expect.objectContaining({ concurrency: 0 }))
    expect(onSuccess).toHaveBeenCalled()
  })

  it('still rejects a negative concurrency', async () => {
    mountModal(3)

    fireEvent.change(document.body.querySelector('[data-test="concurrency-input"]')!, { target: { value: '-1' } })
    submitForm()
    await flushPromises()

    expect(showError).toHaveBeenCalledWith('admin.users.concurrencyNonNegative')
    expect(update).not.toHaveBeenCalled()
  })
})
