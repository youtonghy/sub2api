import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import Select, { type SelectProps } from '../Select'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }),
}))

const trigger = () => screen.getByRole('button', { name: 'Select option' })

function press(key: string) {
  act(() => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

function open(searchable: SelectProps['searchable'] = 'auto') {
  const onChange = vi.fn()
  render(
    <Select
      value="alpha"
      searchable={searchable}
      onChange={onChange}
      options={[
        { value: 'alpha', label: 'Alpha' },
        { value: 'disabled', label: 'Disabled', disabled: true },
        { value: 'beta', label: 'Beta' },
      ]}
    />
  )
  act(() => trigger().focus())
  press('ArrowDown')
  return onChange
}

describe('Select keyboard focus', () => {
  it.each([false, 'auto'] as const)('selects an enabled option without a search input (%s)', (searchable) => {
    const onChange = open(searchable)
    expect(document.activeElement).toBe(document.querySelector('[role="listbox"]'))
    press('ArrowDown')
    press('Enter')
    expect(onChange.mock.calls.map(([value]) => [value])).toEqual([['beta']])
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(trigger())
  })

  it('allows Escape to close a non-searchable dropdown and restore trigger focus', () => {
    const onChange = open(false)
    press('Escape')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(trigger())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps focus in the search input when search is enabled', () => {
    const onChange = open(true)
    expect(document.activeElement).toBe(document.querySelector('[role="listbox"] input'))
    press('ArrowDown')
    press('Enter')
    expect(onChange.mock.calls.map(([value]) => [value])).toEqual([['beta']])
  })
})

describe('Select IME keyboard input', () => {
  it.each(['Enter', 'Escape', 'ArrowDown', 'ArrowUp'])('leaves composing %s to the input method', (key) => {
    const onChange = vi.fn()
    render(
      <Select
        value={null}
        searchable
        onChange={onChange}
        options={[{ value: 'first', label: 'First' }, { value: 'second', label: 'Second' }]}
      />
    )
    fireEvent.click(trigger())
    const input = document.querySelector<HTMLInputElement>('[role="listbox"] input')!
    expect(document.activeElement).toBe(input)
    const composing = new KeyboardEvent('keydown', { key, isComposing: true, bubbles: true, cancelable: true })
    act(() => {
      input.dispatchEvent(composing)
    })
    expect(composing.defaultPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(onChange.mock.calls.map(([value]) => [value])).toEqual([['first']])
  })
})
