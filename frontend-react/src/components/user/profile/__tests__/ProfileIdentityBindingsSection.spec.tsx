import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ProfileIdentityBindingsSection, {
  type ProfileIdentityBindingsSectionProps
} from '@/components/user/profile/ProfileIdentityBindingsSection'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { PublicSettings, User } from '@/types'

const locationState = vi.hoisted(() => ({
  current: { href: 'http://localhost/profile' } as { href: string }
}))

const userApiMocks = vi.hoisted(() => ({
  sendEmailBindingCode: vi.fn(),
  bindEmailIdentity: vi.fn(),
  unbindAuthIdentity: vi.fn()
}))

vi.mock('@/api/user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/user')>()
  return {
    ...actual,
    sendEmailBindingCode: (...args: unknown[]) => userApiMocks.sendEmailBindingCode(...args),
    bindEmailIdentity: (...args: unknown[]) => userApiMocks.bindEmailIdentity(...args),
    unbindAuthIdentity: (...args: unknown[]) => userApiMocks.unbindAuthIdentity(...args)
  }
})

const i18n = vi.hoisted(() => ({
  t: (key: string, params?: Record<string, string>) => {
    if (key === 'profile.authBindings.title') return 'Connected sign-in methods'
    if (key === 'profile.authBindings.description') return 'Manage bound providers'
    if (key === 'profile.authBindings.status.bound') return 'Bound'
    if (key === 'profile.authBindings.status.notBound') return 'Not bound'
    if (key === 'profile.authBindings.providers.email') return 'Email'
    if (key === 'profile.authBindings.providers.linuxdo') return 'LinuxDo'
    if (key === 'profile.authBindings.providers.wechat') return 'WeChat'
    if (key === 'profile.authBindings.providers.oidc') return params?.providerName || 'OIDC'
    if (key === 'profile.authBindings.bindAction') return `Bind ${params?.providerName || ''}`.trim()
    if (key === 'profile.authBindings.emailPlaceholder') return 'Email address'
    if (key === 'profile.authBindings.codePlaceholder') return 'Verification code'
    if (key === 'profile.authBindings.passwordPlaceholder') return 'Set password'
    if (key === 'profile.authBindings.replaceEmailPasswordPlaceholder') return 'Current password'
    if (key === 'profile.authBindings.sendCodeAction') return 'Send code'
    if (key === 'profile.authBindings.unbindAction') return 'Unbind'
    if (key === 'profile.authBindings.manageEmailAction') return 'Manage email'
    if (key === 'profile.authBindings.hideEmailFormAction') return 'Hide email form'
    if (key === 'profile.authBindings.confirmEmailBindAction') return 'Bind email'
    if (key === 'profile.authBindings.confirmEmailReplaceAction') return 'Replace primary email'
    if (key === 'profile.authBindings.codeSentTo') return `Code sent to ${params?.email || ''}`.trim()
    if (key === 'profile.authBindings.bindSuccess') return 'Bind success'
    if (key === 'profile.authBindings.replaceSuccess') return 'Primary email updated'
    if (key === 'profile.authBindings.notes.emailManagedFromProfile') return 'Primary email is managed in the profile form'
    if (key === 'profile.authBindings.notes.canUnbind') return 'You can unbind this sign-in method'
    if (key === 'profile.authBindings.notes.bindAnotherBeforeUnbind') return 'Bind another sign-in method before unbinding'
    return key
  },
  te: () => true,
  locale: 'en'
}))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

function createUser(overrides: Partial<User> = {}): User {
  return {
    id: 7,
    username: 'alice',
    email: 'alice@example.com',
    role: 'user',
    balance: 10,
    concurrency: 2,
    status: 'active',
    allowed_groups: null,
    balance_notify_enabled: true,
    balance_notify_threshold: null,
    balance_notify_extra_emails: [],
    created_at: '2026-04-20T00:00:00Z',
    updated_at: '2026-04-20T00:00:00Z',
    ...overrides
  }
}

const showSuccess = vi.fn()
const showError = vi.fn()

