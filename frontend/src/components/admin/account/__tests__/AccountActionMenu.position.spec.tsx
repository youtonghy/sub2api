import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Account } from '@/types'
import AccountActionMenu, { type AccountActionMenuProps } from '../AccountActionMenu'
import styles from '../AccountActionMenu.module.css'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' })
}))

const account = {
  id: 1,
  platform: 'openai',
  type: 'oauth',
  status: 'active',
  rate_limit_reset_at: '2099-01-01T00:00:00Z'
} as Account

let menuHeight: number
let resizeMenu: ResizeObserverCallback

const getMenu = () => document.body.querySelector<HTMLElement>('.action-menu-content')!
const getTop = () => Number.parseFloat(getMenu().style.top)
const getLeft = () => Number.parseFloat(getMenu().style.left)

function setViewport(width: number, height: number) {
  vi.stubGlobal('innerWidth', width)
  vi.stubGlobal('innerHeight', height)
  act(() => {
    window.dispatchEvent(new Event('resize'))
  })
}

function mountMenu(anchorRect = new DOMRect(950, 720, 32, 24), extra: Partial<AccountActionMenuProps> = {}) {
  const handlers = { onClose: vi.fn(), onRecoverState: vi.fn() }
  const props: AccountActionMenuProps = { show: true, account, anchorRect, ...handlers, ...extra }
  const view = render(<AccountActionMenu {...props} />)
  return { ...view, handlers, props }
}

describe('AccountActionMenu viewport positioning', () => {
  beforeEach(() => {
    menuHeight = 305
    setViewport(1024, 768)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains('action-menu-content')) return new DOMRect()
      return new DOMRect(0, 0, Math.min(208, window.innerWidth - 16), Math.min(menuHeight, window.innerHeight - 16))
    })
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resizeMenu = callback }
      observe = vi.fn()
      disconnect = vi.fn()
      unobserve = vi.fn()
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('measures a long OAuth menu and opens above the last row', () => {
    mountMenu()

    expect(getTop()).toBe(720 - 305 - 4)
    expect(getLeft()).toBe(982 - 208)
    expect(getTop() + menuHeight).toBeLessThanOrEqual(window.innerHeight - 8)
    expect(getMenu().textContent).toContain('admin.accounts.recoverState')
  })

  it('opens below the trigger when the complete menu fits', () => {
    mountMenu(new DOMRect(500, 100, 32, 24))

    expect(getTop()).toBe(128)
    expect(getLeft()).toBe(324)
  })

  it('centers a mobile menu on its trigger and flips above the last row', () => {
    setViewport(390, 600)
    mountMenu(new DOMRect(179, 550, 32, 24))

    expect(getTop()).toBe(241)
    expect(getLeft()).toBe(91)
  })

  it.each([0, 370])('keeps mobile menus within the horizontal margins at x=%i', (x) => {
    setViewport(390, 600)
    mountMenu(new DOMRect(x, 100, 24, 24))

    expect(getLeft()).toBeGreaterThanOrEqual(8)
    expect(getLeft() + 208).toBeLessThanOrEqual(382)
  })

  it('constrains an oversized menu and preserves the recover-state action', () => {
    setViewport(180, 220)
    const { handlers } = mountMenu(new DOMRect(150, 180, 24, 24))

    expect(getTop()).toBe(8)
    expect(getLeft()).toBe(8)
    expect(getMenu().style.maxHeight).toBe('204px')
    expect(getMenu().style.maxWidth).toBe('164px')
    // Vue 版断言 overflow-y-auto / overscroll-contain 类；这里由菜单模块类提供同样的滚动约束
    expect(getMenu().classList.contains(styles.menu)).toBe(true)

    const recover = Array.from(getMenu().querySelectorAll('button'))
      .find(button => button.textContent?.includes('admin.accounts.recoverState'))!
    act(() => recover.click())
    expect(handlers.onRecoverState).toHaveBeenCalledWith(account)
    expect(handlers.onRecoverState).toHaveBeenCalledTimes(1)
    expect(handlers.onClose).toHaveBeenCalledTimes(1)
  })

  it('repositions when menu content grows', () => {
    mountMenu()
    menuHeight = 420
    act(() => resizeMenu([], {} as ResizeObserver))

    expect(getTop()).toBe(296)
  })

  it('repositions and updates size limits after a viewport resize', () => {
    mountMenu()
    setViewport(320, 240)

    expect(getTop()).toBe(8)
    expect(getLeft()).toBe(104)
    expect(getMenu().style.maxHeight).toBe('224px')
    expect(getMenu().style.maxWidth).toBe('304px')
  })

  it('remeasures after reopening on another row', () => {
    const { rerender, props } = mountMenu()
    rerender(<AccountActionMenu {...props} show={false} />)
    expect(getMenu()).toBeNull()
    rerender(<AccountActionMenu {...props} show anchorRect={new DOMRect(400, 100, 32, 24)} />)

    expect(getTop()).toBe(128)
    expect(getLeft()).toBe(224)
  })

  it('still closes on Escape and backdrop clicks', () => {
    const { handlers } = mountMenu()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    const backdrop = getMenu().previousElementSibling as HTMLElement
    act(() => backdrop.click())

    expect(handlers.onClose).toHaveBeenCalledTimes(2)
  })
})
