import { act, renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { useAppStore } from '@/stores/app'

// Mock i18n
vi.mock('@/i18n', () => ({
  t: (key: string) => key,
}))

// Mock app store actions
const mockShowSuccess = vi.fn()
const mockShowError = vi.fn()

import { useClipboard } from '@/composables/useClipboard'

function setup() {
  return renderHook(() => useClipboard())
}

describe('useClipboard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    useAppStore.setState({ showSuccess: mockShowSuccess, showError: mockShowError })

    // 默认模拟安全上下文 + Clipboard API
    Object.defineProperty(window, 'isSecureContext', { value: true, writable: true })
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    // 恢复 execCommand
    if ('execCommand' in document) {
      delete (document as any).execCommand
    }
  })

  it('复制成功后 copied 变为 true', async () => {
    const hook = setup()

    expect(hook.result.current.copied).toBe(false)

    await act(() => hook.result.current.copyToClipboard('hello'))

    expect(hook.result.current.copied).toBe(true)
  })

  it('copied 在 2 秒后自动恢复为 false', async () => {
    const hook = setup()

    await act(() => hook.result.current.copyToClipboard('hello'))
    expect(hook.result.current.copied).toBe(true)

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(hook.result.current.copied).toBe(false)
  })

  it('复制成功时调用 showSuccess', async () => {
    const hook = setup()

    await act(() => hook.result.current.copyToClipboard('hello', '已复制'))

    expect(mockShowSuccess).toHaveBeenCalledWith('已复制')
  })

  it('无自定义消息时使用 i18n 默认消息', async () => {
    const hook = setup()

    await act(() => hook.result.current.copyToClipboard('hello'))

    expect(mockShowSuccess).toHaveBeenCalledWith('common.copiedToClipboard')
  })

  it('空文本返回 false 且不复制', async () => {
    const hook = setup()

    const result = await act(() => hook.result.current.copyToClipboard(''))

    expect(result).toBe(false)
    expect(hook.result.current.copied).toBe(false)
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('Clipboard API 失败时降级到 fallback', async () => {
    const writeTextMock = navigator.clipboard.writeText as any
    writeTextMock.mockRejectedValue(new Error('API failed'))

    // jsdom 没有 execCommand，手动定义
    const documentAny = document as any
    documentAny.execCommand = vi.fn().mockReturnValue(true)

    const hook = setup()
    const result = await act(() => hook.result.current.copyToClipboard('fallback text'))

    expect(result).toBe(true)
    expect(hook.result.current.copied).toBe(true)
    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })

  it('非安全上下文使用 fallback', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, writable: true })

    const documentAny = document as any
    documentAny.execCommand = vi.fn().mockReturnValue(true)

    const hook = setup()
    const result = await act(() => hook.result.current.copyToClipboard('insecure context text'))

    expect(result).toBe(true)
    expect(hook.result.current.copied).toBe(true)
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })

  it.each([false, true])('reports a thrown fallback error (secure context: %s)', async (secure) => {
    Object.defineProperty(window, 'isSecureContext', { value: secure, writable: true })
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('Clipboard denied'))
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => { throw new DOMException('Copy denied', 'NotAllowedError') })
    })
    const hook = setup()
    await expect(act(() => hook.result.current.copyToClipboard('text'))).resolves.toBe(false)
    expect(hook.result.current.copied).toBe(false)
    expect(mockShowError).toHaveBeenCalledWith('common.copyFailed')
    expect(mockShowSuccess).not.toHaveBeenCalled()
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('所有复制方式均失败时调用 showError', async () => {
    const writeTextMock = navigator.clipboard.writeText as any
    writeTextMock.mockRejectedValue(new Error('fail'))

    const documentAny = document as any
    documentAny.execCommand = vi.fn().mockReturnValue(false)

    const hook = setup()
    const result = await act(() => hook.result.current.copyToClipboard('text'))

    expect(result).toBe(false)
    expect(hook.result.current.copied).toBe(false)
    expect(mockShowError).toHaveBeenCalled()
  })
})
