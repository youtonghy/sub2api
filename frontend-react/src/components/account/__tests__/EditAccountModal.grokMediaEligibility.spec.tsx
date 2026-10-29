import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  updateAccountMock,
  getEligibilityMock,
  updateEligibilityMock,
  showErrorMock,
  authIsSimpleMode
} = vi.hoisted(() => ({
  updateAccountMock: vi.fn(),
  getEligibilityMock: vi.fn(),
  updateEligibilityMock: vi.fn(),
  showErrorMock: vi.fn(),
  authIsSimpleMode: { value: true }
}))

vi.mock('@/stores/app', () => {
  const store = { showError: showErrorMock, showSuccess: vi.fn(), showInfo: vi.fn(), showWarning: vi.fn() }
  return { useAppStore: Object.assign((selector: (s: typeof store) => unknown) => selector(store), { getState: () => store }) }
})
vi.mock('@/stores/auth', () => {
  const state = () => ({ isSimpleMode: authIsSimpleMode.value })
  return { useAuthStore: Object.assign((selector: (s: ReturnType<typeof state>) => unknown) => selector(state()), { getState: state }) }
})
vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      update: updateAccountMock,
      getGrokMediaEligibility: getEligibilityMock,
      updateGrokMediaEligibility: updateEligibilityMock,
      checkMixedChannelRisk: vi.fn().mockResolvedValue({ has_risk: false })
    },
    settings: {
      getWebSearchEmulationConfig: vi.fn().mockResolvedValue({ enabled: false, providers: [] }),
      getSettings: vi.fn().mockResolvedValue({})
    },
    tlsFingerprintProfiles: { list: vi.fn().mockResolvedValue([]) }
  }
}))
vi.mock('@/api/admin/accounts', () => ({ getAntigravityDefaultModelMapping: vi.fn() }))
vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: 'en', setLocale: vi.fn() })
}))

// Vue 版 BaseDialog 桩：show 时直接渲染内容与 footer
vi.mock('../AccountFormLayout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../AccountFormLayout')>()
  return {
    ...actual,
    AccountFormDrawer: ({ show, children, footer }: { show: boolean; children: ReactNode; footer?: ReactNode }) =>
      show ? (
        <div>
          {children}
          {footer}
        </div>
      ) : null
  }
})

// Vue 版 stubs: Select / ProxySelector / GroupSelector / ModelWhitelistSelector。
// Vue 版媒体资格用原生 select；React 版用通用 Select，这里桩成原生 select。
vi.mock('@/components/common/Select', () => ({
  default: (props: {
    value: unknown
    options: Array<{ value: unknown; label: string }>
    onChange?: (value: unknown, option: null) => void
    disabled?: boolean
    'data-testid'?: string
  }) => (
    <select
      data-testid={props['data-testid']}
      value={props.value == null ? '' : String(props.value)}
      disabled={props.disabled}
      onChange={(event) => props.onChange?.(event.target.value, null)}
    >
      {props.options.map((option) => (
        <option key={String(option.value)} value={option.value == null ? '' : String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  )
}))
vi.mock('@/components/common/ProxySelector', () => ({ default: () => null }))
vi.mock('@/components/common/GroupSelector', () => ({ default: () => null }))
vi.mock('../ModelWhitelistSelector', () => ({ default: () => null }))

import EditAccountModal from '../EditAccountModal'

const account = (platform = 'grok', type = 'oauth', extra: Record<string, unknown> = {}) =>
  ({
    id: 12, name: 'Grok', notes: '', platform, type,
    credentials: { expires_at: '2027-01-01T00:00:00Z', token_type: 'Bearer' },
    credentials_status: { has_access_token: true, has_refresh_token: true }, extra,
    proxy_id: null, concurrency: 1, priority: 1, rate_multiplier: 1, status: 'active',
    group_ids: [], expires_at: null, auto_pause_on_expired: false
  }) as any

function mountModal(value = account()) {
  const view = render(
    <EditAccountModal show account={value} proxies={[]} groups={[]} onClose={() => {}} onUpdated={() => {}} />
  )
  const q = (selector: string) => view.container.querySelector<HTMLElement>(selector)
  const get = (selector: string) => {
    const found = q(selector)
    if (!found) throw new Error(`Element not found: ${selector}`)
    return found
  }
  return {
    q,
    get,
    async setValue(selector: string, value: string) {
      await act(async () => {
        fireEvent.change(get(selector), { target: { value } })
      })
    },
    async submit() {
      await act(async () => {
        fireEvent.submit(get('form#edit-account-form'))
      })
    }
  }
}

afterEach(() => {
  cleanup()
})

describe('EditAccountModal Grok media eligibility', () => {
  beforeEach(() => {
    authIsSimpleMode.value = true
    updateAccountMock.mockReset()
    getEligibilityMock.mockReset()
    updateEligibilityMock.mockReset()
    showErrorMock.mockReset()
    updateAccountMock.mockResolvedValue(account())
    getEligibilityMock.mockResolvedValue({ account_id: 12, mode: 'auto', eligible: false, reason: 'billing_inconclusive' })
    updateEligibilityMock.mockImplementation(async (_id: number, mode: string) => ({
      account_id: 12, mode, eligible: mode === 'enabled', reason: mode === 'enabled' ? 'override_enabled' : 'override_disabled'
    }))
  })

  it('shows only for Grok OAuth and fills the current decision', async () => {
    const wrapper = mountModal()
    await vi.waitFor(() => expect(getEligibilityMock).toHaveBeenCalledWith(12))
    expect(wrapper.q('[data-testid="grok-media-eligibility-card"]')).not.toBeNull()
    expect((wrapper.get('[data-testid="grok-media-eligibility-mode"]') as HTMLSelectElement).value).toBe('auto')
    await vi.waitFor(() =>
      expect(wrapper.get('[data-testid="grok-media-eligibility-status"]').textContent).toContain('billing_inconclusive')
    )
    expect(mountModal(account('grok', 'apikey')).q('[data-testid="grok-media-eligibility-card"]')).toBeNull()
    expect(mountModal(account('openai', 'oauth')).q('[data-testid="grok-media-eligibility-card"]')).toBeNull()
  })

  it('updates the dedicated endpoint only when the mode changes', async () => {
    const wrapper = mountModal()
    await vi.waitFor(() => expect(getEligibilityMock).toHaveBeenCalled())
    await vi.waitFor(() => expect(wrapper.q('[data-testid="grok-media-eligibility-status"]')).not.toBeNull())
    await wrapper.setValue('[data-testid="grok-media-eligibility-mode"]', 'enabled')
    await wrapper.submit()
    await vi.waitFor(() => expect(updateEligibilityMock).toHaveBeenCalledWith(12, 'enabled'))
  })

  it('reports partial-save errors when the dedicated endpoint fails', async () => {
    updateEligibilityMock.mockRejectedValueOnce(new Error('eligibility failed'))
    const wrapper = mountModal()
    await vi.waitFor(() => expect(getEligibilityMock).toHaveBeenCalled())
    await vi.waitFor(() => expect(wrapper.q('[data-testid="grok-media-eligibility-status"]')).not.toBeNull())
    await wrapper.setValue('[data-testid="grok-media-eligibility-mode"]', 'disabled')
    await wrapper.submit()
    await vi.waitFor(() => expect(showErrorMock).toHaveBeenCalledWith('admin.accounts.grokMediaEligibility.partialSave'))
    expect(getEligibilityMock).toHaveBeenCalledTimes(2)
  })
})
