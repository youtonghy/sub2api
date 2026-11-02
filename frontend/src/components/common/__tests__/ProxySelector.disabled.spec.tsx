import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Proxy } from '@/types'
import ProxySelector from '../ProxySelector'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }),
}))
vi.mock('@/api/admin', () => ({ adminAPI: { proxies: { testProxy: vi.fn() } } }))

// 移植自 disabledSelectors.spec.ts 的 ProxySelector 部分（Select 部分由 Select 的 spec 覆盖）
describe('selectors disabled while open', () => {
  it('closes an open proxy picker when the account form becomes disabled', () => {
    const onChange = vi.fn()
    const proxies = [{ id: 1, name: 'Proxy', host: 'localhost', port: 8080, protocol: 'http' } as Proxy]
    const view = render(<ProxySelector value={null} onChange={onChange} proxies={proxies} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.queryByRole('listbox')).not.toBeNull()
    view.rerender(<ProxySelector value={null} onChange={onChange} proxies={proxies} disabled />)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })
})
