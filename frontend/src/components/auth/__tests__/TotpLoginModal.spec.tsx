import { act, createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TotpLoginModal, { type TotpLoginModalHandle } from '@/components/auth/TotpLoginModal'
import { useAppStore } from '@/stores/app'
import { pageText } from '@/views/auth/__tests__/authTestUtils'

const { showErrorMock } = vi.hoisted(() => ({
  showErrorMock: vi.fn(),
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: 'en', setLocale: vi.fn() }),
}))

describe('TotpLoginModal', () => {
  beforeEach(() => {
    showErrorMock.mockReset()
    useAppStore.setState({ showError: (...args: any[]) => showErrorMock(...args) })
  })

  it('sends verification errors to toast and does not render inline red text', () => {
    const ref = createRef<TotpLoginModalHandle>()
    render(
      <TotpLoginModal
        ref={ref}
        tempToken="temp-token"
        userEmailMasked="u***@example.com"
        onVerify={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    act(() => {
      ref.current!.setError('Invalid code')
    })

    expect(showErrorMock).toHaveBeenCalledWith('Invalid code')
    expect(pageText()).not.toContain('Invalid code')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
