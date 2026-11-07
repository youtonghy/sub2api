import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MCPAuthorization, MCPConsent } from '@/api/mcp'
import type { StepUpController } from '@/composables/useStepUp'

const { auth, previewAuthorization, authorize, assign } = vi.hoisted(() => ({
  auth: { isAdmin: false, user: { email: 'user@example.com' } as { email: string } | null },
  previewAuthorization: vi.fn(),
  authorize: vi.fn(),
  assign: vi.fn()
}))

vi.mock('@/api/mcp', () => ({ mcpAPI: { previewAuthorization, authorize } }))
vi.mock('@/stores/auth', () => ({
  useAuthStore: Object.assign((selector?: (s: typeof auth) => unknown) => (selector ? selector(auth) : auth), {
    getState: () => auth
  })
}))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
// 对应 Vue spec 的 TotpStepUpDialog 桩：可见时提供验证与取消按钮
vi.mock('@/components/auth/TotpStepUpDialog', () => ({
  default: ({ controller }: { controller: StepUpController }) =>
    controller.visible ? (
      <div data-testid="step-up">
        <button type="button" data-testid="step-up-verify" onClick={() => controller.onVerified()}>Verify</button>
        <button type="button" data-testid="step-up-cancel" onClick={() => controller.onCancel()}>Cancel</button>
      </div>
    ) : null
}))

import MCPOAuthAuthorizeView from '../MCPOAuthAuthorizeView'

const request: MCPAuthorization = {
  response_type: 'code',
  client_id: 'client-1',
  redirect_uri: 'https://client.example.com/callback?workspace=team',
  scope: 'mcp',
  state: 'opaque+value&with=reserved?characters',
  code_challenge: 'a'.repeat(43),
  code_challenge_method: 'S256',
  resource: 'https://api.example.com/api/v1/mcp'
}
const consent: MCPConsent = {
  client_id: request.client_id,
  client_name: 'Desktop assistant',
  redirect_uri: request.redirect_uri,
  resource: request.resource,
  scope: 'mcp'
}
const redirectURL = `${request.redirect_uri}&code=opaque-code&state=encoded-state`
const originalLocation = window.location

function pathFor(query: Record<string, string | undefined> | string): string {
  if (typeof query === 'string') return `/oauth/mcp/authorize?${query}`
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.append(key, value)
  }
  return `/oauth/mcp/authorize?${params.toString()}`
}

// 测试内切换到另一个授权请求（对应 Vue spec 直接改写 route.query 与 fullPath）
const secondRequestPath = pathFor({ ...request, client_id: 'client-2' })
function NavigateProbe() {
  const navigate = useNavigate()
  return <button type="button" data-testid="next-request" onClick={() => void navigate(secondRequestPath)} />
}

function renderAt(entry: string = pathFor({ ...request })) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <NavigateProbe />
      <Routes>
        <Route path="/oauth/mcp/authorize" element={<MCPOAuthAuthorizeView />} />
      </Routes>
    </MemoryRouter>
  )
}

const flushPromises = () => act(async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
})
const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)
const click = async (element: Element | null) => {
  await act(async () => {
    fireEvent.click(element!)
  })
}
const submit = async () => {
  await act(async () => {
    fireEvent.submit($('form')!)
  })
  await flushPromises()
}
function radio(group: 'scope' | 'permissions', label: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(`#mcp-consent-${group} [role="radio"]`)).find((node) =>
    node.textContent?.includes(label)
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.isAdmin = false
  auth.user = { email: 'user@example.com' }
  previewAuthorization.mockResolvedValue({ ...consent })
  authorize.mockResolvedValue({ redirect_url: redirectURL })
  Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign } })
})
afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
})

