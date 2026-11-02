/**
 * Usage request flow sankey (Arc Pro sankey-flow)
 */
export default {
  flowUi: {
    title: 'Request flow',
    description: 'Group, then requested model, then the model sent upstream',
    metricLabel: 'Flow weight',
    metric: {
      tokens: 'Tokens',
      actualCost: 'Actual cost',
      requests: 'Requests'
    },
    columns: {
      group: 'Group',
      requested: 'Requested model',
      upstream: 'Upstream model'
    },
    noGroup: 'No group',
    otherGroups: 'Other groups',
    otherModels: 'Other models',
    unknownModel: 'Unknown model',
    total: 'the total',
    empty: 'No requests in this range',
    failed: 'Failed to load request flow',
    retry: 'Retry',
    sankey: {
      flow: 'Flow',
      from: 'From',
      to: 'To',
      value: 'Value',
      shareOfSource: 'Share of source',
      roleDescription: 'flow diagram',
      keyboardHint: 'Arrow keys move between stages and nodes, Escape clears.',
      toNode: 'to {label}',
      fromNode: 'from {label}',
      linkTitle: '{source} to {target}',
      shareOf: '{share} of {of}'
    }
  }
}
