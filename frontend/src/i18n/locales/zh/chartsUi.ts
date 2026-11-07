export default {
  chartsUi: {
    // 环形图中心读数的占比文案，{share} 为占比数字（如 45%）
    shareOfTotal: '占比 {share}',
    // Arc Pro 图表（分段条、旭日图、实时流、地平线图）的界面与读屏文案
    // 旭日图第二圈：每个模型按 token 类型拆分
    tokenTypes: {
      input: '输入',
      output: '输出',
      cacheWrite: '缓存写入',
      cacheRead: '缓存读取'
    },
    splitBar: {
      off: '已隐藏',
      hidden: '已隐藏',
      onlyShare: '{label} 是唯一显示的分段，无法隐藏。',
      hiddenMessage: '已隐藏 {label}。',
      shownMessage: '已显示 {label}。',
      keyboardHint: '用方向键逐个读取占比。',
      segments: '分段',
      total: '合计'
    },
    sunburst: {
      ofTotal: '占总量 {share}',
      ofParent: '占 {parent} 的 {share}',
      groups: '{count} 项',
      backTo: '返回 {label}',
      keyboardHint: '方向键在分段间移动，Enter 展开，Esc 返回上一级。',
      zoomIn: '展开',
      path: '路径',
      parts: '组成',
      pathHeader: '路径',
      valueHeader: '数值',
      shareHeader: '占上级比例',
      empty: '暂无数据'
    },
    realtime: {
      live: '实时',
      paused: '已暂停',
      pausedWithNew: '已暂停，{count} 条新数据',
      now: '现在',
      secondsAgo: '-{seconds} 秒',
      resume: '继续',
      pause: '暂停',
      anomaly: '异常',
      keyboardHint: '最近 {seconds} 秒。聚焦时画面暂停，用左右方向键读取数据点，空格键暂停或继续。',
      latestReadings: '最近 {count} 个读数',
      timeHeader: '时间',
      valueHeader: '数值',
      noteHeader: '备注',
      waiting: '等待数据'
    },
    horizon: {
      sort: '排序',
      sortRows: '行排序方式',
      sortName: '名称',
      sortPeak: '波动',
      sortLatest: '最新',
      sortedByName: '已按名称排序。',
      sortedByPeak: '已按最大波动排序。',
      sortedByLatest: '已按最新值排序。',
      bands: '色带',
      bandCount: '色带层数',
      bandsOf: '{count} 层色带，每层 {step}。',
      latestDay: '最新时段',
      selectedDay: '选中时段',
      below: '低于',
      above: '高于',
      oneBandCaption: '单层色带时，每行是距{baseline}最多 {extent} 的面积图。',
      bandsCaption: '每行折叠为 {count} 层、每层 {step} 的色带，颜色越深离{baseline}越远。',
      colorScale: '色阶：从低于{baseline} {extent} 到高于 {extent}，每侧 {count} 层。',
      empty: '暂无可显示的数据。',
      rows: '{count} 行',
      keyboardHint: '左右方向键逐个时段移动十字线，Shift 加方向键一次移动 7 个时段，Home / End 跳到首尾，Esc 清除。',
      dayExtremes: '{day}。最高 {top} {topValue}，最低 {bottom} {bottomValue}。',
      tableCaption: '{title}，相对{baseline}的数值',
      rowHeader: '行',
      latestHeader: '最新',
      highestHeader: '最高',
      lowestHeader: '最低',
      valueOn: '{value}（{day}）'
    },
    metricTicker: {
      up: '上升',
      down: '下降',
      lastUpdates: '最近 {count} 次更新',
      trendingUp: '呈上升趋势',
      trendingDown: '呈下降趋势',
      flat: '持平',
      low: '最低',
      high: '最高',
      points: '个百分点'
    }
  }
}
