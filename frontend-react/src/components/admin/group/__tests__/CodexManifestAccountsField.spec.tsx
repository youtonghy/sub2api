import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CodexManifestAccountsField, { type CodexManifestAccountsFieldHandle } from '../CodexManifestAccountsField'
import { adminAPI } from '@/api/admin'
import type { CodexModelsManifestConfig } from '@/types'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en', setLocale: () => {} })
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      list: vi.fn()
    }
  }
}))

const disabledConfig = (): CodexModelsManifestConfig => ({
  enabled: false,
  account_ids: [],
  fallback_to_scheduler: false
})

const enabledConfig = (): CodexModelsManifestConfig => ({
  enabled: true,
  account_ids: [],
  fallback_to_scheduler: false
})

const flushPromises = () => act(async () => {})

// 挂载一个双向绑定的宿主，验证完整的选择→移除流程。
const mountInteractive = (initial: CodexModelsManifestConfig, accountNames?: Record<number, string>) => {
  function Host() {
    const [config, setConfig] = useState(initial)
    return (
      <CodexManifestAccountsField
        groupId={7}
        modelValue={config}
        accountNames={accountNames}
        onModelValueChange={setConfig}
      />
    )
  }
  return render(<Host />)
}

const mountField = (
  modelValue: CodexModelsManifestConfig,
  accountNames?: Record<number, string>,
  onModelValueChange = vi.fn()
) => {
  const ref = createRef<CodexManifestAccountsFieldHandle>()
  const view = render(
    <CodexManifestAccountsField
      ref={ref}
      groupId={7}
      modelValue={modelValue}
      onModelValueChange={onModelValueChange}
      {...(accountNames ? { accountNames } : {})}
    />
  )
  return { view, ref, onModelValueChange }
}

describe('CodexManifestAccountsField', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('hides account controls while disabled and reveals them after enabling', () => {
    const { view, onModelValueChange } = mountField(disabledConfig())

    expect(view.container.querySelector('[data-testid="codex-manifest-search"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="codex-manifest-fallback-toggle"]')).toBeNull()
    expect(view.container.textContent).toContain('admin.groups.codexModelsManifest.disabledHint')

    fireEvent.click(view.container.querySelector('[data-testid="codex-manifest-toggle"]')!)

    expect(onModelValueChange).toHaveBeenCalledTimes(1)
    expect(onModelValueChange.mock.calls[0][0]).toMatchObject({ enabled: true })

    const enabled = mountField(enabledConfig())
    expect(enabled.view.container.querySelector('[data-testid="codex-manifest-search"]')).not.toBeNull()
    expect(enabled.view.container.querySelector('[data-testid="codex-manifest-fallback-toggle"]')).not.toBeNull()
    expect(enabled.view.container.textContent).toContain('admin.groups.codexModelsManifest.enabledHint')
  })

  it('selects accounts from search results and removes them via tags', async () => {
    vi.mocked(adminAPI.accounts.list).mockResolvedValue({
      items: [
        { id: 5, name: 'oauth-five' },
        { id: 6, name: 'apikey-six' }
      ]
    } as never)
    const view = mountInteractive({ ...enabledConfig(), account_ids: [5] }, { 5: 'oauth-five' })

    expect(screen.getByTestId('codex-manifest-selected-tags').textContent).toContain('oauth-five')

    const search = screen.getByTestId('codex-manifest-search')
    fireEvent.focus(search)
    fireEvent.change(search, { target: { value: 'oauth' } })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    await flushPromises()

    expect(adminAPI.accounts.list).toHaveBeenCalledWith(
      1,
      20,
      { search: 'oauth', platform: 'openai', group: '7' },
      expect.anything()
    )

    const dropdown = screen.getByTestId('codex-manifest-dropdown')
    expect(dropdown.textContent).toContain('apikey-six')

    // 账号 6 未选中：点击加入。
    const option = Array.from(dropdown.querySelectorAll('button')).find((b) => b.textContent?.includes('apikey-six'))
    fireEvent.click(option!)
    await flushPromises()

    // 新选账号立即以名称展示
    expect(view.container.textContent).toContain('apikey-six')

    // 移除账号 5：点击其标签上的删除按钮。
    fireEvent.click(screen.getByLabelText('remove account 5'))
    await flushPromises()

    const tags = screen.getByTestId('codex-manifest-selected-tags')
    expect(tags.textContent).toContain('apikey-six')
    expect(tags.textContent).not.toContain('oauth-five')
  })

  it('fails validation when enabled without accounts', async () => {
    const { view, ref } = mountField(enabledConfig())

    let result = true
    act(() => {
      result = ref.current!.validate()
    })
    expect(result).toBe(false)
    expect(screen.getByTestId('codex-manifest-validation-error').textContent).toBe(
      'admin.groups.codexModelsManifest.selectAtLeastOne'
    )

    // 关闭对话框时通过可选链调用 resetValidation，必须真实存在且生效。
    expect(typeof ref.current!.resetValidation).toBe('function')
    act(() => ref.current!.resetValidation())
    expect(screen.queryByTestId('codex-manifest-validation-error')).toBeNull()

    view.rerender(
      <CodexManifestAccountsField
        ref={ref}
        groupId={7}
        modelValue={{ ...enabledConfig(), account_ids: [9] }}
        onModelValueChange={vi.fn()}
      />
    )
    act(() => {
      result = ref.current!.validate()
    })
    expect(result).toBe(true)
    expect(screen.queryByTestId('codex-manifest-validation-error')).toBeNull()
  })

  it('closes the dropdown on outside click and shows the empty state', async () => {
    vi.mocked(adminAPI.accounts.list).mockResolvedValue({ items: [] } as never)
    mountField(enabledConfig())

    const search = screen.getByTestId('codex-manifest-search')
    fireEvent.focus(search)
    fireEvent.change(search, { target: { value: 'nonexistent' } })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    await flushPromises()

    // 有关键词但无结果：展示空状态提示而非静默无反应。
    expect(screen.getByTestId('codex-manifest-dropdown')).toBeTruthy()
    expect(screen.getByTestId('codex-manifest-search-empty').textContent).toBe(
      'admin.groups.codexModelsManifest.searchEmpty'
    )

    // 点击组件外部：收起下拉。
    act(() => {
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(screen.queryByTestId('codex-manifest-dropdown')).toBeNull()

    // 点击输入框内部：不收起。
    fireEvent.click(search)
    fireEvent.focus(search)
    expect(screen.getByTestId('codex-manifest-dropdown')).toBeTruthy()
  })
})
