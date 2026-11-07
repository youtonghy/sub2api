export default {
  chartsUi: {
    // Share line in the donut centre readout; {share} is a percentage such as 45%
    shareOfTotal: '{share} of total',
    // Arc Pro charts (split bar, sunburst, realtime stream, horizon chart): visible and screen reader text
    // 旭日图第二圈：每个模型按 token 类型拆分
    tokenTypes: {
      input: 'Input',
      output: 'Output',
      cacheWrite: 'Cache write',
      cacheRead: 'Cache read'
    },
    splitBar: {
      off: 'Off',
      hidden: 'hidden',
      onlyShare: '{label} is the only share shown, so it stays on.',
      hiddenMessage: '{label} hidden.',
      shownMessage: '{label} shown.',
      keyboardHint: 'Use the arrow keys to read each share.',
      segments: 'segments',
      total: 'Total'
    },
    sunburst: {
      ofTotal: '{share} of total',
      ofParent: '{share} of {parent}',
      groups: '{count} items',
      backTo: 'Back to {label}',
      keyboardHint: 'Arrow keys move between segments, Enter zooms in, Escape zooms out.',
      zoomIn: 'Zoom in',
      path: 'path',
      parts: 'parts',
      pathHeader: 'Path',
      valueHeader: 'Value',
      shareHeader: 'Share of parent',
      empty: 'No data yet'
    },
    realtime: {
      live: 'Live',
      paused: 'Paused',
      pausedWithNew: 'Paused, {count} new',
      now: 'now',
      secondsAgo: '-{seconds}s',
      resume: 'resume',
      pause: 'pause',
      anomaly: 'Anomaly',
      keyboardHint: 'last {seconds} seconds. Focus holds the view. Use left and right arrows to read points, Space to pause or resume.',
      latestReadings: 'latest {count} readings',
      timeHeader: 'Time',
      valueHeader: 'Value',
      noteHeader: 'Note',
      waiting: 'Waiting for data'
    },
    horizon: {
      sort: 'Sort',
      sortRows: 'Sort rows',
      sortName: 'Name',
      sortPeak: 'Peak',
      sortLatest: 'Latest',
      sortedByName: 'Rows sorted by name.',
      sortedByPeak: 'Rows sorted by largest swing.',
      sortedByLatest: 'Rows sorted by latest value.',
      bands: 'Bands',
      bandCount: 'Band count',
      bandsOf: '{count} bands of {step}.',
      latestDay: 'Latest bucket',
      selectedDay: 'Selected bucket',
      below: 'Below',
      above: 'Above',
      oneBandCaption: 'With one band, each row is a plain area chart up to {extent} from the {baseline}.',
      bandsCaption: 'Each row folds into {count} bands of {step}. Stronger color means further from the {baseline}.',
      colorScale: 'Color scale from {extent} below to {extent} above the {baseline}, in {count} bands per side.',
      empty: 'No data to show yet.',
      rows: '{count} rows',
      keyboardHint: 'Use the left and right arrow keys to move the crosshair by one bucket, Shift with an arrow for seven, Home and End for the first and last, and Escape to clear it.',
      dayExtremes: '{day}. Highest {top} {topValue}, lowest {bottom} {bottomValue}.',
      tableCaption: '{title}, values against the {baseline}',
      rowHeader: 'Row',
      latestHeader: 'Latest',
      highestHeader: 'Highest',
      lowestHeader: 'Lowest',
      valueOn: '{value} on {day}'
    },
    metricTicker: {
      up: 'up',
      down: 'down',
      lastUpdates: 'Last {count} updates',
      trendingUp: 'Trending up',
      trendingDown: 'Trending down',
      flat: 'Flat',
      low: 'Low',
      high: 'High',
      points: 'pts'
    }
  }
}
