import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChannelMonitor } from '@/api/admin/channelMonitor'
import MonitorFormDialog from '@/components/admin/monitor/MonitorFormDialog'
import { makeMonitor } from '@/components/admin/monitor/__tests__/monitorFixtures'

const { listTemplates, accountsList, accountsGetById, monitorCreate, monitorUpdate } = vi.hoisted(() => ({
  listTemplates: vi.fn(),
  accountsList: vi.fn(),
  accountsGetById: vi.fn(),
  monitorCreate: vi.fn(),
  monitorUpdate: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    channelMonitor: { create: monitorCreate, update: monitorUpdate },
    channelMonitorTemplate: { list: listTemplates },
    accounts: {
      list: (...args: unknown[]) => accountsList(...args),
      getById: (...args: unknown[]) => accountsGetById(...args)
    }
  }
}))
vi.mock('@/api/keys', () => ({ keysAPI: { list: vi.fn() } }))
vi.mock('@/api/groups', () => ({ userGroupsAPI: { getUserGroupRates: vi.fn() } }))
vi.mock('@/stores/app', () => {
  const state = { cachedPublicSettings: null, showError: vi.fn(), showSuccess: vi.fn() }
  const useAppStore = Object.assign((selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state), {
    getState: () => state
  })
  return { useAppStore }
})
const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))
// 与 Vue 版一致，把子组件换成桩
vi.mock('@/components/admin/channel/ModelTagInput', () => ({ default: () => null }))
vi.mock('@/components/admin/monitor/MonitorKeyPickerDialog', () => ({ default: () => null }))
vi.mock('@/components/admin/monitor/MonitorAdvancedRequestConfig', () => ({ default: () => null }))

let unmountView: (() => void) | undefined

function mountDialog(monitor: ChannelMonitor | null = null) {
  const view = render(<MonitorFormDialog show monitor={monitor} />)
  unmountView = () => view.unmount()
  return view
}

const flushPromises = () => act(async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
})
const advance = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms)
})

const accountTrigger = () => within(screen.getByTestId('monitor-linked-account')).getAllByRole('button')[0]
const openAccountDropdown = () => {
  fireEvent.click(accountTrigger())
  return screen.getByRole('listbox')
}
const clickOption = (text: string) => {
  const option = screen.getAllByRole('option').find((el) => el.textContent?.includes(text))
  expect(option, `option containing "${text}" not found`).toBeDefined()
  fireEvent.click(option!)
}
const typeAccountSearch = (query: string) => {
  fireEvent.change(screen.getByLabelText('common.searchPlaceholder'), { target: { value: query } })
}
const submit = () => fireEvent.submit(document.getElementById('channel-monitor-form')!)
const click = (testId: string) => fireEvent.click(screen.getByTestId(testId))

afterEach(() => {
  unmountView?.()
  unmountView = undefined
  vi.useRealTimers()
})

