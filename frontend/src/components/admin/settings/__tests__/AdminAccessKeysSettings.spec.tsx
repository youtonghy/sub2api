import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import zh from '@/i18n/locales/zh/adminAccessKeys'
import en from '@/i18n/locales/en/adminAccessKeys'
import { getAllIncludingInactive } from '@/api/admin/groups'
import AdminAccessKeysSettings from '../AdminAccessKeysSettings'

vi.mock('@/i18n/useI18n', () => {
  const t = (key: string, values: Record<string, unknown> = {}) => {
    const message = zh[key.replace('adminAccessKeys.', '') as keyof typeof zh]
    if (!message) throw new Error(`缺少翻译：${key}`)
    return message.replace(/\{(\w+)\}/g, (_: string, name: string) => String(values[name]))
  }
  return { useI18n: () => ({ t, te: () => true, locale: 'zh', setLocale: vi.fn() }) }
})

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  rotate: vi.fn(),
  revoke: vi.fn(),
  deleteRecord: vi.fn(),
  stepUp: vi.fn((fn: () => unknown) => fn())
}))
vi.mock('@/api/admin/adminAccessKeys', () => mocks)
vi.mock('@/api/admin/groups', () => ({ getAllIncludingInactive: vi.fn().mockResolvedValue([{ id: 7, name: '测试分组' }]) }))
vi.mock('@/components/auth/TotpStepUpDialog', () => ({ default: () => <div /> }))
vi.mock('@/composables/useStepUp', () => ({ useStepUp: () => ({ run: mocks.stepUp }), isStepUpCancelled: () => false }))

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
const mountSettings = async () => {
  const view = render(<AdminAccessKeysSettings />)
  await flush()
  return view
}
const text = () => document.body.textContent ?? ''
const buttonByText = (label: string) => screen.queryAllByRole('button', { hidden: true }).find((button) => button.textContent === label)
const byTest = (id: string) => document.querySelector(`[data-test="${id}"]`) as HTMLElement | null
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy()
  await act(async () => { fireEvent.click(el!) })
  await flush()
}
const type = async (el: Element | null, value: string) => {
  expect(el).toBeTruthy()
  await act(async () => { fireEvent.change(el!, { target: { value } }) })
}
const selectGroups = async (el: Element | null, values: string[]) => {
  const select = el as HTMLSelectElement
  for (const option of Array.from(select.options)) option.selected = values.includes(option.value)
  await act(async () => { fireEvent.change(select) })
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.mocked(getAllIncludingInactive).mockResolvedValue([{ id: 7, name: '测试分组' }] as Awaited<ReturnType<typeof getAllIncludingInactive>>)
  mocks.list.mockResolvedValue({
    items: [],
    permissions: [
      { id: 'accounts.read', label: '读取账户', scope: 'account', category: '账户' },
      { id: 'settings.write', label: '修改设置', scope: 'global', category: '设置' }
    ]
  })
})

