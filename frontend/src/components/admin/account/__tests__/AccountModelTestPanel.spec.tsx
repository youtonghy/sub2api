import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AccountModelTestPanel from '../AccountModelTestPanel'

const { getAvailableModels } = vi.hoisted(() => ({
  getAvailableModels: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: { accounts: { getAvailableModels } }
}))

vi.mock('@/api/client', () => ({
  buildApiUrl: (path: string) => `/api/v1${path}`
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: 'en', setLocale: vi.fn() })
}))

vi.mock('@/components/common/Select', () => ({
  default: ({ value, onChange, options, ...rest }: any) => (
    <select
      aria-label={rest['aria-label']}
      value={String(value)}
      onChange={(event) => onChange?.(event.target.value, null)}
    >
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}))

const account = {
  id: 7,
  name: 'Primary OpenAI',
  platform: 'openai',
  type: 'apikey',
  status: 'active'
}
const secondaryAccount = { ...account, id: 8, name: 'Secondary OpenAI' }

function streamResponse(success: boolean) {
  const encoder = new TextEncoder()
  const chunks = [encoder.encode(`data: {"type":"test_complete","success":${success}${success ? '' : ',"error":"upstream failed"'}}\n\n`)]
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: chunks[0] })
          .mockResolvedValueOnce({ done: true, value: undefined })
      })
    }
  } as unknown as Response
}

const flushPromises = () => act(async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
})

const modelButtons = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-status]'))

function mountPanel() {
  return render(<AccountModelTestPanel accounts={[account] as any} platform="openai" active />)
}

function mountMultiAccountPanel() {
  return render(<AccountModelTestPanel accounts={[account, secondaryAccount] as any} platform="openai" active />)
}

describe('AccountModelTestPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAvailableModels.mockResolvedValue([
      { id: 'gpt-5', display_name: 'GPT-5' },
      { id: 'gpt-5-mini', display_name: 'GPT-5 mini' }
    ])
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: vi.fn(() => 'test-token') },
      configurable: true
    })
  })

  it('loads provider models and marks an individual successful test green', async () => {
    global.fetch = vi.fn().mockResolvedValue(streamResponse(true)) as any
    mountPanel()
    await flushPromises()

    expect(getAvailableModels).toHaveBeenCalledWith(7)
    const modelButton = modelButtons().find((button) => button.textContent?.includes('GPT-5 mini'))
    expect(modelButton).toBeTruthy()
    fireEvent.click(modelButton!)
    await flushPromises()

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/admin/accounts/7/test', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({
      model_id: 'gpt-5-mini',
      prompt: '',
      mode: 'default'
    })
    // Vue 版断言 border-green-300 类；这里断言成功状态
    const updated = modelButtons().find((button) => button.textContent?.includes('GPT-5 mini'))
    expect(updated).toHaveAttribute('data-status', 'success')
  })

  it('tests every loaded model in one batch and marks failures red', async () => {
    global.fetch = vi.fn().mockResolvedValue(streamResponse(false)) as any
    mountPanel()
    await flushPromises()

    fireEvent.click(screen.getByRole('button', { name: /admin\.accounts\.modelTest\.testAll/ }))
    await flushPromises()
    await flushPromises()

    expect(global.fetch).toHaveBeenCalledTimes(2)
    const buttons = modelButtons().filter((button) => button.textContent?.includes('GPT-5'))
    expect(buttons).toHaveLength(2)
    expect(buttons.every((button) => button.getAttribute('data-status') === 'error')).toBe(true)
  })

  it('limits batch tests to the chosen account and models', async () => {
    global.fetch = vi.fn().mockResolvedValue(streamResponse(true)) as any
    mountMultiAccountPanel()
    await flushPromises()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'GPT-5 mini' }))
    fireEvent.click(screen.getByRole('button', { name: /admin\.accounts\.modelTest\.testAll/ }))
    await flushPromises()

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/admin/accounts/7/test', expect.objectContaining({
      body: expect.stringContaining('gpt-5-mini')
    }))
  })
})
