type TranslateFn = (key: string, params?: Record<string, unknown>) => string

/** 时间桶跨度文案（分钟 / 小时 / 天），色块矩阵与趋势图共用 */
export function bucketSpanLabel(t: TranslateFn, minutes: number): string {
  if (minutes < 60) return t('channelMonitorV2.bucket.minutes', { count: minutes })
  const hours = minutes / 60
  if (hours < 24) return t('channelMonitorV2.bucket.hours', { count: hours })
  return t('channelMonitorV2.bucket.days', { count: hours / 24 })
}
