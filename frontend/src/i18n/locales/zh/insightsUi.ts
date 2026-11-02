/**
 * 管理仪表盘的 KPI 下钻与排行赛跑图（Arc Pro kpi-drilldown、race-bar-chart）文案
 */
export default {
  insightsUi: {
    kpi: {
      title: '用量概览',
      // 序列截止到昨天（最后一个完整日），区间值为区间内逐日之和
      metrics: {
        requests: {
          label: '请求数',
          description: '每日请求数，按天统计到昨天。区间值为区间内各天之和。'
        },
        total_tokens: {
          label: 'Token 总量',
          description: '每日输入、输出与缓存 Token 之和，按天统计到昨天。'
        },
        actual_cost: {
          label: '实际费用',
          description: '每日实际扣除的费用（美元），按天统计到昨天。'
        },
        cost: {
          label: '标准计费',
          description: '按标准价格计算的每日费用（美元），按天统计到昨天。'
        }
      },
      dimensions: {
        model: '模型',
        group: '分组'
      },
      other: '其他',
      noGroup: '无分组',
      loading: '正在加载用量概览',
      loadFailed: '用量概览加载失败',
      retry: '重试',
      labels: {
        compare: '对比',
        dateRange: '时间范围',
        range: '{days} 天',
        breakdown: '构成（近 {days} 天）',
        breakDownBy: '拆分维度',
        segment: '分段',
        share: '占比',
        shareRate: '账号',
        value: '近 {days} 天',
        change: '环比',
        byDimension: '{metric}按{dimension}拆分',
        backToOverview: '返回概览',
        versusPrevious: '对比前 {days} 天',
        versusBefore: '前 {days} 天为 {value}',
        lastDays: '近 {days} 天',
        previousDays: '前 {days} 天',
        chartSummary: '{metric}近 {days} 天的每日数值，从 {from} 到 {to}。',
        periodEarlier: '上一周期 {value}',
        openCard: '{metric}，{value}，较前 {days} 天 {change}。打开详情',
        newSegment: '新增',
        points: '\u00a0个百分点'
      }
    },
    race: {
      title: '用户消费排行变化',
      description: '所选时间范围内实际费用前 12 名用户的累计消费，播放或拖动时间轴查看名次变化。',
      label: '用户累计实际费用排行',
      loading: '正在加载用户消费排行',
      loadFailed: '用户消费排行加载失败',
      labels: {
        total: '合计 {value}',
        roleDescription: '排行赛跑图',
        plot: '{label}，{period}。空格键播放或暂停，左右方向键切换时间，上下方向键逐条读取。',
        empty: '暂无数据',
        rank: '第 {rank} 名，共 {count} 名，占合计 {share}',
        versus: '较 {period} {change}',
        groups: '分组',
        play: '播放',
        pause: '暂停',
        replay: '从头重播',
        timeline: '{label}，时间',
        reading: '{item}，第 {rank} 名，{value}',
        leads: '{period}。{item} 以 {value} 领先。',
        itemHeader: '用户'
      }
    }
  }
}
