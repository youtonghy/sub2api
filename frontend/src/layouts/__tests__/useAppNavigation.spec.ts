import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import McpIcon from '@/components/common/McpIcon'
import { useAppNavigation } from '@/layouts/useAppNavigation'
import { useAdminSettingsStore } from '@/stores/adminSettings'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { PublicSettings } from '@/types'

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
vi.mock('@/composables/useBatchImageAccess', () => ({
  useBatchImageAccess: () => ({ canUseBatchImage: false, refreshBatchImageAccess: vi.fn() })
}))

function arrange({ isAdmin, isSimpleMode = false, mcp }: { isAdmin: boolean; isSimpleMode?: boolean; mcp: boolean | undefined }) {
  useAuthStore.setState({ isAdmin, isSimpleMode })
  useAppStore.setState({
    backendModeEnabled: false,
    cachedPublicSettings: (mcp === undefined ? {} : { mcp_enabled: mcp }) as PublicSettings
  })
  useAdminSettingsStore.setState({ customMenuItems: [], fetch: vi.fn() } as never)
}

function mcpEntries() {
  const { result } = renderHook(() => useAppNavigation())
  return result.current.sections.flatMap((section) =>
    section.items.filter((entry) => entry.id === '/settings/mcp').map((entry) => ({ section: section.id, entry }))
  )
}

describe('useAppNavigation MCP entry', () => {
  beforeEach(() => {
    useAuthStore.setState(useAuthStore.getInitialState(), true)
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('uses the MCP logo and shows the entry only when the deployment enables MCP', () => {
    arrange({ isAdmin: false, mcp: true })
    const entries = mcpEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].entry.label).toBe('mcp.title')
    expect(entries[0].entry.icon).toBe(McpIcon)

    arrange({ isAdmin: false, mcp: false })
    expect(mcpEntries()).toEqual([])
    // opt-in：设置未加载时隐藏
    arrange({ isAdmin: false, mcp: undefined })
    expect(mcpEntries()).toEqual([])
  })

  it('shows the entry in the admin personal section and in the simple-mode admin list', () => {
    arrange({ isAdmin: true, mcp: true })
    expect(mcpEntries().map((item) => item.section)).toEqual(['personal'])

    arrange({ isAdmin: true, isSimpleMode: true, mcp: true })
    const { result } = renderHook(() => useAppNavigation())
    const adminIds = result.current.sections[0].items.map((entry) => entry.id)
    expect(adminIds).toContain('/settings/mcp')
    expect(adminIds.indexOf('/settings/mcp')).toBe(adminIds.indexOf('/admin/settings') - 1)

    arrange({ isAdmin: true, isSimpleMode: true, mcp: false })
    expect(mcpEntries()).toEqual([])
  })
})

describe('useAppNavigation privacy filter entries', () => {
  beforeEach(() => {
    useAuthStore.setState(useAuthStore.getInitialState(), true)
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  function arrangePrivacy(isAdmin: boolean, privacyFilterEnabled: boolean | undefined) {
    useAuthStore.setState({ isAdmin, isSimpleMode: false })
    useAppStore.setState({
      backendModeEnabled: false,
      cachedPublicSettings: {
        risk_control_enabled: true,
        ...(privacyFilterEnabled === undefined ? {} : { privacy_filter_enabled: privacyFilterEnabled })
      } as PublicSettings
    })
    useAdminSettingsStore.setState({ customMenuItems: [], fetch: vi.fn() } as never)
    const { result } = renderHook(() => useAppNavigation())
    return Object.fromEntries(
      result.current.sections.map((section) => [
        section.id,
        section.items.flatMap((entry) => [entry.id, ...(entry.children ?? []).map((child) => child.id)])
      ])
    )
  }

  it('gives admins a top-level page outside the security audit group, even with the filter off', () => {
    const ids = arrangePrivacy(true, false)
    expect(ids.admin).toContain('/admin/privacy-filter')
    expect(ids.admin.indexOf('/admin/privacy-filter')).toBe(ids.admin.indexOf('/admin/prompt-audit') + 1)
    expect(ids.personal).not.toContain('/privacy-filter')
  })

  it('shows the user records page right after usage only while the filter is active', () => {
    const ids = arrangePrivacy(false, true)
    expect(ids.user.indexOf('/privacy-filter')).toBe(ids.user.indexOf('/usage') + 1)
    expect(arrangePrivacy(true, true).personal).toContain('/privacy-filter')

    expect(arrangePrivacy(false, false).user).not.toContain('/privacy-filter')
    expect(arrangePrivacy(false, undefined).user).not.toContain('/privacy-filter')
  })
})
