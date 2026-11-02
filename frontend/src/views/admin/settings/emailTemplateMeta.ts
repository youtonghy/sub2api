/** 邮件模板编辑器的静态数据：占位符兜底列表与各事件的中英文说明（来自 Vue 版 EmailTemplateEditor.vue） */

export interface EventDisplayMeta {
  label: string
  timing: string
  categoryLabel: string
}

export const fallbackPlaceholders = [
  '{{site_name}}',
  '{{recipient_name}}',
  '{{recipient_email}}',
  '{{verification_code}}',
  '{{expires_in_minutes}}',
  '{{reset_url}}',
  '{{subscription_group}}',
  '{{subscription_days}}',
  '{{expiry_time}}',
  '{{days_remaining}}',
  '{{current_balance}}',
  '{{threshold}}',
  '{{recharge_url}}',
  '{{recharge_amount}}',
  '{{order_id}}',
  '{{unsubscribe_url}}',
  '{{account_id}}',
  '{{account_name}}',
  '{{platform}}',
  '{{quota_dimension}}',
  '{{quota_used}}',
  '{{quota_limit}}',
  '{{quota_remaining}}',
  '{{quota_threshold}}',
  '{{triggered_at}}',
  '{{group_name}}',
  '{{moderation_category}}',
  '{{moderation_score}}',
  '{{violation_count}}',
  '{{ban_threshold}}',
  '{{rule_name}}',
  '{{severity}}',
  '{{alert_status}}',
  '{{metric_type}}',
  '{{operator}}',
  '{{metric_value}}',
  '{{threshold_value}}',
  '{{alert_description}}',
  '{{report_name}}',
  '{{report_type}}',
  '{{report_start_time}}',
  '{{report_end_time}}',
  '{{report_summary_display}}',
  '{{report_detail_display}}',
  '{{report_total_requests}}',
  '{{report_success_count}}',
  '{{report_sla_error_count}}',
  '{{report_business_limited_count}}',
  '{{report_sla}}',
  '{{report_error_rate}}',
  '{{report_upstream_error_rate}}',
  '{{report_upstream_error_count_excl_429_529}}',
  '{{report_upstream_429_count}}',
  '{{report_upstream_529_count}}',
  '{{report_latency_p50}}',
  '{{report_latency_p99}}',
  '{{report_ttft_p50}}',
  '{{report_ttft_p99}}',
  '{{report_tokens}}',
  '{{report_qps_current}}',
  '{{report_qps_peak}}',
  '{{report_qps_avg}}',
  '{{report_tps_current}}',
  '{{report_tps_peak}}',
  '{{report_tps_avg}}',
  '{{report_html}}',
]

