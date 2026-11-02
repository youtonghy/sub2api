/**
 * Admin dashboard KPI drilldown and ranking race (Arc Pro kpi-drilldown, race-bar-chart)
 */
export default {
  insightsUi: {
    kpi: {
      title: 'Usage overview',
      // Series end yesterday (the last complete day); a range value is the sum of its days
      metrics: {
        requests: {
          label: 'Requests',
          description: 'Requests per day, counted through yesterday. A range shows the sum of its days.'
        },
        total_tokens: {
          label: 'Total tokens',
          description: 'Input, output and cache tokens per day, counted through yesterday.'
        },
        actual_cost: {
          label: 'Actual cost',
          description: 'Cost actually charged per day in USD, counted through yesterday.'
        },
        cost: {
          label: 'Standard cost',
          description: 'Cost per day at standard prices in USD, counted through yesterday.'
        }
      },
      dimensions: {
        model: 'Model',
        group: 'Group'
      },
      other: 'Other',
      noGroup: 'No group',
      loading: 'Loading usage overview',
      loadFailed: 'Failed to load usage overview',
      retry: 'Retry',
      labels: {
        compare: 'Compare',
        dateRange: 'Date range',
        range: '{days} days',
        breakdown: 'Breakdown, last {days} days',
        breakDownBy: 'Break down by',
        segment: 'Segment',
        share: 'Share',
        shareRate: 'Accounts',
        value: 'Last {days} days',
        change: 'Change',
        byDimension: '{metric} by {dimension}',
        backToOverview: 'Back to overview',
        versusPrevious: 'versus the previous {days} days',
        versusBefore: 'vs {value} the {days} days before',
        lastDays: 'Last {days} days',
        previousDays: 'Previous {days} days',
        chartSummary: '{metric} per day over the last {days} days, from {from} to {to}.',
        periodEarlier: '{value} a period earlier',
        openCard: '{metric}, {value}, {change} versus the previous {days} days. Open details',
        newSegment: 'New',
        points: '\u00a0pts'
      }
    },
    race: {
      title: 'User spending race',
      description: 'Running actual cost of the top 12 users in the selected range. Play or drag the timeline to see the ranking change.',
      label: 'Users by running actual cost',
      loading: 'Loading user spending race',
      loadFailed: 'Failed to load user spending race',
      labels: {
        total: 'Total {value}',
        roleDescription: 'bar chart race',
        plot: '{label}, {period}. Space plays or pauses, left and right arrows change the period, up and down arrows read the bars.',
        empty: 'No data yet',
        rank: 'Rank {rank} of {count}, {share} of total',
        versus: '{change} vs {period}',
        groups: 'Groups',
        play: 'Play',
        pause: 'Pause',
        replay: 'Replay from the start',
        timeline: '{label}, period',
        reading: '{item}, rank {rank}, {value}',
        leads: '{period}. {item} leads with {value}.',
        itemHeader: 'User'
      }
    }
  }
}
