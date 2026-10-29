import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AccountTestModal from '../AccountTestModal'

const { getAvailableModels, copyToClipboard } = vi.hoisted(() => ({
  getAvailableModels: vi.fn(),
  copyToClipboard: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      getAvailableModels
    }
  }
}))

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({
    copyToClipboard
  })
}))

vi.mock('@/i18n/useI18n', () => {
  const messages: Record<string, string> = {
    'admin.accounts.imagePromptDefault': 'Generate a cute orange cat astronaut sticker on a clean pastel background.'
  }
  const t = (key: string, params?: Record<string, string | number>) => {
    if (key === 'admin.accounts.imageReceived' && params?.count) {
      return `received-${params.count}`
    }
    if (key === 'admin.accounts.imagePreviewAlt' && params?.index) {
      return `test-image-${params.index}`
    }
    return messages[key] || key
  }
  return { useI18n: () => ({ t, te: () => false, locale: 'en', setLocale: vi.fn() }) }
})

// Vue 版把 BaseDialog 替换为渲染默认插槽与 footer 插槽的桩
vi.mock('@/components/common/BaseDialog', () => ({
  default: ({ children, footer }: { children?: ReactNode; footer?: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  )
}))

vi.mock('@/components/common/Select', () => ({
  default: ({ value, onChange, options, valueKey = 'value', labelKey = 'label', ...rest }: any) => (
    <select
      className="select-stub"
      aria-label={rest['aria-label']}
      value={value ?? ''}
      onChange={(event) => onChange?.(event.target.value, null)}
    >
      {options.map((option: any) => (
        <option key={String(option[valueKey])} value={option[valueKey]}>
          {option[labelKey]}
        </option>
      ))}
    </select>
  )
}))

vi.mock('@/components/common/TextArea', () => ({
  default: ({ value, onChange }: { value: string; onChange?: (value: string) => void }) => (
    <textarea className="textarea-stub" value={value} onChange={(event) => onChange?.(event.target.value)} />
  )
}))

function createStreamResponse(lines: string[]) {
  const encoder = new TextEncoder()
  const chunks = lines.map((line) => encoder.encode(line))
  let index = 0

  return {
    ok: true,
    body: {
      getReader: () => ({
        read: vi.fn().mockImplementation(async () => {
          if (index < chunks.length) {
            return { done: false, value: chunks[index++] }
          }
          return { done: true, value: undefined }
        })
      })
    }
  } as unknown as Response
}

const flushPromises = () => act(async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
})

const defaultAccount = {
  id: 42,
  name: 'Gemini Image Test',
  platform: 'gemini',
  type: 'apikey',
  status: 'active'
}

async function mountModal(account: Record<string, unknown> = defaultAccount) {
  const view = render(<AccountTestModal show={false} account={account as any} onClose={vi.fn()} />)
  view.rerender(<AccountTestModal show account={account as any} onClose={vi.fn()} />)
  await flushPromises()
  return view
}

const startButton = () => screen.getByRole('button', { name: /admin\.accounts\.startTest/ })

describe('AccountTestModal', () => {
  beforeEach(() => {
    getAvailableModels.mockResolvedValue([
      { id: 'gemini-2.0-flash', display_name: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.5-flash-image', display_name: 'Gemini 2.5 Flash Image' },
      { id: 'gemini-3.1-flash-image', display_name: 'Gemini 3.1 Flash Image' }
    ])
    copyToClipboard.mockReset()
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => (key === 'auth_token' ? 'test-token' : null)),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn()
      },
      configurable: true
    })
    global.fetch = vi.fn().mockResolvedValue(
      createStreamResponse([
        'data: {"type":"test_start","model":"gemini-2.5-flash-image"}\n',
        'data: {"type":"image","image_url":"data:image/png;base64,QUJD","mime_type":"image/png"}\n',
        'data: {"type":"test_complete","success":true}\n'
      ])
    ) as any
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('gemini 图片模型测试会携带提示词并渲染图片预览', async () => {
    const { container } = await mountModal()

    const promptInput = container.querySelector<HTMLTextAreaElement>('textarea.textarea-stub')
    expect(promptInput).not.toBeNull()
    fireEvent.change(promptInput!, { target: { value: 'draw a tiny orange cat astronaut' } })

    expect(startButton()).toBeTruthy()
    fireEvent.click(startButton())
    await flushPromises()
    await flushPromises()

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [, request] = (global.fetch as any).mock.calls[0]
    expect(JSON.parse(request.body)).toEqual({
      model_id: 'gemini-3.1-flash-image',
      prompt: 'draw a tiny orange cat astronaut'
    })

    const preview = container.querySelector('img[alt="test-image-1"]')
    expect(preview).not.toBeNull()
    expect(preview!.getAttribute('src')).toBe('data:image/png;base64,QUJD')
  })

  it('grok 账号测试默认选择 Grok 模型', async () => {
    getAvailableModels.mockResolvedValue([
      { id: 'grok-4.3', display_name: 'Grok 4.3' },
      { id: 'grok-build-0.1', display_name: 'Grok Build 0.1' }
    ])
    global.fetch = vi.fn().mockResolvedValue(
      createStreamResponse([
        'data: {"type":"test_start","model":"grok-4.3"}\n',
        'data: {"type":"content","text":"ok"}\n',
        'data: {"type":"test_complete","success":true}\n'
      ])
    ) as any

    await mountModal({
      id: 13,
      name: 'Grok Account',
      platform: 'grok',
      type: 'oauth',
      status: 'active'
    })

    expect(startButton()).toBeTruthy()
    fireEvent.click(startButton())
    await flushPromises()

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [, request] = (global.fetch as any).mock.calls[0]
    expect(JSON.parse(request.body)).toEqual({
      model_id: 'grok-4.3',
      prompt: '',
      mode: 'text'
    })
  })

  it('OpenAI Compact 探测会携带 compact 测试模式', async () => {
    getAvailableModels.mockResolvedValue([
      { id: 'gpt-5.4', display_name: 'GPT-5.4' }
    ])
    global.fetch = vi.fn().mockResolvedValue(
      createStreamResponse([
        'data: {"type":"test_complete","success":true}\n'
      ])
    ) as any

    await mountModal({
      id: 42,
      name: 'OpenAI OAuth',
      platform: 'openai',
      type: 'oauth',
      status: 'active'
    })

    // Vue 版直接改 vm.selectedModelId / vm.testMode；这里通过下拉框操作
    fireEvent.change(screen.getByLabelText('admin.accounts.selectTestModel'), { target: { value: 'gpt-5.4' } })
    fireEvent.change(screen.getByLabelText('admin.accounts.openai.testMode'), { target: { value: 'compact' } })
    fireEvent.click(startButton())
    await flushPromises()

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [, request] = (global.fetch as any).mock.calls[0]
    expect(JSON.parse(request.body)).toMatchObject({
      model_id: 'gpt-5.4',
      prompt: '',
      mode: 'compact'
    })
  })
})
