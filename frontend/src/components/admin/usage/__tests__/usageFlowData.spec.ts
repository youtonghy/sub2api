import { describe, expect, it } from 'vitest'

import type { GroupStat, ModelStat } from '@/types'
import { OVERALL_KEY, buildFlowGraph, parseMappingModel, planFlowRequests, type FlowLabels } from '../usageFlowData'

const group = (group_id: number, total_tokens: number, extra: Partial<GroupStat> = {}): GroupStat => ({
  group_id,
  group_name: group_id ? `G${group_id}` : '',
  requests: total_tokens ? 1 : 0,
  total_tokens,
  cost: 0,
  actual_cost: 0,
  ...extra
})

const mapping = (model: string, total_tokens: number, extra: Partial<ModelStat> = {}): ModelStat => ({
  model,
  requests: 1,
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
  total_tokens,
  cost: 0,
  actual_cost: 0,
  ...extra
})

const labels: FlowLabels = {
  groupName: (g) => g.group_name || 'No group',
  otherGroups: 'Other groups',
  otherModels: 'Other models',
  unknownModel: 'Unknown'
}

const linkMap = (links: { source: string; target: string; value: number }[]) =>
  Object.fromEntries(links.map((link) => [`${link.source} => ${link.target}`, link.value]))

describe('parseMappingModel', () => {
  it('splits the backend "requested -> upstream" format', () => {
    expect(parseMappingModel('gpt-5 -> gpt-5-codex')).toEqual({ requested: 'gpt-5', upstream: 'gpt-5-codex' })
  })

  it('treats a plain model as unmapped', () => {
    expect(parseMappingModel('claude-sonnet')).toEqual({ requested: 'claude-sonnet', upstream: 'claude-sonnet' })
  })
})

describe('planFlowRequests', () => {
  it('needs no request without groups', () => {
    expect(planFlowRequests([], 'tokens').keys).toEqual([])
  })

  it('uses one overall request for a single group', () => {
    const plan = planFlowRequests([group(3, 10)], 'tokens')
    expect(plan).toMatchObject({ keys: [OVERALL_KEY], single: true })
  })

  it('requests each top group and skips the overall call when nothing is left over', () => {
    const plan = planFlowRequests([group(1, 10), group(2, 30)], 'tokens')
    expect(plan.keys).toEqual(['2', '1'])
    expect(plan.rest).toEqual([])
  })

  it('caps groups and derives the rest, including the ungrouped bucket, from the overall call', () => {
    const groups = [group(0, 100), ...[1, 2, 3, 4, 5, 6].map((id) => group(id, id * 10))]
    const plan = planFlowRequests(groups, 'tokens', 5)
    expect(plan.keys).toEqual(['6', '5', '4', '3', '2', OVERALL_KEY])
    expect(plan.rest.map((g) => g.group_id)).toEqual([0, 1])
  })

  it('ranks groups by the chosen metric', () => {
    const groups = [group(1, 100, { actual_cost: 1 }), group(2, 10, { actual_cost: 5 })]
    expect(planFlowRequests(groups, 'actual_cost').keys).toEqual(['2', '1'])
  })
})

