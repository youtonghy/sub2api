/**
 * 登录类页面测试的公共工具：替代 Vue 版的 mount + flushPromises + 路由桩。
 * 各 spec 自行 vi.mock('react-router') 的 useNavigate 与 '@/i18n/useI18n'（mock 需在文件内提升）。
 */
import { act, fireEvent, render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'

/** 替代 @vue/test-utils 的 flushPromises：让挂起的 Promise 与 React 更新全部完成 */
export async function flushPromises(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

/** 在内存路由中渲染，initialEntry 提供 path 与查询参数 */
export function renderAt(ui: ReactElement, initialEntry: string = '/'): RenderResult {
  return render(<MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter>)
}

/** 修改受控输入框的值，等同 Vue 的 setValue */
export function setValue(element: Element, value: string): void {
  fireEvent.change(element, { target: { value } })
}

/** 一次性填满 OTP 输入（容器内第一个输入框接收整段数字后自动分格） */
export function fillOtp(container: Element, value: string): void {
  const first = container.querySelector('input')
  if (!first) throw new Error('OTP input not found')
  fireEvent.change(first, { target: { value } })
}

/** 返回 query 字符串构成的路径，方便断言 navigate 的参数 */
export function query(path: string, params: Record<string, string>): string {
  return `${path}?${new URLSearchParams(params).toString()}`
}

/** 页面文本（含按钮、输入框外的文字），对应 Vue 的 wrapper.text() */
export function pageText(): string {
  return document.body.textContent || ''
}
