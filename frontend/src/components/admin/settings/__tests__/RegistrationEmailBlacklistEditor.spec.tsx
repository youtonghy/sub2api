import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RegistrationEmailBlacklistEditor from '../RegistrationEmailBlacklistEditor'

const mocks = vi.hoisted(() => ({
  getBlacklist: vi.fn(),
  updateBlacklist: vi.fn(),
  findUsers: vi.fn(),
  batchDisable: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn()
}))

vi.mock('@/api', () => ({
  adminAPI: {
    settings: {
      getRegistrationEmailBlacklist: mocks.getBlacklist,
      updateRegistrationEmailBlacklist: mocks.updateBlacklist
    },
    users: {
      findBlacklistedEmailUsers: mocks.findUsers,
      batchDisable: mocks.batchDisable
    }
  }
}))

vi.mock('@/i18n/useI18n', () => {
  const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key)
  return { useI18n: () => ({ t, te: () => true, locale: 'en', setLocale: vi.fn() }) }
})

vi.mock('@/stores', () => ({
  useAppStore: {
    getState: () => ({ showSuccess: mocks.showSuccess, showError: mocks.showError, showInfo: mocks.showInfo })
  }
}))

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
const byTest = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
const allByTest = (id: string) => document.querySelectorAll(`[data-testid="${id}"]`)
const buttonByText = (label: string) =>
  Array.from(document.querySelectorAll('button')).find((button) => button.textContent === label)
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy()
  await act(async () => { fireEvent.click(el!) })
  await flush()
}
const type = async (el: Element | null, value: string) => {
  expect(el).toBeTruthy()
  await act(async () => { fireEvent.change(el!, { target: { value } }) })
}
const mountEditor = async () => {
  render(<RegistrationEmailBlacklistEditor />)
  await flush()
}
const addBulk = async (value: string) => {
  await type(byTest('email-blacklist-bulk-input'), value)
  await click(byTest('email-blacklist-bulk-add'))
}

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getBlacklist.mockResolvedValue({ emails: ['old@gmail.com'], max: 20000 })
  mocks.findUsers.mockResolvedValue({ items: [], total: 0 })
  mocks.batchDisable.mockResolvedValue({ affected: 0 })
})

