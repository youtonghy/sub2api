import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  showError: vi.fn(),
  getPlatformQuotas: vi.fn(),
  updatePlatformQuotas: vi.fn(),
  resetPlatformQuotaWindow: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    users: {
      getPlatformQuotas: apiMocks.getPlatformQuotas,
      updatePlatformQuotas: apiMocks.updatePlatformQuotas,
      resetPlatformQuotaWindow: apiMocks.resetPlatformQuotaWindow
    }
  }
}))

vi.mock('@/stores/app', () => ({
  useAppStore: {
    getState: () => ({
      showError: apiMocks.showError,
      showSuccess: vi.fn()
    })
  }
}))

const i18n = vi.hoisted(() => ({
  t: (key: string, params?: Record<string, string>) => {
    if (params) {
      return key.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '')
    }
    return key
  },
  te: () => true,
  locale: 'en'
}))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

// Vue 版把 BaseDialog 换成只渲染插槽的桩；React 版同样替换，避免 Radix 门户与动画
vi.mock('@/components/common/BaseDialog', () => ({
  default: (props: { show: boolean; children?: React.ReactNode; footer?: React.ReactNode }) =>
    props.show ? (
      <div>
        {props.children}
        {props.footer}
      </div>
    ) : null
}))

import type { PlatformQuotaUpdateItem, UserSubscription } from '@/types'
import UserPlatformQuotaModal from '../UserPlatformQuotaModal'

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

function makeUser(overrides: { subscriptions?: UserSubscription[] } = {}) {
  return { id: 99, email: 'u@example.com', ...overrides } as any
}

/** 挂载并触发 show：false → true，确保打开逻辑被激活 */
async function mountAndOpen() {
  const onSuccess = vi.fn()
  const user = makeUser()
  const view = render(<UserPlatformQuotaModal show={false} user={user} onSuccess={onSuccess} />)
  view.rerender(<UserPlatformQuotaModal show user={user} onSuccess={onSuccess} />)
  await flushPromises()
  return { ...view, onSuccess }
}

const numberInputs = () => Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type=number]'))
const setValue = (input: HTMLInputElement, value: string) => fireEvent.change(input, { target: { value } })
const clickSave = () => fireEvent.click(screen.getByRole('button', { name: 'admin.users.platformQuota.save' }))
const rows = () => Array.from(document.body.querySelectorAll('tbody tr'))
// Vue 版按文本 ↻ 查找重置按钮，React 版重置按钮是图标按钮，按 data-testid 查找
const resetButtons = () => screen.queryAllByTestId('quota-reset') as HTMLButtonElement[]
// Vue 版用原生 window.confirm()；React 版改用应用内 ConfirmDialog（BaseDialog 已替换为桩），
// 先确认弹出且只弹出一次对应消息，再点击确认或取消
const answerConfirm = async (message: string, accept: boolean) => {
  expect(screen.getByText(message)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: accept ? 'common.confirm' : 'common.cancel' }))
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  apiMocks.getPlatformQuotas.mockResolvedValue({ platform_quotas: [] })
  apiMocks.updatePlatformQuotas.mockResolvedValue({ platform_quotas: [] })
  apiMocks.resetPlatformQuotaWindow.mockResolvedValue({ platform_quotas: [] })
})

