/* eslint-disable react-refresh/only-export-components -- 测试桩模块，不参与热更新 */
/**
 * ChannelMonitorView 测试共用的模块桩（对应 Vue 版 spec 中的 global.stubs）。
 * 在各 spec 顶部调用 vi.mock 时引用这里导出的工厂。
 */
import type { ChannelMonitor } from '@/api/admin/channelMonitor'

export interface ActionsCellStubProps {
  row: ChannelMonitor
  running: boolean
  duplicating: boolean
  onDuplicate?: (row: ChannelMonitor) => void
}

/** 记录每个监控行最近一次渲染的 MonitorActionsCell props（Vue 版 findComponent(MonitorActionsCell)） */
export const actionsCellProps = new Map<number, ActionsCellStubProps>()

export function ActionsCellStub(props: ActionsCellStubProps) {
  actionsCellProps.set(props.row.id, props)
  return <span data-testid={`actions-${props.row.id}`} data-duplicating={String(props.duplicating)} />
}

export const NullStub = () => null
