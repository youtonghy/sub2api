/**
 * 使用记录的调用流向桑基图（Arc Pro sankey-flow）文案
 */
export default {
  flowUi: {
    title: '调用流向',
    description: '分组到请求模型，再到实际发往上游的模型',
    metricLabel: '流量口径',
    metric: {
      tokens: 'Token',
      actualCost: '实际费用',
      requests: '请求数'
    },
    columns: {
      group: '分组',
      requested: '请求模型',
      upstream: '上游模型'
    },
    noGroup: '无分组',
    otherGroups: '其他分组',
    otherModels: '其他模型',
    unknownModel: '未知模型',
    total: '总量',
    empty: '该时间范围内暂无请求',
    failed: '调用流向加载失败',
    retry: '重试',
    sankey: {
      flow: '流动',
      from: '来源',
      to: '去向',
      value: '数值',
      shareOfSource: '占来源比例',
      roleDescription: '流向图',
      keyboardHint: '方向键在阶段和节点间移动，Esc 清除。',
      toNode: '流向 {label}',
      fromNode: '来自 {label}',
      linkTitle: '{source} 到 {target}',
      shareOf: '占{of}的 {share}'
    }
  }
}
