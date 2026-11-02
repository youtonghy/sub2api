import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ModelTagInput from '../ModelTagInput'

const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

function setup(models: string[]) {
  const onModelsChange = vi.fn()
  const view = render(<ModelTagInput models={models} onModelsChange={onModelsChange} />)
  const input = view.container.querySelector('input')!
  return { onModelsChange, input }
}

// 用原生事件派发，返回值为 false 表示 preventDefault 被调用
function press(input: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  act(() => {
    input.dispatchEvent(event)
  })
  return event
}

describe('model tag keyboard navigation', () => {
  it.each(['Enter', 'Tab', 'Backspace'])('leaves composing %s to the input method', (key) => {
    const { onModelsChange, input } = setup(['existing'])
    if (key !== 'Backspace') fireEvent.change(input, { target: { value: 'prefix' } })
    const event = press(input, key, { isComposing: true })
    expect(event.defaultPrevented).toBe(false)
    expect(onModelsChange).not.toHaveBeenCalled()
  })

  it('keeps tags on Delete and removes the last tag only on Backspace', () => {
    const { onModelsChange, input } = setup(['existing'])
    fireEvent.keyDown(input, { key: 'Delete' })
    expect(onModelsChange).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(onModelsChange.mock.calls).toEqual([[[]]])
  })

  it('commits ordinary Enter input and prevents form submission', () => {
    const { onModelsChange, input } = setup([])
    fireEvent.change(input, { target: { value: 'new-model' } })
    const event = press(input, 'Enter')
    expect(event.defaultPrevented).toBe(true)
    expect(onModelsChange.mock.calls).toEqual([[['new-model']]])
  })

  it.each([false, true])('allows leaving an empty input with Tab (shift: %s)', (shiftKey) => {
    const { onModelsChange, input } = setup(['gpt-4o'])
    expect(press(input, 'Tab', { shiftKey }).defaultPrevented).toBe(false)
    expect(onModelsChange).not.toHaveBeenCalled()
  })

  it('allows leaving a whitespace-only input', () => {
    const { onModelsChange, input } = setup([])
    fireEvent.change(input, { target: { value: '   ' } })
    expect(press(input, 'Tab').defaultPrevented).toBe(false)
    expect(onModelsChange).not.toHaveBeenCalled()
  })

  it('still commits a pending model with Tab, then allows the next Tab to leave', () => {
    const { onModelsChange, input } = setup(['gpt-4o'])
    fireEvent.change(input, { target: { value: 'gpt-4.1' } })
    expect(press(input, 'Tab').defaultPrevented).toBe(true)
    expect(onModelsChange.mock.calls).toEqual([[['gpt-4o', 'gpt-4.1']]])
    expect(input.value).toBe('')
    expect(press(input, 'Tab').defaultPrevented).toBe(false)
  })
})
