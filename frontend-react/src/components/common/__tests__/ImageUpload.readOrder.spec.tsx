import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ImageUpload from '../ImageUpload'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }),
}))

class ControlledReader {
  static instances: ControlledReader[] = []
  onload: ((event: { target: { result: string } }) => void) | null = null
  onerror: (() => void) | null = null
  aborted = false
  constructor() { ControlledReader.instances.push(this) }
  readAsText = vi.fn()
  readAsDataURL = vi.fn()
  abort() { this.aborted = true }
  complete(result: string) {
    if (!this.aborted) this.onload?.({ target: { result } })
  }
}

beforeEach(() => {
  ControlledReader.instances = []
  vi.stubGlobal('FileReader', ControlledReader)
})
afterEach(() => vi.unstubAllGlobals())

function uploader(mode: 'image' | 'svg' = 'image') {
  const onChange = vi.fn()
  const view = render(<ImageUpload value="existing" onChange={onChange} mode={mode} />)
  const input = view.container.querySelector('input')!
  return {
    ...view,
    onChange,
    choose(type = 'image/png') {
      Object.defineProperty(input, 'files', {
        configurable: true, value: [new File(['image'], 'upload', { type })]
      })
      fireEvent.change(input)
    }
  }
}

describe('image upload read lifecycle', () => {
  it.each(['image', 'svg'] as const)('keeps the newest %s selection when reads finish out of order', (mode) => {
    const { onChange, choose } = uploader(mode)
    choose()
    choose()
    act(() => ControlledReader.instances[1].complete('new image'))
    act(() => ControlledReader.instances[0].complete('old image'))
    expect(onChange.mock.calls).toEqual([['new image']])
  })

  it('does not restore an image after the remove button is clicked', () => {
    const { onChange, choose } = uploader()
    choose()
    fireEvent.click(screen.getByRole('button'))
    act(() => ControlledReader.instances[0].complete('removed image'))
    expect(onChange.mock.calls).toEqual([['']])
  })

  it('does not apply a pending image after a later invalid selection', () => {
    const { onChange, choose, container } = uploader()
    choose()
    choose('text/plain')
    act(() => ControlledReader.instances[0].complete('old image'))
    expect(onChange).not.toHaveBeenCalled()
    expect(container.textContent).toContain('common.selectImageFile')
  })

  it('aborts a pending read when the uploader unmounts', () => {
    const { choose, unmount } = uploader()
    choose()
    unmount()
    expect(ControlledReader.instances[0].aborted).toBe(true)
  })
})