describe('MCP OAuth consent', () => {
  it('previews the exact query, displays the client and full return address, and waits for explicit consent', async () => {
    renderAt()
    await flushPromises()
    expect(previewAuthorization).toHaveBeenCalledWith(request)
    expect($('[data-testid="client-name"]')?.textContent).toBe(consent.client_name)
    expect($('[data-testid="redirect-origin"]')?.textContent).toBe('https://client.example.com')
    expect($('[data-testid="redirect-uri"]')?.textContent).toBe(request.redirect_uri)
    expect(document.body.textContent).toContain('mcp.untrustedApplicationHint')
    expect(document.body.textContent).toContain('mcp.signedInAs')
    expect(authorize).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
    expect(radio('scope', 'mcp.adminScope')).toBeUndefined()
    await submit()
    expect(authorize).toHaveBeenCalledWith({ authorization: request, approved: true, scope: 'user', read_only: true })
    expect(assign).toHaveBeenCalledWith(redirectURL)
  })

  it('allows an omitted OAuth scope without adding or changing request parameters', async () => {
    const { scope: _scope, ...expected } = request
    renderAt(pathFor(expected))
    await flushPromises()
    await submit()
    expect(previewAuthorization).toHaveBeenCalledWith(expected)
    expect(authorize.mock.calls[0][0].authorization).toEqual(expected)
  })

  it('escapes untrusted application names', async () => {
    previewAuthorization.mockResolvedValue({ ...consent, client_name: '<img src=x onerror=alert(1)>' })
    renderAt()
    await flushPromises()
    expect($('[data-testid="client-name"]')?.textContent).toBe('<img src=x onerror=alert(1)>')
    expect($('[data-testid="client-name"] img')).toBeNull()
  })

  const base = new URLSearchParams(request as unknown as Record<string, string>)
  const withParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(base)
    mutate(params)
    return params.toString()
  }
  it.each([
    ['a repeated client_id', withParams((p) => p.append('client_id', 'attacker'))],
    ['a state without a value', withParams((p) => p.delete('state')) + '&state'],
    ['a missing resource', withParams((p) => p.delete('resource'))],
    ['response_type token', withParams((p) => p.set('response_type', 'token'))],
    ['a plain code challenge', withParams((p) => p.set('code_challenge_method', 'plain'))],
    ['a short code challenge', withParams((p) => p.set('code_challenge', 'short'))],
    ['an unsupported scope', withParams((p) => p.set('scope', 'mcp admin'))],
    ['an unsupported parameter', withParams((p) => p.set('extra', 'unsupported'))]
  ])('blocks malformed requests before preview: %s', async (_label, query) => {
    renderAt(pathFor(query))
    await flushPromises()
    expect(previewAuthorization).not.toHaveBeenCalled()
    expect($('[role="alert"]')?.textContent).toContain('mcp.invalidRequest')
    expect($('[data-testid="approve"]')).toBeNull()
    expect(authorize).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })

  it('does not offer approval or follow client redirect when preview is rejected', async () => {
    previewAuthorization.mockRejectedValue({ message: 'Unregistered redirect URI' })
    renderAt()
    await flushPromises()
    expect($('[role="alert"]')?.textContent).toContain('Unregistered redirect URI')
    expect($('[data-testid="approve"]')).toBeNull()
    expect(authorize).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })

  it('rejects a preview whose client or redirect differs from the request', async () => {
    previewAuthorization.mockResolvedValue({ ...consent, redirect_uri: 'https://unexpected.example/callback' })
    renderAt()
    await flushPromises()
    expect($('[role="alert"]')?.textContent).toContain('mcp.invalidRequest')
    expect($('form')).toBeNull()
  })

  it('denies with the original authorization and follows only the server result', async () => {
    const deniedURL = `${request.redirect_uri}&error=access_denied&state=encoded-state`
    authorize.mockResolvedValue({ redirect_url: deniedURL })
    renderAt()
    await flushPromises()
    await click($('[data-testid="deny"]'))
    await flushPromises()
    expect(authorize).toHaveBeenCalledTimes(1)
    expect(authorize).toHaveBeenCalledWith({ authorization: request, approved: false, scope: 'user', read_only: true })
    expect(assign).toHaveBeenCalledWith(deniedURL)
  })

  it('requires admin step-up before retrying approval and keeps selected permissions', async () => {
    auth.isAdmin = true
    authorize.mockRejectedValueOnce({ reason: 'STEP_UP_REQUIRED' }).mockResolvedValueOnce({ redirect_url: redirectURL })
    renderAt()
    await flushPromises()
    expect(radio('scope', 'mcp.userScope')?.getAttribute('aria-checked')).toBe('true')
    await click(radio('scope', 'mcp.adminScope')!)
    await click(radio('permissions', 'mcp.readWrite')!)
    await submit()
    expect(authorize).toHaveBeenCalledTimes(1)
    expect(assign).not.toHaveBeenCalled()
    await click($('[data-testid="step-up-verify"]'))
    await flushPromises()
    expect(authorize).toHaveBeenCalledTimes(2)
    expect(authorize.mock.calls[1][0]).toEqual({ authorization: request, approved: true, scope: 'admin', read_only: false })
    expect(assign).toHaveBeenCalledWith(redirectURL)
  })

  it('explains that administrator write access always needs two-factor verification', async () => {
    auth.isAdmin = true
    renderAt()
    await flushPromises()
    const hint = () => $('[data-testid="admin-write-hint"]')
    expect(hint()).toBeNull()
    await click(radio('permissions', 'mcp.readWrite')!)
    expect(hint()).toBeNull()
    await click(radio('scope', 'mcp.adminScope')!)
    expect(hint()?.textContent).toBe('mcp.adminWriteHint')
    await click(radio('permissions', 'mcp.readOnly')!)
    expect(hint()).toBeNull()
  })

  it('cancels admin step-up without granting access', async () => {
    auth.isAdmin = true
    authorize.mockRejectedValue({ reason: 'STEP_UP_REQUIRED' })
    renderAt()
    await flushPromises()
    await click(radio('scope', 'mcp.adminScope')!)
    await submit()
    await click($('[data-testid="step-up-cancel"]'))
    await flushPromises()
    expect(authorize).toHaveBeenCalledTimes(1)
    expect(assign).not.toHaveBeenCalled()
    expect($('[role="alert"]')).toBeNull()
    expect($<HTMLButtonElement>('[data-testid="approve"]')?.disabled).toBe(false)
  })

  it('reports submission failures without navigating', async () => {
    authorize.mockRejectedValue({ message: 'Permission denied' })
    renderAt()
    await flushPromises()
    await submit()
    expect($('[role="alert"]')?.textContent).toBe('Permission denied')
    expect(assign).not.toHaveBeenCalled()
  })

  it.each(['https://attacker.example/callback', 'javascript:alert(1)', 'https://client.example.com/other'])(
    'rejects unexpected server redirects: %s',
    async (destination) => {
      authorize.mockResolvedValue({ redirect_url: destination })
      renderAt()
      await flushPromises()
      await submit()
      expect($('[role="alert"]')?.textContent).toBe('mcp.invalidRedirect')
      expect(assign).not.toHaveBeenCalled()
    }
  )

  it('submits the query captured at preview even if the previewed object changes', async () => {
    renderAt()
    await flushPromises()
    previewAuthorization.mock.calls[0][0].state = 'changed-after-preview'
    await submit()
    expect(authorize.mock.calls[0][0].authorization).toEqual(request)
  })

  it('clears old consent on route changes and ignores a late preview response', async () => {
    let resolveFirst!: (value: MCPConsent) => void
    previewAuthorization.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
    previewAuthorization.mockResolvedValueOnce({ ...consent, client_id: 'client-2', client_name: 'Second client' })
    renderAt()
    await click($('[data-testid="next-request"]'))
    await flushPromises()
    expect($('[data-testid="client-name"]')?.textContent).toBe('Second client')
    await act(async () => {
      resolveFirst(consent)
    })
    await flushPromises()
    expect($('[data-testid="client-name"]')?.textContent).toBe('Second client')
  })
})
