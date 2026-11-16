import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrivacyFilterEventsProps } from '../components/PrivacyFilterEvents'
import { appRoutes } from '@/router/routes'
import AdminPrivacyFilterView from '../AdminPrivacyFilterView'
import UserPrivacyFilterView from '../UserPrivacyFilterView'

const mocks = vi.hoisted(() => ({
  getGroups: vi.fn(),
  listKeys: vi.fn(),
  showError: vi.fn(),
  eventsProps: [] as PrivacyFilterEventsProps[]
}))

vi.mock('@/api/admin', () => ({ adminAPI: { groups: { getAll: mocks.getGroups } } }))
vi.mock('@/api', () => ({ keysAPI: { list: mocks.listKeys } }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showError: mocks.showError }) } }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('../components/PrivacyFilterEvents', () => ({
  default: (props: PrivacyFilterEventsProps) => {
    mocks.eventsProps.push(props)
    return <div data-test={`events-${props.variant}`}>{(props.apiKeyOptions ?? []).map((o) => o.label).join(',')}</div>
  }
}))
vi.mock('../components/PrivacyFilterPanel', () => ({
  default: ({ groups }: { groups: Array<{ name: string }> }) => (
    <div data-test="settings-panel">{groups.map((group) => group.name).join(',')}</div>
  )
}))

describe('privacy filter pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.eventsProps.length = 0
  })

  it('opens the admin page on records and keeps settings one tab away', async () => {
    mocks.getGroups.mockResolvedValue([{ id: 1, name: 'alpha' }])
    const { container } = render(<AdminPrivacyFilterView />)

    const records = container.querySelector('[data-test="tab-panel-records"]') as HTMLElement
    const settings = container.querySelector('[data-test="tab-panel-settings"]') as HTMLElement
    expect(records.hidden).toBe(false)
    expect(settings.hidden).toBe(true)
    expect(mocks.eventsProps[0].variant).toBe('admin')
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy())

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'privacyFilter.tabs.settings' }))
    fireEvent.click(screen.getByRole('tab', { name: 'privacyFilter.tabs.settings' }))
    await waitFor(() => expect(settings.hidden).toBe(false))
    expect(records.hidden).toBe(true)
  })

  it('reports a group load failure on the admin page', async () => {
    mocks.getGroups.mockRejectedValue(new Error('nope'))
    render(<AdminPrivacyFilterView />)
    await waitFor(() => expect(mocks.showError).toHaveBeenCalledTimes(1))
  })

  it('gives the user page their own keys as filter options', async () => {
    mocks.listKeys.mockResolvedValue({ items: [{ id: 5, name: 'my-key' }], total: 1, page: 1, page_size: 100, pages: 1 })
    render(<UserPrivacyFilterView />)
    expect(await screen.findByText('my-key')).toBeTruthy()
    expect(mocks.listKeys).toHaveBeenCalledWith(1, 100)
    expect(mocks.eventsProps.at(-1)?.variant).toBe('user')
  })

  it('registers the admin page as admin-only and the user page for signed-in users', () => {
    const admin = appRoutes.find((route) => route.path === '/admin/privacy-filter')
    const user = appRoutes.find((route) => route.path === '/privacy-filter')
    expect(admin?.meta).toMatchObject({ requiresAuth: true, requiresAdmin: true, titleKey: 'privacyFilter.title' })
    expect(admin?.meta.requiresRiskControl).toBeUndefined()
    expect(user?.meta).toMatchObject({ requiresAuth: true, requiresAdmin: false, titleKey: 'privacyFilter.title' })
  })
})
