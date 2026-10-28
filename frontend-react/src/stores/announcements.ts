import { create } from 'zustand'
import { announcementsAPI } from '@/api'
import type { UserAnnouncement } from '@/types'

const THROTTLE_MS = 20 * 60 * 1000 // 20 minutes

export interface AnnouncementState {
  // State
  announcements: UserAnnouncement[]
  loading: boolean
  currentPopup: UserAnnouncement | null
  // Getters
  unreadCount: number
  // Actions
  fetchAnnouncements: (force?: boolean) => Promise<void>
  dismissPopup: () => Promise<void>
  markAsRead: (id: number) => Promise<boolean>
  markAllAsRead: () => Promise<void>
  reset: () => void
}

function countUnread(announcements: UserAnnouncement[]): number {
  return announcements.filter((a) => !a.read_at).length
}

export const useAnnouncementStore = create<AnnouncementState>()((set, get) => {
  // Internal state, not exposed by the Vue store either
  let lastFetchTime = 0
  let popupQueue: UserAnnouncement[] = []

  // Session-scoped dedup set — not reactive, used as plain lookup only
  let shownPopupIds = new Set<number>()
  let fetchGeneration = 0

  function setAnnouncements(announcements: UserAnnouncement[]): void {
    set({ announcements, unreadCount: countUnread(announcements) })
  }

  /**
   * Stamp read_at on the announcement with the given id (replaces mutating the Vue reactive objects)
   */
  function markLocallyRead(id: number): void {
    const readAt = new Date().toISOString()
    setAnnouncements(get().announcements.map((a) => (a.id === id ? { ...a, read_at: readAt } : a)))
  }

  // Actions
  async function fetchAnnouncements(force = false) {
    const now = Date.now()
    if (!force && lastFetchTime > 0 && now - lastFetchTime < THROTTLE_MS) {
      return
    }

    // Set immediately to prevent concurrent duplicate requests
    lastFetchTime = now
    const generation = ++fetchGeneration

    try {
      set({ loading: true })
      const all = await announcementsAPI.list(false)
      if (generation !== fetchGeneration) return
      setAnnouncements(all.slice(0, 20))
      enqueueNewPopups()
    } catch (err: any) {
      if (generation !== fetchGeneration) return
      // Revert throttle timestamp on failure so retry is allowed
      lastFetchTime = 0
      console.error('Failed to fetch announcements:', err)
    } finally {
      if (generation === fetchGeneration) set({ loading: false })
    }
  }

  function enqueueNewPopups() {
    const newPopups = get().announcements.filter(
      (a) => a.notify_mode === 'popup' && !a.read_at && !shownPopupIds.has(a.id)
    )
    if (newPopups.length === 0) return

    for (const p of newPopups) {
      if (!popupQueue.some((q) => q.id === p.id)) {
        popupQueue.push(p)
      }
    }

    if (!get().currentPopup) {
      showNextPopup()
    }
  }

  function showNextPopup() {
    if (popupQueue.length === 0) {
      set({ currentPopup: null })
      return
    }
    const next = popupQueue.shift()!
    set({ currentPopup: next })
    shownPopupIds.add(next.id)
  }

  async function dismissPopup() {
    const currentPopup = get().currentPopup
    if (!currentPopup) return
    const id = currentPopup.id
    set({ currentPopup: null })

    // Mark as read (fire-and-forget, UI already updated)
    markAsRead(id)

    // Show next popup after a short delay
    if (popupQueue.length > 0) {
      setTimeout(() => showNextPopup(), 300)
    }
  }

  async function markAsRead(id: number) {
    try {
      await announcementsAPI.markRead(id)
      markLocallyRead(id)
      return true
    } catch (err: any) {
      console.error('Failed to mark announcement as read:', err)
      return false
    }
  }

  async function markAllAsRead() {
    const unread = get().announcements.filter((a) => !a.read_at)
    if (unread.length === 0) return

    try {
      set({ loading: true })
      const results = await Promise.allSettled(unread.map(async (a) => {
        await announcementsAPI.markRead(a.id)
        markLocallyRead(a.id)
      }))
      const failure = results.find((result) => result.status === 'rejected')
      if (failure) throw failure.reason
    } catch (err: any) {
      console.error('Failed to mark all as read:', err)
      throw err
    } finally {
      set({ loading: false })
    }
  }

  function reset() {
    fetchGeneration++
    lastFetchTime = 0
    shownPopupIds = new Set()
    popupQueue = []
    set({ announcements: [], unreadCount: 0, currentPopup: null, loading: false })
  }

  return {
    // State
    announcements: [],
    loading: false,
    currentPopup: null,
    // Getters
    unreadCount: 0,
    // Actions
    fetchAnnouncements,
    dismissPopup,
    markAsRead,
    markAllAsRead,
    reset
  }
})
