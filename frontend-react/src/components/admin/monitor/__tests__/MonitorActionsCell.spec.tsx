import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import MonitorActionsCell from '../MonitorActionsCell'
import { makeMonitor } from './monitorFixtures'

const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

describe('MonitorActionsCell duplicate action', () => {
  it('emits the selected monitor when duplicate is clicked', () => {
    const row = makeMonitor()
    const onDuplicate = vi.fn()
    render(<MonitorActionsCell row={row} running={false} duplicating={false} onDuplicate={onDuplicate} />)

    fireEvent.click(screen.getByTestId('monitor-duplicate'))

    expect(onDuplicate.mock.calls).toEqual([[row]])
  })

  it('disables the action while the same monitor is being duplicated', () => {
    render(<MonitorActionsCell row={makeMonitor()} running={false} duplicating />)
    const button = screen.getByTestId('monitor-duplicate')

    expect(button).toBeDisabled()
    expect(button.getAttribute('title')).toBe('admin.channelMonitor.duplicating')
    expect(button.textContent).toContain('admin.channelMonitor.duplicating')
  })

  it('disables the action when the stored API key cannot be decrypted', () => {
    render(<MonitorActionsCell row={makeMonitor({ api_key_decrypt_failed: true })} running={false} duplicating={false} />)
    const button = screen.getByTestId('monitor-duplicate')

    expect(button).toBeDisabled()
    expect(button.getAttribute('title')).toBe('admin.channelMonitor.duplicateKeyUnavailable')
  })
})