describe('UserPlatformQuotaModal', () => {
  it.each([0, 4, 14, 17])('does not turn a negative limit in input %s into unlimited', async (index) => {
    const { onSuccess } = await mountAndOpen()
    setValue(numberInputs()[index], '-1')
    clickSave()
    await flushPromises()
    expect(apiMocks.updatePlatformQuotas).not.toHaveBeenCalled()
    expect(apiMocks.showError).toHaveBeenCalledWith('admin.users.platformQuota.invalidNumber')
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it.each([['0', 0], ['', null]])('preserves the meaning of a limit entered as %j', async (input, expected) => {
    await mountAndOpen()
    setValue(numberInputs()[0], input)
    clickSave()
    await flushPromises()
    expect(apiMocks.updatePlatformQuotas).toHaveBeenCalledTimes(1)
    expect(apiMocks.updatePlatformQuotas.mock.calls[0][1][0].daily_limit_usd).toBe(expected)
  })

  it('挂载并 show=true 时调用 getPlatformQuotas', async () => {
    await mountAndOpen()
    expect(apiMocks.getPlatformQuotas).toHaveBeenCalledWith(99)
  })

  it('renders all thirteen supported platforms with empty limits', async () => {
    await mountAndOpen()
    expect(rows().map((row) => row.querySelector('td')!.textContent)).toEqual([
      'anthropic', 'openai', 'gemini', 'antigravity', 'grok',
      'kimi', 'zhipu', 'deepseek', 'minimax', 'opencode_go', 'typesafe', 'command_code', 'cline'
    ])
    for (const row of rows()) {
      const inputs = Array.from(row.querySelectorAll<HTMLInputElement>('input[type=number]'))
      expect(inputs).toHaveLength(3)
      expect(inputs.map((input) => input.value)).toEqual(['', '', ''])
    }
  })

  it.each(['kimi', 'zhipu', 'deepseek', 'minimax', 'opencode_go', 'typesafe', 'command_code', 'cline'] as const)(
    'saves edits to %s without erasing existing platform limits', async (platform) => {
      const existing: PlatformQuotaUpdateItem[] = [
        { platform: 'openai', daily_limit_usd: 10, weekly_limit_usd: 20, monthly_limit_usd: 100 },
        ...(['kimi', 'zhipu', 'deepseek', 'minimax', 'opencode_go', 'typesafe', 'command_code', 'cline'] as const).map((p) => ({
          platform: p, daily_limit_usd: 0, weekly_limit_usd: null, monthly_limit_usd: 50
        }))
      ]
      apiMocks.getPlatformQuotas.mockResolvedValueOnce({ platform_quotas: existing })
      const { onSuccess } = await mountAndOpen()
      const row = rows().find((r) => r.querySelector('td')!.textContent === platform)!
      const inputs = Array.from(row.querySelectorAll<HTMLInputElement>('input[type=number]'))
      expect(inputs.map((input) => input.value)).toEqual(['0', '', '50'])
      setValue(inputs[1], '12.5')
      clickSave()
      await flushPromises()
      const expected = existing.map((item) => (item.platform === platform ? { ...item, weekly_limit_usd: 12.5 } : item))
      expect(apiMocks.updatePlatformQuotas).toHaveBeenCalledTimes(1)
      expect(apiMocks.updatePlatformQuotas).toHaveBeenCalledWith(99, expect.arrayContaining(expected))
      expect(apiMocks.updatePlatformQuotas.mock.calls[0][1]).toHaveLength(13)
      expect(onSuccess).toHaveBeenCalledTimes(1)
    }
  )

  it('已有数据正确填充 limit input', async () => {
    apiMocks.getPlatformQuotas.mockResolvedValueOnce({
      platform_quotas: [
        { platform: 'anthropic', daily_limit_usd: 10, weekly_limit_usd: null, monthly_limit_usd: null,
          daily_usage_usd: 3.2, weekly_usage_usd: 0, monthly_usage_usd: 0 }
      ]
    })
    await mountAndOpen()
    const inputs = numberInputs()
    // 13 platforms × 3 windows = 39 inputs
    expect(inputs.length).toBe(39)
    // 第一个 input 是 anthropic.daily = 10
    expect(inputs[0].value).toBe('10')
  })

  it('保存提交完整 13 platform payload', async () => {
    apiMocks.getPlatformQuotas.mockResolvedValueOnce({
      platform_quotas: [
        { platform: 'openai', daily_limit_usd: null, weekly_limit_usd: 20, monthly_limit_usd: null,
          daily_usage_usd: 0, weekly_usage_usd: 0, monthly_usage_usd: 0 }
      ]
    })
    await mountAndOpen()
    // 找到「保存」按钮
    expect(screen.getByRole('button', { name: 'admin.users.platformQuota.save' })).toBeTruthy()
    clickSave()
    await flushPromises()
    expect(apiMocks.updatePlatformQuotas).toHaveBeenCalledTimes(1)
    const [uid, payload] = apiMocks.updatePlatformQuotas.mock.calls[0]
    expect(uid).toBe(99)
    expect(payload).toHaveLength(13) // 13 platforms always submitted
    const openai = payload.find((p: any) => p.platform === 'openai')
    expect(openai.weekly_limit_usd).toBe(20)
  })

  it('全部清空把所有 limit 置 null（确认通过）', async () => {
    apiMocks.getPlatformQuotas.mockResolvedValueOnce({
      platform_quotas: [
        { platform: 'anthropic', daily_limit_usd: 10, weekly_limit_usd: 50, monthly_limit_usd: 100,
          daily_usage_usd: 0, weekly_usage_usd: 0, monthly_usage_usd: 0 }
      ]
    })
    await mountAndOpen()
    fireEvent.click(screen.getByRole('button', { name: 'admin.users.platformQuota.clearAll' }))
    await flushPromises()
    await answerConfirm('admin.users.platformQuota.clearAllConfirm', true)
    for (const inp of numberInputs()) {
      expect(inp.value).toBe('')
    }
  })

  it('全部清空 confirm 取消则保持原值', async () => {
    apiMocks.getPlatformQuotas.mockResolvedValueOnce({
      platform_quotas: [
        { platform: 'anthropic', daily_limit_usd: 10, weekly_limit_usd: 50, monthly_limit_usd: 100,
          daily_usage_usd: 0, weekly_usage_usd: 0, monthly_usage_usd: 0 }
      ]
    })
    await mountAndOpen()
    fireEvent.click(screen.getByRole('button', { name: 'admin.users.platformQuota.clearAll' }))
    await flushPromises()
    await answerConfirm('admin.users.platformQuota.clearAllConfirm', false)
    // anthropic daily 应保持 10（未被清空）
    expect(numberInputs()[0].value).toBe('10')
  })

  // 只有已保存限额的平台在后端有配额记录，重置按钮才可用
  const anthropicConfigured = {
    platform_quotas: [
      {
        platform: 'anthropic',
        daily_limit_usd: 10,
        weekly_limit_usd: null,
        monthly_limit_usd: null,
        daily_usage_usd: 0,
        weekly_usage_usd: 0,
        monthly_usage_usd: 0
      }
    ]
  }

  it('未配置限额的平台重置按钮禁用并提示不可用', async () => {
    await mountAndOpen()
    const resetBtns = resetButtons()
    expect(resetBtns.length).toBe(39) // 13 平台 × 3 窗口
    for (const b of resetBtns) {
      expect(b.disabled).toBe(true)
      expect(b.getAttribute('title')).toBe('admin.users.platformQuota.reset.unavailable')
    }
  })

  it('已保存限额的平台重置按钮可用，其余仍禁用', async () => {
    apiMocks.getPlatformQuotas.mockResolvedValue(anthropicConfigured)
    await mountAndOpen()
    const enabled = resetButtons().filter((b) => !b.disabled)
    expect(enabled.length).toBe(3) // anthropic 的 daily/weekly/monthly
    expect(enabled[0].getAttribute('title')).toBe('admin.users.platformQuota.reset.button')
  })

  it('重置按钮 confirm 取消则不调用 API', async () => {
    apiMocks.getPlatformQuotas.mockResolvedValue(anthropicConfigured)
    await mountAndOpen()
    const resetBtns = resetButtons()
    expect(resetBtns.length).toBeGreaterThan(0)
    fireEvent.click(resetBtns[0])
    await flushPromises()
    await answerConfirm('admin.users.platformQuota.reset.confirm', false)
    expect(apiMocks.resetPlatformQuotaWindow).not.toHaveBeenCalled()
  })

  it('重置按钮 confirm 确认则调用 API', async () => {
    apiMocks.getPlatformQuotas.mockResolvedValue(anthropicConfigured)
    await mountAndOpen()
    fireEvent.click(resetButtons()[0]) // 第一个是 anthropic.daily
    await flushPromises()
    expect(apiMocks.resetPlatformQuotaWindow).not.toHaveBeenCalled()
    await answerConfirm('admin.users.platformQuota.reset.confirm', true)
    expect(apiMocks.resetPlatformQuotaWindow).toHaveBeenCalledWith(99, 'anthropic', 'daily')
  })

  describe('subscription warning banner', () => {
    const subscription = (status: 'active' | 'expired') =>
      ({
        id: status === 'active' ? 1 : 2, user_id: 99, group_id: 1, status,
        starts_at: '2026-01-01T00:00:00Z', expires_at: status === 'active' ? null : '2025-12-31T00:00:00Z',
        daily_usage_usd: 0, weekly_usage_usd: 0, monthly_usage_usd: 0,
        daily_window_start: null, weekly_window_start: null, monthly_window_start: null,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z'
      }) as unknown as UserSubscription

    it('displays subscription warning when user has active subscription', async () => {
      const { container } = render(<UserPlatformQuotaModal show user={makeUser({ subscriptions: [subscription('active')] })} />)
      await flushPromises()
      expect(container.innerHTML).toContain('admin.users.platformQuota.subscriptionWarning')
    })

    it('hides subscription warning when user has only expired subscriptions', async () => {
      const { container } = render(<UserPlatformQuotaModal show user={makeUser({ subscriptions: [subscription('expired')] })} />)
      await flushPromises()
      expect(container.innerHTML).not.toContain('admin.users.platformQuota.subscriptionWarning')
    })

    it('hides subscription warning when subscriptions is empty array', async () => {
      const { container } = render(<UserPlatformQuotaModal show user={makeUser({ subscriptions: [] })} />)
      await flushPromises()
      expect(container.innerHTML).not.toContain('admin.users.platformQuota.subscriptionWarning')
    })
  })
})
