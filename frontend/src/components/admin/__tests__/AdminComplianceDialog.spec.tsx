import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import AdminComplianceDialog from '../AdminComplianceDialog'
import { useAdminComplianceStore } from '@/stores/adminCompliance'
import { useAuthStore } from '@/stores/auth'

const { showSuccess, showError } = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showSuccess, showError }) } }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

const PHRASE = 'I agree'

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ isAuthenticated: true, isAdmin: true })
  useAdminComplianceStore.setState({ shouldShow: true, expectedPhrase: PHRASE, submitting: false, status: null })
})
afterEach(cleanup)

describe('AdminComplianceDialog', () => {
  it('renders the bundled legal document and cannot be dismissed with Escape', async () => {
    const user = userEvent.setup()
    render(<AdminComplianceDialog />)
    await screen.findByRole('dialog')
    expect(document.body.querySelector('h1')).not.toBeNull()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('only submits the exact phrase and reports success', async () => {
    const user = userEvent.setup()
    const accept = vi.fn().mockResolvedValue({ required: false })
    useAdminComplianceStore.setState({ accept })
    render(<AdminComplianceDialog />)

    const input = await screen.findByLabelText('adminCompliance.inputLabel')
    await user.type(input, 'wrong{Enter}')
    expect(accept).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await user.clear(input)
    await user.type(input, ` ${PHRASE} `)
    await user.click(screen.getByRole('button', { name: 'adminCompliance.accept' }))
    await waitFor(() => expect(accept).toHaveBeenCalledWith(PHRASE))
    expect(showSuccess).toHaveBeenCalledWith('adminCompliance.accepted')
  })
})
