/**
 * 渠道对比雷达图（Arc Pro radar-chart）文案
 */
export default {
  radarUi: {
    title: '渠道对比',
    description: '得分 0 到 100，越靠外越好。延迟、吞吐量和请求量以对比组内最好的一项为满分，悬停或用方向键查看真实数值。',
    chartLabel: '渠道对比',
    picker: {
      label: '对比',
      defaultOption: '请求量前 3（默认）',
      limitHint: '最多 3 个，超出时替换最早选的一个'
    },
    axes: {
      success: '成功率',
      ttft: '首字速度 P50',
      ttftTail: '首字速度 P90',
      cache: '缓存命中率',
      throughput: '吞吐量',
      volume: '请求量'
    },
    values: {
      tokensPerSecond: '{value} tokens/s',
      rpm: '{value} RPM',
      noData: '无数据'
    },
    empty: {
      title: '暂无可对比的渠道',
      description: '当前筛选范围内没有请求记录。'
    },
    chart: {
      roleDescription: '雷达图',
      keyboardHint: '{label}。用方向键在各项指标间切换。',
      profiles: '{label}的对比对象',
      measure: '指标',
      empty: '暂无数据'
    }
  }
}
