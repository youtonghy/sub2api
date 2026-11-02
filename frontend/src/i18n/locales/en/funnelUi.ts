/**
 * Order funnel (Arc Pro funnel-chart)
 */
export default {
  funnelUi: {
    title: 'Order funnel',
    description: 'How far orders created in the last {days} days got',
    chartLabel: 'Order funnel, last {days} days',
    unit: 'orders',
    viewLabel: 'Funnel view',
    loadFailed: 'Could not load the order funnel',
    empty: 'No orders in this range',
    truncated: 'Counts only the latest {count} orders, from {date}. Older orders in this range are not included.',
    stages: {
      created: 'Created',
      paid: 'Paid',
      completed: 'Completed'
    },
    views: {
      total: 'Total',
      split: 'By type'
    },
    segments: {
      other: 'Other'
    },
    dropoff: {
      heading: 'Orders that stopped',
      unpaid: 'Not paid',
      paidNotCompleted: 'Paid, not completed',
      afterCompletion: 'After completion',
      other: 'Other',
      inProgress: 'In progress',
      refund: 'Entered refund'
    },
    chart: {
      start: 'Start',
      ofStart: '{share} of start',
      total: 'Total',
      keptFrom: '{share} kept from {step}',
      entryStep: 'Entry step',
      entryStepUnit: 'Entry step, {unit}',
      announce: '{step}, {value}, {fromPrevious} of the previous step, {fromFirst} of the first',
      keyboardHint: 'Use arrow keys to move between steps.',
      roleDescription: 'funnel chart',
      viewAll: 'all',
      viewSplit: 'by segment',
      reachLast: '{share} reach the last step.',
      stepHeader: 'Step',
      shownTotalHeader: 'Shown total',
      keptHeader: 'Kept from previous',
      ofFirstHeader: 'Of first step'
    }
  }
}
