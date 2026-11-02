import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import channelsAPI from '@/api/admin/channels'
import PricingEntryCard from '../PricingEntryCard'
import type { PricingFormEntry } from '../types'

vi.mock('@/api/admin/channels', () => ({
  default: { getModelDefaultPricing: vi.fn() }
}))

const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

// Vue 版 shallowMount 把子组件换成桩；这里同样把子组件换成记录回调的桩
const stubs = vi.hoisted(() => ({
  onModelsChange: undefined as undefined | ((models: string[]) => void),
  onSelectChange: undefined as undefined | ((value: unknown) => void)
}))
vi.mock('../ModelTagInput', () => ({
  default: (props: { onModelsChange?: (models: string[]) => void }) => {
    stubs.onModelsChange = props.onModelsChange
    return <div data-testid="model-tag-input" />
  }
}))
vi.mock('../TimePricingSection', () => ({
  default: () => <div data-testid="time-pricing-section" />
}))
vi.mock('@/components/common/Select', () => ({
  default: (props: { onChange?: (value: unknown) => void }) => {
    stubs.onSelectChange = props.onChange
    return <div data-testid="select" />
  }
}))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

function createEntry(billingMode: PricingFormEntry['billing_mode'] = 'token'): PricingFormEntry {
  return {
    models: [],
    billing_mode: billingMode,
    input_price: null,
    output_price: null,
    cache_write_price: null,
    cache_read_price: null,
    fast_multiplier: null,
    flex_multiplier: null,
    reasoning_effort_multipliers: null,
    image_input_price: null,
    image_output_price: null,
    per_request_price: null,
    intervals: [],
    time_pricing: {
      timezone: 'Asia/Shanghai',
      weekdays_only: false,
      periods: [{ start_time: '09:00', end_time: '12:00', multiplier: '2.00' }]
    }
  }
}

const effortInput = (container: HTMLElement, effort: string) =>
  container.querySelector<HTMLInputElement>(`[data-reasoning-effort="${effort}"]`)!

describe('PricingEntryCard time pricing visibility', () => {
  it('is hidden by default', () => {
    render(<PricingEntryCard entry={createEntry()} />)
    expect(screen.queryByTestId('time-pricing-section')).toBeNull()
  })

  it('is shown for token pricing when explicitly enabled', () => {
    render(<PricingEntryCard entry={createEntry()} enableTimePricing />)
    expect(screen.getByTestId('time-pricing-section')).toBeInTheDocument()
  })

  it('is hidden for non-token pricing even when explicitly enabled', () => {
    render(<PricingEntryCard entry={createEntry('per_request')} enableTimePricing />)
    expect(screen.queryByTestId('time-pricing-section')).toBeNull()
  })

  it('clears time periods when changing billing mode', () => {
    const entry = createEntry()
    const onUpdate = vi.fn()
    render(<PricingEntryCard entry={entry} enableTimePricing onUpdate={onUpdate} />)

    act(() => stubs.onSelectChange!('image'))

    expect(onUpdate.mock.calls[0][0]).toEqual({
      ...entry,
      billing_mode: 'image',
      intervals: [],
      time_pricing: { timezone: 'Asia/Shanghai', weekdays_only: false, periods: [] }
    })
    expect(entry.time_pricing.periods).toHaveLength(1)
  })
})

describe('PricingEntryCard request multipliers', () => {
  it('shows Fast and Flex controls only when explicitly enabled', () => {
    const hidden = render(<PricingEntryCard entry={createEntry()} />)
    expect(hidden.container.textContent).not.toContain('admin.channels.form.fastMultiplier')
    hidden.unmount()

    const shown = render(<PricingEntryCard entry={createEntry()} enableTierMultipliers />)
    expect(shown.container.textContent).toContain('admin.channels.form.fastMultiplier')
    expect(shown.container.textContent).toContain('admin.channels.form.flexMultiplier')
    expect(shown.container.textContent).toContain('admin.channels.form.reasoningEffortMultipliers')
  })

  it.each(['token', 'per_request', 'image', 'video'] as const)(
    'supports every reasoning level for %s pricing and account statistics',
    (billingMode) => {
      const { container } = render(<PricingEntryCard entry={createEntry(billingMode)} />)
      expect(
        [...container.querySelectorAll('[data-reasoning-effort]')].map((input) => input.getAttribute('data-reasoning-effort'))
      ).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    }
  )

  it('edits levels independently, then clears individual and all overrides', () => {
    const entry = { ...createEntry(), reasoning_effort_multipliers: { high: 1.5, max: 3 } }
    const onUpdate = vi.fn()
    const view = render(<PricingEntryCard entry={entry} onUpdate={onUpdate} />)
    const update = () => onUpdate.mock.calls.at(-1)![0] as PricingFormEntry
    const rerender = () => view.rerender(<PricingEntryCard entry={update()} onUpdate={onUpdate} />)

    fireEvent.change(effortInput(view.container, 'high'), { target: { value: '0.75' } })
    expect(update().reasoning_effort_multipliers).toEqual({ high: '0.75', max: 3 })
    expect(entry.reasoning_effort_multipliers.high).toBe(1.5)
    rerender()

    fireEvent.change(effortInput(view.container, 'max'), { target: { value: '' } })
    expect(update().reasoning_effort_multipliers).toEqual({ high: '0.75' })
    rerender()

    fireEvent.click(view.container.querySelector('[data-testid="reasoning-effort-multipliers"] button')!)
    expect(update().reasoning_effort_multipliers).toBeNull()
    rerender()
    expect(effortInput(view.container, 'high').value).toBe('')
  })

  it('clearing the last configured level restores default billing', () => {
    const onUpdate = vi.fn()
    const { container } = render(
      <PricingEntryCard entry={{ ...createEntry(), reasoning_effort_multipliers: { max: 3 } }} onUpdate={onUpdate} />
    )
    fireEvent.change(effortInput(container, 'max'), { target: { value: '' } })
    expect((onUpdate.mock.calls[0][0] as PricingFormEntry).reasoning_effort_multipliers).toBeNull()
  })

  it('marks invalid multipliers and shows a validation error', () => {
    const { container } = render(
      <PricingEntryCard entry={{ ...createEntry(), reasoning_effort_multipliers: { high: 0, max: 2 } }} />
    )
    expect(effortInput(container, 'high').getAttribute('aria-invalid')).toBe('true')
    expect(effortInput(container, 'max').getAttribute('aria-invalid')).toBe('false')
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('reasoningEffortMultiplierPositive')
  })

  it('does not assign a model-specific multiplier to Fable', () => {
    const { container } = render(<PricingEntryCard entry={{ ...createEntry(), models: ['claude-fable-5-1'] }} />)
    expect(effortInput(container, 'max').value).toBe('')
    expect(effortInput(container, 'max').getAttribute('placeholder')).toBe('admin.channels.form.reasoningEffortMultiplierDefault')
  })

  it('keeps custom effort multipliers when auto-filling model token prices', async () => {
    vi.mocked(channelsAPI.getModelDefaultPricing).mockResolvedValue({
      found: true,
      input_price: 3e-6,
      output_price: 15e-6
    })
    const onUpdate = vi.fn()
    render(<PricingEntryCard entry={{ ...createEntry(), reasoning_effort_multipliers: { high: 0.5 } }} onUpdate={onUpdate} />)
    act(() => stubs.onModelsChange!(['example-model']))
    await flushPromises()
    expect(onUpdate.mock.calls.at(-1)![0]).toMatchObject({
      models: ['example-model'],
      input_price: 3,
      output_price: 15,
      reasoning_effort_multipliers: { high: 0.5 }
    })
  })
})