describe('MonitorFormDialog linked account selector', () => {
  beforeEach(() => {
    listTemplates.mockReset().mockResolvedValue({ items: [] })
    accountsList.mockReset().mockResolvedValue({ items: [] })
    accountsGetById.mockReset()
    monitorCreate.mockReset().mockResolvedValue({})
    monitorUpdate.mockReset().mockResolvedValue({})
  })

  it('loads the first page of provider accounts when quota mode is enabled', async () => {
    accountsList.mockResolvedValue({ items: [{ id: 1, name: 'a', platform: 'anthropic' }] })
    mountDialog()
    await flushPromises()
    expect(accountsList).not.toHaveBeenCalled()

    click('monitor-check-mode-quota')
    await flushPromises()

    expect(accountsList).toHaveBeenCalledTimes(1)
    expect(accountsList).toHaveBeenCalledWith(1, 50, { platform: 'anthropic' }, { signal: expect.any(AbortSignal) })
  })

  it('debounced typing hits server-side search and aborts the previous request', async () => {
    vi.useFakeTimers()
    mountDialog()
    click('monitor-check-mode-quota')
    await advance(0)

    openAccountDropdown()
    typeAccountSearch('hidden')
    // debounce window must not fire a request
    expect(accountsList).toHaveBeenCalledTimes(1)

    await advance(300)

    expect(accountsList).toHaveBeenCalledTimes(2)
    const lastCall = accountsList.mock.calls[accountsList.mock.calls.length - 1]
    expect(lastCall[2]).toMatchObject({ platform: 'anthropic', search: 'hidden' })
    const firstSignal = (accountsList.mock.calls[0][3] as { signal: AbortSignal }).signal
    expect(firstSignal.aborted).toBe(true)
  })

  it('hydrates a bound account missing from the first page and keeps the binding', async () => {
    accountsList.mockResolvedValue({ items: [{ id: 1, name: 'first page account', platform: 'anthropic' }] })
    accountsGetById.mockResolvedValue({ id: 999, name: 'hidden gem', platform: 'anthropic' })
    mountDialog(makeMonitor({ provider: 'anthropic', check_mode: 'quota', account_id: 999, endpoint: '', primary_model: 'quota' }))
    await flushPromises()

    expect(accountsGetById).toHaveBeenCalledWith(999)
    expect(accountTrigger().textContent).toContain('hidden gem (#999)')

    submit()
    await flushPromises()
    expect(monitorUpdate).toHaveBeenCalledWith(42, expect.objectContaining({ account_id: 999 }))
  })

  it('clears the binding with a visible hint when the bound account cannot be loaded', async () => {
    accountsGetById.mockRejectedValue(new Error('gone'))
    mountDialog(makeMonitor({ provider: 'anthropic', check_mode: 'quota', account_id: 999, endpoint: '', primary_model: 'quota' }))
    await flushPromises()

    expect(document.body.textContent).toContain('admin.channelMonitor.form.linkedAccountMissing')
    expect(accountTrigger().textContent).not.toContain('hidden gem')

    submit()
    await flushPromises()
    expect(monitorUpdate).not.toHaveBeenCalled()
  })

  it('shows the OpenAI codex probe hint only in quota mode on openai', async () => {
    mountDialog()
    await flushPromises()
    expect(document.body.textContent).not.toContain('openAIQuotaProbeHint')

    click('monitor-check-mode-quota')
    await flushPromises()
    // anthropic 平台不显示。
    expect(document.body.textContent).not.toContain('openAIQuotaProbeHint')

    click('monitor-provider-openai')
    await flushPromises()
    expect(document.body.textContent).toContain('openAIQuotaProbeHint')
  })

  it('keeps a picked account visible when a later search hides it', async () => {
    vi.useFakeTimers()
    accountsList
      .mockResolvedValueOnce({
        items: [
          { id: 1, name: 'alpha', platform: 'anthropic' },
          { id: 2, name: 'beta', platform: 'anthropic' }
        ]
      })
      .mockResolvedValueOnce({ items: [{ id: 2, name: 'beta', platform: 'anthropic' }] })
    mountDialog()
    click('monitor-check-mode-quota')
    await advance(0)

    openAccountDropdown()
    clickOption('alpha (#1)')
    await advance(0)
    expect(accountTrigger().textContent).toContain('alpha (#1)')

    // 搜索 beta：结果页只剩 beta，但已选中的 alpha 仍固定展示、提交仍保留绑定。
    openAccountDropdown()
    typeAccountSearch('beta')
    await advance(300)

    expect(accountTrigger().textContent).toContain('alpha (#1)')

    fireEvent.change(document.getElementById('monitor-name')!, { target: { value: 'my monitor' } })
    submit()
    await advance(0)
    expect(monitorCreate).toHaveBeenCalledWith(expect.objectContaining({ account_id: 1 }))
  })

  it('clears the account binding when the provider switches', async () => {
    accountsList.mockResolvedValue({ items: [{ id: 1, name: 'alpha', platform: 'anthropic' }] })
    mountDialog()
    click('monitor-check-mode-quota')
    await flushPromises()

    openAccountDropdown()
    clickOption('alpha (#1)')
    await flushPromises()
    expect(accountTrigger().textContent).toContain('alpha (#1)')

    click('monitor-provider-openai')
    await flushPromises()

    expect(accountTrigger().textContent).not.toContain('alpha')
    expect(accountTrigger().textContent).toContain('linkedAccountPlaceholder')
  })

  // P2-7(b)：antigravity 强制的 quota 在切走时要对称还原，占位模型一并清掉。
  it('restores probe mode and clears the quota placeholder when switching away from antigravity', async () => {
    accountsGetById.mockRejectedValue(new Error('gone'))
    mountDialog(makeMonitor({ provider: 'antigravity', check_mode: 'quota', account_id: 7, endpoint: '', primary_model: 'quota' }))
    await flushPromises()

    click('monitor-provider-anthropic')
    await flushPromises()

    // 占位模型已被清空：probe 模式必填校验拦下提交，而不是拿 'quota' 探活。
    submit()
    await flushPromises()
    expect(monitorUpdate).not.toHaveBeenCalled()

    fireEvent.change(screen.getByTestId('monitor-primary-model'), { target: { value: 'claude-sonnet-4-5' } })
    submit()
    await flushPromises()
    expect(monitorUpdate).toHaveBeenCalledWith(42, expect.objectContaining({ check_mode: 'probe', primary_model: 'claude-sonnet-4-5' }))
  })

  // P2-7(c)：update 切回 probe 显式发 account_id=0 解绑存量关联（null=不动）。
  it('unbinds the linked account with account_id=0 when a quota monitor switches back to probe', async () => {
    accountsGetById.mockRejectedValue(new Error('gone'))
    mountDialog(makeMonitor({ provider: 'anthropic', check_mode: 'quota', account_id: 999, endpoint: '', primary_model: 'quota' }))
    await flushPromises()

    click('monitor-check-mode-probe')
    fireEvent.change(screen.getByTestId('monitor-primary-model'), { target: { value: 'claude-sonnet-4-5' } })
    submit()
    await flushPromises()

    expect(monitorUpdate).toHaveBeenCalledWith(42, expect.objectContaining({ account_id: 0 }))
  })

  // P2-7(c)：create 绝不发 0（后端会把 0 存成 &0 触发外键违约），保持 null。
  it('keeps account_id null when creating a probe monitor', async () => {
    mountDialog()
    await flushPromises()

    fireEvent.change(document.getElementById('monitor-name')!, { target: { value: 'my monitor' } })
    fireEvent.change(screen.getByTestId('monitor-primary-model'), { target: { value: 'claude-sonnet-4-5' } })
    submit()
    await flushPromises()

    expect(monitorCreate).toHaveBeenCalledWith(expect.objectContaining({ check_mode: 'probe', account_id: null }))
  })
})
