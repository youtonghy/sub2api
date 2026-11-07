import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MCPGrant } from '@/api/mcp'

const { getConnectionConfig, listGrants, revokeGrant, copyToClipboard, showSuccess } = vi.hoisted(() => ({
  getConnectionConfig: vi.fn(),
  listGrants: vi.fn(),
  revokeGrant: vi.fn(),
  copyToClipboard: vi.fn(),
  showSuccess: vi.fn()
}))

vi.mock('@/api/mcp', () => ({ mcpAPI: { getConnectionConfig, listGrants, revokeGrant } }))
vi.mock('@/stores/app', () => {
  const state = { showSuccess }
  return {
    useAppStore: Object.assign((selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state), {
      getState: () => state
    })
  }
})
vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copyToClipboard }) }))
vi.mock('@/utils/format', () => ({ formatDate: (value: string) => value }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
// 对应 Vue spec 的 BaseDialog 桩：显示时直接渲染内容与页脚
vi.mock('@/components/common/BaseDialog', () => ({
  default: ({ show, title, children, footer }: { show: boolean; title: string; children?: React.ReactNode; footer?: React.ReactNode }) =>
    show ? (
      <section role="dialog" aria-label={title}>
        {children}
        {footer}
      </section>
    ) : null
}))

import MCPView from '../MCPView'

const item: MCPGrant = {
  id: 'grant-1',
  client_id: 'client-1',
  client_name: 'Desktop assistant',
  scope: 'user',
  read_only: true,
  created_at: '2026-10-28T00:00:00Z',
  expires_at: '2099-11-27T00:00:00Z',
  last_used_at: null,
  revoked_at: null,
  invalidated: false
}

const flushPromises = () => act(async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
})
const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)
const endpointInput = () => $<HTMLInputElement>('#mcp-endpoint')!
const copyButton = () => $<HTMLButtonElement>('[data-testid="copy-endpoint"]')!
const grantRow = (id: string) => $(`[data-grant-id="${id}"]`)
const text = () => document.body.textContent ?? ''
const click = async (element: Element | null) => {
  await act(async () => {
    fireEvent.click(element!)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getConnectionConfig.mockResolvedValue({ resource: 'https://mcp.example.com/api/v1/mcp' })
  listGrants.mockResolvedValue([])
  revokeGrant.mockResolvedValue(undefined)
})
afterEach(() => cleanup())

describe('MCP OAuth connections', () => {
  it('shows OAuth instructions and only copies the server URL, without static credential creation', async () => {
    render(<MCPView />)
    await flushPromises()
    expect(getConnectionConfig).toHaveBeenCalledTimes(1)
    expect(listGrants).toHaveBeenCalledTimes(1)
    expect(endpointInput().value).toBe('https://mcp.example.com/api/v1/mcp')
    expect(text()).toContain('mcp.connectStep2')
    expect(text()).toContain('mcp.empty')
    expect($('form')).toBeNull()
    expect($('[data-testid="create-token"]')).toBeNull()
    expect($('textarea')).toBeNull()
    expect(document.body.innerHTML).not.toMatch(/Bearer|mcp-new-token|mcp-secret/)
    await click(copyButton())
    expect(copyToClipboard).toHaveBeenCalledWith('https://mcp.example.com/api/v1/mcp')
  })

  it('does not guess the resource when server configuration fails and keeps grants usable', async () => {
    getConnectionConfig.mockRejectedValueOnce({ message: 'MCP public URL is not configured correctly' })
    listGrants.mockResolvedValue([item])
    render(<MCPView />)
    await flushPromises()
    expect($('[role="alert"]')?.textContent).toBe('MCP public URL is not configured correctly')
    expect(endpointInput().value).toBe('')
    expect(copyButton().disabled).toBe(true)
    expect(grantRow('grant-1')?.querySelector('button')).not.toBeNull()
    await click($('[data-testid="retry-connection"]'))
    await flushPromises()
    expect($('[role="alert"]')).toBeNull()
    expect(endpointInput().value).toBe('https://mcp.example.com/api/v1/mcp')
    expect(copyButton().disabled).toBe(false)
    expect(listGrants).toHaveBeenCalledTimes(1)
  })

  it('disables URL copying while configuration is loading independently from grants', async () => {
    let resolveConfig!: (value: { resource: string }) => void
    getConnectionConfig.mockReturnValueOnce(new Promise<{ resource: string }>((resolve) => { resolveConfig = resolve }))
    render(<MCPView />)
    await flushPromises()
    expect(text()).toContain('mcp.empty')
    expect(copyButton().disabled).toBe(true)
    await act(async () => {
      resolveConfig({ resource: 'https://configured.example.com/api/v1/mcp' })
    })
    await flushPromises()
    expect(endpointInput().value).toBe('https://configured.example.com/api/v1/mcp')
  })

  it('loads authorized applications and shows their permissions', async () => {
    listGrants.mockResolvedValue([item, { ...item, id: 'grant-2', scope: 'admin', read_only: false }])
    render(<MCPView />)
    await flushPromises()
    expect(grantRow('grant-1')?.textContent).toContain('Desktop assistant')
    expect(grantRow('grant-1')?.textContent).toContain('mcp.readOnly')
    expect(grantRow('grant-2')?.textContent).toContain('mcp.adminScope')
    expect(grantRow('grant-2')?.textContent).toContain('mcp.readWrite')
  })

  it('keeps loading failures visible and can refresh', async () => {
    listGrants.mockRejectedValueOnce({ message: 'Service unavailable' }).mockResolvedValueOnce([item])
    render(<MCPView />)
    await flushPromises()
    expect($('[role="alert"]')?.textContent).toBe('Service unavailable')
    await click($('[data-testid="refresh-grants"]'))
    await flushPromises()
    expect($('[role="alert"]')).toBeNull()
    expect(grantRow('grant-1')).not.toBeNull()
  })

  it('revokes only after confirmation and updates the application state', async () => {
    listGrants.mockResolvedValue([item])
    render(<MCPView />)
    await flushPromises()
    await click(grantRow('grant-1')!.querySelector('button'))
    expect(revokeGrant).not.toHaveBeenCalled()
    await click($('[data-testid="confirm-revoke"]'))
    await flushPromises()
    expect(revokeGrant).toHaveBeenCalledWith(item.id)
    expect(grantRow('grant-1')?.textContent).toContain('mcp.revoked')
    expect(grantRow('grant-1')?.querySelector('button')).toBeNull()
    expect(showSuccess).toHaveBeenCalledWith('mcp.revokeSuccess')
  })

  it('keeps the revoke dialog and grant active when revocation fails', async () => {
    listGrants.mockResolvedValue([item])
    revokeGrant.mockRejectedValue({ message: 'Try again later' })
    render(<MCPView />)
    await flushPromises()
    await click(grantRow('grant-1')!.querySelector('button'))
    await click($('[data-testid="confirm-revoke"]'))
    await flushPromises()
    expect($('[role="alert"]')?.textContent).toBe('Try again later')
    expect(grantRow('grant-1')?.textContent).toContain('mcp.active')
    expect($('[data-testid="confirm-revoke"]')).not.toBeNull()
  })

  it('shows invalidated and expired grants as inactive while allowing revocation', async () => {
    listGrants.mockResolvedValue([
      { ...item, invalidated: true },
      { ...item, id: 'grant-2', expires_at: '2000-01-01T00:00:00Z' }
    ])
    render(<MCPView />)
    await flushPromises()
    expect(grantRow('grant-1')?.textContent).toContain('mcp.invalidated')
    expect(grantRow('grant-2')?.textContent).toContain('mcp.expired')
    expect(grantRow('grant-1')?.querySelector('button')).not.toBeNull()
  })
})