describe('buildFlowGraph', () => {
  it('returns null until every planned response has arrived', () => {
    const plan = planFlowRequests([group(1, 10), group(2, 10)], 'tokens')
    expect(buildFlowGraph({ plan, stats: { '1': [] }, metric: 'tokens', labels })).toBeNull()
  })

  it('builds group, requested and upstream columns with exact link values', () => {
    const plan = planFlowRequests([group(1, 60), group(2, 40)], 'tokens')
    const graph = buildFlowGraph({
      plan,
      stats: {
        '1': [mapping('a -> a2', 50), mapping('b -> b', 10)],
        '2': [mapping('a -> a2', 40)]
      },
      metric: 'tokens',
      labels
    })!
    expect(graph.total).toBe(100)
    expect(graph.nodes.map((node) => [node.id, node.column])).toEqual([
      ['g:1', 0],
      ['g:2', 0],
      ['r:a', 1],
      ['r:b', 1],
      ['u:a2', 2],
      ['u:b', 2]
    ])
    expect(linkMap(graph.links)).toEqual({
      'g:1 => r:a': 50,
      'g:1 => r:b': 10,
      'g:2 => r:a': 40,
      'r:a => u:a2': 90,
      'r:b => u:b': 10
    })
  })

  it('derives the remaining groups by subtracting top groups from the overall totals', () => {
    const plan = planFlowRequests([group(1, 60), group(0, 30), group(2, 5)], 'tokens', 1)
    const graph = buildFlowGraph({
      plan,
      stats: {
        '1': [mapping('a -> a', 60)],
        [OVERALL_KEY]: [mapping('a -> a', 80), mapping('b -> c', 15)]
      },
      metric: 'tokens',
      labels
    })!
    const other = graph.nodes.find((node) => node.column === 0 && node.id !== 'g:1')!
    expect(other.label).toBe('Other groups')
    const links = linkMap(graph.links)
    expect(links[`g:1 => r:a`]).toBe(60)
    expect(links[`${other.id} => r:a`]).toBe(20)
    expect(links[`${other.id} => r:b`]).toBe(15)
    expect(links['r:a => u:a']).toBe(80)
    expect(links['r:b => u:c']).toBe(15)
  })

  it('names a single remaining group instead of calling it other', () => {
    const plan = planFlowRequests([group(1, 60), group(0, 30)], 'tokens')
    const graph = buildFlowGraph({
      plan,
      stats: { '1': [mapping('a -> a', 60)], [OVERALL_KEY]: [mapping('a -> a', 90)] },
      metric: 'tokens',
      labels
    })!
    expect(graph.nodes.filter((node) => node.column === 0).map((node) => node.label)).toEqual(['G1', 'No group'])
  })

  it('drops non-positive differences caused by concurrent writes', () => {
    const plan = planFlowRequests([group(1, 60), group(0, 1)], 'tokens')
    const graph = buildFlowGraph({
      plan,
      stats: { '1': [mapping('a -> a', 61)], [OVERALL_KEY]: [mapping('a -> a', 60)] },
      metric: 'tokens',
      labels
    })!
    expect(graph.nodes.filter((node) => node.column === 0)).toHaveLength(1)
  })

  it('merges models beyond the cap into an other node at the end of each column', () => {
    const plan = planFlowRequests([group(1, 100)], 'requests')
    const stats = ['m1', 'm2', 'm3', 'm4'].map((model, index) => mapping(`${model} -> up`, 0, { requests: 10 - index }))
    const graph = buildFlowGraph({ plan, stats: { [OVERALL_KEY]: stats }, metric: 'requests', labels, maxModels: 3 })!
    const requested = graph.nodes.filter((node) => node.column === 1)
    expect(requested.map((node) => node.label)).toEqual(['m1', 'm2', 'Other models'])
    expect(linkMap(graph.links)['g:1 => r:\u0000other']).toBe(8 + 7)
  })

  it('applies the page model filter to the requested model', () => {
    const plan = planFlowRequests([group(1, 100)], 'tokens')
    const graph = buildFlowGraph({
      plan,
      stats: { [OVERALL_KEY]: [mapping('a -> x', 10), mapping('b -> x', 20)] },
      metric: 'tokens',
      labels,
      modelFilter: 'b'
    })!
    expect(graph.total).toBe(20)
    expect(graph.nodes.map((node) => node.id)).toEqual(['g:1', 'r:b', 'u:x'])
  })

  it('weights by actual cost when asked', () => {
    const plan = planFlowRequests([group(1, 100, { actual_cost: 2 })], 'actual_cost')
    const graph = buildFlowGraph({
      plan,
      stats: { [OVERALL_KEY]: [mapping('a -> a', 999, { actual_cost: 1.5 })] },
      metric: 'actual_cost',
      labels
    })!
    expect(graph.total).toBe(1.5)
  })
})
