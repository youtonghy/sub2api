import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import UpstreamRequestIdHeaderField from '../UpstreamRequestIdHeaderField'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params?.platform ? `${key}:${String(params.platform)}` : key),
    te: () => true,
    locale: 'en'
  })
}))

afterEach(cleanup)

function mountField(props: { platform?: string; type?: string; modelValue?: string }, onChange = vi.fn()) {
  render(
    <UpstreamRequestIdHeaderField
      platform={props.platform}
      type={props.type}
      value={props.modelValue ?? ''}
      onChange={onChange}
    />
  )
  // 帮助提示渲染到 body（Vue 版 Teleport 被 stub 为内联）
  return { text: () => document.body.textContent ?? '', onChange }
}

describe('UpstreamRequestIdHeaderField', () => {
  it('lists relay and official header examples for API key accounts', () => {
    const text = mountField({ platform: 'openai', type: 'apikey' }).text()

    expect(text).toContain('admin.accounts.upstreamRequestIdHeaderHelp.intro')
    expect(text).toContain('admin.accounts.upstreamRequestIdHeaderHelp.examplesTitle')
    expect(text).toContain('X-Client-Request-ID')
    expect(text).toContain('admin.accounts.upstreamRequestIdHeaderHelp.sub2apiNote')
    expect(text).toContain('X-Oneapi-Request-Id')
    expect(text).toContain('admin.accounts.upstreamRequestIdHeaderHelp.official:OpenAI')
    expect(text).toContain('x-request-id')
  })

  it('lists only the official header for accounts that connect to the platform directly', () => {
    const text = mountField({ platform: 'anthropic', type: 'oauth' }).text()

    expect(text).toContain('admin.accounts.upstreamRequestIdHeaderHelp.official:Anthropic')
    expect(text).toContain('request-id')
    expect(text).not.toContain('X-Client-Request-ID')
    expect(text).not.toContain('X-Oneapi-Request-Id')
  })

  it('omits the examples section when no header is known for the platform', () => {
    const text = mountField({ platform: 'kimi', type: 'oauth' }).text()

    expect(text).toContain('admin.accounts.upstreamRequestIdHeaderHelp.intro')
    expect(text).not.toContain('admin.accounts.upstreamRequestIdHeaderHelp.examplesTitle')
    expect(document.body.querySelectorAll('code')).toHaveLength(0)
  })

  it('binds the header name through v-model', () => {
    const { onChange } = mountField({ platform: 'openai', type: 'apikey', modelValue: 'X-Request-ID' })
    const input = screen.getByTestId('upstream-request-id-header') as HTMLInputElement
    expect(input.value).toBe('X-Request-ID')

    fireEvent.change(input, { target: { value: 'X-Oneapi-Request-Id' } })
    expect(onChange).toHaveBeenLastCalledWith('X-Oneapi-Request-Id')
  })
})
