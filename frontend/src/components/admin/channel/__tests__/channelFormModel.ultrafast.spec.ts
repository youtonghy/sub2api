import { describe, expect, it } from 'vitest'

import type { Channel } from '@/api/admin/channels'
import type { AdminGroup } from '@/types'
import { apiToForm, formToAPI, newChannelPricingEntry, newPlatformSection } from '../channelFormModel'

describe('channelFormModel Ultra Fast pricing and Bedrock compatibility', () => {
  it('sends the Ultra Fast multiplier as a number and clears empty values', () => {
    const section = newPlatformSection('openai')
    section.group_ids = [3]
    section.model_pricing = [
      { ...newChannelPricingEntry(['gpt-6.2-sol']), ultrafast_multiplier: '3' },
      { ...newChannelPricingEntry(['gpt-6.2-astra']), ultrafast_multiplier: '' }
    ]

    const { model_pricing } = formToAPI([section], null)

    expect(model_pricing.map((p) => p.ultrafast_multiplier)).toEqual([3, null])
  })

  it('loads the Ultra Fast multiplier back into the form', () => {
    const channel = {
      id: 1,
      group_ids: [3],
      model_pricing: [{ platform: 'openai', models: ['gpt-6.2-sol'], billing_mode: 'token', ultrafast_multiplier: 6 }],
      model_mapping: {},
      features_config: {}
    } as unknown as Channel
    const groups = [{ id: 3, platform: 'openai' }] as unknown as AdminGroup[]

    const sections = apiToForm(channel, groups, ['openai'], [])

    expect(sections[0].model_pricing[0].ultrafast_multiplier).toBe(6)
  })

  it('persists Bedrock compatibility as a channel-level boolean, sending false to clear it', () => {
    const anthropic = newPlatformSection('anthropic')
    anthropic.group_ids = [5]
    anthropic.bedrock_cc_compat = true
    expect(formToAPI([anthropic], null).features_config.bedrock_cc_compat).toBe(true)

    anthropic.bedrock_cc_compat = false
    const editing = { features_config: { bedrock_cc_compat: true } } as unknown as Channel
    expect(formToAPI([anthropic], editing).features_config.bedrock_cc_compat).toBe(false)

    const openai = newPlatformSection('openai')
    openai.bedrock_cc_compat = true
    expect(formToAPI([openai], null).features_config.bedrock_cc_compat).toBe(false)
  })
})
