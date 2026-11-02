/**
 * 订单漏斗图（Arc Pro funnel-chart）文案
 */
export default {
  funnelUi: {
    title: '订单漏斗',
    description: '最近 {days} 天创建的订单走到了哪一步',
    chartLabel: '最近 {days} 天订单漏斗',
    unit: '单',
    viewLabel: '漏斗视图',
    loadFailed: '订单漏斗加载失败',
    empty: '这段时间没有订单',
    // 订单列表一次最多读取 {count} 条，范围内订单更多时只统计最近的部分
    truncated: '仅统计最近 {count} 条订单（{date} 起），范围内更早的订单未计入。',
    stages: {
      created: '已创建',
      paid: '已支付',
      completed: '已完成'
    },
    views: {
      total: '合计',
      split: '按类型'
    },
    segments: {
      other: '其他'
    },
    dropoff: {
      heading: '未走完的订单',
      unpaid: '未支付',
      paidNotCompleted: '已支付未完成',
      afterCompletion: '完成后',
      other: '其他',
      inProgress: '处理中',
      refund: '进入退款'
    },
    // Arc Pro 漏斗图组件的界面与读屏文案
    chart: {
      start: '起点',
      ofStart: '占起点 {share}',
      total: '合计',
      keptFrom: '较{step}保留 {share}',
      entryStep: '起始步骤',
      entryStepUnit: '起始步骤，单位：{unit}',
      announce: '{step}，{value}，占上一步 {fromPrevious}，占起点 {fromFirst}',
      keyboardHint: '用方向键在步骤间移动。',
      roleDescription: '漏斗图',
      viewAll: '全部',
      viewSplit: '按分段',
      reachLast: '{share} 走到最后一步。',
      stepHeader: '步骤',
      shownTotalHeader: '显示合计',
      keptHeader: '较上一步保留',
      ofFirstHeader: '占起点'
    }
  }
}
