import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import OpsAlertRulesCard from '../OpsAlertRulesCard'

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

const { createAlertRule } = vi.hoisted(() => ({ createAlertRule: vi.fn() }))
vi.mock('@/api', () => ({ adminAPI: { groups: { getAll: vi.fn().mockResolvedValue([]) } } }))
vi.mock('@/api/admin/ops', () => ({ opsAPI: { listAlertRules: vi.fn().mockResolvedValue([]), createAlertRule } }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showError: vi.fn(), showSuccess: vi.fn() }) } }))

const flushPromises = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

// 编辑弹窗渲染在 portal（document.body）里，因此按选择器在整个文档中查找输入框。
function input(selector: string): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(selector)
  if (!el) throw new Error(`missing ${selector}`)
  return el
}

const saveButton = () => screen.getByRole('button', { name: 'common.save' })

async function openRule() {
  render(<OpsAlertRulesCard />)
  await flushPromises()
  fireEvent.click(screen.getByRole('button', { name: 'admin.ops.alertRules.create' }))
  await flushPromises()
  fireEvent.change(input('input[type="text"]'), { target: { value: 'Error rate' } })
}

describe('alert rule integer durations', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(cleanup)

  it.each(['1.5', '0.5'])('rejects fractional duration %s before submitting', async (value) => {
    await openRule()
    const field = input(value === '1.5' ? 'input[min="1"][max="1440"]' : 'input[min="0"][max="1440"]')
    fireEvent.change(field, { target: { value } })
    expect(document.body.textContent).toContain(
      value === '1.5' ? 'admin.ops.alertRules.validation.sustainedRange' : 'admin.ops.alertRules.validation.cooldownRange'
    )
    fireEvent.click(saveButton())
    await flushPromises()
    expect(createAlertRule).not.toHaveBeenCalled()
  })

  it('allows whole-minute boundaries and a fractional metric threshold', async () => {
    await openRule()
    fireEvent.change(input('input[min="1"][max="1440"]'), { target: { value: '1440' } })
    fireEvent.change(input('input[min="0"][max="1440"]'), { target: { value: '0' } })
    fireEvent.change(input('input[type="number"]:not([min])'), { target: { value: '1.25' } })
    expect(saveButton()).toBeEnabled()
    fireEvent.click(saveButton())
    await flushPromises()
    expect(createAlertRule).toHaveBeenCalledWith(expect.objectContaining({ sustained_minutes: 1440, cooldown_minutes: 0, threshold: 1.25 }))
  })
})
