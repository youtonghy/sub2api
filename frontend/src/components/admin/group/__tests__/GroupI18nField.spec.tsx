import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import GroupI18nField from '../GroupI18nField'
import type { GroupI18n } from '@/types'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${params.language}` : key),
    te: () => true,
    locale: 'en',
    setLocale: () => {}
  })
}))

// 用例断言焦点，逐例卸载避免互相残留
afterEach(cleanup)

// 挂载一个双向绑定的宿主，贴近分组表单里的真实用法。
const mountField = (initial: { text: string; i18n: GroupI18n }, fieldProps: Record<string, unknown> = {}) => {
  const state = { text: initial.text, i18n: initial.i18n }
  function Host() {
    const [text, setText] = useState(initial.text)
    const [i18n, setI18n] = useState(initial.i18n)
    return (
      <GroupI18nField
        label="Name"
        field="name"
        {...fieldProps}
        modelValue={text}
        onModelValueChange={(value) => {
          state.text = value
          setText(value)
        }}
        i18n={i18n}
        onI18nChange={(value) => {
          state.i18n = value
          setI18n(value)
        }}
      />
    )
  }
  const view = render(<Host />)
  return { view, state }
}

const trigger = () => screen.getByTestId('group-i18n-menu')
const menuItems = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-locale]'))
const choose = (locale: string) => {
  fireEvent.click(trigger())
  fireEvent.click(document.querySelector(`button[data-locale="${locale}"]`)!)
}
const input = () => document.querySelector('input')!

describe('GroupI18nField', () => {
  it('renders the label and the switcher on one row above a single input', () => {
    mountField({ text: '标准', i18n: { en: { name: 'Standard' } } })

    const label = document.querySelector('label')!
    const labelRow = label.parentElement!
    expect(label.textContent).toBe('Name')
    expect(labelRow.contains(trigger())).toBe(true)
    expect(labelRow.contains(input())).toBe(false)
    expect(document.querySelectorAll('input')).toHaveLength(1)
  })

  it('starts on the default content', () => {
    const { state } = mountField({ text: '标准', i18n: { en: { name: 'Standard' } } })

    expect(input().value).toBe('标准')
    expect(trigger().textContent).toBe('admin.groups.i18nField.default')

    fireEvent.change(input(), { target: { value: '标准版' } })

    expect(state.text).toBe('标准版')
    expect(state.i18n).toEqual({ en: { name: 'Standard' } })
  })

  it('lists the default content and an add or edit entry per interface language', () => {
    mountField({ text: '标准', i18n: { en: { name: 'Standard' }, zh: { description: '仅描述' } } })

    fireEvent.click(trigger())

    expect(menuItems().map((item) => [item.getAttribute('data-locale'), item.textContent])).toEqual([
      ['default', 'admin.groups.i18nField.default'],
      ['en', 'admin.groups.i18nField.edit:English'],
      ['zh', 'admin.groups.i18nField.add:中文']
    ])
  })

  it('switches the same input to the chosen language version', () => {
    const { state } = mountField({ text: '标准', i18n: { en: { name: 'Standard' } } })

    choose('en')

    expect(menuItems()).toHaveLength(0)
    expect(document.querySelectorAll('input')).toHaveLength(1)
    expect(input().value).toBe('Standard')
    expect(document.activeElement).toBe(input())
    expect(trigger().textContent).toBe('English')

    fireEvent.change(input(), { target: { value: 'Standard v2' } })

    expect(state.text).toBe('标准')
    expect(state.i18n).toEqual({ en: { name: 'Standard v2' } })
  })

  it('starts a new language version empty and keeps the other field of that language', () => {
    const { state } = mountField({ text: '标准', i18n: { en: { description: 'Pro + Max pool' } } })

    choose('en')
    expect(input().value).toBe('')
    expect(input().getAttribute('placeholder')).toBe('admin.groups.i18nField.placeholder:English')

    fireEvent.change(input(), { target: { value: 'Standard' } })

    expect(state.i18n).toEqual({ en: { name: 'Standard', description: 'Pro + Max pool' } })
  })

  it('returns to the default content from a language version', () => {
    mountField({ text: '标准', i18n: { en: { name: 'Standard' } } })

    choose('en')
    choose('zh')
    expect(input().value).toBe('')

    choose('default')

    expect(input().value).toBe('标准')
    expect(trigger().textContent).toBe('admin.groups.i18nField.default')
  })

  it('marks the version being edited in the menu', () => {
    mountField({ text: '标准', i18n: {} })

    choose('zh')
    fireEvent.click(trigger())

    const checked = menuItems()
      .filter((item) => item.querySelector('svg'))
      .map((item) => item.getAttribute('data-locale'))
    expect(checked).toEqual(['zh'])
  })

  it('requires only the default content and keeps the form placeholder for it', () => {
    mountField(
      { text: '', i18n: {} },
      { required: true, placeholder: 'Enter name', 'data-tour': 'group-form-name' }
    )
    expect(input().hasAttribute('required')).toBe(true)
    expect(input().getAttribute('placeholder')).toBe('Enter name')
    expect(input().getAttribute('data-tour')).toBe('group-form-name')

    choose('en')

    expect(input().hasAttribute('required')).toBe(false)
  })

  it('switches a single textarea for multiline fields', () => {
    const { state } = mountField({ text: '号池', i18n: {} }, { field: 'description', multiline: true, rows: '3' })
    expect(document.querySelectorAll('textarea')).toHaveLength(1)
    expect(document.querySelector('textarea')!.getAttribute('rows')).toBe('3')

    choose('en')
    fireEvent.change(document.querySelector('textarea')!, { target: { value: 'Pro + Max pool' } })

    expect(document.querySelectorAll('textarea')).toHaveLength(1)
    expect(state.i18n).toEqual({ en: { description: 'Pro + Max pool' } })
    expect(state.text).toBe('号池')
  })

  it('closes the menu when clicking elsewhere', () => {
    mountField({ text: '标准', i18n: {} })
    fireEvent.click(trigger())
    expect(menuItems()).toHaveLength(3)

    act(() => {
      document.body.click()
    })

    expect(menuItems()).toHaveLength(0)
  })
})
