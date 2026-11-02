import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import channelsAPI from '@/api/admin/channels'
import PricingEntryCard from '../PricingEntryCard'
import type { PricingFormEntry } from '../types'

vi.mock('@/api/admin/channels', () => ({
  default: { getModelDefaultPricing: vi.fn() }
}))

const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

// Vue 版用 shallowMount 后对 ModelTagInput 发出 update:models；这里把 ModelTagInput 换成只记录回调的桩
const modelTagInput = vi.hoisted(() => ({ onModelsChange: undefined as undefined | ((models: string[]) => void) }))
vi.mock('../ModelTagInput', () => ({
  default: (props: { onModelsChange?: (models: string[]) => void }) => {
    modelTagInput.onModelsChange = props.onModelsChange
    return <div data-testid="model-tag-input" />
  }
}))

const getModelDefaultPricing = vi.mocked(channelsAPI.getModelDefaultPricing)
const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

function createEntry(models: string[] = []): PricingFormEntry {
  return {
    models,
    billing_mode: 'token',
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
      periods: []
    }
  }
}

function addModels(entry: PricingFormEntry, models: string[]) {
  const onUpdate = vi.fn()
  render(<PricingEntryCard entry={entry} onUpdate={onUpdate} />)
  act(() => modelTagInput.onModelsChange!(models))
  return onUpdate
}

const emittedEntries = (onUpdate: ReturnType<typeof vi.fn>) => onUpdate.mock.calls.map((call) => call[0] as PricingFormEntry)

describe('PricingEntryCard default price auto-fill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getModelDefaultPricing.mockResolvedValue({ found: true, input_price: 3e-6, output_price: 15e-6 })
  })

  it('auto-fills the default price when a model is added to an empty entry', async () => {
    const onUpdate = addModels(createEntry(), ['claude-opus-4-8'])
    await flushPromises()

    expect(getModelDefaultPricing).toHaveBeenCalledTimes(1)
    expect(getModelDefaultPricing).toHaveBeenCalledWith('claude-opus-4-8')
    expect(emittedEntries(onUpdate).at(-1)).toMatchObject({
      models: ['claude-opus-4-8'],
      input_price: 3,
      output_price: 15
    })
  })

  it('does not overwrite prices when appending a model to an entry that already has one', async () => {
    const entry = createEntry(['claude-opus-4-7'])
    const onUpdate = addModels(entry, ['claude-opus-4-7', 'claude-opus-4-8'])
    await flushPromises()

    expect(getModelDefaultPricing).not.toHaveBeenCalled()
    expect(emittedEntries(onUpdate).at(-1)).toMatchObject({
      models: ['claude-opus-4-7', 'claude-opus-4-8']
    })
    for (const emitted of emittedEntries(onUpdate)) {
      expect(emitted.input_price).toBeNull()
      expect(emitted.output_price).toBeNull()
      expect(emitted.cache_write_price).toBeNull()
      expect(emitted.cache_read_price).toBeNull()
    }
  })

  it('does not auto-fill a shared price when several models are added to an empty entry at once', async () => {
    const onUpdate = addModels(createEntry(), ['claude-opus-4-7', 'claude-opus-4-8'])
    await flushPromises()

    expect(getModelDefaultPricing).not.toHaveBeenCalled()
    expect(emittedEntries(onUpdate).at(-1)).toMatchObject({
      models: ['claude-opus-4-7', 'claude-opus-4-8'],
      input_price: null,
      output_price: null
    })
  })

  it('keeps manual prices untouched when a model is appended', async () => {
    const entry = { ...createEntry(['claude-opus-4-7']), input_price: '1.5' }
    const onUpdate = addModels(entry, ['claude-opus-4-7', 'claude-opus-4-8'])
    await flushPromises()

    expect(getModelDefaultPricing).not.toHaveBeenCalled()
    for (const emitted of emittedEntries(onUpdate)) {
      expect(emitted.input_price).toBe('1.5')
    }
  })
})
