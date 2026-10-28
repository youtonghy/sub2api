import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AnnouncementBell from '../AnnouncementBell'
import { useAnnouncementStore } from '@/stores/announcements'

const { markRead, showError, showSuccess } = vi.hoisted(() => ({ markRead: vi.fn(), showError: vi.fn(), showSuccess: vi.fn() }))
vi.mock('@/api', () => ({ announcementsAPI: { markRead } }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showError, showSuccess }) } }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
vi.mock('@/utils/format', () => ({ formatRelativeTime: () => 'now', formatRelativeWithDateTime: () => 'now' }))
afterEach(cleanup)
beforeEach(() => {
  useAnnouncementStore.getState().reset()
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  useAnnouncementStore.setState({
    announcements: [{ id: 1, title: 'Notice', content: 'Details', notify_mode: 'silent', created_at: '2026-09-30', updated_at: '2026-09-30' }],
    unreadCount: 1,
  })
})
afterEach(() => { vi.restoreAllMocks() })

describe('announcement read confirmation', () => {
  it('keeps a failed read confirmation open and only reports success after retry', async () => {
    const user = userEvent.setup()
    markRead.mockRejectedValue(new Error('offline'))
    render(<AnnouncementBell />)
    await user.click(screen.getByRole('button', { name: 'announcements.title' }))
    await user.click(await screen.findByText('Notice'))
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1))
    const confirm = () => screen.getByRole('button', { name: 'announcements.markRead' })
    await user.click(confirm())
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(2))
    expect(showSuccess).not.toHaveBeenCalled()
    expect(showError).toHaveBeenCalled()
    expect(document.body.querySelector('.markdown-body')).not.toBeNull()
    markRead.mockResolvedValue(undefined)
    await user.click(confirm())
    await waitFor(() => expect(showSuccess).toHaveBeenCalledWith('announcements.markedAsRead'))
    await waitFor(() => expect(document.body.querySelector('.markdown-body')).toBeNull())
    expect(useAnnouncementStore.getState().unreadCount).toBe(0)
  })
})
