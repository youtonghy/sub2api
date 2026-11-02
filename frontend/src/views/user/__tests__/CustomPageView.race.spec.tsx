import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CustomPageView from '../CustomPageView'
import { useAdminSettingsStore } from '@/stores/adminSettings'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

const { route } = vi.hoisted(() => ({ route: { params: { id: 'old' } as Record<string, string> } }))
const fetchPage = vi.fn()

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useParams: () => route.params
}))
vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: 'en', setLocale: vi.fn() })
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const response = (markdown: string) => ({ ok: true, text: async () => markdown }) as Response

async function flushPromises() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

/** 对应 Vue spec 中修改响应式 route.params.id：改参数后重新渲染同一实例 */
function mountPage() {
  const result = render(<CustomPageView />)
  return {
    container: result.container,
    navigate(id: string) {
      route.params = { id }
      act(() => result.rerender(<CustomPageView />))
    }
  }
}

function text(container: Element, selector: string): string {
  const element = container.querySelector(selector)
  if (!element) throw new Error(`Element not found: ${selector}`)
  return element.textContent ?? ''
}

beforeEach(() => {
  route.params = { id: 'old' }
  useAppStore.setState({
    publicSettingsLoaded: true,
    cachedPublicSettings: {
      custom_menu_items: [
        { id: 'old', url: 'md:old' }, { id: 'new', url: 'md:new' },
        { id: 'external', url: 'https://example.com/docs' }
      ]
    } as never
  })
  useAuthStore.setState({ isAdmin: false, user: { id: 1 } as never, token: 'test' })
  useAdminSettingsStore.setState({ customMenuItems: [] })
  fetchPage.mockReset()
  vi.stubGlobal('fetch', fetchPage)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('custom Markdown page request ordering', () => {
  it.each(['success', 'http error', 'network error'])('ignores an old %s after switching pages', async (outcome) => {
    const old = deferred<Response>()
    fetchPage.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response('# New page'))
    const page = mountPage()
    page.navigate('new')
    await flushPromises()
    expect(text(page.container, '[data-markdown-content] h1')).toBe('New page')
    if (outcome === 'network error') old.reject(new Error('offline'))
    else old.resolve(outcome === 'http error' ? { ok: false } as Response : response('# Old page'))
    await flushPromises()
    expect(text(page.container, '[data-markdown-content] h1')).toBe('New page')
    expect(text(page.container, '[data-toc-item]')).toBe('New page')
  })

  it('ignores an old body that finishes reading after the new page', async () => {
    const body = deferred<string>()
    fetchPage.mockResolvedValueOnce({ ok: true, text: () => body.promise })
      .mockResolvedValueOnce(response('# New page'))
    const page = mountPage()
    await flushPromises()
    page.navigate('new')
    await flushPromises()
    body.resolve('# Old page')
    await flushPromises()
    expect(text(page.container, '[data-markdown-content] h1')).toBe('New page')
  })

  it('keeps the current loading state when the old request completes', async () => {
    const old = deferred<Response>()
    const current = deferred<Response>()
    fetchPage.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const page = mountPage()
    page.navigate('new')
    old.resolve(response('# Old page'))
    await flushPromises()
    expect(page.container.querySelector('[data-loading]')).not.toBeNull()
    expect(page.container.querySelector('[data-markdown-content]')).toBeNull()
    current.resolve(response('# New page'))
    await flushPromises()
    expect(text(page.container, '[data-markdown-content] h1')).toBe('New page')
  })

  it('shows an embedded page immediately after leaving a pending Markdown page', async () => {
    const old = deferred<Response>()
    fetchPage.mockReturnValueOnce(old.promise)
    const page = mountPage()
    page.navigate('external')
    expect(page.container.querySelector('iframe')?.getAttribute('src')).toContain('https://example.com/docs')
    old.resolve(response('# Old page'))
    await flushPromises()
    expect(page.container.querySelector('[data-markdown-content]')).toBeNull()
    expect(page.container.querySelector('iframe')?.getAttribute('src')).toContain('https://example.com/docs')
  })
})
