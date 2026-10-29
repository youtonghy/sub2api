import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Account } from '@/types'
import GrokQuotaProbeCell from '../GrokQuotaProbeCell'

const { queryQuota } = vi.hoisted(() => ({
  queryQuota: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    grok: { queryQuota }
  }
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params?.percent == null ? key : `${key}:${params.percent}`),
    te: () => true,
    locale: 'en'
  })
}))

const account = {
  id: 99,
  platform: 'grok',
  type: 'oauth'
} as Account

describe('GrokQuotaProbeCell', () => {
  beforeEach(() => {
    queryQuota.mockReset()
  })

  afterEach(() => cleanup())

  it('keeps billing data while exposing a failed Free quota fallback', async () => {
    queryQuota.mockResolvedValue({
      source: 'hybrid_probe',
      billing: { period_type: 'weekly', usage_percent: null },
      headers_observed: false,
      reset_supported: false,
      fetched_at: 1,
      probe_error: 'upstream returned 402 for probe model "grok-4.5"'
    })
    const onProbed = vi.fn()
    const { container } = render(<GrokQuotaProbeCell account={account} onProbed={onProbed} />)

    await act(async () => {
      fireEvent.click(container.querySelector('button')!)
    })
    await act(async () => {})

    expect(container.textContent).toContain('upstream returned 402 for probe model "grok-4.5"')
    expect(onProbed.mock.calls[0]?.[0]).toMatchObject({
      billing: { period_type: 'weekly', usage_percent: null },
      probe_error: 'upstream returned 402 for probe model "grok-4.5"'
    })
  })
})
