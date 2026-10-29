import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ErrorPassthroughRulesModal from '../ErrorPassthroughRulesModal'

const mocks = vi.hoisted(() => ({ list: vi.fn(), toggleEnabled: vi.fn(), showError: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { errorPassthrough: mocks } }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showError: mocks.showError }) } }))
const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))
afterEach(() => vi.restoreAllMocks())
beforeEach(() => vi.resetAllMocks())

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

function rule(enabled: boolean) {
  return { id: 7, name: 'Rule', enabled, priority: 1, error_codes: [429], keywords: [],
    platforms: [], match_mode: 'any', passthrough_code: true, passthrough_body: true, skip_monitoring: false }
}

async function openRules(enabled = true) {
  mocks.list.mockResolvedValue([rule(enabled)])
  const view = render(<ErrorPassthroughRulesModal show={false} />)
  view.rerender(<ErrorPassthroughRulesModal show />)
  await flushPromises()
  return view
}

// Vue 版按 tbody button.relative 与 bg-primary-600 类判断，React 版按 Arc switch 的 role 与 aria-checked 判断
const toggle = () => screen.getByRole('switch')
const isOn = () => toggle().getAttribute('aria-checked') === 'true'

describe('error passthrough enabled state', () => {
  it.each([true, false])('keeps the server state after two pending clicks (enabled=%s)', async (enabled) => {
    const finishes: Array<(value: unknown) => void> = []
    mocks.toggleEnabled.mockImplementation(() => new Promise((resolve) => { finishes.push(resolve) }))
    await openRules(enabled)
    fireEvent.click(toggle())
    fireEvent.click(toggle())
    expect(mocks.toggleEnabled.mock.calls).toEqual([[7, !enabled], [7, !enabled]])
    for (const finish of finishes) {
      finish(rule(!enabled))
      await flushPromises()
      expect(isOn()).toBe(!enabled)
    }
  })

  it('allows sequential toggles in both directions', async () => {
    mocks.toggleEnabled.mockImplementation((_id: number, enabled: boolean) => Promise.resolve(rule(enabled)))
    await openRules()
    fireEvent.click(toggle())
    await flushPromises()
    expect(isOn()).toBe(false)
    fireEvent.click(toggle())
    await flushPromises()
    expect(isOn()).toBe(true)
    expect(mocks.toggleEnabled.mock.calls).toEqual([[7, false], [7, true]])
  })

  it('keeps the original state when saving fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.toggleEnabled.mockRejectedValue(new Error('offline'))
    await openRules()
    fireEvent.click(toggle())
    await flushPromises()
    expect(isOn()).toBe(true)
    expect(mocks.showError).toHaveBeenCalledWith('admin.errorPassthrough.failedToToggle')
  })
})
