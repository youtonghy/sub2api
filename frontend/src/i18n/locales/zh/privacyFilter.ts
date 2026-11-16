// 隐私过滤：管理端设置与记录页、用户端记录页共用的文案
export default {
  title: '隐私过滤',
  hint: '转发到上游账号前，把请求里用户文本和工具结果中的敏感信息替换为 [REDACTED:类型]。这是尽力而为的措施，不是安全边界，也不覆盖图片和 PDF 中的文字。规则参考 gitleaks 和 Presidio。',
  loadFailed: '加载隐私过滤配置失败',
  saveFailed: '保存隐私过滤配置失败',
  saved: '隐私过滤配置已保存',
  save: '保存隐私过滤配置',
  mode: '运行模式',
  modes: { off: '关闭', observe: '仅统计', redact: '脱敏', restore: '可还原脱敏' },
  modeHint: {
    off: '不扫描任何请求。',
    observe: '扫描所选分组的请求并按类别计数，请求内容不变。不记录命中的原文。',
    redact: '替换所选分组请求中命中的内容，替换不可还原。处理失败时拒绝请求，不转发原文。',
    restore: '上游只看到占位符，回复在返回客户端前换回原值，Agent 可以直接使用。原值只保存在本次请求或本条 WebSocket 连接的内存中。处理失败时拒绝请求。'
  },
  restoreNotice: 'thinking 和推理摘要中的占位符不还原；请求通过 previous_response_id 引用上游保存的历史时，其中的占位符也无法还原。',
  redactWarning: '脱敏不可还原。编码 Agent 读到占位符后，可能无法按原文编辑文件或连接被隐藏的地址，建议先用“仅统计”观察。',
  categoriesTitle: '识别类别',
  categories: {
    private_key: { label: '私钥', description: 'PEM 与 OpenSSH 私钥块，包括被截断的私钥。' },
    public_key: { label: '公钥', description: 'SSH 公钥行，以及 PEM 公钥或证书。' },
    credential: { label: '密码与令牌', description: '配置文件和 URL 中的密码、API 密钥、访问令牌等凭据。' },
    financial: { label: '银行卡与 IBAN', description: '通过 Luhn 校验且符合卡组织号段的银行卡号，以及通过校验的 IBAN。' },
    identity: { label: '身份证件号', description: '校验位或格式有效的证件号：中国大陆、香港、台湾、美国 SSN、英国、新加坡、韩国、西班牙、巴西；澳大利亚 TFN 与 Medicare、加拿大 SIN、Aadhaar、My Number 和护照号须带标注词。' },
    proxy: { label: '代理与 VPN 节点凭据', description: '分享链接（vless://、vmess://、trojan://、ss:// 等），以及代理配置中的 UUID、Reality short-id、密码和订阅令牌。公钥保持可见。' },
    email: { label: '邮箱地址', description: '邮箱地址，排除 SSH 目标、noreply 地址和示例域名。' },
    ip: { label: 'IP 地址', description: 'IPv4 与 IPv6 地址，排除回环地址和形似版本号的数字。' }
  },
  groups: '生效分组',
  groupsHint: '只对选中的分组生效。未选中任何分组时不处理任何请求。',
  stats: {
    scanned: '已扫描 {count}',
    hit: '命中 {count}',
    redacted: '已脱敏 {count}',
    failed: '失败 {count}',
    dropped: '未写入记录 {count}',
    restored: '已还原 {restored}，未能还原 {unresolved}',
    category: '当前实例累计命中 {count} 次。'
  },
  searchGroups: '搜索分组名称或平台',
  noGroups: '暂无可用分组',
  adminDescription: '配置转发前的敏感信息过滤，并查看全站的命中记录',
  userDescription: '查看你的请求在转发到上游前命中隐私过滤的记录',
  tabs: { records: '过滤记录', settings: '过滤设置' },
  records: {
    adminHint: '每个命中隐私过滤的请求记一条，只保存类别和次数，不保存命中的原文。记录与使用记录共用运维监控里的“请求日志保留天数”，到期自动清理。',
    userHint: '你的请求在转发到上游前命中隐私过滤时会留下一条记录。这里只显示类别和次数，不保存命中的原文。',
    loadFailed: '加载过滤记录失败',
    empty: '所选时间内没有过滤记录',
    deletedKey: '已删除的密钥',
    hitCount: '{count} 处',
    columns: {
      time: '时间',
      user: '用户',
      apiKey: 'API 密钥',
      group: '分组',
      model: '模型',
      endpoint: '端点',
      action: '处理方式',
      categories: '命中类别',
      requestId: '请求 ID'
    },
    filters: {
      dateRange: '时间范围',
      action: '处理方式',
      category: '类别',
      apiKey: 'API 密钥',
      search: '搜索',
      searchPlaceholder: '邮箱、密钥名称或模型',
      requestId: '请求 ID',
      all: '全部',
      reset: '重置',
      refresh: '刷新'
    },
    actions: {
      observe: '仅统计',
      redact: '已脱敏',
      restore: '可还原脱敏',
      failed: '处理失败，已拒绝'
    }
  }
}
