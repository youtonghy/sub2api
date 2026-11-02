import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'

import NotFoundView from '../NotFoundView'

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
afterEach(cleanup)

function renderAt(entries: string[]) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Routes>
        <Route path="/dashboard" element={<p>dashboard page</p>} />
        <Route path="/previous" element={<p>previous page</p>} />
        <Route path="*" element={<NotFoundView />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('NotFoundView', () => {
  it('shows the not found title and goes to the dashboard', async () => {
    renderAt(['/missing'])
    expect(screen.getByText('errors.pageNotFound')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /shell.notFound.goToDashboard/ }))
    expect(await screen.findByText('dashboard page')).toBeInTheDocument()
  })

  it('goes back to the previous page', async () => {
    renderAt(['/previous', '/missing'])
    await userEvent.click(screen.getByRole('button', { name: /shell.notFound.goBack/ }))
    expect(await screen.findByText('previous page')).toBeInTheDocument()
  })
})
