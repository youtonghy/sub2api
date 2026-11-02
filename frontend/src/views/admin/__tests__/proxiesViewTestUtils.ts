import { act } from '@testing-library/react'
import { vi } from 'vitest'

export async function flushPromises(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

export const i18nMock = () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: 'en', setLocale: vi.fn() })
})
