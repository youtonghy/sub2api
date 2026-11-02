import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HomeView from '../HomeView'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

const { checkAuth, fetchPublicSettings } = vi.hoisted(() => ({
  checkAuth: vi.fn(),
  fetchPublicSettings: vi.fn()
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: 'en', setLocale: vi.fn() })
}))

// 对应 Vue spec 的 LocaleSwitcher 桩
vi.mock('@/components/common/LocaleSwitcher', () => ({
  default: () => <div data-testid="locale-switcher" />
}))

function mountHome(settings: Record<string, unknown> = {}) {
  useAppStore.setState({
    cachedPublicSettings: {
      site_name: 'Test site',
      site_subtitle: 'Test subtitle',
      ...settings,
    } as never,
  })
  return render(
    <MemoryRouter>
      <HomeView />
    </MemoryRouter>
  )
}

/** 对应 Vue 的 compact-home 内首个登录/后台 RouterLink 的 to */
function compactDestination(result: ReturnType<typeof mountHome>) {
  return result.container.querySelector('[data-testid="compact-home"] [data-home-entry]')?.getAttribute('href')
}

function modelPlazaDestination(result: ReturnType<typeof mountHome>) {
  return result.container.querySelector('a[href="/model-plaza"]')?.getAttribute('href') ?? undefined
}

describe('HomeView compact mode', () => {
  beforeEach(() => {
    useAppStore.setState({
      siteName: 'Fallback site',
      siteLogo: '',
      docUrl: '',
      publicSettingsLoaded: true,
      fetchPublicSettings,
    })
    useAuthStore.setState({ isAuthenticated: false, isAdmin: false, user: null, checkAuth })
    checkAuth.mockClear()
    fetchPublicSettings.mockClear()
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders custom HTML ahead of compact mode', () => {
    const result = mountHome({
      compact_home_enabled: true,
      home_content: '<section id="custom-home">Custom home</section>',
    })

    expect(result.container.querySelector('#custom-home')?.textContent).toBe('Custom home')
    expect(result.container.querySelector('[data-testid="compact-home"]')).toBeNull()
  })

  it('renders custom URL content ahead of compact mode', () => {
    const result = mountHome({
      compact_home_enabled: true,
      home_content: ' https://example.com/home ',
    })

    expect(result.container.querySelector('iframe')?.getAttribute('src')).toBe('https://example.com/home')
    expect(result.container.querySelector('[data-testid="compact-home"]')).toBeNull()
  })

  it('treats whitespace-only custom content as empty and selects compact mode', () => {
    const result = mountHome({ compact_home_enabled: true, home_content: ' \n\t ' })

    expect(result.container.querySelector('[data-testid="compact-home"]')?.textContent).toContain('Test site')
  })

  it.each([undefined, false])('selects the default home when compact mode is %s', (enabled) => {
    const settings = enabled === undefined ? {} : { compact_home_enabled: enabled }
    const result = mountHome(settings)

    expect(result.container.querySelector('[data-testid="compact-home"]')).toBeNull()
    expect(result.container.querySelector('[data-terminal]')).not.toBeNull()
  })

  it('links unauthenticated visitors to login', () => {
    expect(compactDestination(mountHome({ compact_home_enabled: true }))).toBe('/login')
  })

  it('links authenticated users to their dashboard', () => {
    useAuthStore.setState({ isAuthenticated: true })

    expect(compactDestination(mountHome({ compact_home_enabled: true }))).toBe('/dashboard')
  })

  it('links administrators to the admin dashboard', () => {
    useAuthStore.setState({ isAuthenticated: true, isAdmin: true })

    const result = mountHome({ compact_home_enabled: true })
    expect(compactDestination(result)).toBe('/admin/dashboard')
    expect(checkAuth).toHaveBeenCalledOnce()
    expect(fetchPublicSettings).not.toHaveBeenCalled()
  })

  it('shows the model plaza link to anonymous visitors when public access is enabled', () => {
    const result = mountHome({
      compact_home_enabled: true,
      model_plaza_enabled: true,
      model_plaza_require_auth: false,
    })

    expect(modelPlazaDestination(result)).toBe('/model-plaza')
  })

  it('hides the model plaza link from anonymous visitors when sign-in is required', () => {
    const result = mountHome({
      compact_home_enabled: true,
      model_plaza_enabled: true,
      model_plaza_require_auth: true,
    })

    expect(modelPlazaDestination(result)).toBeUndefined()
  })

  it('shows the model plaza link to authenticated visitors when sign-in is required', () => {
    useAuthStore.setState({ isAuthenticated: true })

    const result = mountHome({
      compact_home_enabled: true,
      model_plaza_enabled: true,
      model_plaza_require_auth: true,
    })

    expect(modelPlazaDestination(result)).toBe('/model-plaza')
  })

  it('shows the model plaza link in the default home header', () => {
    const result = mountHome({
      model_plaza_enabled: true,
      model_plaza_require_auth: false,
    })

    expect(modelPlazaDestination(result)).toBe('/model-plaza')
  })

  it('hides the model plaza link when the feature is disabled', () => {
    const result = mountHome({
      compact_home_enabled: true,
      model_plaza_enabled: false,
      model_plaza_require_auth: false,
    })

    expect(modelPlazaDestination(result)).toBeUndefined()
  })
})