describe('RegistrationEmailBlacklistEditor', () => {
  it('批量添加后保存整份名单，并对新增项命中的用户弹窗确认禁用', async () => {
    mocks.updateBlacklist.mockResolvedValue({
      emails: ['new.one@gmail.com', 'new2@googlemail.com', 'old@gmail.com'],
      added: ['new.one@gmail.com', 'new2@googlemail.com'],
      max: 20000
    })
    mocks.findUsers.mockResolvedValue({ items: [{ id: 11, email: 'newone@gmail.com', username: 'n1' }], total: 1 })
    mocks.batchDisable.mockResolvedValue({ affected: 1 })

    await mountEditor()
    expect(byTest('email-blacklist-summary')).toHaveTextContent('"count":"1"')

    await click(byTest('email-blacklist-edit'))
    await addBulk('New.One@gmail.com, new2@googlemail.com\nold@gmail.com\nnew.one@gmail.com\nnot-an-email')

    expect(byTest('email-blacklist-add-result')).toHaveTextContent('"added":"2","duplicates":"2"')
    expect(byTest('email-blacklist-invalid')).toHaveTextContent('not-an-email')
    expect(allByTest('email-blacklist-row')).toHaveLength(3)
    expect((byTest('email-blacklist-bulk-input') as HTMLTextAreaElement).value).toBe('not-an-email')

    await click(byTest('email-blacklist-save'))

    expect(mocks.updateBlacklist).toHaveBeenCalledWith(['new.one@gmail.com', 'new2@googlemail.com', 'old@gmail.com'])
    expect(mocks.findUsers).toHaveBeenCalledWith(['new.one@gmail.com', 'new2@googlemail.com'])
    expect(byTest('email-blacklist-matched-users')).toHaveTextContent('newone@gmail.com')

    await click(byTest('email-blacklist-disable-confirm'))
    expect(mocks.batchDisable).toHaveBeenCalledWith([11])
    expect(mocks.showSuccess).toHaveBeenLastCalledWith('admin.settings.registration.emailBlacklist.disabled:{"count":"1"}')
    await waitFor(() => expect(byTest('email-blacklist-matched-users')).toBeNull())
  })

  it('保存后没有新增项时不查询用户，没有命中时也不弹窗', async () => {
    mocks.updateBlacklist.mockResolvedValue({ emails: [], added: [], max: 20000 })

    await mountEditor()
    await click(byTest('email-blacklist-edit'))
    await click(byTest('email-blacklist-clear'))
    expect(byTest('email-blacklist-pending')).toHaveTextContent('"removed":"1"')

    await click(byTest('email-blacklist-save'))
    expect(mocks.updateBlacklist).toHaveBeenCalledWith([])
    expect(mocks.findUsers).not.toHaveBeenCalled()
    expect(mocks.showInfo).not.toHaveBeenCalled()
  })

  it('手动检查已注册用户覆盖整份已保存名单，无命中时提示', async () => {
    await mountEditor()
    await click(byTest('email-blacklist-check'))

    expect(mocks.findUsers).toHaveBeenCalledWith(['old@gmail.com'])
    expect(mocks.showInfo).toHaveBeenCalledWith('admin.settings.registration.emailBlacklist.noActiveMatches')
    expect(byTest('email-blacklist-matched-users')).toBeNull()
  })

  it('未改动时保存按钮不可用，保存失败时保留弹窗并提示错误', async () => {
    mocks.updateBlacklist.mockRejectedValue({ message: 'invalid email address (1): broken' })

    await mountEditor()
    await click(byTest('email-blacklist-edit'))
    expect(byTest('email-blacklist-save')).toBeDisabled()

    await addBulk('fresh@gmail.com')
    await click(byTest('email-blacklist-save'))

    expect(mocks.showError).toHaveBeenCalledWith('invalid email address (1): broken')
    expect(byTest('email-blacklist-save')).not.toBeNull()
    expect(mocks.findUsers).not.toHaveBeenCalled()
  })

  it('有未保存改动时关闭先确认，放弃后草稿丢弃，继续编辑则保留', async () => {
    await mountEditor()
    await click(byTest('email-blacklist-edit'))
    await addBulk('draft@gmail.com')

    await click(buttonByText('common.cancel'))
    expect(document.body.textContent).toContain('admin.settings.registration.emailBlacklist.discardTitle')

    await click(buttonByText('admin.settings.registration.emailBlacklist.discardCancel'))
    expect(allByTest('email-blacklist-row')).toHaveLength(2)

    await click(buttonByText('common.cancel'))
    await click(buttonByText('admin.settings.registration.emailBlacklist.discardConfirm'))
    await waitFor(() => expect(byTest('email-blacklist-bulk-input')).toBeNull())
    expect(mocks.updateBlacklist).not.toHaveBeenCalled()
  })

  it('保存后核查新增项期间编辑入口不可用，核查结束后可正常打开和关闭', async () => {
    let resolveFind: (value: { items: never[]; total: number }) => void = () => {}
    mocks.findUsers.mockReturnValue(new Promise((resolve) => { resolveFind = resolve }))
    mocks.updateBlacklist.mockResolvedValue({ emails: ['x@gmail.com', 'old@gmail.com'], added: ['x@gmail.com'], max: 20000 })

    await mountEditor()
    await click(byTest('email-blacklist-edit'))
    await addBulk('x@gmail.com')
    await click(byTest('email-blacklist-save'))

    expect(byTest('email-blacklist-edit')).toBeDisabled()
    await act(async () => { resolveFind({ items: [], total: 0 }) })
    await flush()
    expect(byTest('email-blacklist-edit')).not.toBeDisabled()
    await waitFor(() => expect(byTest('email-blacklist-bulk-input')).toBeNull())

    await click(byTest('email-blacklist-edit'))
    const cancel = buttonByText('common.cancel')!
    expect(cancel).not.toBeDisabled()
    await click(cancel)
    await waitFor(() => expect(byTest('email-blacklist-bulk-input')).toBeNull())
  })

  it('命中用户超过单批上限时分批禁用并汇总人数', async () => {
    const users = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, email: `u${i}@gmail.com`, username: '' }))
    mocks.findUsers.mockResolvedValue({ items: users, total: users.length })
    mocks.batchDisable.mockImplementation(async (ids: number[]) => ({ affected: ids.length }))

    await mountEditor()
    await click(byTest('email-blacklist-check'))
    await click(byTest('email-blacklist-disable-confirm'))

    expect(mocks.batchDisable).toHaveBeenCalledTimes(2)
    expect(mocks.batchDisable.mock.calls[0]![0]).toHaveLength(1000)
    expect(mocks.batchDisable.mock.calls[1]![0]).toEqual([1001])
    expect(mocks.showSuccess).toHaveBeenLastCalledWith('admin.settings.registration.emailBlacklist.disabled:{"count":"1,001"}')
  })

  it('分批禁用中途失败时只保留未提交的用户，重试从断点继续', async () => {
    const users = Array.from({ length: 1500 }, (_, i) => ({ id: i + 1, email: `u${i}@gmail.com`, username: '' }))
    mocks.findUsers.mockResolvedValue({ items: users, total: users.length })
    mocks.batchDisable
      .mockResolvedValueOnce({ affected: 1000 })
      .mockRejectedValueOnce({ message: 'timeout' })
      .mockResolvedValueOnce({ affected: 500 })

    await mountEditor()
    await click(byTest('email-blacklist-check'))
    await click(byTest('email-blacklist-disable-confirm'))

    expect(mocks.showError).toHaveBeenCalledWith('timeout')
    expect(document.querySelectorAll('[data-testid="email-blacklist-matched-users"] li')).toHaveLength(500)

    await click(byTest('email-blacklist-disable-confirm'))
    expect(mocks.batchDisable.mock.calls[2]![0]).toEqual(users.slice(1000).map((user) => user.id))
    await waitFor(() => expect(byTest('email-blacklist-matched-users')).toBeNull())
  })
})
