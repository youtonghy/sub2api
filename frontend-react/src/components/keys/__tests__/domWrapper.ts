/**
 * 测试辅助：把 DOM 元素包装成与 @vue/test-utils 包装器同名的最小接口（find / findAll / get / text /
 * trigger / setValue / attributes / exists），让从 Vue 迁移来的用例保持原有断言，只替换挂载方式。
 */
import { act, fireEvent } from '@testing-library/react'

export interface DomWrapper<E extends Element = Element> {
  element: E
  exists: () => boolean
  text: () => string
  html: () => string
  attributes: (name: string) => string | undefined
  find: (selector: string) => DomWrapper
  findAll: (selector: string) => DomWrapper[]
  get: (selector: string) => DomWrapper
  trigger: (event: 'click' | 'submit' | 'input' | 'change' | 'keydown' | 'blur' | 'focus', init?: object) => Promise<void>
  setValue: (value: string | boolean) => Promise<void>
}

export const flushPromises = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
})

function missing(selector: string): DomWrapper {
  const fail = () => {
    throw new Error(`Unable to find ${selector}`)
  }
  return {
    get element(): Element {
      return fail() as never
    },
    exists: () => false,
    text: fail,
    html: fail,
    attributes: fail,
    find: () => missing(selector),
    findAll: () => [],
    get: fail,
    trigger: async () => fail(),
    setValue: async () => fail()
  }
}

export function wrap<E extends Element>(element: E): DomWrapper<E> {
  return {
    element,
    exists: () => element.isConnected,
    text: () => (element.textContent ?? '').trim(),
    html: () => element.innerHTML,
    attributes: (name) => element.getAttribute(name) ?? undefined,
    find: (selector) => {
      const found = element.querySelector(selector)
      return found ? wrap(found) : missing(selector)
    },
    findAll: (selector) => Array.from(element.querySelectorAll(selector)).map((found) => wrap(found)),
    get: (selector) => {
      const found = element.querySelector(selector)
      if (!found) throw new Error(`Unable to get ${selector}`)
      return wrap(found)
    },
    trigger: async (event, init) => {
      await act(async () => {
        switch (event) {
          case 'click': fireEvent.click(element, init); break
          case 'submit': fireEvent.submit(element, init); break
          case 'input': fireEvent.input(element, init); break
          case 'change': fireEvent.change(element, init); break
          case 'keydown': fireEvent.keyDown(element, init); break
          case 'blur': fireEvent.blur(element, init); break
          case 'focus': fireEvent.focus(element, init); break
        }
      })
      await flushPromises()
    },
    setValue: async (value) => {
      await act(async () => {
        if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
          if (element.checked !== Boolean(value)) fireEvent.click(element)
        } else if (element instanceof HTMLSelectElement) {
          fireEvent.change(element, { target: { value } })
        } else if (element.getAttribute('role') === 'checkbox') {
          // Arc checkbox（Radix）是 button[role=checkbox]
          if ((element.getAttribute('aria-checked') === 'true') !== Boolean(value)) fireEvent.click(element)
        } else {
          fireEvent.change(element, { target: { value } })
        }
      })
      await flushPromises()
    }
  }
}
