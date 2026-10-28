import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import Pagination from '../Pagination'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }),
}))

function renderPagination() {
  const onPageChange = vi.fn()
  render(
    <Pagination
      total={200}
      page={1}
      pageSize={20}
      showJump
      showPageSizeSelector={false}
      onPageChange={onPageChange}
    />
  )
  return onPageChange
}

const jumpInput = () => document.querySelector<HTMLInputElement>('input[type="number"]')!
const jumpButton = () => screen.getByRole('button', { name: 'pagination.jumpAction' })

describe('pagination jump input', () => {
  it.each(['click', 'enter'])('jumps to the entered numeric page using %s', (action) => {
    const onPageChange = renderPagination()
    const input = jumpInput()
    fireEvent.change(input, { target: { value: '3' } })
    if (action === 'click') fireEvent.click(jumpButton())
    else fireEvent.keyUp(input, { key: 'Enter' })
    expect(onPageChange.mock.calls).toEqual([[3]])
    expect(input.value).toBe('')
  })

  it('clamps an entered page to the last page', () => {
    const onPageChange = renderPagination()
    fireEvent.change(jumpInput(), { target: { value: '99' } })
    fireEvent.click(jumpButton())
    expect(onPageChange.mock.calls).toEqual([[10]])
  })

  it('ignores an empty jump input', () => {
    const onPageChange = renderPagination()
    fireEvent.click(jumpButton())
    expect(onPageChange).not.toHaveBeenCalled()
  })
})
