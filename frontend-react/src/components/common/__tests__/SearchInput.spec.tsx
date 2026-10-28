import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SearchInput from '../SearchInput'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function renderInput() {
  const onChange = vi.fn()
  const onSearch = vi.fn()
  const view = render(<SearchInput value="" debounceMs={300} onChange={onChange} onSearch={onSearch} />)
  const setValue = (value: string) =>
    view.rerender(<SearchInput value={value} debounceMs={300} onChange={onChange} onSearch={onSearch} />)
  return { onChange, onSearch, setValue, input: screen.getByRole('textbox') as HTMLInputElement }
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

describe('SearchInput composition', () => {
  it('waits for committed IME text before updating or searching', async () => {
    const { onChange, onSearch, input } = renderInput()
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'zhong' } })
    await advance(500)
    expect(onChange).not.toHaveBeenCalled()
    expect(onSearch).not.toHaveBeenCalled()
    input.value = '中文'
    fireEvent.compositionEnd(input)
    expect(onChange.mock.calls).toEqual([['中文']])
    await advance(300)
    expect(onSearch.mock.calls).toEqual([['中文']])
  })

  it('still updates plain text immediately and debounces searches', async () => {
    const { onChange, onSearch, input } = renderInput()
    fireEvent.change(input, { target: { value: 'a' } })
    await advance(200)
    fireEvent.change(input, { target: { value: 'ab' } })
    expect(onChange.mock.calls).toEqual([['a'], ['ab']])
    await advance(299)
    expect(onSearch).not.toHaveBeenCalled()
    await advance(1)
    expect(onSearch.mock.calls).toEqual([['ab']])
  })

  it('reflects external value changes without issuing a search', async () => {
    const { onSearch, setValue, input } = renderInput()
    setValue('restored')
    expect(input.value).toBe('restored')
    await advance(500)
    expect(onSearch).not.toHaveBeenCalled()
  })
})
