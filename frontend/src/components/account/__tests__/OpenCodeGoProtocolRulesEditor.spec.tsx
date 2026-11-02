import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import OpenCodeGoProtocolRulesEditor from '../OpenCodeGoProtocolRulesEditor'
import type { OpenCodeGoProtocolRule } from '../credentialsBuilder'

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

afterEach(cleanup)

/** 受控包装：记录最新一次 onChange 的 rows（Vue 版直接修改传入的数组） */
function mountEditor(initial: OpenCodeGoProtocolRule[], platform = 'command_code', plan = 'payg') {
  const latest = { rows: initial }
  function Harness() {
    const [rows, setRows] = useState(initial)
    return (
      <OpenCodeGoProtocolRulesEditor
        rows={rows}
        platform={platform}
        plan={plan}
        onChange={(next) => {
          latest.rows = next
          setRows(next)
        }}
      />
    )
  }
  render(<Harness />)
  return latest
}

describe('OpenCodeGoProtocolRulesEditor protocol sets', () => {
  it('toggles additional protocols in protocol order', () => {
    const latest = mountEditor([{ pattern: 'gpt-*', protocol: 'anthropic' }])

    expect(screen.queryByTestId('opencode-go-protocol-extra-0-anthropic')).toBeNull()
    const responses = screen.getByTestId('opencode-go-protocol-extra-0-responses')
    expect(responses.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(responses)
    fireEvent.click(screen.getByTestId('opencode-go-protocol-extra-0-chat_completions'))
    expect(latest.rows[0].extraProtocols).toEqual(['chat_completions', 'responses'])
    expect(screen.getByTestId('opencode-go-protocol-extra-0-responses').getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByTestId('opencode-go-protocol-extra-0-responses'))
    fireEvent.click(screen.getByTestId('opencode-go-protocol-extra-0-chat_completions'))
    expect(latest.rows[0]).toEqual({ pattern: 'gpt-*', protocol: 'anthropic' })
  })

  it('swaps the preferred protocol within the set and replaces it otherwise', () => {
    const latest = mountEditor([
      { pattern: 'gpt-*', protocol: 'responses', extraProtocols: ['chat_completions'] },
      { pattern: 'grok-*', protocol: 'chat_completions' }
    ])

    fireEvent.change(screen.getByTestId('opencode-go-protocol-select-0'), { target: { value: 'chat_completions' } })
    expect(latest.rows[0]).toEqual({ pattern: 'gpt-*', protocol: 'chat_completions', extraProtocols: ['responses'] })

    fireEvent.change(screen.getByTestId('opencode-go-protocol-select-0'), { target: { value: 'anthropic' } })
    expect(latest.rows[0]).toEqual({ pattern: 'gpt-*', protocol: 'anthropic', extraProtocols: ['responses'] })

    fireEvent.change(screen.getByTestId('opencode-go-protocol-select-1'), { target: { value: 'responses' } })
    expect(latest.rows[1]).toEqual({ pattern: 'grok-*', protocol: 'responses' })
  })

  it('describes the model-list fallback only for providers with a model catalog', () => {
    mountEditor([])
    expect(screen.getByTestId('opencode-go-protocol-fallback').textContent).toContain(
      'admin.accounts.opencodeGo.protocolRules.catalogFallback'
    )
    cleanup()
    mountEditor([], 'opencode_go', 'go')
    expect(screen.getByTestId('opencode-go-protocol-fallback').textContent).toContain(
      'admin.accounts.opencodeGo.protocolRules.fallback'
    )
  })
})
