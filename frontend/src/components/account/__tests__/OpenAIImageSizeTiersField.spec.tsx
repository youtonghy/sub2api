import { cleanup, fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import OpenAIImageSizeTiersField from '../OpenAIImageSizeTiersField'
import {
  applyOpenAIImageSizeTiersToExtra,
  openAIImageSizeTiersPayload,
  readOpenAIImageSizeTiers,
  type OpenAIImageSizeTier
} from '../openaiImageSizeTiers'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' })
}))

afterEach(cleanup)

describe('openaiImageSizeTiers helpers', () => {
  it('reads unrestricted extra as all tiers', () => {
    expect(readOpenAIImageSizeTiers(undefined)).toEqual(['1K', '2K', '4K'])
    expect(readOpenAIImageSizeTiers({ openai_image_size_tiers: [] })).toEqual(['1K', '2K', '4K'])
    expect(readOpenAIImageSizeTiers({ openai_image_size_tiers: ['8K'] })).toEqual(['1K', '2K', '4K'])
  })

  it('reads restricted tiers in canonical order', () => {
    expect(readOpenAIImageSizeTiers({ openai_image_size_tiers: ['4k', ' 1K'] })).toEqual(['1K', '4K'])
  })

  it('omits the key when every tier is allowed', () => {
    expect(openAIImageSizeTiersPayload(['4K', '1K', '2K'])).toBeNull()
    expect(openAIImageSizeTiersPayload(['2K', '1K'])).toEqual(['1K', '2K'])

    const extra: Record<string, unknown> = { openai_image_size_tiers: ['4K'] }
    applyOpenAIImageSizeTiersToExtra(extra, ['1K', '2K', '4K'])
    expect(extra).not.toHaveProperty('openai_image_size_tiers')
    applyOpenAIImageSizeTiersToExtra(extra, ['4K'])
    expect(extra.openai_image_size_tiers).toEqual(['4K'])
  })
})

describe('OpenAIImageSizeTiersField', () => {
  it('toggles tiers and keeps at least one selected', () => {
    const changes: OpenAIImageSizeTier[][] = []
    function Harness() {
      const [value, setValue] = useState<OpenAIImageSizeTier[]>(['1K', '2K', '4K'])
      return (
        <OpenAIImageSizeTiersField
          value={value}
          onChange={(next) => {
            changes.push(next)
            setValue(next)
          }}
        />
      )
    }
    const { container } = render(<Harness />)
    const box = (tier: string) => container.querySelector(`[data-testid="openai-image-size-tier-${tier}"]`) as HTMLElement

    fireEvent.click(box('4K'))
    expect(changes.at(-1)).toEqual(['1K', '2K'])
    fireEvent.click(box('1K'))
    expect(changes.at(-1)).toEqual(['2K'])

    fireEvent.click(box('2K'))
    expect(box('2K').getAttribute('aria-checked')).toBe('true')
    expect(changes).toHaveLength(2)
    expect(box('2K').parentElement?.parentElement?.getAttribute('title')).toBe('admin.accounts.openai.imageSizeTiersAtLeastOne')

    fireEvent.click(box('4K'))
    expect(changes.at(-1)).toEqual(['2K', '4K'])
  })

  it('hides the label and uses the custom test id prefix', () => {
    const { container } = render(
      <OpenAIImageSizeTiersField value={['1K', '2K', '4K']} onChange={() => {}} hideLabel testIdPrefix="bulk-tier" disabled />
    )
    expect(container.textContent).not.toContain('admin.accounts.openai.imageSizeTiers ')
    expect(container.querySelector('label')?.textContent).toBe('1K')
    const box = container.querySelector('[data-testid="bulk-tier-1K"]') as HTMLButtonElement
    expect(box.disabled).toBe(true)
  })
})
