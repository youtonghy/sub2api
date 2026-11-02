import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ProxiesView from '../ProxiesView'
import { flushPromises } from './proxiesViewTestUtils'

const { list, update, getAllWithCount } = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), getAllWithCount: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { proxies: { list, update, getAllWithCount } } }))
vi.mock('@/i18n/useI18n', async () => (await import('./proxiesViewTestUtils')).i18nMock())
vi.mock('@/components/common/DataTable', async () => ({ default: (await import('./proxiesViewHarness')).DataTableStub }))
vi.mock('@/components/common/BaseDialog', async () => ({ default: (await import('./proxiesViewHarness')).BaseDialogStub }))

let unmount: (() => void) | undefined
beforeEach(() => {
  vi.clearAllMocks()
  list.mockResolvedValue({ items: [{ id: 9, name: 'proxy', protocol: 'http', host: 'proxy.example', port: 8080, username: 'old-user', status: 'active' }], total: 1, pages: 1 })
  getAllWithCount.mockResolvedValue([])
  update.mockResolvedValue({})
})
afterEach(() => unmount?.())

async function edit() {
  unmount = render(<ProxiesView />).unmount
  await flushPromises()
  fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
}
function form() {
  return document.getElementById('edit-proxy-form') as HTMLFormElement
}
async function submit() {
  fireEvent.submit(form())
  await flushPromises()
  expect(update).toHaveBeenCalledTimes(1)
  return update.mock.calls[0][1]
}

describe('proxy credential updates', () => {
  it('sends an explicit empty username when cleared', async () => {
    await edit()
    const username = Array.from(form().querySelectorAll('input')).find((input) => input.value === 'old-user')!
    fireEvent.change(username, { target: { value: '' } })
    const payload = await submit()
    expect(payload.username).toBe('')
    expect(payload).not.toHaveProperty('password')
  })

  it('sends an explicit empty password when the user clears the field', async () => {
    await edit()
    // 原值为空时 React 不会为相同的值触发 change：先写入再清空，等同 Vue spec 中 setValue('') 触发的 input 事件
    const password = form().querySelector('input[type="password"]') as HTMLInputElement
    fireEvent.change(password, { target: { value: 'x' } })
    fireEvent.change(password, { target: { value: '' } })
    expect((await submit()).password).toBe('')
  })

  it('omits an untouched password when saving other settings', async () => {
    await edit()
    const payload = await submit()
    expect(payload.username).toBe('old-user')
    expect(payload).not.toHaveProperty('password')
  })

  it('keeps trimming a replacement password', async () => {
    await edit()
    fireEvent.change(form().querySelector('input[type="password"]')!, { target: { value: ' new-password ' } })
    expect((await submit()).password).toBe('new-password')
  })
})
