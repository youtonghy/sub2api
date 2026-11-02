import { isChannelMonitorV1Mode } from '@/utils/featureFlags'
import ChannelStatusV1View from './ChannelStatusV1View'
import ChannelStatusV2View from './ChannelStatusV2View'

/** 渠道状态入口：按系统设置的监控模式切换 V1 卡片视图或 V2 指标视图 */
export default function ChannelStatusView() {
  return isChannelMonitorV1Mode() ? <ChannelStatusV1View /> : <ChannelStatusV2View />
}
