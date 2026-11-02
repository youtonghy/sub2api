import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import VersionBadge from '../VersionBadge'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

const { getRollbackVersions, rollback } = vi.hoisted(() => ({ getRollbackVersions: vi.fn(), rollback: vi.fn() }))
vi.mock('@/api/admin/system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/admin/system')>()),
  getRollbackVersions,
  rollback,
}))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

const fetchVersion = vi.fn().mockResolvedValue(null)

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({
    fetchVersion,
    versionLoading: false,
    currentVersion: '1.2.0',
    latestVersion: '1.2.0',
    hasUpdate: false,
    buildType: 'release',
    releaseInfo: null,
  })
})
afterEach(cleanup)

describe('VersionBadge', () => {
  it('shows a static version for non-admins and hides it when collapsed', () => {
    useAuthStore.setState({ isAdmin: false })
    const { rerender } = render(<VersionBadge version="1.0.0" />)
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
    rerender(<VersionBadge version="1.0.0" collapsed />)
    expect(screen.queryByText('v1.0.0')).toBeNull()
    expect(fetchVersion).not.toHaveBeenCalled()
  })

  it('lets admins pick a rollback version and confirm it', async () => {
    const user = userEvent.setup()
    useAuthStore.setState({ isAdmin: true })
    getRollbackVersions.mockResolvedValue({ versions: [{ version: '1.1.0', published_at: '2026-09-01T00:00:00Z' }] })
    rollback.mockResolvedValue({ need_restart: true })
    render(<VersionBadge version="1.0.0" />)
    expect(fetchVersion).toHaveBeenCalledWith(false)

    await user.click(screen.getByRole('button', { name: 'v1.2.0' }))
    await user.click(await screen.findByRole('button', { name: /version\.rollback$/ }))
    await user.click(await screen.findByRole('button', { name: /v1\.1\.0/ }))
    expect(document.body.textContent).toContain('rollback v1.1.0')

    await user.click(screen.getByRole('button', { name: 'version.rollbackConfirm' }))
    await waitFor(() => expect(rollback).toHaveBeenCalledWith('1.1.0'))
    expect(await screen.findByText('version.rollbackComplete')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'version.restartNow' })).toBeInTheDocument()
  })
})
