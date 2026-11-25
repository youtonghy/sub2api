import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import HeaderOverrideEditor from '../HeaderOverrideEditor'
import type { HeaderOverrideRow } from '../credentialsBuilder'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' })
}))

vi.mock('../HeaderOverrideJsonTools', () => ({ default: () => null }))

afterEach(cleanup)

function mountEditor(initial: HeaderOverrideRow[], allowVariables = true) {
  const current: { rows: HeaderOverrideRow[] } = { rows: initial }
  function Host() {
    const [rows, setRows] = useState(initial)
    current.rows = rows
    return <HeaderOverrideEditor rows={rows} allowVariables={allowVariables} onChange={setRows} />
  }
  render(<Host />)
  return current
}

describe('HeaderOverrideEditor', () => {
  it('adds a suggested row when no value input is being edited', () => {
    const state = mountEditor([])
    fireEvent.click(screen.getByTestId('header-override-variable-user_id'))
    expect(state.rows).toEqual([{ name: 'x-gateway-user-id', value: '{{user_id}}' }])

    // 连点同一个变量不产生重名行
    fireEvent.click(screen.getByTestId('header-override-variable-user_id'))
    expect(state.rows).toHaveLength(1)
  })

  it('leaves the name empty when the suggested name is taken by another value', () => {
    const state = mountEditor([{ name: 'X-Gateway-User-Id', value: 'fixed' }])
    fireEvent.click(screen.getByTestId('header-override-variable-user_id'))
    expect(state.rows).toEqual([
      { name: 'X-Gateway-User-Id', value: 'fixed' },
      { name: '', value: '{{user_id}}' }
    ])
  })

  it('inserts at the caret of the value input being edited', () => {
    const state = mountEditor([{ name: 'x-trace', value: 'u=;end' }])
    const input = screen.getByTestId('header-override-value') as HTMLInputElement
    input.focus()
    input.setSelectionRange(2, 2)
    fireEvent.click(screen.getByTestId('header-override-variable-request_id'))
    expect(state.rows).toEqual([{ name: 'x-trace', value: 'u={{request_id}};end' }])
    expect(input.selectionStart).toBe(2 + '{{request_id}}'.length)
  })

  it('shows a preview for valid variables and an inline error for unknown ones', () => {
    mountEditor([
      { name: 'x-user', value: 'id-{{user_id}}' },
      { name: 'x-bad', value: '{{nope}}' }
    ])
    const previews = screen.getAllByTestId('header-override-row-preview')
    expect(previews).toHaveLength(1)
    expect(previews[0].textContent).toContain('x-user: id-10086')
    expect(screen.getAllByTestId('header-override-row-error')).toHaveLength(1)
  })

  it('hides the variable picker and flags variables when the account cannot report identity', () => {
    mountEditor([{ name: 'x-user', value: '{{user_id}}' }], false)
    expect(screen.queryByTestId('header-override-variables')).toBeNull()
    expect(screen.getByTestId('header-override-variables-unavailable')).toBeTruthy()
    expect(screen.getAllByTestId('header-override-row-error')).toHaveLength(1)
  })
})
