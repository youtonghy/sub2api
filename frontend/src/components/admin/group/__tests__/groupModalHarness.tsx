/**
 * 分组倍率 / RPM 覆盖弹窗测试的公共替身（Vue 版用 global.stubs 替换 BaseDialog / Pagination / Icon）。
 * 各 spec 在 vi.mock 工厂里 await import 这里的模块。
 */
import { act, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'

export const i18nModule = () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en', setLocale: () => {} })
})

export const baseDialogModule = () => ({
  default: (props: { show: boolean; children?: ReactNode }) => (props.show ? <div>{props.children}</div> : null)
})

export const nullModule = () => ({ default: () => null })

export const appStoreModule = (app: { showError: (...args: any[]) => void; showSuccess: (...args: any[]) => void }) => {
  const useAppStore = Object.assign((selector?: (state: typeof app) => unknown) => (selector ? selector(app) : app), {
    getState: () => app
  })
  return { useAppStore }
}

export const flushPromises = () => act(async () => {})

/** Vue 版 setValue 会同时触发 input 与 change；React 版表格内输入框在失焦时提交 */
export function setValueAndCommit(input: Element, value: string) {
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

export const buttonByText = (text: string) =>
  Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === text)

export const buttonContaining = (text: string) =>
  Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes(text))
