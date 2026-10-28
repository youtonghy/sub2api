import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Proxy } from '@/types'
import ProxySelector from '../ProxySelector'

const testProxy = vi.hoisted(() => vi.fn())
vi.mock('@/api/admin', () => ({ adminAPI: { proxies: { testProxy } } }))
vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }),
}))
beforeEach(() => { vi.clearAllMocks() })

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

// Vue 版按 .test-btn / .batch-test-btn 类名查找，React 版按可访问名称查找
const testButtons = () => screen.getAllByRole('button', { name: 'admin.proxies.testConnection' })
const batchButton = () => screen.getByRole('button', { name: 'admin.proxies.batchTest' })

function openSelector() {
  const view = render(
    <ProxySelector
      value={null}
      onChange={vi.fn()}
      proxies={[1, 2].map((id) => ({ id, name: `Proxy ${id}`, host: 'localhost', port: 8080, protocol: 'http' } as Proxy))}
    />,
  )
  fireEvent.click(screen.getByRole('button', { expanded: false }))
  return view
}

describe('proxy connection tests', () => {
  it('does not restart an individual test when a batch is started', async () => {
    let finish!: (result: object) => void
    testProxy.mockImplementation((id: number) => id === 1
      ? new Promise((resolve) => { finish = resolve })
      : Promise.resolve({ success: true, country: 'GB' }))
    const { container } = openSelector()
    fireEvent.click(testButtons()[0])
    fireEvent.click(batchButton())
    await flushPromises()
    expect(testProxy.mock.calls.map(([id]) => id)).toEqual([1, 2])
    expect(testButtons()[0]).toBeDisabled()
    await act(async () => finish({ success: true, country: 'US' }))
    await flushPromises()
    expect(container.textContent).toContain('US')
    expect(testButtons()[0]).not.toBeDisabled()
  })

  it('shows per-proxy outcomes and allows another batch after a failure', async () => {
    testProxy.mockImplementation((id: number) => id === 1
      ? Promise.reject(new Error('offline'))
      : Promise.resolve({ success: true, country: 'GB' }))
    const { container } = openSelector()
    fireEvent.click(batchButton())
    await flushPromises()
    expect(testProxy).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('admin.proxies.testFailed')
    expect(container.textContent).toContain('GB')
    expect(batchButton()).not.toBeDisabled()
    fireEvent.click(batchButton())
    await flushPromises()
    expect(testProxy).toHaveBeenCalledTimes(4)
  })
})
