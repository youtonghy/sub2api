import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLocale, setLocaleMessage } from '@/i18n'
import en from '@/i18n/locales/en'
import zh from '@/i18n/locales/zh'
import enKeys from '@/i18n/locales/en/adminAccessKeys'
import zhKeys from '@/i18n/locales/zh/adminAccessKeys'
import AdminAccessKeysSettings from '../AdminAccessKeysSettings'

const catalogSource = readFileSync(resolve(process.cwd(), '../backend/internal/pkg/adminaccess/catalog.go'), 'utf8')
const catalog = [...catalogSource.matchAll(/Permission\{"([^"]+)", "([^"]+)", "([^"]+)", "([^"]+)"\}/g)].map(
  ([, id, label, category, scope]) => ({ id, label, category, scope })
)
const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), rotate: vi.fn(), revoke: vi.fn(), deleteRecord: vi.fn() }))
vi.mock('@/api/admin/adminAccessKeys', () => mocks)
vi.mock('@/api/admin/groups', () => ({ getAllIncludingInactive: vi.fn().mockResolvedValue([{ id: 7, name: 'Example group' }]) }))
vi.mock('@/components/auth/TotpStepUpDialog', () => ({ default: () => <div /> }))
vi.mock('@/composables/useStepUp', () => ({ useStepUp: () => ({ run: (fn: () => unknown) => fn() }), isStepUpCancelled: () => false }))

const CJK = /[㐀-鿿]/u
const permissionKey = (id: string) => id.replaceAll('_', '_u').replaceAll('.', '_d') as keyof typeof enKeys.permissions
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const text = () => document.body.textContent ?? ''
const byTest = (id: string) => document.querySelector(`[data-test="${id}"]`) as HTMLInputElement | null
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy()
  await act(async () => { fireEvent.click(el!) })
  await flush()
}
const type = async (el: Element | null, value: string) => {
  expect(el).toBeTruthy()
  await act(async () => { fireEvent.change(el!, { target: { value } }) })
}
const switchLocale = async (locale: 'en' | 'zh') => {
  await act(async () => { await setLocale(locale) })
  await flush()
}
async function setup(locale: 'en' | 'zh' = 'en') {
  await switchLocale(locale)
  render(<AdminAccessKeysSettings />)
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  setLocaleMessage('en', en)
  setLocaleMessage('zh', zh)
  mocks.list.mockResolvedValue({
    items: [],
    permissions: [
      ...catalog,
      { id: 'future.feature', label: '后端新增权限', category: '后端新增分类', scope: 'global' },
      { id: 'payment.mark.paid', label: '不可误认成人工确认到账', category: '未知分类', scope: 'global' }
    ]
  })
  mocks.create.mockResolvedValue({ key: 'secret', item: { id: 'created', name: 'Example key' } })
})
afterEach(() => cleanup())

