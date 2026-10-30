import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PluginUISession } from '@/api/admin'
import PluginsView from '../PluginsView'

const {
  listPlugins,
  uploadPlugin,
  enablePlugin,
  disablePlugin,
  removePlugin,
  savePluginConfig,
  createUISession,
  stepUpRun,
  dialog
} = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  uploadPlugin: vi.fn(),
  enablePlugin: vi.fn(),
  disablePlugin: vi.fn(),
  removePlugin: vi.fn(),
  savePluginConfig: vi.fn(),
  createUISession: vi.fn(),
  stepUpRun: vi.fn((action: () => Promise<unknown>) => action()),
  dialog: { onClose: null as null | (() => void) }
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    plugins: {
      list: listPlugins,
      upload: uploadPlugin,
      enable: enablePlugin,
      disable: disablePlugin,
      remove: removePlugin,
      getConfig: vi.fn().mockResolvedValue({}),
      saveConfig: savePluginConfig,
      test: vi.fn().mockResolvedValue({ success: true, message: 'ok', latency_ms: 1 }),
      createUISession
    }
  }
}))

vi.mock('@/stores/app', () => ({
  useAppStore: {
    getState: () => ({
      showError: vi.fn(),
      showSuccess: vi.fn(),
      showInfo: vi.fn()
    })
  }
}))

vi.mock('@/composables/useStepUp', () => ({
  useStepUp: () => ({ run: stepUpRun }),
  isStepUpBlocked: () => false,
  isStepUpCancelled: () => false,
  stepUpBlockReason: () => ''
}))

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

// BaseDialog 桩：始终渲染内容，并记录插件配置对话框的 onClose 以模拟 Vue 版 $emit('close')；
// 打开时渲染 footer，供应用内确认框（ConfirmDialog 同样基于 BaseDialog）点击确认 / 取消
vi.mock('@/components/common/BaseDialog', () => ({
  default: ({
    show,
    title,
    children,
    footer,
    onClose
  }: {
    show: boolean
    title: string
    children?: ReactNode
    footer?: ReactNode
    onClose?: () => void
  }) => {
    if (title === 'admin.plugins.configTitle') dialog.onClose = onClose ?? null
    return (
      <div>
        {children}
        {show ? footer : null}
      </div>
    )
  }
}))
vi.mock('@/components/auth/TotpStepUpDialog', () => ({ default: () => null }))

const flushPromises = () => act(async () => {})

const plugin = {
  id: 7,
  plugin_key: 'local.test.transport',
  name: 'Test Transport',
  version: '1.0.0',
  description: '',
  author: 'test',
  manifest: {
    schema_version: 1,
    id: 'local.test.transport',
    name: 'Test Transport',
    version: '1.0.0',
    requires: {
      sub2api: '>=0.1.0',
      plugin_protocol: 1,
      transport_api: 1,
      ui_bridge: 1
    },
    capabilities: [],
    ui: { entrypoint: 'ui/index.html' }
  },
  binary_sha256: 'a'.repeat(64),
  signature_status: 'trusted' as const,
  state: 'disabled' as const,
  last_error: '',
  installed_at: '2026-08-22T00:00:00Z',
  updated_at: '2026-08-22T00:00:00Z',
  bindings: [
    {
      id: 1,
      plugin_id: 7,
      capability: 'openai.oauth.outbound_transport.v1',
      platform: 'openai',
      account_type: 'oauth',
      enabled: false,
      rollout_percent: 100
    }
  ],
  compatibility: {
    compatible: true,
    tested: true,
    status: 'compatible' as const,
    message: '',
    current_sub2api_version: '0.1.0',
    required_sub2api_version: '>=0.1.0',
    recommended_sub2api_version: '0.1.0',
    plugin_protocol: 1,
    transport_api: 1,
    ui_bridge: 1
  },
  runtime_healthy: false,
  runtime_message: ''
}

async function mountView() {
  const view = render(<PluginsView />)
  await flushPromises()
  return view
}

const configureButtons = () => screen.getAllByRole('button').filter((item) => item.textContent === 'admin.plugins.configure')
const actionButton = (label: string) => screen.getAllByRole('button').find((item) => item.textContent === label)!
// Vue 版用原生 window.confirm()；React 版改用应用内 ConfirmDialog，先确认消息已显示，再点击确认或取消
const answerConfirm = async (message: string, accept: boolean) => {
  expect(screen.getByText(message)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: accept ? 'common.confirm' : 'common.cancel' }))
  await flushPromises()
}
const closeDialog = () =>
  act(() => {
    dialog.onClose?.()
  })

