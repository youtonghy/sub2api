import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import Select, { type SelectProps } from '../Select'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }),
}))

const baseOptions = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta' },
  { value: 'gamma', label: 'Gamma' },
]

const trigger = () => screen.getByRole('button', { name: 'Select option' })

function open(props: Partial<SelectProps> = {}) {
  const onChange = vi.fn()
  const allProps: SelectProps = { value: 'gamma', searchable: true, options: baseOptions, onChange, ...props }
  const view = render(<Select {...allProps} />)
  fireEvent.click(trigger())
  const setProps = (next: Partial<SelectProps>) => view.rerender(<Select {...allProps} {...next} />)
  return { onChange, setProps }
}

function search(query: string) {
  const input = document.querySelector<HTMLInputElement>('[role="listbox"] input')!
  fireEvent.change(input, { target: { value: query } })
}

function enter() {
  act(() => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

const values = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.map(([value]) => [value])

describe('Select highlight after result changes', () => {
  it('selects a filtered result when the previous highlight index is no longer valid', () => {
    const { onChange } = open()
    search('alpha')
    enter()
    expect(values(onChange)).toEqual([['alpha']])
  })

  it('restores keyboard selection after a search with no matches', () => {
    const { onChange } = open()
    search('no matches')
    enter()
    expect(onChange).not.toHaveBeenCalled()
    search('beta')
    enter()
    expect(values(onChange)).toEqual([['beta']])
  })

  it('highlights the first enabled result when remote options arrive', () => {
    const { onChange, setProps } = open({ value: null, remote: true, options: [] })
    setProps({
      options: [
        { value: 'group', label: 'Group', kind: 'group', disabled: true },
        { value: 'result', label: 'Result' },
      ],
    })
    enter()
    expect(values(onChange)).toEqual([['result']])
  })

  it('does not retain an old index that now points to a disabled option', () => {
    const { onChange, setProps } = open({ remote: true })
    setProps({
      options: [
        { value: 'result', label: 'Result' },
        { value: 'other', label: 'Other' },
        { value: 'disabled', label: 'Disabled', disabled: true },
      ],
    })
    enter()
    expect(values(onChange)).toEqual([['result']])
  })

  it('preserves the selected highlight when reopening after clearing a search', () => {
    const { onChange } = open()
    search('alpha')
    fireEvent.click(trigger())
    fireEvent.click(trigger())
    enter()
    expect(values(onChange)).toEqual([['gamma']])
  })
})
