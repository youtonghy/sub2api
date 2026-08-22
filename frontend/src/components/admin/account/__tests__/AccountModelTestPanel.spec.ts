import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AccountModelTestPanel from '../AccountModelTestPanel.vue'

const { getAvailableModels } = vi.hoisted(() => ({
  getAvailableModels: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: { accounts: { getAvailableModels } }
}))

vi.mock('@/api/client', () => ({
  buildApiUrl: (path: string) => `/api/v1${path}`
}))

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string) => key
    })
  }
})

const account = {
  id: 7,
  name: 'Primary OpenAI',
  platform: 'openai',
  type: 'apikey',
  status: 'active'
}

function streamResponse(success: boolean) {
  const encoder = new TextEncoder()
  const chunks = [encoder.encode(`data: {"type":"test_complete","success":${success}${success ? '' : ',"error":"upstream failed"'}}\n\n`)]
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: chunks[0] })
          .mockResolvedValueOnce({ done: true, value: undefined })
      })
    }
  } as unknown as Response
}

function mountPanel() {
  return mount(AccountModelTestPanel, {
    props: { accounts: [account] as any, platform: 'openai', active: true },
    global: { stubs: { Icon: true } }
  })
}

describe('AccountModelTestPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAvailableModels.mockResolvedValue([
      { id: 'gpt-5', display_name: 'GPT-5' },
      { id: 'gpt-5-mini', display_name: 'GPT-5 mini' }
    ])
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: vi.fn(() => 'test-token') },
      configurable: true
    })
  })

  it('loads provider models and marks an individual successful test green', async () => {
    global.fetch = vi.fn().mockResolvedValue(streamResponse(true)) as any
    const wrapper = mountPanel()
    await flushPromises()

    expect(getAvailableModels).toHaveBeenCalledWith(7)
    const modelButton = wrapper.findAll('button').find(button => button.text().includes('GPT-5 mini'))
    expect(modelButton).toBeTruthy()
    await modelButton!.trigger('click')
    await flushPromises()

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/admin/accounts/7/test', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({
      model_id: 'gpt-5-mini',
      prompt: '',
      mode: 'default'
    })
    expect(modelButton!.classes()).toContain('border-green-300')
  })

  it('tests every loaded model in one batch and marks failures red', async () => {
    global.fetch = vi.fn().mockResolvedValue(streamResponse(false)) as any
    const wrapper = mountPanel()
    await flushPromises()

    const batchButton = wrapper.findAll('button').find(button => button.text().includes('admin.accounts.modelTest.testAll'))
    await batchButton!.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(global.fetch).toHaveBeenCalledTimes(2)
    const modelButtons = wrapper.findAll('button').filter(button => button.text().includes('GPT-5'))
    expect(modelButtons).toHaveLength(2)
    expect(modelButtons.every(button => button.classes().includes('border-red-300'))).toBe(true)
  })
})
