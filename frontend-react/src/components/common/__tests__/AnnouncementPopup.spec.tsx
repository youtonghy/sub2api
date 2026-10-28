import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import AnnouncementPopup from '../AnnouncementPopup'
import { useAnnouncementStore } from '@/stores/announcements'

const announcementMarkdownStyles = readFileSync(
  resolve(process.cwd(), 'src/styles/announcement-markdown.css'),
  'utf8',
)

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    te: () => true,
    locale: 'en',
  }),
}))

const announcement = {
  id: 1,
  title: 'Preview announcement',
  content: '## Preview heading\n\n<div>HTML content</div><script>window.__xss = true</script>',
  status: 'draft' as const,
  notify_mode: 'popup' as const,
  targeting: { any_of: [] },
  created_at: '2026-07-24T07:30:00Z',
  updated_at: '2026-07-24T07:30:00Z',
}

function dismissButton() {
  return document.body.querySelector<HTMLButtonElement>('[data-testid="announcement-popup-dismiss"]')
}

describe('AnnouncementPopup', () => {
  beforeEach(() => {
    useAnnouncementStore.getState().reset()
  })

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
    document.body.style.overflow = ''
  })

  it('renders mixed Markdown and HTML inside the shared styled container', async () => {
    useAnnouncementStore.setState({
      currentPopup: {
        id: 1,
        title: 'Mixed content announcement',
        content: [
          '## Markdown heading',
          '',
          '<div><h3>HTML heading</h3><ul><li>HTML list item</li></ul></div>',
          '',
          '<table><thead><tr><th>Status</th></tr></thead><tbody><tr><td>OK</td></tr></tbody></table>',
          '<script>window.__announcementXss = true</script>',
        ].join('\n'),
        notify_mode: 'popup',
        created_at: '2026-07-24T07:30:00Z',
        updated_at: '2026-07-24T07:30:00Z',
      },
    })

    const { unmount } = render(<AnnouncementPopup />)

    const content = await waitFor(() => {
      const node = document.body.querySelector('.markdown-body')
      expect(node).not.toBeNull()
      return node!
    })
    expect(content.querySelector('h2')?.textContent).toBe('Markdown heading')
    expect(content.querySelector('h3')?.textContent).toBe('HTML heading')
    expect(content.querySelector('li')?.textContent).toBe('HTML list item')
    expect(content.querySelector('table td')?.textContent).toBe('OK')
    expect(content.querySelector('script')).toBeNull()

    unmount()
  })

  it.each(['h2', 'h3', 'ul', 'li', 'blockquote', 'table', 'th', 'td', 'code'])(
    'loads a shared style rule for mixed-content <%s> elements',
    (element) => {
      expect(announcementMarkdownStyles).toContain(`.markdown-body ${element}`)
    },
  )

  it('previews an admin announcement without marking it as read', async () => {
    const dismissPopup = vi.fn().mockResolvedValue(undefined)
    useAnnouncementStore.setState({ dismissPopup })
    const onClose = vi.fn()
    const { rerender, unmount } = render(<AnnouncementPopup announcement={announcement} preview onClose={onClose} />)

    await waitFor(() => expect(document.body.textContent).toContain('Preview announcement'))
    expect(document.body.querySelector('.markdown-body h2')?.textContent).toBe('Preview heading')
    expect(document.body.querySelector('.markdown-body script')).toBeNull()
    expect(document.body.textContent).toContain('common.close')

    dismissButton()?.click()

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dismissPopup).not.toHaveBeenCalled()

    rerender(<AnnouncementPopup announcement={null} preview onClose={onClose} />)
    expect(document.body.style.overflow).toBe('')
    unmount()
  })

  it('keeps the existing user popup dismissal behavior', async () => {
    const dismissPopup = vi.fn().mockResolvedValue(undefined)
    useAnnouncementStore.setState({ currentPopup: announcement, dismissPopup })
    const onClose = vi.fn()
    const { unmount } = render(<AnnouncementPopup onClose={onClose} />)

    await waitFor(() => expect(dismissButton()).not.toBeNull())
    dismissButton()?.click()

    expect(dismissPopup).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    unmount()
  })
})
