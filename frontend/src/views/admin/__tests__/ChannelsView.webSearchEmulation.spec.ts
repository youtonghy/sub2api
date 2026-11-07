import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { formToAPI, newPlatformSection, WEB_SEARCH_EMULATION_PLATFORMS } from '@/components/admin/channel/channelFormModel'
import type { Channel } from '@/api/admin/channels'
import type { GroupPlatform } from '@/types'

/**
 * features_config.web_search_emulation 回归保护：渠道编辑器曾只渲染和提交 anthropic 维度，
 * 界面保存会覆盖 API 写入的其他平台维度。渲染与提交现在都遵循平台白名单。
 */
describe('ChannelsView web_search_emulation platform whitelist', () => {
  const drawer = readFileSync(resolve('src/components/admin/channel/ChannelFormDrawer.tsx'), 'utf8')
  const zh = readFileSync(resolve('src/i18n/locales/zh/admin/channels.ts'), 'utf8')
  const en = readFileSync(resolve('src/i18n/locales/en/admin/channels.ts'), 'utf8')

  it('declares the whitelist aligned with the backend platform whitelist', () => {
    expect([...WEB_SEARCH_EMULATION_PLATFORMS].sort()).toEqual(
      ['anthropic', 'command_code', 'minimax', 'openai', 'opencode_go', 'zhipu'].sort()
    )
  })

  it('renders the toggle for every whitelisted platform section', () => {
    expect(drawer).toContain('WEB_SEARCH_EMULATION_PLATFORMS.has(section.platform) && webSearchGlobalEnabled')
    expect(drawer).not.toContain("section.platform === 'anthropic' && webSearchGlobalEnabled")
  })

  it('submits every whitelisted platform dimension on save, false for disabled sections', () => {
    const section = (platform: string, patch: Partial<ReturnType<typeof newPlatformSection>> = {}) => ({
      ...newPlatformSection(platform as GroupPlatform),
      ...patch
    })
    const editing = { features_config: { web_search_emulation: { openai: true, zhipu: true, gemini: true } } } as unknown as Channel
    const { features_config } = formToAPI(
      [
        section('anthropic', { web_search_emulation: true }),
        section('openai', { web_search_emulation: true, enabled: false }),
        section('minimax', { web_search_emulation: true }),
        section('zhipu'),
        section('gemini', { web_search_emulation: true })
      ],
      editing
    )
    expect(features_config.web_search_emulation).toEqual({ anthropic: true, openai: false, minimax: true, zhipu: false })
  })

  it('drops the key when no whitelisted section exists', () => {
    const editing = { features_config: { web_search_emulation: { anthropic: true } } } as unknown as Channel
    const { features_config } = formToAPI([newPlatformSection('gemini' as GroupPlatform)], editing)
    expect(features_config).not.toHaveProperty('web_search_emulation')
  })

  it('i18n hint no longer hardcodes Anthropic as the only platform', () => {
    expect(zh).not.toContain('所有 Anthropic 分组的账号将自动拦截')
    expect(en).not.toContain('Anthropic groups will intercept')
    expect(zh).toContain('webSearchEmulationHint')
    expect(en).toContain('webSearchEmulationHint')
  })
})
