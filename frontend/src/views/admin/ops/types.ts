// Ops 前端视图层的共享类型（与后端 DTO 解耦）。
import type { OpsRequestDetailsParams } from '@/api/admin/ops'

export type ChartState = 'loading' | 'empty' | 'ready'

// 请求明细弹窗的预设（Vue 版定义在 OpsRequestDetailsModal.vue 中；React 版移到这里，
// 避免组件文件导出非组件内容，OpsRequestDetailsModal 仍会再导出该类型）。
export interface OpsRequestDetailsPreset {
  title: string
  kind?: OpsRequestDetailsParams['kind']
  sort?: OpsRequestDetailsParams['sort']
  min_duration_ms?: number
  max_duration_ms?: number
}

// Re-export ops alert/settings types so view components can import from a single place
// while keeping the API contract centralized in `@/api/admin/ops`.
export type {
  AlertRule,
  AlertEvent,
  AlertSeverity,
  ThresholdMode,
  MetricType,
  Operator,
  EmailNotificationConfig,
  OpsDistributedLockSettings,
  OpsAlertRuntimeSettings,
  OpsMetricThresholds,
  OpsAdvancedSettings,
  OpsDataRetentionSettings,
  OpsAggregationSettings,
  OpsRuntimeLogConfig,
  OpsSystemLog,
  OpsSystemLogSinkHealth
} from '@/api/admin/ops'
