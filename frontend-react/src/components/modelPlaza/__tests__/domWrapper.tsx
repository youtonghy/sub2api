/**
 * 模型广场 spec 的测试工具：把 RTL 渲染结果包装成与 @vue/test-utils wrapper 相近的接口
 * （text / find / findAll / attributes / exists / unmount），让移植的用例逐条保持原样。
 */
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'

export interface DomWrapper {
  element: Element | null
  text: () => string
  find: (selector: string) => DomWrapper
  findAll: (selector: string) => DomWrapper[]
  attributes: (name: string) => string | undefined
  exists: () => boolean
}

export function wrap(element: Element | null): DomWrapper {
  return {
    element,
    text: () => (element?.textContent ?? '').trim(),
    find: (selector) => wrap(element?.querySelector(selector) ?? null),
    findAll: (selector) => Array.from(element?.querySelectorAll(selector) ?? []).map((el) => wrap(el)),
    attributes: (name) => element?.getAttribute(name) ?? undefined,
    exists: () => element !== null
  }
}

export function mountElement(ui: ReactElement): DomWrapper & { unmount: () => void } {
  const result = render(ui)
  return { ...wrap(result.container), unmount: result.unmount }
}