describe('管理员受限密钥配置', () => {
  it('中英文文案键保持一致，模型限制提示采用上游白名单语义', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(en.modelAllowlistHint).toContain('restricts')
    expect(zh.modelAllowlistHint).toContain('白名单')
  })

  it('加载失败时不允许创建密钥', async () => {
    mocks.list.mockRejectedValueOnce(new Error('加载失败'))
    await mountSettings()
    expect(byTest('create')).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('加载失败')
  })

  it('分组模型权限独立勾选并保留所选分组，不隐式授予账户或全站权限', async () => {
    mocks.list.mockResolvedValueOnce({
      items: [],
      permissions: [
        { id: 'accounts.models.write', label: '账户模型', scope: 'account', category: '账户' },
        { id: 'groups.models.read', label: '读取分组模型', scope: 'group', category: '分组模型' },
        { id: 'groups.models.write', label: '编辑分组模型', scope: 'group', category: '分组模型' }
      ]
    })
    mocks.create.mockResolvedValue({ key: 'once-secret', item: { id: '1' } })
    await mountSettings()
    await click(byTest('create'))
    await type(byTest('name'), '分组模型工具')
    await selectGroups(byTest('groups-0'), ['7'])
    expect(text()).toContain('分组模型白名单会限制分组可调用的模型')
    await click(document.querySelector('input[value="groups.models.read"]'))
    await click(document.querySelector('input[value="groups.models.write"]'))
    await click(byTest('save'))
    const input = mocks.create.mock.calls[0]![0]
    expect(input.policy.rules[0].permissions).toEqual(['groups.models.read', 'groups.models.write'])
    expect(input.policy.rules[0].group_ids).toEqual([7])
    expect(input.policy.rules[0].account_types).toEqual([])
    expect(input.policy.global_permissions).toEqual([])
  })

  it('分组选择不会隐式授予操作或全局权限，并支持多个规则', async () => {
    mocks.create.mockResolvedValue({ key: 'once-secret', item: { id: '1' } })
    await mountSettings()
    await click(byTest('create'))
    await type(byTest('name'), '自动化')
    await selectGroups(byTest('groups-0'), ['7'])
    await click(byTest('add-rule'))
    await click(byTest('save'))
    const input = mocks.create.mock.calls[0]![0]
    expect(input.policy.global_permissions).toEqual([])
    expect(input.policy.rules).toHaveLength(2)
    expect(input.policy.rules[0].permissions).toEqual([])
    expect(input.policy.rules[0].account_types).toEqual([])
    expect(input.policy.rules[0].group_ids).toEqual([7])
    expect(mocks.stepUp).toHaveBeenCalledOnce()
    expect(text()).toContain('once-secret')
    await click(byTest('dismiss-secret'))
    expect(text()).not.toContain('once-secret')
  })

  it('保存失败时保留表单并展示错误，不显示成功密钥', async () => {
    mocks.create.mockRejectedValue(new Error('服务不可用'))
    await mountSettings()
    await click(byTest('create'))
    await type(byTest('name'), '自动化')
    await click(byTest('save'))
    expect(screen.getByRole('alert')).toHaveTextContent('服务不可用')
    expect(byTest('save')).not.toBeNull()
    expect(byTest('dismiss-secret')).toBeNull()
  })

  it('停用失败保持原状态，成功后更新状态；轮换及撤销均等待服务器确认', async () => {
    const item = { id: 'key-1', name: '自动化', description: '', enabled: true, key_prefix: 'adm_sc_1', expires_at: null, allowed_ips: [], policy: { rules: [], global_permissions: [] }, revoked_at: null }
    mocks.list.mockResolvedValueOnce({ items: [item], permissions: [] })
    mocks.update.mockRejectedValueOnce(new Error('更新失败'))
    await mountSettings()
    expect(buttonByText('删除记录')).toBeUndefined()
    await click(buttonByText('停用'))
    expect(text()).toContain('已启用')
    expect(text()).toContain('更新失败')
    mocks.update.mockResolvedValueOnce({ ...item, enabled: false })
    await click(buttonByText('停用'))
    expect(text()).toContain('已停用')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    mocks.rotate.mockResolvedValueOnce({ item: { ...item, enabled: false }, key: 'rotated-once' })
    await click(buttonByText('轮换'))
    expect(mocks.rotate).toHaveBeenCalledWith('key-1')
    expect(text()).toContain('rotated-once')
    mocks.revoke.mockRejectedValueOnce(new Error('撤销失败'))
    await click(buttonByText('永久撤销'))
    expect(text()).toContain('自动化')
    expect(text()).toContain('撤销失败')
    mocks.revoke.mockResolvedValueOnce({ message: 'ok' })
    await click(buttonByText('永久撤销'))
    expect(text()).toContain('adm_sc_1')
    expect(text()).toContain('已撤销')
    expect(buttonByText('删除记录')).toBeDefined()
    expect(mocks.stepUp).toHaveBeenCalledTimes(5)
    confirmSpy.mockRestore()
  })

  it('删除已撤销记录时提示历史保留，取消和失败不移除，服务器确认后才移除', async () => {
    const item = { id: 'revoked-key', name: '已撤销自动化', enabled: false, key_prefix: 'revoked-prefix', policy: { rules: [], global_permissions: [] }, revoked_at: '2026-10-22T00:00:00Z' }
    mocks.list.mockResolvedValueOnce({ items: [item], permissions: [] })
    const view = await mountSettings()
    const remove = () => buttonByText('删除记录')!
    expect(remove()).toBeDefined()
    expect(buttonByText('永久撤销')).toBeUndefined()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      await click(remove())
      expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('删除只是从列表移除，历史操作记录仍会继续保留'))
      expect(mocks.deleteRecord).not.toHaveBeenCalled()
      expect(text()).toContain('revoked-prefix')

      confirmSpy.mockReturnValue(true)
      mocks.deleteRecord.mockRejectedValueOnce(new Error('删除失败'))
      await click(remove())
      expect(text()).toContain('删除失败')
      expect(text()).toContain('revoked-prefix')

      let resolve!: (value: { message: string }) => void
      mocks.deleteRecord.mockReturnValueOnce(new Promise((r) => { resolve = r }))
      await act(async () => { fireEvent.click(remove()) })
      expect(remove()).toBeDisabled()
      expect(text()).toContain('revoked-prefix')
      await act(async () => { resolve({ message: 'ok' }) })
      await flush()
      expect(mocks.deleteRecord).toHaveBeenLastCalledWith(item.id)
      expect(mocks.stepUp).toHaveBeenCalledTimes(2)
      expect(text()).not.toContain('revoked-prefix')
      expect(text()).toContain('历史操作记录仍会继续保留')
    } finally {
      confirmSpy.mockRestore()
      view.unmount()
    }
  })

  it('编辑仅修改名称时保留所有规则且不会自动授予操作或全站权限', async () => {
    const rules = [
      { permissions: ['accounts.read'], group_ids: [7], all_groups: false, include_ungrouped: false, account_types: ['oauth'], platforms: ['openai'] },
      { permissions: [], group_ids: [8], all_groups: false, include_ungrouped: true, account_types: [], platforms: [] }
    ]
    const item = { id: 'key-2', name: '原名称', description: '', enabled: true, key_prefix: 'prefix', expires_at: null, allowed_ips: null, policy: { rules, global_permissions: null }, revoked_at: null }
    mocks.list.mockResolvedValueOnce({ items: [item], permissions: [] })
    mocks.update.mockResolvedValueOnce(item)
    await mountSettings()
    expect(text()).toContain('测试分组')
    expect(text()).toContain('全站权限：0 项')
    expect(text()).toContain('按操作和资源范围授权；未勾选操作不生效')
    await click(buttonByText('编辑权限'))
    await type(byTest('name'), '新名称')
    expect(text()).not.toContain('kiro')
    await click(byTest('save'))
    expect(mocks.update).toHaveBeenCalledWith('key-2', expect.objectContaining({ name: '新名称', allowed_ips: [], policy: { rules, global_permissions: [] } }))
  })

  it('空数组返回 null 时仍可创建默认无权限密钥', async () => {
    mocks.list.mockResolvedValueOnce({ items: null, permissions: null })
    mocks.create.mockResolvedValueOnce({ key: 'new-secret', item: { id: 'key-3', policy: { rules: null, global_permissions: null } } })
    await mountSettings()
    await click(byTest('create'))
    await type(byTest('name'), '无权限')
    await click(byTest('save'))
    expect(mocks.create.mock.calls[0]![0].policy.global_permissions).toEqual([])
    expect(text()).toContain('new-secret')
  })

  it.each(['2025-01-02T03:04:56.123456Z', '2099-01-02T03:04:56.123456Z'])('只改名称时精确保留到期时间 %s', async (expiresAt) => {
    const item = { id: 'expiry-key', name: '原名称', description: '', enabled: true, key_prefix: 'prefix', expires_at: expiresAt, allowed_ips: [], policy: { rules: [], global_permissions: [] }, revoked_at: null }
    mocks.list.mockResolvedValueOnce({ items: [item], permissions: [] })
    mocks.update.mockResolvedValueOnce(item)
    const view = await mountSettings()
    await click(buttonByText('编辑权限'))
    await type(byTest('name'), '新名称')
    await click(byTest('save'))
    expect(mocks.update).toHaveBeenCalledWith('expiry-key', expect.objectContaining({ name: '新名称', expires_at: expiresAt }))
    view.unmount()
  })

  it('允许主动修改和清空有效期，重试保持修改值，新建不会继承原有效期', async () => {
    const item = { id: 'expiry-edit', name: '原名称', description: '', enabled: true, key_prefix: 'prefix', expires_at: '2025-01-02T03:04:56.123456Z', allowed_ips: [], policy: { rules: [], global_permissions: [] }, revoked_at: null }
    mocks.list.mockResolvedValueOnce({ items: [item], permissions: [] })
    const view = await mountSettings()
    const edit = async () => { await click(buttonByText('编辑权限')) }
    const save = async () => { await click(byTest('save')) }
    const dateInput = () => document.querySelector('input[type="datetime-local"]')
    await edit()
    const local = '2099-02-03T04:05'
    await type(dateInput(), local)
    mocks.update.mockRejectedValueOnce(new Error('重试'))
    await save()
    const expected = new Date(local).toISOString()
    expect(mocks.update).toHaveBeenLastCalledWith(item.id, expect.objectContaining({ expires_at: expected }))
    mocks.update.mockResolvedValueOnce({ ...item, expires_at: expected })
    await save()
    expect(mocks.update).toHaveBeenLastCalledWith(item.id, expect.objectContaining({ expires_at: expected }))
    await waitFor(() => expect(byTest('save')).toBeNull())
    await edit()
    await type(dateInput(), '')
    mocks.update.mockResolvedValueOnce({ ...item, expires_at: null })
    await save()
    expect(mocks.update).toHaveBeenLastCalledWith(item.id, expect.objectContaining({ expires_at: null }))
    await waitFor(() => expect(byTest('save')).toBeNull())
    await click(byTest('create'))
    await type(byTest('name'), '新建')
    await type(dateInput(), local)
    mocks.create.mockResolvedValueOnce({ key: 'new-secret', item: { ...item, id: 'new', expires_at: expected } })
    await save()
    expect(mocks.create).toHaveBeenLastCalledWith(expect.objectContaining({ expires_at: expected }))
    view.unmount()
  })
})