export const eventDisplayMeta: Record<string, EventDisplayMeta> = {
  'auth.verify_code': {
    label: '邮箱验证码',
    timing: '注册、绑定邮箱、OAuth 补全邮箱或 TOTP 邮箱校验时发送。',
    categoryLabel: '认证安全',
  },
  'auth.password_reset': {
    label: '密码重置',
    timing: '用户请求密码重置链接时发送。',
    categoryLabel: '认证安全',
  },
  'notification_email.verify_code': {
    label: '通知邮箱验证码',
    timing: '用户添加并验证额外通知邮箱时发送。',
    categoryLabel: '认证安全',
  },
  'subscription.purchase_success': {
    label: '订阅开通成功',
    timing: '订阅订单完成支付并成功开通或续期后发送。',
    categoryLabel: '订阅',
  },
  'subscription.expiry_reminder': {
    label: '订阅到期提醒',
    timing: '后台任务在订阅仍有效且距离到期剩余 7 天、3 天、1 天时各发送一次，可通过邮件设置中的开关关闭。',
    categoryLabel: '订阅',
  },
  'balance.low': {
    label: '余额不足提醒',
    timing: '用户余额低于全局或个人配置的提醒阈值时发送。',
    categoryLabel: '计费',
  },
  'balance.recharge_success': {
    label: '余额充值成功',
    timing: '余额充值订单支付完成并入账后发送。',
    categoryLabel: '计费',
  },
  'account.quota_alert': {
    label: '账号限额告警',
    timing: '上游账号的用量达到配置的额度告警阈值时发送给管理员通知邮箱。',
    categoryLabel: '管理告警',
  },
  'content_moderation.violation_notice': {
    label: '内容审计违规提醒',
    timing: '用户请求命中内容审计或风控规则、但尚未被禁用时发送。',
    categoryLabel: '风控',
  },
  'content_moderation.account_disabled': {
    label: '内容审计禁用账号',
    timing: '内容审计违规次数达到封禁阈值并自动禁用用户账号时发送。',
    categoryLabel: '风控',
  },
  'ops.alert': {
    label: '运维告警',
    timing: '运维监控规则触发告警并满足邮件通知配置时发送给运维收件人。',
    categoryLabel: '运维',
  },
  'ops.scheduled_report': {
    label: '运维定时报表',
    timing: '运维日报、周报、错误摘要或账号健康报表到达配置的发送时间时发送；日报和周报的完整指标均可在模板中编辑。',
    categoryLabel: '运维',
  },
}

export const eventDisplayMetaEn: Record<string, EventDisplayMeta> = {
  'auth.verify_code': {
    label: 'Email Verification Code',
    timing: 'Sent for registration, email binding, OAuth pending email completion, or TOTP email verification.',
    categoryLabel: 'Auth',
  },
  'auth.password_reset': {
    label: 'Password Reset',
    timing: 'Sent when a user requests a password reset link.',
    categoryLabel: 'Auth',
  },
  'notification_email.verify_code': {
    label: 'Notification Email Verification',
    timing: 'Sent when a user adds and verifies an extra notification email address.',
    categoryLabel: 'Auth',
  },
  'subscription.purchase_success': {
    label: 'Subscription Activated',
    timing: 'Sent after a subscription order is paid and the subscription is activated or extended.',
    categoryLabel: 'Subscription',
  },
  'subscription.expiry_reminder': {
    label: 'Subscription Expiry Reminder',
    timing: 'Sent by the background job when an active subscription has 7, 3, or 1 day remaining. It can be disabled in Email settings.',
    categoryLabel: 'Subscription',
  },
  'balance.low': {
    label: 'Low Balance Alert',
    timing: "Sent when a user's balance drops below the global or personal reminder threshold.",
    categoryLabel: 'Billing',
  },
  'balance.recharge_success': {
    label: 'Balance Recharge Success',
    timing: 'Sent after a balance recharge order is paid and credited.',
    categoryLabel: 'Billing',
  },
  'account.quota_alert': {
    label: 'Account Quota Alert',
    timing: 'Sent to admin notification emails when an upstream account reaches the configured quota alert threshold.',
    categoryLabel: 'Admin',
  },
  'content_moderation.violation_notice': {
    label: 'Risk Control Violation Notice',
    timing: 'Sent when a user request triggers content moderation or risk-control rules but the account is not disabled yet.',
    categoryLabel: 'Risk Control',
  },
  'content_moderation.account_disabled': {
    label: 'Risk Control Account Disabled',
    timing: 'Sent when content moderation reaches the ban threshold and automatically disables the user account.',
    categoryLabel: 'Risk Control',
  },
  'ops.alert': {
    label: 'Ops Alert',
    timing: 'Sent to ops recipients when an ops monitoring rule fires and email notification settings allow it.',
    categoryLabel: 'Ops',
  },
  'ops.scheduled_report': {
    label: 'Ops Scheduled Report',
    timing: 'Sent when a configured daily, weekly, error digest, or account health report reaches its scheduled send time. Every daily and weekly summary metric is editable in this template.',
    categoryLabel: 'Ops',
  },
}