describe('管理员密钥英文体验', () => {
  it('各自后端目录的每个权限都有准确的中英文标签与分类', () => {
    expect(catalog.length).toBeGreaterThan(50)
    expect(new Set(catalog.map((permission) => permission.id)).size).toBe(catalog.length)
    const expectedKeys = catalog.map((permission) => permissionKey(permission.id)).sort()
    for (const messages of [enKeys, zhKeys]) {
      expect(Object.keys(messages.permissions).sort()).toEqual(expectedKeys)
      for (const { label, category } of Object.values(messages.permissions)) {
        expect(label.trim()).not.toBe('')
        expect(category.trim()).not.toBe('')
      }
    }
    expect(en.adminAccessKeys).toEqual(enKeys)
    expect(zh.adminAccessKeys).toEqual(zhKeys)
    for (const permission of catalog) {
      const key = permissionKey(permission.id)
      expect(zhKeys.permissions[key]).toEqual({ label: permission.label, category: permission.category })
      expect(enKeys.permissions[key].label).not.toMatch(CJK)
      expect(enKeys.permissions[key].category).not.toMatch(CJK)
    }
  })

  it('切换语言清除待确认文字和本次扩权，必须使用当前语言重新确认', async () => {
    await setup('zh')
    await click(byTest('create'))
    await type(byTest('name'), 'Example key')
    await click(byTest('full-access'))
    await type(byTest('full-access-phrase'), '开启全权访问')
    await switchLocale('en')
    // 对话框与按钮文字有退出动画，等待旧语言内容离开 DOM
    await waitFor(() => expect(byTest('full-access-phrase')).toBeNull())
    expect(byTest('full-access')!.checked).toBe(false)
    await waitFor(() => expect(text()).not.toMatch(CJK))
    await click(byTest('full-access'))
    expect(byTest('full-access-phrase')!.value).toBe('')
    await type(byTest('full-access-phrase'), 'ENABLE FULL ACCESS')
    await click(byTest('full-access-confirm'))
    expect(byTest('full-access')!.checked).toBe(true)
    await switchLocale('zh')
    expect(byTest('full-access')!.checked).toBe(false)
    await click(byTest('full-access'))
    await type(byTest('full-access-phrase'), 'ENABLE FULL ACCESS')
    expect(byTest('full-access-confirm')).toBeDisabled()
    await type(byTest('full-access-phrase'), '开启全权访问')
    await click(byTest('full-access-confirm'))
    await click(byTest('save'))
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ policy: expect.objectContaining({ full_access: true }), confirm_full_access: true })
    )
  })

  it('语言切换保留已有全权权限并翻译列表摘要', async () => {
    mocks.list.mockResolvedValueOnce({
      items: [{ id: 'existing', name: 'Existing key', enabled: true, allowed_ips: [], policy: { full_access: true, rules: [{ permissions: ['accounts.read'], group_ids: [7], account_types: ['oauth'], platforms: ['openai'] }], global_permissions: [] } }],
      permissions: catalog
    })
    await setup('zh')
    await click(screen.getAllByRole('button').find((button) => button.textContent === '编辑权限'))
    await switchLocale('en')
    expect(byTest('full-access')!.checked).toBe(true)
    expect(text()).toContain('Full access')
    expect(text()).toContain('Example group')
    await waitFor(() => expect(text()).not.toMatch(CJK))
  })

  it('英文环境翻译页面及后端权限目录，未知权限不泄漏中文标签或分类', async () => {
    await setup()
    await click(byTest('create'))
    expect(text()).toContain('Admin access keys')
    expect(text()).not.toMatch(CJK)
    expect(text()).toContain('Read accounts (redacted)')
    expect(text()).toContain('Finance')
    expect(text()).toContain('future.feature')
    const unknown = document.querySelector('input[value="payment.mark.paid"]')!.closest('label')!
    expect(unknown.textContent).toContain('Unknown permission (payment.mark.paid)')
    for (const permission of catalog) {
      const label = document.querySelector(`input[value="${permission.id}"]`)!.closest('label')!
      expect(label.textContent).toContain(enKeys.permissions[permissionKey(permission.id)].label)
    }
    await click(document.querySelector('input[value="accounts.create"]'))
    expect(text()).not.toMatch(CJK)
    await click(byTest('full-access'))
    expect(text()).toContain('ENABLE FULL ACCESS')
    expect(text()).not.toMatch(CJK)
    await type(byTest('full-access-phrase'), '开启全权访问')
    expect(byTest('full-access-confirm')).toBeDisabled()
    await type(byTest('full-access-phrase'), 'ENABLE FULL ACCESS')
    await click(byTest('full-access-confirm'))
    await type(byTest('name'), 'Example key')
    await click(byTest('save'))
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ confirm_full_access: true, policy: expect.objectContaining({ full_access: true }) })
    )
    expect(document.querySelector('[role="status"]')).toHaveTextContent('Key saved')
  })
})
