import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AnnouncementReadStatusDialog from '../AnnouncementReadStatusDialog'

const { getReadStatus, showError } = vi.hoisted(() => ({
  getReadStatus: vi.fn(),
  showError: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    announcements: {
      getReadStatus
    }
  }
}))

vi.mock('@/stores/app', () => ({
  useAppStore: { getState: () => ({ showError }) }
}))

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

vi.mock('@/composables/usePersistedPageSize', () => ({
  getPersistedPageSize: () => 20
}))

vi.mock('@/components/common/BaseDialog', () => ({
  default: ({ children, footer }: { children?: ReactNode; footer?: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  )
}))
vi.mock('@/components/common/DataTable', () => ({ default: () => null }))
vi.mock('@/components/common/Pagination', () => ({ default: () => null }))

const flushPromises = () => act(async () => {})

describe('AnnouncementReadStatusDialog', () => {
  beforeEach(() => {
    getReadStatus.mockReset()
    showError.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('closes by aborting active requests and clearing debounced reloads', async () => {
    let activeSignal: AbortSignal | undefined
    getReadStatus.mockImplementation(async (...args: unknown[]) => {
      activeSignal = (args[4] as { signal?: AbortSignal } | undefined)?.signal
      return new Promise(() => {})
    })
    const onClose = vi.fn()

    const view = render(<AnnouncementReadStatusDialog show={false} announcementId={1} onClose={onClose} />)
    view.rerender(<AnnouncementReadStatusDialog show announcementId={1} onClose={onClose} />)
    await flushPromises()

    expect(getReadStatus).toHaveBeenCalledTimes(1)
    expect(activeSignal?.aborted).toBe(false)

    // 输入搜索词（启动 300ms 防抖重载），随后立即关闭
    fireEvent.change(screen.getByPlaceholderText('admin.announcements.searchUsers'), { target: { value: 'alice' } })

    fireEvent.click(screen.getByRole('button', { name: 'common.close' }))
    await flushPromises()

    expect(activeSignal?.aborted).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(350)
    })
    await flushPromises()

    expect(getReadStatus).toHaveBeenCalledTimes(1)
  })
})
