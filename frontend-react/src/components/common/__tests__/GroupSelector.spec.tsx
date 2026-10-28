import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth'
import { resetStore } from '@/stores/__tests__/storeHarness'
import GroupSelector from '../GroupSelector'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }),
}))

const groups = [
  { id: 1, name: 'Basic', platform: 'anthropic', status: 'active' },
  { id: 2, name: 'Composite', platform: 'composite', status: 'active' }
] as any

const setSimpleMode = (isSimpleMode: boolean) => useAuthStore.setState({ isSimpleMode })

const mountSelector = (value: number[] = []) => {
  const onChange = vi.fn()
  const view = render(<GroupSelector value={value} onChange={onChange} groups={groups} />)
  return { ...view, onChange }
}

describe('GroupSelector simple-mode binding policy', () => {
  beforeEach(() => {
    resetStore(useAuthStore)
    setSimpleMode(false)
  })

  it('hides composite groups in simple mode and preserves basic groups', () => {
    setSimpleMode(true)
    const { container } = mountSelector()
    expect(container.textContent).toContain('Basic')
    expect(container.textContent).not.toContain('Composite')
  })

  it('keeps composite groups available in advanced mode', () => {
    const { container } = mountSelector()
    expect(container.textContent).toContain('Composite')
  })

  it('cleans hidden historical composite IDs while preserving visible selections', () => {
    setSimpleMode(true)
    const { onChange } = mountSelector([1, 2])
    expect(onChange.mock.calls).toEqual([[[1]]])
  })
})
