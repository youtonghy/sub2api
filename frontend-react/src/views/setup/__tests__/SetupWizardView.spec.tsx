import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import SetupWizardView from '../SetupWizardView'

const { testDatabase, testRedis, install } = vi.hoisted(() => ({
  testDatabase: vi.fn(),
  testRedis: vi.fn(),
  install: vi.fn()
}))
vi.mock('@/api/setup', () => ({ testDatabase, testRedis, install }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(cleanup)

const nextButton = () => screen.getByRole('button', { name: /common\.next/ })
const testButton = () => screen.getByRole('button', { name: /setup\.status\.(testConnection|success)/ })

describe('SetupWizardView', () => {
  it('only proceeds after a successful database test and shows request errors', async () => {
    const user = userEvent.setup()
    testDatabase.mockRejectedValueOnce({ response: { data: { detail: 'bad credentials' } } })
    testDatabase.mockResolvedValueOnce(undefined)
    render(<SetupWizardView />)

    expect(nextButton()).toBeDisabled()

    await user.click(testButton())
    expect(await screen.findByText('bad credentials')).toBeInTheDocument()
    expect(testDatabase).toHaveBeenCalledWith(expect.objectContaining({ host: 'localhost', port: 5432, sslmode: 'disable' }))
    expect(nextButton()).toBeDisabled()

    await user.click(testButton())
    await waitFor(() => expect(nextButton()).toBeEnabled())
    await user.click(nextButton())
    expect(screen.getByRole('heading', { level: 2, name: 'setup.redis.title' })).toBeInTheDocument()
  })

  it('requires a matching admin password of at least 8 characters', async () => {
    const user = userEvent.setup()
    testDatabase.mockResolvedValue(undefined)
    testRedis.mockResolvedValue(undefined)
    render(<SetupWizardView />)

    await user.click(testButton())
    await waitFor(() => expect(nextButton()).toBeEnabled())
    await user.click(nextButton())
    await user.click(testButton())
    await waitFor(() => expect(nextButton()).toBeEnabled())
    await user.click(nextButton())

    await user.type(screen.getByLabelText('setup.admin.email'), 'admin@example.com')
    await user.type(screen.getByLabelText('setup.admin.password'), 'password1')
    await user.type(screen.getByLabelText('setup.admin.confirmPassword'), 'password2')
    expect(screen.getByText('setup.admin.passwordMismatch')).toBeInTheDocument()
    expect(nextButton()).toBeDisabled()

    await user.clear(screen.getByLabelText('setup.admin.confirmPassword'))
    await user.type(screen.getByLabelText('setup.admin.confirmPassword'), 'password1')
    expect(nextButton()).toBeEnabled()
    await user.click(nextButton())
    expect(screen.getByText('admin@example.com')).toBeInTheDocument()
    expect(screen.getByText('postgres@localhost:5432/sub2api')).toBeInTheDocument()
  })
})
