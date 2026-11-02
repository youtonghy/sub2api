import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BulkEditUserModal from '../BulkEditUserModal'

const { batchUpdateLimits, showSuccess, showError } = vi.hoisted(() => ({
  batchUpdateLimits: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    users: {
      batchUpdateLimits
    }
  }
}))

vi.mock('@/stores/app', () => ({
  useAppStore: { getState: () => ({ showSuccess, showError }) }
}))

const i18n = vi.hoisted(() => ({
  t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
  te: () => true,
  locale: 'en'
}))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

const mountModal = (selectedIds: number[] = [4, 7]) => {
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  const view = render(<BulkEditUserModal show selectedIds={selectedIds} onClose={onClose} onSuccess={onSuccess} />)
  const setSelectedIds = (ids: number[]) =>
    view.rerender(<BulkEditUserModal show selectedIds={ids} onClose={onClose} onSuccess={onSuccess} />)
  return { onClose, onSuccess, setSelectedIds }
}

// Vue 版用 data-test 查找 Toggle；React 版的 Toggle 是 Arc switch，按无障碍名称查找
const enableConcurrency = () => fireEvent.click(screen.getByRole('switch', { name: 'admin.users.bulkLimits.enableConcurrency' }))
const enableRPMLimit = () => fireEvent.click(screen.getByRole('switch', { name: 'admin.users.bulkLimits.enableRPMLimit' }))
const setInput = (test: string, value: string) =>
  fireEvent.change(document.body.querySelector(`[data-test="${test}"]`)!, { target: { value } })
const submitButton = () => document.body.querySelector('[data-test="submit"]') as HTMLButtonElement
const submitForm = () => fireEvent.submit(document.getElementById('bulk-edit-user-limits-form')!)

// Vue 版用原生 window.confirm()；React 版改用应用内 ConfirmDialog，按标题找到确认框后点击确认或取消，返回确认框中的消息
const answerConfirm = async (accept: boolean) => {
  const dialog = await screen.findByRole('dialog', { name: 'common.confirm' })
  const message = dialog.textContent ?? ''
  fireEvent.click(within(dialog).getByRole('button', { name: accept ? 'common.confirm' : 'common.cancel' }))
  await flushPromises()
  return message
}

describe('BulkEditUserModal', () => {
  beforeEach(() => {
    batchUpdateLimits.mockReset()
    showSuccess.mockReset()
    showError.mockReset()
    batchUpdateLimits.mockResolvedValue({ affected: 2 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    [{ message: 'Selected users are no longer available' }, 'Selected users are no longer available'],
    [{ response: { data: { message: 'Legacy message' } } }, 'Legacy message'],
    [{ response: { data: { detail: 'Legacy detail' } } }, 'Legacy detail'],
    [{}, 'admin.users.bulkLimits.failed']
  ])('shows API error details and allows retry after failure', async (error, expected) => {
    batchUpdateLimits.mockRejectedValueOnce(error)
    const { onClose, onSuccess } = mountModal()
    enableConcurrency()
    setInput('concurrency-input', '5')
    submitForm()
    await answerConfirm(true)

    expect(showError).toHaveBeenCalledWith(expected)
    expect(onClose).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(submitButton()).not.toBeDisabled()
  })

  it('disables submission until at least one enabled field has a value', () => {
    mountModal()

    expect(submitButton()).toBeDisabled()

    enableConcurrency()
    expect(submitButton()).toBeDisabled()

    setInput('concurrency-input', '5')
    expect(submitButton()).not.toBeDisabled()
  })

  it('disables submission when more than 500 users are selected', () => {
    const { setSelectedIds } = mountModal()
    setSelectedIds(Array.from({ length: 501 }, (_, index) => index + 1))
    enableConcurrency()
    setInput('concurrency-input', '5')

    expect(document.body.textContent).toContain('admin.users.bulkLimits.selectionLimit')
    expect(submitButton()).toBeDisabled()
  })

  it('submits only the enabled RPM field and preserves zero as unlimited', async () => {
    const { onSuccess } = mountModal()

    enableRPMLimit()
    setInput('rpm-limit-input', '0')
    expect(document.body.textContent).toContain('admin.users.bulkLimits.unlimited')
    submitForm()
    const confirmMessage = await answerConfirm(true)

    expect(batchUpdateLimits).toHaveBeenCalledWith({
      user_ids: [4, 7],
      all: false,
      rpm_limit: 0
    })
    expect(confirmMessage).toContain('admin.users.bulkLimits.rpmUnlimitedValue')
    expect(onSuccess.mock.calls).toEqual([[2]])
  })

  it('omits disabled fields from the request', async () => {
    mountModal()

    enableConcurrency()
    setInput('concurrency-input', '9')
    submitForm()
    await answerConfirm(true)

    expect(batchUpdateLimits).toHaveBeenCalledWith({
      user_ids: [4, 7],
      all: false,
      concurrency: 9
    })
  })

  it('does not call the API when overwrite confirmation is cancelled', async () => {
    mountModal()

    enableConcurrency()
    setInput('concurrency-input', '9')
    submitForm()
    await answerConfirm(false)

    expect(batchUpdateLimits).not.toHaveBeenCalled()
  })
})
