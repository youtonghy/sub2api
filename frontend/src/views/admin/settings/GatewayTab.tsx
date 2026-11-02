/** 网关 Tab：顺序与 Vue 版一致（容错类独立设置在前，随整表保存的转发与调度设置在后） */
import { ClaudeCodeSection, CodexHardeningSection, SchedulingSection, UsageRecordsSection } from './GatewayClientSections'
import GatewayForwardingSection from './GatewayForwardingSection'
import { OllamaCloudUsageSection, OpenCodeGoUsageSection, UpstreamBillingProbeSection } from './GatewayProbeSections'
import {
  BetaPolicySection,
  OverloadCooldownSection,
  RateLimit429CooldownSection,
  RectifierSection,
  StreamTimeoutSection
} from './GatewayResilienceSections'
import OpenAIFastPolicySection from './OpenAIFastPolicySection'
import WebSearchEmulationSection from './WebSearchEmulationSection'

export default function GatewayTab() {
  return (
    <>
      <OverloadCooldownSection />
      <RateLimit429CooldownSection />
      <StreamTimeoutSection />
      <RectifierSection />
      <BetaPolicySection />
      <OpenAIFastPolicySection />
      <ClaudeCodeSection />
      <CodexHardeningSection />
      <UpstreamBillingProbeSection />
      <OllamaCloudUsageSection />
      <OpenCodeGoUsageSection />
      <SchedulingSection />
      <GatewayForwardingSection />
      <WebSearchEmulationSection />
      <UsageRecordsSection />
    </>
  )
}