describe('管理员插件页二次验证', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dialog.onClose = null
    stepUpRun.mockImplementation((action: () => Promise<unknown>) => action())
    listPlugins.mockResolvedValue([plugin])
    uploadPlugin.mockResolvedValue(plugin)
    enablePlugin.mockResolvedValue(plugin)
    disablePlugin.mockResolvedValue(plugin)
    removePlugin.mockResolvedValue(undefined)
    savePluginConfig.mockResolvedValue({ enabled: true })
    createUISession.mockResolvedValue({
      url: '/api/v1/plugin-ui/token/index.html#bridge_token=bridge',
      bridge_token: 'bridge',
      ui_bridge_version: 1,
      expires_at: '2026-08-22T01:00:00Z'
    })
  })
  afterEach(cleanup)

  it('启用插件通过 step-up 控制器执行', async () => {
    await mountView()

    const button = screen.getAllByRole('button').find((item) => item.textContent?.includes('admin.plugins.enable'))
    expect(button).toBeDefined()
    fireEvent.click(button!)
    await flushPromises()

    expect(stepUpRun).toHaveBeenCalledTimes(1)
    expect(enablePlugin).toHaveBeenCalledWith(7, 100, false)
  })

  it.each([7, 8])('keeps the latest session when reopening configuration for plugin %s', async (id) => {
    let resolveOld!: (session: PluginUISession) => void
    createUISession.mockReturnValueOnce(
      new Promise<PluginUISession>((resolve) => {
        resolveOld = resolve
      })
    )
    listPlugins.mockResolvedValue([plugin, { ...plugin, id: 8, name: 'Other Transport' }])
    const { container } = await mountView()
    const buttons = configureButtons()
    fireEvent.click(buttons[0])
    closeDialog()
    fireEvent.click(buttons[id === 7 ? 0 : 1])
    await flushPromises()
    const currentURL = container.querySelector('iframe')!.getAttribute('src')

    await act(async () => {
      resolveOld({ url: '/obsolete-session', bridge_token: 'old', ui_bridge_version: 1, expires_at: '' })
    })
    await flushPromises()
    expect(container.querySelector('iframe')!.getAttribute('src')).toBe(currentURL)
  })

  it('ignores an old session error while the reopened configuration is loading', async () => {
    let rejectOld!: (error: Error) => void
    let resolveCurrent!: (session: PluginUISession) => void
    createUISession
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectOld = reject
        })
      )
      .mockReturnValueOnce(
        new Promise<PluginUISession>((resolve) => {
          resolveCurrent = resolve
        })
      )
    const { container } = await mountView()
    const button = configureButtons()[0]
    fireEvent.click(button)
    closeDialog()
    fireEvent.click(button)
    await act(async () => {
      rejectOld(new Error('obsolete failure'))
    })
    await flushPromises()

    expect(container.textContent).not.toContain('obsolete failure')
    expect(container.textContent).toContain('admin.plugins.loadingUI')
    await act(async () => {
      resolveCurrent({ url: '/current-session', bridge_token: 'current', ui_bridge_version: 1, expires_at: '' })
    })
    await flushPromises()
    fireEvent.load(container.querySelector('iframe')!)
    expect(container.querySelector('iframe')!.getAttribute('src')).toBe('/current-session')
    expect(container.textContent).not.toContain('admin.plugins.loadingUI')
  })

  it('keeps the iframe sandbox and referrer policy locked down', async () => {
    const { container } = await mountView()
    fireEvent.click(configureButtons()[0])
    await flushPromises()
    const frame = container.querySelector('iframe')!
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('does not restore a session after the configuration dialog closes', async () => {
    let resolveSession!: (session: PluginUISession) => void
    createUISession.mockReturnValueOnce(
      new Promise<PluginUISession>((resolve) => {
        resolveSession = resolve
      })
    )
    const { container } = await mountView()
    fireEvent.click(configureButtons()[0])
    closeDialog()
    await act(async () => {
      resolveSession({ url: '/closed-session', bridge_token: 'old', ui_bridge_version: 1, expires_at: '' })
    })
    await flushPromises()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('启用未测试兼容性的插件需先确认，取消则不调用 API', async () => {
    listPlugins.mockResolvedValue([{ ...plugin, compatibility: { ...plugin.compatibility, tested: false, status: 'untested' } }])
    await mountView()

    fireEvent.click(actionButton('admin.plugins.enable'))
    await flushPromises()
    await answerConfirm('admin.plugins.confirmUntested', false)
    expect(enablePlugin).not.toHaveBeenCalled()

    fireEvent.click(actionButton('admin.plugins.enable'))
    await flushPromises()
    await answerConfirm('admin.plugins.confirmUntested', true)
    expect(stepUpRun).toHaveBeenCalledTimes(1)
    expect(enablePlugin).toHaveBeenCalledWith(7, 100, true)
  })

  it('停用插件需先确认，确认后才通过 step-up 控制器执行', async () => {
    listPlugins.mockResolvedValue([{ ...plugin, state: 'enabled', bindings: [{ ...plugin.bindings[0], enabled: true }] }])
    await mountView()

    fireEvent.click(actionButton('admin.plugins.disable'))
    await flushPromises()
    await answerConfirm('admin.plugins.confirmDisable', false)
    expect(disablePlugin).not.toHaveBeenCalled()

    fireEvent.click(actionButton('admin.plugins.disable'))
    await flushPromises()
    await answerConfirm('admin.plugins.confirmDisable', true)
    expect(stepUpRun).toHaveBeenCalledTimes(1)
    expect(disablePlugin).toHaveBeenCalledWith(7)
  })

  it('卸载插件需先确认，确认后才通过 step-up 控制器执行', async () => {
    await mountView()

    fireEvent.click(actionButton('admin.plugins.uninstall'))
    await flushPromises()
    await answerConfirm('admin.plugins.confirmUninstall', false)
    expect(removePlugin).not.toHaveBeenCalled()

    fireEvent.click(actionButton('admin.plugins.uninstall'))
    await flushPromises()
    await answerConfirm('admin.plugins.confirmUninstall', true)
    expect(stepUpRun).toHaveBeenCalledTimes(1)
    expect(removePlugin).toHaveBeenCalledWith(7)
  })

  it('上传插件通过 step-up 控制器执行', async () => {
    const { container } = await mountView()
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['plugin'], 'transport.s2plugin', { type: 'application/zip' })]
    })

    fireEvent.change(input)
    await flushPromises()

    expect(stepUpRun).toHaveBeenCalledTimes(1)
    expect(uploadPlugin).toHaveBeenCalledTimes(1)
  })
})
