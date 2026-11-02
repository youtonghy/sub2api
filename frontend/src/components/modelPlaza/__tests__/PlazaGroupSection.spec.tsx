import { describe, expect, it, vi } from 'vitest'

import PlazaGroupSection from '../PlazaGroupSection'
import type { PlazaModelPricingTableProps } from '../PlazaModelPricingTable'
import type { ModelPlazaGroup, PlazaModel } from '@/api/modelPlaza'
import { mountElement } from './domWrapper'

const { tableProps } = vi.hoisted(() => ({ tableProps: [] as unknown[] }))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: 'en', setLocale: vi.fn() })
}))

vi.mock('@/stores/app', () => ({
  useAppStore: (selector: (state: { cachedPublicSettings: null }) => unknown) => selector({ cachedPublicSettings: null })
}))

// 对应 Vue spec 的 GroupBadge / PlazaModelPricingTable 桩：价格表桩记录收到的 props
vi.mock('@/components/common/GroupBadge', () => ({ default: () => null }))
vi.mock('../PlazaModelPricingTable', () => ({
  default: (props: unknown) => {
    tableProps.push(props)
    return null
  }
}))

/** 对应 Vue 的 findComponent(PlazaModelPricingTable)：返回最近一次渲染的 props */
function tableComponent() {
  const props = tableProps.at(-1) as PlazaModelPricingTableProps
  return {
    props: ((key?: keyof PlazaModelPricingTableProps) => (key ? props[key] : props)) as {
      (): PlazaModelPricingTableProps
      <K extends keyof PlazaModelPricingTableProps>(key: K): PlazaModelPricingTableProps[K]
    }
  }
}

function ladderModel(tiers: number): PlazaModel {
  const intervals = Array.from({ length: tiers }, (_, i) => ({
    min_tokens: i * 272000,
    max_tokens: i === tiers - 1 ? null : (i + 1) * 272000,
    tier_label: '',
    input_price: 5e-6,
    output_price: 3e-5,
    cache_write_price: null,
    cache_read_price: null,
    per_request_price: null
  }))
  return {
    name: 'gpt-5.6-sol',
    platform: 'openai',
    pricing: {
      billing_mode: 'token',
      input_price: 5e-6,
      output_price: 3e-5,
      cache_write_price: null,
      cache_read_price: null,
      image_input_price: null,
      image_output_price: null,
      per_request_price: null,
      intervals: []
    },
    official_pricing: {
      input_price: 5e-6,
      output_price: 3e-5,
      cache_write_price: null,
      cache_read_price: null,
      intervals
    }
  }
}

function group(overrides: Partial<ModelPlazaGroup> = {}): ModelPlazaGroup {
  return {
    id: 1,
    name: 'g',
    description: '',
    platform: 'openai',
    subscription_type: 'standard',
    rate_multiplier: 1,
    peak_rate_enabled: false,
    peak_start: '',
    peak_end: '',
    peak_rate_multiplier: 1,
    is_exclusive: false,
    image_rate_independent: false,
    image_rate_multiplier: 1,
    video_rate_independent: false,
    video_rate_multiplier: 1,
    long_context_pricing_enabled: true,
    models: [ladderModel(2)],
    ...overrides
  }
}

function mountSection(g: ModelPlazaGroup) {
  tableProps.length = 0
  return mountElement(<PlazaGroupSection group={g} />)
}

const NOTE = 'modelPlaza.detail.longContextDisabledNote'

describe('PlazaGroupSection 长上下文说明', () => {
  it('passes video-specific rates to the pricing table', () => {
    const wrapper = mountSection(group({ video_rate_independent: true, video_rate_multiplier: 0 }))
    expect(tableComponent().props()).toMatchObject({
      videoRateIndependent: true,
      videoRateMultiplier: 0
    })
    wrapper.unmount()
  })
  it('分组关闭阶梯且组内有官方阶梯模型时显示说明', () => {
    const wrapper = mountSection(group({ long_context_pricing_enabled: false }))
    expect(wrapper.text()).toContain(NOTE)
  })

  it('分组开启阶梯时不显示', () => {
    const wrapper = mountSection(group({ long_context_pricing_enabled: true }))
    expect(wrapper.text()).not.toContain(NOTE)
  })

  it('分组关闭但没有官方阶梯模型时不显示', () => {
    const wrapper = mountSection(
      group({ long_context_pricing_enabled: false, models: [ladderModel(1)] })
    )
    expect(wrapper.text()).not.toContain(NOTE)
  })

  it('旧后端缺少开关字段时不显示', () => {
    const g = group()
    delete (g as Partial<ModelPlazaGroup>).long_context_pricing_enabled
    const wrapper = mountSection(g)
    expect(wrapper.text()).not.toContain(NOTE)
  })
})

describe('PlazaGroupSection 高峰配置传递', () => {
  it('分组启用高峰时把窗口描述与倍率传给价格表', () => {
    mountSection(
      group({
        subscription_type: 'subscription',
        peak_rate_enabled: true,
        peak_start: '14:00',
        peak_end: '18:00',
        peak_rate_multiplier: 1.5
      })
    )
    const table = tableComponent()
    // appStore mock 无 server_utc_offset,窗口描述不带时区标注
    expect(table.props('peakWindow')).toBe('14:00-18:00 ×1.5')
    expect(table.props('peakRateMultiplier')).toBe(1.5)
  })

  it('分组未启用高峰时窗口描述为空串', () => {
    mountSection(group())
    expect(tableComponent().props('peakWindow')).toBe('')
  })
})
