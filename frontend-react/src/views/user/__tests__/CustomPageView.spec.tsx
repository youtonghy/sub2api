import { act, render, type RenderResult } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CustomPageView from '../CustomPageView'
import { useAdminSettingsStore } from '@/stores/adminSettings'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { CustomMenuItem } from '@/types'

const { route } = vi.hoisted(() => ({ route: { params: { id: 'docs' } as Record<string, string> } }))

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useParams: () => route.params
}))
vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: 'en', setLocale: vi.fn() })
}))

let notifyResize: () => void
const results: RenderResult[] = []

function setMenuItems(items: Array<Partial<CustomMenuItem>>) {
  useAppStore.setState({
    publicSettingsLoaded: true,
    cachedPublicSettings: { custom_menu_items: items } as never
  })
}

async function flushPromises() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

function mountPage() {
  const result = render(<CustomPageView />)
  results.push(result)
  return result
}

function get(container: Element, selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`Element not found: ${selector}`)
  return element
}

function mountEmbed() {
  const { container } = mountPage()
  const shell = get(container, '[data-custom-embed-shell]')
  const button = get(container, '[data-custom-open-fab]') as HTMLAnchorElement
  const size = { width: 800, height: 600 }
  let capturedPointer: number | null = null
  Object.defineProperties(shell, {
    clientWidth: { get: () => size.width }, clientHeight: { get: () => size.height },
  })
  Object.defineProperties(button, {
    offsetWidth: { value: 100 }, offsetHeight: { value: 32 },
    offsetLeft: { get: () => Number.parseFloat(button.style.left || '688') },
    offsetTop: { get: () => Number.parseFloat(button.style.top || '12') },
    setPointerCapture: { value: vi.fn((id: number) => { capturedPointer = id }) },
    hasPointerCapture: { value: (id: number) => capturedPointer === id },
    releasePointerCapture: { value: vi.fn(() => { capturedPointer = null }) },
  })
  return { container, button, size }
}

async function pointer(button: HTMLElement, type: string, x: number, y: number, extra = {}) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, ...extra })
  Object.defineProperties(event, {
    pointerId: { value: 1 }, isPrimary: { value: true },
  })
  await act(async () => {
    button.dispatchEvent(event)
  })
}

function click(button: HTMLElement, detail = 1) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail })
  act(() => {
    button.dispatchEvent(event)
  })
  return event
}

describe('custom page open button', () => {
  beforeEach(() => {
    route.params = { id: 'docs' }
    setMenuItems([{ id: 'docs', url: 'https://example.com/docs' }])
    useAuthStore.setState({ isAdmin: false, user: { id: 7 } as never, token: 'test-token' })
    useAdminSettingsStore.setState({ customMenuItems: [] })
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notifyResize = callback }
      observe() {}
      disconnect() {}
    })
  })

  afterEach(() => {
    results.splice(0).forEach(result => result.unmount())
    vi.unstubAllGlobals()
  })

  it.each([undefined, false, true])('honors the per-menu hide button setting %s while keeping the iframe', (hidden) => {
    setMenuItems([{ id: 'docs', url: 'https://example.com/docs', hide_open_button: hidden }])
    const { container } = mountPage()
    expect(container.querySelector('[data-custom-open-fab]') !== null).toBe(hidden !== true)
    expect(get(container, 'iframe').getAttribute('src')).toContain('https://example.com/docs')
  })

  it('preserves the embedded URL, secure link attributes, and normal clicks with small pointer movements', async () => {
    const { container, button } = mountEmbed()
    expect(button.href).toBe(get(container, 'iframe').getAttribute('src'))
    expect(button.href).toContain('user_id=7')
    expect(button.href).toContain('token=test-token')
    expect(button.target).toBe('_blank')
    expect(button.rel).toBe('noopener noreferrer')
    await pointer(button, 'pointerdown', 700, 24)
    await pointer(button, 'pointermove', 702, 25)
    await pointer(button, 'pointerup', 702, 25)
    expect(button.style.left).toBe('')
    expect(click(button).defaultPrevented).toBe(false)
    expect(click(button, 0).defaultPrevented).toBe(false)
  })

  it('captures the pointer across iframe content and suppresses only the click following a drag', async () => {
    const { button } = mountEmbed()
    await pointer(button, 'pointerdown', 700, 24)
    expect(button.setPointerCapture).toHaveBeenCalledWith(1)
    await pointer(button, 'pointermove', 200, 124)
    expect(button.style.left).toBe('188px')
    expect(button.style.top).toBe('112px')
    await pointer(button, 'pointerup', 200, 124)
    expect(button.releasePointerCapture).toHaveBeenCalledWith(1)
    expect(click(button).defaultPrevented).toBe(true)
    expect(click(button).defaultPrevented).toBe(false)
    await pointer(button, 'pointerdown', 200, 124)
    await pointer(button, 'pointermove', 220, 124)
    await pointer(button, 'pointerup', 220, 124)
    expect(click(button, 0).defaultPrevented).toBe(false)
  })

  it('keeps the button inside each boundary and reachable when the container shrinks', async () => {
    const { button, size } = mountEmbed()
    await pointer(button, 'pointerdown', 700, 24)
    await pointer(button, 'pointermove', -1000, -1000)
    expect([button.style.left, button.style.top]).toEqual(['0px', '0px'])
    await pointer(button, 'pointermove', 2000, 2000)
    expect([button.style.left, button.style.top]).toEqual(['700px', '568px'])
    await pointer(button, 'pointerup', 2000, 2000)
    size.width = 300
    size.height = 200
    act(() => notifyResize())
    expect([button.style.left, button.style.top]).toEqual(['200px', '168px'])
  })

  it('stops moving on cancellation or lost pointer capture and permits the next normal click', async () => {
    const { button } = mountEmbed()
    for (const endEvent of ['pointercancel', 'lostpointercapture']) {
      await pointer(button, 'pointerdown', 700, 24)
      await pointer(button, 'pointermove', 500, 124)
      await pointer(button, endEvent, 500, 124)
      const position = button.style.cssText
      await pointer(button, 'pointermove', 400, 224)
      expect(button.style.cssText).toBe(position)
      await pointer(button, 'pointerdown', 500, 124)
      await pointer(button, 'pointerup', 500, 124)
      expect(click(button).defaultPrevented).toBe(false)
    }
  })

  it('leaves secondary mouse button gestures alone', async () => {
    const { button } = mountEmbed()
    await pointer(button, 'pointerdown', 700, 24, { button: 2 })
    await pointer(button, 'pointermove', 500, 124)
    expect(button.setPointerCapture).not.toHaveBeenCalled()
    expect(button.style.left).toBe('')
  })

  it('keeps Markdown pages separate from the embedded-page controls', async () => {
    setMenuItems([{ id: 'docs', url: 'md:guide' }])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '# Guide' }))
    const { container } = mountPage()
    await flushPromises()
    expect(container.querySelector('[data-custom-open-fab]')).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
    expect(get(container, '[data-markdown-content] h1').textContent).toBe('Guide')
  })
})
