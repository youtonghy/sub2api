import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GroupStat, ModelStat } from '@/types'
import UsageFlowSankey from '../UsageFlowSankey'
import { createFlowQuery } from '../usageFlowData'

const { getModelStats, inView } = vi.hoisted(() => ({ getModelStats: vi.fn(), inView: { value: true } }))

vi.mock('@/api/admin', () => ({ adminAPI: { dashboard: { getModelStats } } }))
vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' })
}))
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useInView: () => inView.value
}))

const group = (group_id: number, total_tokens: number): GroupStat => ({
  group_id,
  group_name: `G${group_id}`,
  requests: 1,
  total_tokens,
  cost: 0,
  actual_cost: 0
})
const mapping = (model: string, total_tokens: number): ModelStat => ({
  model,
  requests: 1,
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
  total_tokens,
  cost: 0,
  actual_cost: 0
})

const params = { start_date: '2026-11-01', end_date: '2026-11-02', model: undefined }

// jsdom 没有布局：给桑基图一个宽度，它才会画出节点与读屏表格
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
beforeEach(() => {
  inView.value = true
  getModelStats.mockReset()
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 })
})
afterEach(() => {
  cleanup()
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth)
})

describe('UsageFlowSankey', () => {
  it('waits until the panel is in view before requesting', () => {
    inView.value = false
    render(<UsageFlowSankey query={createFlowQuery(params, [group(1, 10), group(2, 5)])} />)
    expect(getModelStats).not.toHaveBeenCalled()
  })

  it('requests mapping stats once per top group and draws the flow', async () => {
    getModelStats.mockImplementation(async ({ group_id }: { group_id?: number }) => ({
      models: group_id === 1 ? [mapping('a -> a2', 10)] : [mapping('b -> b', 5)]
    }))
    render(<UsageFlowSankey query={createFlowQuery(params, [group(1, 10), group(2, 5)])} />)
    await waitFor(() => expect(screen.getAllByText('G1').length).toBeGreaterThan(0))
    expect(getModelStats).toHaveBeenCalledTimes(2)
    expect(getModelStats).toHaveBeenCalledWith(expect.objectContaining({ model_source: 'mapping', group_id: 1 }))
    expect(getModelStats).toHaveBeenCalledWith(expect.objectContaining({ model_source: 'mapping', group_id: 2 }))
    expect(screen.getAllByText('a2').length).toBeGreaterThan(0)
  })

  it('drops a response that arrives after the filters changed', async () => {
    let resolveOld: (value: { models: ModelStat[] }) => void = () => {}
    getModelStats
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValueOnce({ models: [mapping('fresh -> fresh', 3)] })
    const { rerender } = render(<UsageFlowSankey query={createFlowQuery(params, [group(7, 1)])} />)
    rerender(<UsageFlowSankey query={createFlowQuery({ ...params, end_date: '2026-11-03' }, [group(7, 1)])} />)
    await waitFor(() => expect(screen.getAllByText('fresh').length).toBeGreaterThan(0))
    await act(async () => {
      resolveOld({ models: [mapping('stale -> stale', 9)] })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.queryByText('stale')).toBeNull()
    expect(screen.getAllByText('fresh').length).toBeGreaterThan(0)
    expect(getModelStats).toHaveBeenCalledTimes(2)
  })

  it('shows an error with retry when a request fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    getModelStats.mockRejectedValueOnce(new Error('boom'))
    render(<UsageFlowSankey query={createFlowQuery(params, [group(3, 1)])} />)
    expect(await screen.findByText('flowUi.failed')).toBeTruthy()
    expect(error).toHaveBeenCalledWith('[UsageFlowSankey] failed to load mapping model stats', expect.any(Error))
    error.mockRestore()
  })
})