function mountSection(props: ProfileIdentityBindingsSectionProps) {
  const view = render(
    <MemoryRouter initialEntries={['/profile']}>
      <ProfileIdentityBindingsSection {...props} />
    </MemoryRouter>
  )
  let current = props
  return {
    ...view,
    setProps(next: Partial<ProfileIdentityBindingsSectionProps>) {
      current = { ...current, ...next }
      view.rerender(
        <MemoryRouter initialEntries={['/profile']}>
          <ProfileIdentityBindingsSection {...current} />
        </MemoryRouter>
      )
    }
  }
}

const mountEmailBindingSection = (user: User | null) => mountSection({ user })
const byTestId = (id: string) => screen.getByTestId(id)
const inputValue = (id: string) => (screen.getByTestId(id) as HTMLInputElement).value
const setValue = (id: string, value: string) => fireEvent.change(byTestId(id), { target: { value } })
const click = async (id: string) => {
  await act(async () => {
    fireEvent.click(byTestId(id))
  })
}
const flushPromises = () => act(async () => {})

describe('ProfileIdentityBindingsSection', () => {
  beforeEach(() => {
    locationState.current = { href: 'http://localhost/profile' }
    Object.defineProperty(window, 'location', { configurable: true, value: locationState.current })
    Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0' })
    showSuccess.mockReset()
    showError.mockReset()
    useAppStore.setState({ cachedPublicSettings: null, publicSettingsLoaded: false, showSuccess, showError })
    useAuthStore.setState({ user: null })
    userApiMocks.sendEmailBindingCode.mockReset()
    userApiMocks.bindEmailIdentity.mockReset()
    userApiMocks.unbindAuthIdentity.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders provider binding states and provider-specific bind actions', () => {
    mountSection({
      user: createUser({
        auth_bindings: { email: { bound: true }, linuxdo: { bound: true }, oidc: { bound: false }, wechat: false }
      }),
      linuxdoEnabled: true,
      oidcEnabled: true,
      oidcProviderName: 'ExampleID',
      wechatEnabled: true,
      wechatOpenEnabled: true,
      wechatMpEnabled: false
    })

    expect(byTestId('profile-binding-email-status').textContent).toBe('Bound')
    expect(byTestId('profile-binding-linuxdo-status').textContent).toBe('Bound')
    expect(byTestId('profile-binding-oidc-status').textContent).toBe('Not bound')
    expect(byTestId('profile-binding-oidc-action').textContent).toBe('Bind ExampleID')
    expect(byTestId('profile-binding-wechat-action').textContent).toBe('Bind WeChat')
  })

  it('starts the WeChat bind flow for the current profile page', async () => {
    mountSection({
      user: createUser(),
      linuxdoEnabled: false,
      oidcEnabled: false,
      wechatEnabled: true,
      wechatOpenEnabled: true,
      wechatMpEnabled: false
    })

    await click('profile-binding-wechat-action')

    await waitFor(() => expect(locationState.current.href).toContain('/api/v1/auth/oauth/wechat/bind/start?'))
    expect(locationState.current.href).toContain('mode=open')
    expect(locationState.current.href).toContain('intent=bind_current_user')
    expect(locationState.current.href).toContain('redirect=%2Fprofile')
  })

  it('hides the WeChat bind action outside the WeChat browser when only mp mode is configured', () => {
    mountSection({
      user: createUser(),
      linuxdoEnabled: false,
      oidcEnabled: false,
      wechatEnabled: true,
      wechatOpenEnabled: false,
      wechatMpEnabled: true
    })

    expect(screen.queryByTestId('profile-binding-wechat-action')).toBeNull()
  })

  it('keeps the WeChat bind action visible when only the legacy aggregate setting is present', () => {
    mountSection({ user: createUser(), linuxdoEnabled: false, oidcEnabled: false, wechatEnabled: true })

    expect(screen.queryByTestId('profile-binding-wechat-action')).not.toBeNull()
  })

  it('starts the WeChat bind flow when only the legacy aggregate setting is present', async () => {
    mountSection({ user: createUser(), linuxdoEnabled: false, oidcEnabled: false, wechatEnabled: true })

    await click('profile-binding-wechat-action')

    await waitFor(() => expect(locationState.current.href).toContain('/api/v1/auth/oauth/wechat/bind/start?'))
    expect(locationState.current.href).toContain('mode=open')
    expect(locationState.current.href).toContain('intent=bind_current_user')
    expect(locationState.current.href).toContain('redirect=%2Fprofile')
  })

  it('uses explicit cached WeChat capabilities and ignores legacy prop fallbacks', () => {
    useAppStore.setState({
      cachedPublicSettings: {
        registration_enabled: false,
        email_verify_enabled: false,
        force_email_on_third_party_signup: false,
        registration_email_suffix_whitelist: [],
        promo_code_enabled: true,
        password_reset_enabled: false,
        invitation_code_enabled: false,
        turnstile_enabled: false,
        turnstile_site_key: '',
        site_name: 'Sub2API',
        site_logo: '',
        site_subtitle: '',
        api_base_url: '',
        contact_info: '',
        doc_url: '',
        home_content: '',
        compact_home_enabled: false,
        hide_ccs_import_button: false,
        payment_enabled: false,
        table_default_page_size: 20,
        table_page_size_options: [10, 20, 50, 100],
        custom_menu_items: [],
        custom_endpoints: [],
        linuxdo_oauth_enabled: false,
        wechat_oauth_enabled: true,
        wechat_oauth_open_enabled: true,
        wechat_oauth_mp_enabled: false,
        oidc_oauth_enabled: false,
        oidc_oauth_provider_name: 'OIDC',
        backend_mode_enabled: false,
        version: 'test',
        balance_low_notify_enabled: false,
        account_quota_notify_enabled: false,
        balance_low_notify_threshold: 0
      } as unknown as PublicSettings,
      publicSettingsLoaded: true
    })

    mountSection({ user: createUser(), linuxdoEnabled: false, oidcEnabled: false, wechatEnabled: true })

    expect(screen.queryByTestId('profile-binding-wechat-action')).not.toBeNull()
  })

  it('sends email verification code and binds email from the profile card', async () => {
    userApiMocks.sendEmailBindingCode.mockResolvedValue(undefined)
    userApiMocks.bindEmailIdentity.mockResolvedValue(
      createUser({ email: 'bound@example.com', email_bound: true, auth_bindings: { email: { bound: true } } })
    )
    const initialUser = createUser({
      email: 'legacy-user@linuxdo-connect.invalid',
      email_bound: false,
      auth_bindings: { email: { bound: false } }
    })
    useAuthStore.setState({ user: initialUser })

    mountSection({ user: initialUser, linuxdoEnabled: false, oidcEnabled: false, wechatEnabled: false })

    setValue('profile-binding-email-input', 'bound@example.com')
    await click('profile-binding-email-send-code')

    expect(userApiMocks.sendEmailBindingCode).toHaveBeenCalledWith('bound@example.com')
    expect(showSuccess).toHaveBeenCalledWith('Code sent to bound@example.com')

    setValue('profile-binding-email-code-input', '123456')
    setValue('profile-binding-email-password-input', 'new-password')
    await click('profile-binding-email-submit')

    expect(userApiMocks.bindEmailIdentity).toHaveBeenCalledWith({
      email: 'bound@example.com',
      verify_code: '123456',
      password: 'new-password'
    })
    // Arc Badge 文案切换有退场动画，等待旧文案移除
    await waitFor(() => expect(byTestId('profile-binding-email-status').textContent).toBe('Bound'))
    expect(useAuthStore.getState().user?.email).toBe('bound@example.com')
  })

  it('keeps the email binding form visible when the user still lacks an email identity', () => {
    mountSection({
      user: createUser({ email: 'legacy@example.com', email_bound: false, auth_bindings: { email: { bound: false } } }),
      linuxdoEnabled: false,
      oidcEnabled: false,
      wechatEnabled: false
    })

    expect(byTestId('profile-binding-email-status').textContent).toBe('Not bound')
    expect(byTestId('profile-binding-email-input')).toBeInTheDocument()
  })

  it('does not show a synthetic oauth-only email as the bound email summary', () => {
    const { container } = mountSection({
      user: createUser({
        email: 'legacy-user@linuxdo-connect.invalid',
        email_bound: false,
        auth_bindings: { email: { bound: false } }
      }),
      linuxdoEnabled: false,
      oidcEnabled: false,
      wechatEnabled: false
    })

    expect(container.textContent).not.toContain('legacy-user@linuxdo-connect.invalid')
    expect(byTestId('profile-binding-email-status').textContent).toBe('Not bound')
  })

  it('does not show a synthetic oauth-only email when only fallback auth bindings mark email as unbound', () => {
    const { container } = mountSection({
      user: createUser({ email: 'legacy-user@wechat-connect.invalid', auth_bindings: { email: { bound: false } } }),
      linuxdoEnabled: false,
      oidcEnabled: false,
      wechatEnabled: false
    })

    expect(container.textContent).not.toContain('legacy-user@wechat-connect.invalid')
    expect(byTestId('profile-binding-email-status').textContent).toBe('Not bound')
  })

  it('shows the bound email only once and localizes the email management note', () => {
    const { container } = mountSection({
      user: createUser({
        email: 'alice@example.com',
        email_bound: true,
        auth_bindings: {
          email: {
            bound: true,
            display_name: 'alice@example.com',
            subject_hint: 'a***e@example.com',
            note_key: 'profile.authBindings.notes.emailManagedFromProfile',
            note: 'Primary account email is managed from the profile form.'
          } as never
        }
      }),
      linuxdoEnabled: false,
      oidcEnabled: false,
      wechatEnabled: false
    })

    // 邮箱输入框的值不计入 textContent，与 Vue 版 wrapper.text() 一致
    expect(container.textContent?.match(/alice@example\.com/g)).toHaveLength(1)
    expect(container.textContent).not.toContain('a***e@example.com')
    expect(container.textContent).toContain('Primary email is managed in the profile form')
  })

  it('keeps the email form available for replacing a bound primary email', async () => {
    userApiMocks.sendEmailBindingCode.mockResolvedValue(undefined)
    userApiMocks.bindEmailIdentity.mockResolvedValue(
      createUser({ email: 'new@example.com', email_bound: true, auth_bindings: { email: { bound: true } } })
    )
    const initialUser = createUser({
      email: 'current@example.com',
      email_bound: true,
      auth_bindings: { email: { bound: true } }
    })
    useAuthStore.setState({ user: initialUser })

    mountSection({ user: initialUser, linuxdoEnabled: false, oidcEnabled: false, wechatEnabled: false })

    expect(byTestId('profile-binding-email-status').textContent).toBe('Bound')
    expect(byTestId('profile-binding-email-input')).toBeInTheDocument()
    expect(byTestId('profile-binding-email-submit').textContent).toBe('Replace primary email')
    expect((byTestId('profile-binding-email-password-input') as HTMLInputElement).placeholder).toBe('Current password')

    setValue('profile-binding-email-input', 'new@example.com')
    await click('profile-binding-email-send-code')
    expect(userApiMocks.sendEmailBindingCode).toHaveBeenCalledWith('new@example.com')

    setValue('profile-binding-email-code-input', '123456')
    setValue('profile-binding-email-password-input', 'current-password')
    await click('profile-binding-email-submit')

    expect(userApiMocks.bindEmailIdentity).toHaveBeenCalledWith({
      email: 'new@example.com',
      verify_code: '123456',
      password: 'current-password'
    })
    expect(useAuthStore.getState().user?.email).toBe('new@example.com')
    expect(showSuccess).toHaveBeenCalledWith('Primary email updated')
  })

  describe('email form synchronization', () => {
    it.each([true, false])('preserves the target email across profile refreshes (email bound: %s)', async (emailBound) => {
      userApiMocks.sendEmailBindingCode.mockResolvedValue(undefined)
      userApiMocks.bindEmailIdentity.mockResolvedValue(createUser({ email: 'new@example.com', email_bound: true }))
      const view = mountEmailBindingSection(createUser({ email_bound: emailBound }))

      setValue('profile-binding-email-input', 'new@example.com')
      view.setProps({ user: createUser({ email_bound: emailBound, balance: 20 }) })
      expect(inputValue('profile-binding-email-input')).toBe('new@example.com')

      await click('profile-binding-email-send-code')
      await flushPromises()
      view.setProps({ user: createUser({ email_bound: emailBound, balance: 30 }) })
      expect(userApiMocks.sendEmailBindingCode).toHaveBeenCalledWith('new@example.com')
      expect(inputValue('profile-binding-email-input')).toBe('new@example.com')

      setValue('profile-binding-email-code-input', '123456')
      setValue('profile-binding-email-password-input', 'current-password')
      view.setProps({ user: createUser({ email: 'updated-elsewhere@example.com', email_bound: emailBound }) })
      await click('profile-binding-email-submit')
      await flushPromises()

      expect(userApiMocks.bindEmailIdentity).toHaveBeenCalledWith({
        email: 'new@example.com',
        verify_code: '123456',
        password: 'current-password'
      })
    })

    it('preserves the code recipient while an unedited email code request is pending', async () => {
      let resolveSend!: () => void
      userApiMocks.sendEmailBindingCode.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveSend = () => resolve()
          })
      )
      const view = mountEmailBindingSection(createUser({ email_bound: true }))

      await click('profile-binding-email-send-code')
      view.setProps({ user: createUser({ email: 'updated-elsewhere@example.com', email_bound: true }) })
      expect(inputValue('profile-binding-email-input')).toBe('alice@example.com')

      await act(async () => {
        resolveSend()
      })
      expect(showSuccess).toHaveBeenCalledWith('Code sent to alice@example.com')
      view.setProps({ user: createUser({ email: 'updated-elsewhere@example.com', email_bound: true, balance: 20 }) })
      expect(inputValue('profile-binding-email-input')).toBe('alice@example.com')
    })

    it('preserves an intentionally cleared target email across profile refreshes', () => {
      const view = mountEmailBindingSection(createUser())

      setValue('profile-binding-email-input', '')
      view.setProps({ user: createUser({ balance: 20 }) })

      expect(inputValue('profile-binding-email-input')).toBe('')
    })

    it.each(['code', 'password'])('preserves the target email when only the %s field has been edited', (field) => {
      const view = mountEmailBindingSection(createUser({ email_bound: true }))
      const id = `profile-binding-email-${field}-input`
      const value = field === 'code' ? '123456' : 'current-password'

      setValue(id, value)
      view.setProps({ user: createUser({ email: 'updated-elsewhere@example.com', email_bound: true }) })

      expect(inputValue('profile-binding-email-input')).toBe('alice@example.com')
      expect(inputValue(id)).toBe(value)
    })

    it('hydrates and synchronizes an untouched form, clearing synthetic email addresses', () => {
      const view = mountEmailBindingSection(null)
      expect(inputValue('profile-binding-email-input')).toBe('')

      view.setProps({ user: createUser() })
      expect(inputValue('profile-binding-email-input')).toBe('alice@example.com')

      view.setProps({ user: createUser({ email: 'updated@example.com' }) })
      expect(inputValue('profile-binding-email-input')).toBe('updated@example.com')

      view.setProps({ user: createUser({ email: 'oauth@linuxdo-connect.invalid', email_bound: false }) })
      expect(inputValue('profile-binding-email-input')).toBe('')
    })

    it.each([
      { name: 'another account', user: createUser({ id: 8, email: 'bob@example.com' }), email: 'bob@example.com' },
      {
        name: 'an OAuth-only account',
        user: createUser({ id: 8, email: 'oauth@linuxdo-connect.invalid', email_bound: false }),
        email: ''
      },
      { name: 'a signed-out user', user: null, email: '' }
    ])('resets the draft and credentials for $name', ({ user, email }) => {
      const view = mountEmailBindingSection(createUser())

      setValue('profile-binding-email-input', 'new@example.com')
      setValue('profile-binding-email-code-input', '123456')
      setValue('profile-binding-email-password-input', 'current-password')
      view.setProps({ user })

      expect(inputValue('profile-binding-email-input')).toBe(email)
      expect(inputValue('profile-binding-email-code-input')).toBe('')
      expect(inputValue('profile-binding-email-password-input')).toBe('')

      view.setProps({ user: createUser({ id: 8, email: 'refreshed@example.com' }) })
      expect(inputValue('profile-binding-email-input')).toBe('refreshed@example.com')
    })

    it('preserves the draft after a failed submission and a subsequent profile refresh', async () => {
      userApiMocks.bindEmailIdentity.mockRejectedValue(new Error('Incorrect password'))
      const view = mountEmailBindingSection(createUser({ email_bound: true }))

      setValue('profile-binding-email-input', 'new@example.com')
      setValue('profile-binding-email-code-input', '123456')
      setValue('profile-binding-email-password-input', 'current-password')
      await click('profile-binding-email-submit')
      await flushPromises()
      view.setProps({ user: createUser({ email_bound: true, balance: 20 }) })

      expect(showError).toHaveBeenCalledWith('Incorrect password')
      expect(inputValue('profile-binding-email-input')).toBe('new@example.com')
      expect(inputValue('profile-binding-email-code-input')).toBe('123456')
      expect(inputValue('profile-binding-email-password-input')).toBe('current-password')
    })

    it('resets to the canonical email after success and resumes synchronization', async () => {
      const updatedUser = createUser({ email: 'new@example.com', email_bound: true })
      userApiMocks.bindEmailIdentity.mockResolvedValue(updatedUser)
      const view = mountEmailBindingSection(createUser({ email_bound: true }))

      setValue('profile-binding-email-input', 'New@Example.com')
      setValue('profile-binding-email-code-input', '123456')
      setValue('profile-binding-email-password-input', 'current-password')
      await click('profile-binding-email-submit')
      await flushPromises()

      expect(inputValue('profile-binding-email-input')).toBe('new@example.com')
      expect(inputValue('profile-binding-email-code-input')).toBe('')
      expect(inputValue('profile-binding-email-password-input')).toBe('')

      view.setProps({ user: updatedUser })
      view.setProps({ user: createUser({ email: 'refreshed@example.com', email_bound: true }) })
      expect(inputValue('profile-binding-email-input')).toBe('refreshed@example.com')
    })
  })

  it('collapses the email binding form in compact mode until the user expands it', async () => {
    mountSection({
      user: createUser({ email: 'legacy@example.com', email_bound: false, auth_bindings: { email: { bound: false } } }),
      compact: true,
      linuxdoEnabled: false,
      oidcEnabled: false,
      wechatEnabled: false
    })

    expect(screen.queryByTestId('profile-binding-email-input')).toBeNull()
    expect(byTestId('profile-binding-email-toggle').textContent).toBe('Manage email')

    await click('profile-binding-email-toggle')

    expect(byTestId('profile-binding-email-input')).toBeInTheDocument()
  })

  it('shows third-party binding details and unbinds a connected provider', async () => {
    userApiMocks.unbindAuthIdentity.mockResolvedValue(
      createUser({
        email_bound: true,
        linuxdo_bound: false,
        auth_bindings: { email: { bound: true }, linuxdo: { bound: false, can_unbind: false } }
      })
    )

    const { container } = mountSection({
      user: createUser({
        email_bound: true,
        linuxdo_bound: true,
        auth_bindings: {
          email: { bound: true },
          linuxdo: {
            bound: true,
            display_name: 'linuxdo-handle',
            subject_hint: 'lin***3456',
            note: 'Linked from LinuxDo',
            can_unbind: true
          }
        }
      }),
      compact: true,
      linuxdoEnabled: true,
      oidcEnabled: false,
      wechatEnabled: false
    })

    expect(container.textContent).toContain('linuxdo-handle')
    expect(container.textContent).toContain('lin***3456')
    expect(container.textContent).toContain('Linked from LinuxDo')

    await click('profile-binding-linuxdo-unbind')

    expect(userApiMocks.unbindAuthIdentity).toHaveBeenCalledWith('linuxdo')
    await waitFor(() => expect(byTestId('profile-binding-linuxdo-status').textContent).toBe('Not bound'))
  })

  it('localizes third-party unbind guidance from note_key', () => {
    const { container } = mountSection({
      user: createUser({
        email_bound: true,
        linuxdo_bound: true,
        auth_bindings: {
          email: { bound: true },
          linuxdo: {
            bound: true,
            display_name: 'linuxdo-handle',
            note_key: 'profile.authBindings.notes.canUnbind',
            note: 'You can unbind this sign-in method.',
            can_unbind: true
          } as never
        }
      }),
      linuxdoEnabled: true,
      oidcEnabled: false,
      wechatEnabled: false
    })

    expect(container.textContent).toContain('You can unbind this sign-in method')
    expect(container.textContent).not.toContain('You can unbind this sign-in method.')
  })

  it('hides bind actions when provider details say bindable but the provider is disabled', () => {
    mountSection({
      user: createUser({
        auth_bindings: { linuxdo: { bound: false, can_bind: true }, oidc: { bound: false, can_bind: true } }
      }),
      linuxdoEnabled: false,
      oidcEnabled: false,
      wechatEnabled: false
    })

    expect(screen.queryByTestId('profile-binding-linuxdo-action')).toBeNull()
    expect(screen.queryByTestId('profile-binding-oidc-action')).toBeNull()
  })
})
