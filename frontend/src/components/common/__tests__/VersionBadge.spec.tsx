import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import VersionBadge from '../VersionBadge'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}:${Object.values(params).join(',')}` : key),
    te: () => true,
    locale: 'en',
  }),
}))

const fetchVersion = vi.fn().mockResolvedValue(null)

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({
    fetchVersion,
    versionLoading: false,
    currentVersion: '2611111054',
    upstreamVersion: '0.2.21',
    latestVersion: '0.2.21',
    versionWarning: '',
    hasUpdate: false,
    buildType: 'release',
    releaseInfo: { name: 'v0.2.21', body: '', published_at: '', html_url: 'https://github.com/Wei-Shaw/sub2api/releases/tag/v0.2.21' },
  })
})
afterEach(cleanup)

describe('VersionBadge', () => {
  it('shows a static version for non-admins and hides it when collapsed', () => {
    useAuthStore.setState({ isAdmin: false })
    const { rerender } = render(<VersionBadge version="2611111054" />)
    expect(screen.getByText('2611111054')).toBeInTheDocument()
    rerender(<VersionBadge version="0.2.21" />)
    expect(screen.getByText('v0.2.21')).toBeInTheDocument()
    rerender(<VersionBadge version="0.2.21" collapsed />)
    expect(screen.queryByText('v0.2.21')).toBeNull()
    expect(fetchVersion).not.toHaveBeenCalled()
  })

  it('shows build time and upstream versions when up to date, without online update', async () => {
    const user = userEvent.setup()
    useAuthStore.setState({ isAdmin: true })
    render(<VersionBadge version="2611111054" />)
    expect(fetchVersion).toHaveBeenCalledWith(false)

    await user.click(screen.getByRole('button', { name: '2611111054' }))
    expect(await screen.findByText('shell.forkVersion.builtAt:2026-11-11 10:54')).toBeInTheDocument()
    expect(screen.getByText('shell.forkVersion.upToDate')).toBeInTheDocument()
    expect(screen.getAllByText('v0.2.21')).toHaveLength(2)
    expect(screen.queryByText('version.updateNow')).toBeNull()
    expect(screen.queryByText(/version\.rollback/)).toBeNull()
    expect(screen.queryByText('shell.forkVersion.viewDiff')).toBeNull()
  })

  it('flags a newer upstream release and links to the diff', async () => {
    const user = userEvent.setup()
    useAuthStore.setState({ isAdmin: true })
    useAppStore.setState({ upstreamVersion: '0.2.20', latestVersion: '0.2.21', hasUpdate: true })
    render(<VersionBadge version="2611111054" />)

    await user.click(screen.getByRole('button', { name: '2611111054' }))
    expect(await screen.findByText('shell.forkVersion.behind:v0.2.21')).toBeInTheDocument()
    expect(screen.getByText('v0.2.20')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'shell.forkVersion.viewDiff' })).toHaveAttribute(
      'href',
      'https://github.com/Wei-Shaw/sub2api/compare/v0.2.20...v0.2.21',
    )
  })

  it('does not claim up to date when the upstream check failed', async () => {
    const user = userEvent.setup()
    useAuthStore.setState({ isAdmin: true })
    useAppStore.setState({ versionWarning: 'rate limited', releaseInfo: null })
    render(<VersionBadge version="2611111054" />)

    await user.click(screen.getByRole('button', { name: '2611111054' }))
    expect(await screen.findByText('shell.forkVersion.checkFailed')).toBeInTheDocument()
    expect(screen.queryByText('shell.forkVersion.upToDate')).toBeNull()
  })
})
