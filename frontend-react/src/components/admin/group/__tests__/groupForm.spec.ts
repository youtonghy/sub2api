import { describe, expect, it } from 'vitest'

import type { AdminGroup } from '@/types'
import { createModelAllowlistState } from '@/views/admin/groupModelAllowlist'
import {
  applyEditHydrationWatchers,
  applySubscriptionTypeChange,
  buildCreateGroupPayload,
  buildUpdateGroupPayload,
  createGroupFormDefaults,
  createModelRoutingRule,
  groupFormFromGroup,
  toModelNumber,
  withBatchImagePricingReset
} from '../groupForm'

const ctx = (overrides = {}) => ({
  routingRules: [],
  allowlist: createModelAllowlistState(),
  isSimpleMode: false,
  ...overrides
})

describe('groupForm', () => {
  it('mirrors v-model.number parsing', () => {
    expect(toModelNumber('1.5')).toBe(1.5)
    expect(toModelNumber('1e3')).toBe(1000)
    expect(toModelNumber('')).toBe('')
  })

  it('sends only identity fields from simple mode', () => {
    const form = { ...createGroupFormDefaults('create'), name: 'g', description: 'd' }
    expect(buildCreateGroupPayload(form, ctx({ isSimpleMode: true }))).toEqual({
      name: 'g',
      description: 'd',
      i18n: {},
      platform: 'anthropic'
    })
    expect(buildUpdateGroupPayload({ ...form, status: 'active' }, { ...ctx({ isSimpleMode: true }), codexManifest: { enabled: true, account_ids: [1], fallback_to_scheduler: false } })).toEqual({
      name: 'g',
      description: 'd',
      i18n: {}
    })
  })

  it('builds the create payload with normalized prices, routing and profit control', () => {
    const form = {
      ...createGroupFormDefaults('create'),
      name: 'g',
      image_price_1k: '',
      daily_limit_usd: '',
      profit_control_enabled: true,
      profit_min_margin_percent: 10,
      allow_batch_image_generation: true,
      batch_image_discount_multiplier: 0.2
    }
    const payload = buildCreateGroupPayload(form, {
      ...ctx(),
      routingRules: [createModelRoutingRule('claude-*', [{ id: 3, name: 'a' }]), createModelRoutingRule(' ', [])]
    })
    expect(payload.image_price_1k).toBeNull()
    expect(payload.daily_limit_usd).toBeNull()
    expect(payload).not.toHaveProperty('video_model_prices')
    expect(payload).not.toHaveProperty('profit_min_margin_percent')
    expect(payload.profit_control_enabled).toBe(true)
    expect(payload.profit_min_margin).toBeCloseTo(0.1)
    expect(payload.model_routing).toEqual({ 'claude-*': [3] })
    expect(payload.codex_models_manifest_config).toEqual({ enabled: false, account_ids: [], fallback_to_scheduler: false })
    // 未开启生图时批量生图被关闭，批量倍率恢复默认
    expect(payload.allow_batch_image_generation).toBe(false)
    expect(payload.batch_image_discount_multiplier).toBe(0.5)
    expect(payload.messages_dispatch_model_config).toBeUndefined()
  })

  it('builds the update payload with clear markers and fallbacks', () => {
    const group = {
      id: 9,
      name: 'g',
      platform: 'composite',
      status: 'active',
      subscription_type: 'standard',
      image_price_1k: 0.2,
      fallback_group_id: null,
      fallback_group_id_on_invalid_request: null,
      rate_multiplier: 1,
      is_exclusive: false
    } as unknown as AdminGroup
    const form = { ...groupFormFromGroup(group), image_price_1k: '' }
    const payload = buildUpdateGroupPayload(form, {
      ...ctx(),
      codexManifest: { enabled: true, account_ids: [1], fallback_to_scheduler: true }
    })
    expect(payload.image_price_1k).toBe(-1)
    expect(payload.fallback_group_id).toBe(0)
    expect(payload.fallback_group_id_on_invalid_request).toBe(0)
    // 非 openai 分组固定提交关闭的 manifest
    expect(payload.codex_models_manifest_config).toEqual({ enabled: false, account_ids: [], fallback_to_scheduler: false })
    expect(payload.video_model_prices).toEqual({})
    expect(payload.status).toBe('active')
  })

  it('applies create subscription defaults and resets peak rate when going back to standard', () => {
    const form = { ...createGroupFormDefaults('create'), fallback_group_id_on_invalid_request: 3 }
    const subscribed = applySubscriptionTypeChange({ ...form, subscription_type: 'subscription' }, 'create')
    expect(subscribed.is_exclusive).toBe(true)
    expect(subscribed.fallback_group_id_on_invalid_request).toBeNull()
    const standard = applySubscriptionTypeChange(
      { ...subscribed, subscription_type: 'standard', peak_rate_enabled: true, peak_start: '09:00' },
      'create'
    )
    expect(standard.peak_rate_enabled).toBe(false)
    expect(standard.peak_start).toBe('')
  })

  it('runs the platform watcher only when the hydrated platform changes', () => {
    const previous = createGroupFormDefaults('edit')
    const next = { ...createGroupFormDefaults('edit'), platform: 'composite' as const, require_oauth_only: true }
    expect(applyEditHydrationWatchers(previous, next).require_oauth_only).toBe(false)
    expect(applyEditHydrationWatchers({ ...previous, platform: 'composite' }, next).require_oauth_only).toBe(true)
  })

  it('resets batch image pricing when generation is disabled', () => {
    const form = {
      ...createGroupFormDefaults('edit'),
      allow_image_generation: false,
      allow_batch_image_generation: true,
      image_count_billing: true
    }
    const next = withBatchImagePricingReset(form)
    expect(next.allow_batch_image_generation).toBe(false)
    expect(next.image_count_billing).toBe(false)
  })
})
