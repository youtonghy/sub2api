/**
 * Channel comparison radar (Arc Pro radar-chart)
 */
export default {
  radarUi: {
    title: 'Channel comparison',
    description: 'Scores run from 0 to 100, further out is better. Latency, throughput and volume are scored against the best compared channel. Hover or use the arrow keys to read the real values.',
    chartLabel: 'Channel comparison',
    picker: {
      label: 'Compare',
      defaultOption: 'Top 3 by requests (default)',
      limitHint: 'Up to 3. A new pick replaces the earliest one'
    },
    axes: {
      success: 'Success rate',
      ttft: 'First token P50',
      ttftTail: 'First token P90',
      cache: 'Cache hit rate',
      throughput: 'Throughput',
      volume: 'Request volume'
    },
    values: {
      tokensPerSecond: '{value} tokens/s',
      rpm: '{value} RPM',
      noData: 'No data'
    },
    empty: {
      title: 'No channels to compare',
      description: 'No requests in the current filter range.'
    },
    chart: {
      roleDescription: 'radar chart',
      keyboardHint: '{label}. Use arrow keys to move between measures.',
      profiles: '{label} profiles',
      measure: 'Measure',
      empty: 'No data'
    }
  }
}
