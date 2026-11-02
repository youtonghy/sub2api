import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { UserSupportedModel } from '@/api/channels'
import SupportedModelChip from '../SupportedModelChip'

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

const trigger = (container: HTMLElement) => container.querySelector('[tabindex="0"]') as HTMLElement

describe('SupportedModelChip', () => {
  it.each(['availableChannels.pricing', 'admin.availableChannels.pricing'])(
    'shows video prices per second using %s translations',
    (pricingKeyPrefix) => {
      const model: UserSupportedModel = {
        name: 'video-test',
        platform: '',
        pricing: {
          billing_mode: 'video',
          input_price: null,
          output_price: null,
          cache_write_price: null,
          cache_read_price: null,
          image_input_price: null,
          image_output_price: null,
          per_request_price: 0.05,
          intervals: [
            { tier_label: '480p', min_tokens: 0, max_tokens: null, input_price: null, output_price: null, cache_write_price: null, cache_read_price: null, per_request_price: 0 },
            { tier_label: '720p', min_tokens: 0, max_tokens: null, input_price: null, output_price: null, cache_write_price: null, cache_read_price: null, per_request_price: 0.12 }
          ]
        }
      }
      const view = render(<SupportedModelChip pricingKeyPrefix={pricingKeyPrefix} model={model} />)
      fireEvent.mouseEnter(trigger(view.container))
      const tooltip = screen.getByRole('tooltip')
      expect(tooltip.textContent).toContain(`${pricingKeyPrefix}.billingModeVideo`)
      expect(tooltip.textContent).toContain(`${pricingKeyPrefix}.videoPrice`)
      expect(tooltip.textContent).toContain(`$0.05 ${pricingKeyPrefix}.unitPerSecond`)
      expect(tooltip.textContent).toContain('480p')
      expect(tooltip.textContent).toContain(`$0 ${pricingKeyPrefix}.unitPerSecond`)
      expect(tooltip.textContent).toContain('720p')
      expect(tooltip.textContent).toContain(`$0.12 ${pricingKeyPrefix}.unitPerSecond`)

      view.rerender(
        <SupportedModelChip
          pricingKeyPrefix={pricingKeyPrefix}
          model={{ ...model, pricing: { ...model.pricing!, per_request_price: null } }}
        />
      )
      expect(tooltip.textContent).not.toContain(`${pricingKeyPrefix}.videoPrice`)
      expect(tooltip.textContent).toContain(`$0.12 ${pricingKeyPrefix}.unitPerSecond`)

      view.rerender(
        <SupportedModelChip
          pricingKeyPrefix={pricingKeyPrefix}
          model={{ ...model, pricing: { ...model.pricing!, per_request_price: 0 } }}
        />
      )
      expect(tooltip.textContent).toContain(`${pricingKeyPrefix}.videoPrice`)
      expect(screen.getByTestId('pricing-row').textContent).toContain(`$0 ${pricingKeyPrefix}.unitPerSecond`)
      view.unmount()
    }
  )

  it('仅配置区间倍率时按基础价展示 token 档位', () => {
    const view = render(
      <SupportedModelChip
        showPlatform={false}
        model={{
          name: 'gpt-test',
          platform: '',
          pricing: {
            billing_mode: 'token',
            input_price: 10e-6,
            output_price: 50e-6,
            cache_write_price: null,
            cache_read_price: null,
            image_input_price: null,
            image_output_price: null,
            per_request_price: null,
            intervals: [
              {
                min_tokens: 272000,
                max_tokens: null,
                input_price: null,
                output_price: null,
                cache_write_price: null,
                cache_read_price: null,
                input_multiplier: 2,
                output_multiplier: 1.5,
                per_request_price: null
              }
            ]
          }
        }}
      />
    )

    fireEvent.mouseEnter(trigger(view.container))

    expect(document.body.textContent).toContain('$20 / $75')
    view.unmount()
  })
})
