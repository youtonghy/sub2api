import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import apiClient from '@/api/client'
import type { Account } from '@/types'
import OpenAIReferralCell from '../OpenAIReferralCell'

// 只替换组件内的 useI18n；@/i18n 保持真实实现（client.ts 拦截器依赖 getLocale）
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

// Exercise the actual accounts API and shared Axios interceptor together.
const originalAdapter = apiClient.defaults.adapter
const flushPromises = () => act(async () => {})
const mountCell = () =>
  render(<OpenAIReferralCell account={{ id: 1, name: 'Test account', platform: 'openai', type: 'oauth' } as Account} />)

afterEach(() => {
  cleanup()
  apiClient.defaults.adapter = originalAdapter
})

const fillAndSubmit = () => {
  fireEvent.change(screen.getByTestId('referral-email'), { target: { value: 'friend@example.com' } })
  fireEvent.click(screen.getByTestId('referral-consent'))
  fireEvent.submit(document.body.querySelector('form') as HTMLFormElement)
}

describe('invitation transport failures', () => {
  it.each(['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK', 'ERR_CANCELED', undefined])(
    'warns of an uncertain send after %s without retrying',
    async (code) => {
      const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
        if (config.url?.endsWith('/invite')) throw new AxiosError('Connection lost', code, config)
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
          data: {
            code: 0,
            data: {
              cache_persisted: true,
              eligibility: {
                should_show: true,
                available_invites: 2,
                requires_explicit_confirmation: true,
                program_id: 'codex_referral_consumer',
                fetched_at: 1770000000
              }
            }
          }
        }
      })
      apiClient.defaults.adapter = adapter
      mountCell()
      fireEvent.click(screen.getByTestId('referral-open'))
      await flushPromises()
      fillAndSubmit()
      await flushPromises()
      expect(screen.getByRole('alert').textContent).toBe('admin.accounts.openaiReferral.sendUnknown')
      expect(document.body.textContent).not.toContain('Network error.')
      expect(document.body.textContent).not.toContain('admin.accounts.openaiReferral.sent')
      expect(screen.getByTestId('referral-send')).toBeDisabled()
      fireEvent.submit(document.body.querySelector('form') as HTMLFormElement)
      await flushPromises()
      expect(adapter.mock.calls.filter(([config]) => config.url?.endsWith('/invite'))).toHaveLength(1)
    }
  )

  it('keeps a query timeout separate from an uncertain send', async () => {
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      throw new AxiosError('Timed out', 'ECONNABORTED', config)
    })
    mountCell()
    fireEvent.click(screen.getByTestId('referral-open'))
    await flushPromises()
    expect(screen.getByRole('alert').textContent).toBe('Network error. Please check your connection.')
    expect(document.body.textContent).not.toContain('admin.accounts.openaiReferral.sendUnknown')
    expect(screen.getByTestId('referral-send')).toBeDisabled()
  })
})
