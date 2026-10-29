import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ModelFingerprintPanel from '../ModelFingerprintPanel'

const getModelFingerprintBank = vi.fn()
const modelFingerprint = vi.fn()
const getAvailableModels = vi.fn()

vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      getModelFingerprintBank: (...args: unknown[]) => getModelFingerprintBank(...args),
      modelFingerprint: (...args: unknown[]) => modelFingerprint(...args),
      getAvailableModels: (...args: unknown[]) => getAvailableModels(...args)
    }
  }
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
    te: () => false,
    locale: 'en',
    setLocale: vi.fn()
  })
}))

vi.mock('@/components/common/Select', () => ({
  default: () => <select />
}))

const accounts = [
  { id: 1, name: 'account-a', platform: 'openai', status: 'active' },
  { id: 2, name: 'account-b', platform: 'openai', status: 'active' }
] as never[]

const flushPromises = () => act(async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
})

const mountPanel = () => render(<ModelFingerprintPanel accounts={accounts} platform="openai" active />)

beforeEach(() => {
  getModelFingerprintBank.mockReset().mockResolvedValue({
    built_at: '2026-10-27T05:02:50Z',
    schema: 'shared-detector-v2',
    models: [
      { id: 'gpt-6-sol', display_name: 'gpt-6-sol', family: 'gpt', family_name: 'GPT' },
      { id: 'claude-opus-5', display_name: 'claude-opus-5', family: 'claude', family_name: 'Claude' }
    ]
  })
  getAvailableModels.mockReset().mockImplementation(async (id: number) =>
    id === 1
      ? [{ id: 'gpt-6-sol', display_name: 'gpt-6-sol' }, { id: 'private-model', display_name: 'private-model' }]
      : [{ id: 'gpt-6-sol', display_name: 'gpt-6-sol' }]
  )
  modelFingerprint.mockReset()
})

describe('ModelFingerprintPanel', () => {
  it('selects every account and the union of their models by default', async () => {
    mountPanel()
    await flushPromises()

    const accountBoxes = screen.getAllByTestId('model-fingerprint-account')
    expect(accountBoxes).toHaveLength(2)
    expect(accountBoxes.every((box) => box.getAttribute('aria-checked') === 'true')).toBe(true)

    const modelBoxes = screen.getAllByTestId('model-fingerprint-model')
    expect(modelBoxes.map((box) => box.getAttribute('value'))).toEqual(['gpt-6-sol', 'private-model'])
  })

  it('marks models that exist in the reference bank as comparable', async () => {
    mountPanel()
    await flushPromises()

    const rows = screen.getAllByTestId('model-fingerprint-model').map((box) => box.closest('[data-testid="model-fingerprint-model-row"]'))
    // gpt-6-sol is in the bank, private-model is not.
    expect(rows[0]?.textContent).toContain('admin.accounts.modelFingerprint.comparable')
    expect(rows[1]?.textContent).not.toContain('admin.accounts.modelFingerprint.comparable')
    expect(document.body.textContent).toContain('admin.accounts.modelFingerprint.incomparableHint')
  })

  it('submits the selected matrix with the chosen rounds and renders the report', async () => {
    modelFingerprint.mockResolvedValue({
      started_at: '2026-10-27T00:00:00Z',
      finished_at: '2026-10-27T00:01:00Z',
      rounds: 3,
      bank_built_at: '2026-10-27T05:02:50Z',
      results: [
        {
          account_id: 1,
          account_name: 'account-a',
          model_id: 'gpt-6-sol',
          requested_model: 'gpt-6-sol',
          decision: 'scored',
          prediction: 'gpt-6-sol',
          probability: 0.91,
          matches_claim: true,
          claim_comparable: true,
          used_outputs: 3,
          requested_rounds: 3,
          samples: [],
          tested_at: '2026-10-27T00:00:30Z'
        },
        {
          account_id: 2,
          account_name: 'account-b',
          model_id: 'private-model',
          requested_model: 'private-model',
          decision: 'partial',
          prediction: 'claude-opus-5',
          matches_claim: false,
          claim_comparable: false,
          used_outputs: 2,
          requested_rounds: 3,
          samples: [],
          tested_at: '2026-10-27T00:00:40Z'
        }
      ]
    })

    mountPanel()
    await flushPromises()
    fireEvent.click(screen.getByTestId('model-fingerprint-run'))
    await flushPromises()

    expect(modelFingerprint).toHaveBeenCalledTimes(1)
    const payload = modelFingerprint.mock.calls[0][0]
    expect(payload.account_ids).toEqual([1, 2])
    expect(payload.model_ids).toEqual(['gpt-6-sol', 'private-model'])
    expect(payload.rounds).toBe(3)
    expect(payload.concurrency).toBe(2)

    const rows = screen.getAllByTestId('model-fingerprint-row')
    expect(rows).toHaveLength(2)
    // The verdict column reflects match vs out-of-bank model.
    expect(rows[0].textContent).toContain('admin.accounts.modelFingerprint.verdicts.matches')
    expect(rows[1].textContent).toContain('admin.accounts.modelFingerprint.verdicts.incomparable')
    expect(rows[0].textContent).toContain('91.0%')
  })
})
