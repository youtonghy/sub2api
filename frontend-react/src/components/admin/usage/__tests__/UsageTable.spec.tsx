import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en/admin/resources'
import zh from '@/i18n/locales/zh/admin/resources'
import type { AdminUsageLog } from '@/types'
import UsageTable from '../UsageTable'

const ipGeoMocks = vi.hoisted(() => ({
  getEntry: vi.fn((): { status: string; label?: string; detail?: object } => ({ status: 'idle' })),
  fetchOne: vi.fn(),
  fetchBatch: vi.fn(),
  subscribeIpGeo: () => () => {},
  getIpGeoRevision: () => 0
}))

const appStoreMocks = vi.hoisted(() => ({
  showSuccess: vi.fn(),
  showError: vi.fn()
}))

vi.mock('@/utils/ipGeoLookup', () => ipGeoMocks)
vi.mock('@/stores/app', () => ({
  useAppStore: Object.assign((selector?: (state: typeof appStoreMocks) => unknown) => (selector ? selector(appStoreMocks) : appStoreMocks), {
    getState: () => appStoreMocks
  })
}))

const locale = vi.hoisted(() => ({ current: 'en' as 'en' | 'zh' }))
const localizedMessages: Record<'en' | 'zh', Record<string, string>> = {
  en: {
    'admin.usage.longContext': en.usage.longContext,
    'admin.usage.longContextPricingTooltip': en.usage.longContextPricingTooltip
  },
  zh: {
    'admin.usage.longContext': zh.usage.longContext,
    'admin.usage.longContextPricingTooltip': zh.usage.longContextPricingTooltip
  }
}

const messages: Record<string, string> = {
  'usage.outputTps': 'Output TPS',
  'admin.usage.userDeletedBadge': 'Deleted',
  'usage.costDetails': 'Cost Breakdown',
  'admin.usage.inputCost': 'Input Cost',
  'admin.usage.outputCost': 'Output Cost',
  'admin.usage.cacheCreationCost': 'Cache Creation Cost',
  'admin.usage.cacheReadCost': 'Cache Read Cost',
  'usage.inputTokenPrice': 'Input price',
  'usage.outputTokenPrice': 'Output price',
  'usage.perMillionTokens': '/ 1M tokens',
  'usage.serviceTier': 'Service tier',
  'usage.serviceTierPriority': 'Fast',
  'usage.serviceTierUltrafast': 'Ultrafast',
  'usage.serviceTierFlex': 'Flex',
  'usage.serviceTierStandard': 'Standard',
  'usage.rate': 'Rate',
  'usage.accountMultiplier': 'Account rate',
  'usage.original': 'Original',
  'usage.userBilled': 'User billed',
  'usage.accountBilled': 'Account billed',
  'usage.imageUnit': ' images',
  'usage.imageCount': 'Image count',
  'usage.imageBillingSize': 'Billing size',
  'usage.imageInputSize': 'Input size',
  'usage.imageOutputSize': 'Output size',
  'usage.imageSizeSource': 'Size source',
  'usage.imageSizeBreakdown': 'Size breakdown',
  'usage.imageSizeSourceOutput': 'Upstream output',
  'usage.imageSizeSourceInput': 'Request input',
  'usage.imageSizeSourceDefault': 'Default billing tier',
  'usage.imageSizeSourceLegacy': 'Legacy record',
  'usage.imageSizeSourceMissing': 'Not recorded',
  'usage.imageSizeNotRecorded': 'not recorded',
  'usage.imageSizeLegacyUnstandardized': 'legacy unstandardized',
  'usage.imageSizeUnknown': 'unknown',
  'usage.imageUnitPrice': 'Per-image price',
  'usage.imageTotalPrice': 'Image total price',
  'usage.stream': 'Stream',
  'usage.sync': 'Sync',
  'usage.nativeCompactionV2': 'Compaction',
  'admin.usage.billingModeToken': 'Token',
  'admin.usage.billingModePerRequest': 'Per request',
  'admin.usage.billingModeImage': 'Image',
  'admin.usage.requestIdCopied': 'Request ID copied',
  'admin.usage.upstreamRequestIdCopied': 'Upstream ID copied',
  'keys.copied': 'Copied',
  'keys.copyToClipboard': 'Copy to clipboard',
  'common.copyFailed': 'Copy failed',
  'usage.requestedModel': 'Requested',
  'usage.sentUpstreamModel': 'Sent upstream',
  'usage.upstreamResponseModel': 'Upstream response',
  'usage.modelVariant': 'Possible version variant',
  'usage.modelMismatch': 'Different model'
}

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => localizedMessages[locale.current][key] ?? messages[key] ?? key,
    te: () => true,
    locale: locale.current
  })
}))

// DataTable 桩：按 stubKeys 顺序渲染每行的单元格（Vue 版各个 DataTable 插槽桩）
const stub = vi.hoisted(() => ({ keys: [] as string[] }))
vi.mock('@/components/common/DataTable', () => ({
  default: ({
    data,
    cells
  }: {
    data: Array<Record<string, unknown>>
    cells: Record<string, (ctx: { row: unknown; value: unknown; index: number; expanded: boolean }) => ReactNode>
  }) => (
    <div>
      {data.map((row, index) => (
        <div key={String(row.request_id) + index} data-request-id={row.request_id as string}>
          {stub.keys.map((key) => (
            <div key={key}>{cells[key]?.({ row, value: row[key], index, expanded: false })}</div>
          ))}
        </div>
      ))}
    </div>
  )
}))

const DEFAULT_KEYS = ['model', 'reasoning_effort', 'billing_mode', 'tokens', 'latency', 'cost', 'request_id', 'upstream_request_id']

afterEach(cleanup)

const flushPromises = () => act(async () => {})

const rows = (data: unknown[]) => data as AdminUsageLog[]

const mountTable = (data: unknown[], columns: Array<{ key: string; label: string }> = [], keys = DEFAULT_KEYS) => {
  stub.keys = keys
  return render(<UsageTable data={rows(data)} loading={false} columns={columns} />)
}

const lastCostTrigger = () => {
  const triggers = screen.getAllByTestId('cost-tooltip-trigger')
  return triggers[triggers.length - 1]
}
const openCostTooltip = async () => {
  fireEvent.mouseEnter(lastCostTrigger())
  await flushPromises()
  return screen.getByTestId('usage-cost-tooltip')
}
const spanTexts = (root: Element) => Array.from(root.querySelectorAll('span')).map((span) => span.textContent ?? '')

const baseImageRow = {
  request_id: 'req-admin-image',
  model: 'gpt-image-2',
  actual_cost: 0.4,
  total_cost: 0.4,
  account_rate_multiplier: 1,
  rate_multiplier: 1,
  service_tier: null,
  input_cost: 0,
  output_cost: 0,
  cache_creation_cost: 0,
  cache_read_cost: 0,
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_5m_tokens: 0,
  cache_creation_1h_tokens: 0,
  cache_ttl_overridden: false,
  billing_mode: 'image',
  image_count: 2,
  image_size: '2K',
  image_input_size: null,
  image_output_size: null,
  image_size_source: null,
  image_size_breakdown: null
}

describe('admin UsageTable tooltip', () => {
  beforeEach(() => {
    locale.current = 'en'
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 20,
      left: 20,
      right: 120,
      bottom: 40,
      width: 100,
      height: 20,
      toJSON: () => ({})
    } as DOMRect)
  })

  it('shows output TPS in the latency cell using total duration', () => {
    const row = { ...baseImageRow, image_count: 0, billing_mode: 'token', output_tokens: 1000, duration_ms: 20_000, first_token_ms: 10_000 }
    const { container } = mountTable(
      [row, { ...row, request_id: 'no-duration', duration_ms: null }, { ...row, request_id: 'image', image_count: 1 }],
      [{ key: 'latency', label: 'Latency' }]
    )
    expect(screen.getAllByTestId('output-tps').map((cell) => cell.textContent)).toEqual(['50.0 tok/s', '—', '—'])
    expect(container.textContent).toContain('Output TPS')
  })

  it.each([
    ['en', 'Long context', 'Long-context pricing was applied. Input and output rates depend on the pricing tier, not a uniform multiplier.'],
    ['zh', '长上下文', '已应用长上下文计费。输入和输出费率取决于定价档位，并非统一倍率。']
  ] as const)('marks only applied long-context billing with localized text in %s', (language, label, tooltip) => {
    locale.current = language
    const { container } = mountTable([
      { ...baseImageRow, request_id: 'req-long-context-enabled', long_context_billing_applied: true },
      { ...baseImageRow, request_id: 'req-long-context-disabled', long_context_billing_applied: false },
      { ...baseImageRow, request_id: 'req-long-context-absent' }
    ])

    expect(container.querySelectorAll('[data-testid="long-context-billing-marker"]')).toHaveLength(1)
    const marker = container.querySelector('[data-request-id="req-long-context-enabled"] [data-testid="long-context-billing-marker"]')!
    expect(marker.textContent).toBe(label)
    expect(marker.getAttribute('title')).toBe(tooltip)
    expect(container.querySelector('[data-request-id="req-long-context-disabled"] [data-testid="long-context-billing-marker"]')).toBeNull()
    expect(container.querySelector('[data-request-id="req-long-context-absent"] [data-testid="long-context-billing-marker"]')).toBeNull()
    expect(container.textContent).not.toContain('x2')
  })

  it('keeps the request type badge and adds a separate badge only for native compaction rows', () => {
    mountTable(
      [
        { ...baseImageRow, request_id: 'req-compaction-stream', request_type: 'stream', stream: true, native_compaction_v2: true },
        { ...baseImageRow, request_id: 'req-historical-sync', request_type: 'sync', stream: false, native_compaction_v2: false }
      ],
      [],
      ['stream']
    )

    const requestBadges = screen.getAllByTestId('request-type-badge')
    expect(requestBadges).toHaveLength(2)
    expect(requestBadges[0].textContent).toBe('Stream')
    expect(requestBadges[1].textContent).toBe('Sync')
    expect(screen.getAllByTestId('native-compaction-badge')).toHaveLength(1)
    expect(screen.getByTestId('native-compaction-badge').textContent).toBe('Compaction')
  })

  it.each([
    [0, '0.0x'],
    [0.5, '0.50x'],
    [undefined, '1.00x']
  ])('shows the stored user rate %s in cost details', async (rate, expected) => {
    mountTable([{ ...baseImageRow, rate_multiplier: rate }])
    const tooltip = await openCostTooltip()
    const rateLabel = Array.from(tooltip.querySelectorAll('span')).find((span) => span.textContent === 'Rate')!
    expect(rateLabel.parentElement?.textContent).toContain(expected)
  })

  it('shows service tier and billing breakdown in cost tooltip', async () => {
    const row = {
      request_id: 'req-admin-1',
      actual_cost: 0.092883,
      total_cost: 0.092883,
      account_rate_multiplier: 1,
      rate_multiplier: 1,
      service_tier: 'priority',
      input_cost: 0.020285,
      output_cost: 0.00303,
      cache_creation_cost: 0,
      cache_read_cost: 0.069568,
      input_tokens: 4057,
      output_tokens: 101
    }

    mountTable([row])
    await openCostTooltip()

    const text = document.body.textContent
    expect(text).toContain('Service tier')
    expect(text).toContain('Fast')
    expect(text).toContain('Rate')
    expect(text).toContain('1.00x')
    expect(text).toContain('Account rate')
    expect(text).toContain('User billed')
    expect(text).toContain('Account billed')
    expect(text).toContain('$0.092883')
    expect(text).toContain('$5.0000 / 1M tokens')
    expect(text).toContain('$30.0000 / 1M tokens')
    expect(text).toContain('$0.069568')
  })

  it.each(['token', 'image', 'per_request'])('keeps eight decimal places in %s cost details', async (billingMode) => {
    const row = {
      ...baseImageRow,
      billing_mode: billingMode,
      image_count: billingMode === 'image' ? 2 : 0,
      input_cost: 0.00000001,
      image_input_cost: 0.00000002,
      output_cost: 0.00000003,
      image_output_cost: 0.00000004,
      cache_creation_cost: 0.00000005,
      cache_read_cost: 0.00000006,
      total_cost: 0.00000022,
      actual_cost: 0.00000042,
      account_stats_cost: 0.00000012,
      account_rate_multiplier: 1.5
    }
    mountTable([row])
    const amounts = spanTexts(await openCostTooltip())
    expect(amounts).toEqual(
      expect.arrayContaining([
        '$0.00000001',
        '$0.00000002',
        '$0.00000003',
        '$0.00000004',
        '$0.00000005',
        '$0.00000006',
        '$0.00000022',
        '$0.00000042',
        '$0.00000018'
      ])
    )
    if (billingMode === 'image') expect(amounts).toContain('$0.00000011')
  })

  it('uses eight decimal places for missing cost values', async () => {
    mountTable([{ ...baseImageRow, billing_mode: 'per_request', image_count: 0, total_cost: undefined, actual_cost: undefined }])
    const amounts = spanTexts(await openCostTooltip()).filter((text) => text.startsWith('$'))
    expect(amounts).toEqual(['$0.00000000', '$0.00000000', '$0.00000000', '$0.00000000'])
  })

  it('shows requested and upstream models separately for admin rows', () => {
    const row = {
      request_id: 'req-admin-model-1',
      model: 'claude-sonnet-4',
      upstream_model: 'claude-sonnet-4-20250514',
      actual_cost: 0,
      total_cost: 0,
      account_rate_multiplier: 1,
      rate_multiplier: 1,
      input_cost: 0,
      output_cost: 0,
      cache_creation_cost: 0,
      cache_read_cost: 0,
      input_tokens: 0,
      output_tokens: 0
    }

    const { container } = mountTable([row])
    expect(container.textContent).toContain('claude-sonnet-4')
    expect(container.textContent).toContain('claude-sonnet-4-20250514')
  })

  it('shows requested and forwarded reasoning effort separately when they differ', () => {
    const { container } = mountTable([
      { request_id: 'req-admin-effort-1', model: 'gpt-5.4', reasoning_effort: 'max', upstream_reasoning_effort: 'xhigh' }
    ])
    expect(container.textContent).toContain('Max')
    expect(container.textContent).toContain('XHigh')
    expect(container.textContent).toContain('↳')
  })

  it('shows a single reasoning effort when requested matches forwarded', () => {
    const { container } = mountTable([{ request_id: 'req-admin-effort-2', model: 'gpt-5.6-sol', reasoning_effort: 'max' }])
    expect(container.textContent).toContain('Max')
    expect(container.textContent).not.toContain('↳')
  })

  it('hides mapped reasoning effort for user rows that only have the requested value', () => {
    const { container } = mountTable([{ request_id: 'req-user-effort-1', model: 'gpt-5.4', reasoning_effort: 'max' }])
    expect(container.textContent).toContain('Max')
    expect(container.textContent).not.toContain('XHigh')
    expect(container.textContent).not.toContain('↳')
  })

  it.each([
    { name: 'possible version variant', responseModel: 'gpt-5.5-2026-08-01', expectedBadge: 'Possible version variant' },
    { name: 'different upstream model', responseModel: 'gpt-5.4', expectedBadge: 'Different model' }
  ])('shows a compact upstream response audit marker for $name', ({ responseModel, expectedBadge }) => {
    const { container } = mountTable([
      {
        request_id: `req-${responseModel}`,
        model: 'gpt-5.6-sol',
        upstream_model: 'gpt-5.5',
        model_mapping_chain: 'gpt-5.6-sol→gpt-5.5',
        upstream_response_model: responseModel,
        upstream_model_mismatch: true
      }
    ])

    const text = container.textContent
    expect(text).toContain('gpt-5.6-sol')
    expect(text).toContain('gpt-5.5')
    expect(text).toContain(responseModel)
    expect(text).toContain(expectedBadge)
  })

  it.each([
    {
      name: 'defaulted row',
      row: { ...baseImageRow, request_id: 'req-admin-default-image', image_size: '2K', image_input_size: 'auto', image_output_size: null, image_size_source: 'default' },
      expected: ['2K', 'Default billing tier', 'auto', 'unknown']
    },
    {
      name: 'output-sourced row',
      row: {
        ...baseImageRow,
        request_id: 'req-admin-output-image',
        image_size: '4K',
        image_input_size: '1024x1024',
        image_output_size: '3840x2160',
        image_size_source: 'output',
        image_size_breakdown: { '4K': 1 }
      },
      expected: ['4K', 'Upstream output', '1024x1024', '3840x2160', '4K x 1']
    },
    {
      name: 'input-sourced row',
      row: { ...baseImageRow, request_id: 'req-admin-input-image', image_size: '1K', image_input_size: '1024x1024', image_output_size: null, image_size_source: 'input' },
      expected: ['1K', 'Request input', '1024x1024', 'unknown']
    },
    {
      name: 'legacy unstandardized row',
      row: { ...baseImageRow, request_id: 'req-admin-legacy-unstandardized-image', image_size: '512x512', image_input_size: null, image_output_size: null, image_size_source: null },
      expected: ['legacy unstandardized: 512x512', 'Legacy record', 'unknown']
    }
  ])('shows image usage metadata for $name', async ({ row, expected }) => {
    mountTable([row])
    fireEvent.mouseEnter(screen.getAllByTestId('cost-tooltip-trigger')[0])
    await flushPromises()

    const text = document.body.textContent
    expect(text).toContain('Image count')
    expect(text).toContain('Billing size')
    expect(text).toContain('Size source')
    expect(text).toContain('Input size')
    expect(text).toContain('Output size')
    expect(text).toContain('Per-image price')
    expect(text).toContain('Image total price')
    for (const value of expected) {
      expect(text).toContain(value)
    }
  })

  it('displays historical image rows with missing billing_mode as image usage without a 2K fallback', async () => {
    mountTable([
      {
        ...baseImageRow,
        request_id: 'req-admin-legacy-missing-image',
        billing_mode: null,
        image_size: null,
        image_input_size: null,
        image_output_size: null,
        image_size_source: null,
        image_size_breakdown: null
      }
    ])
    fireEvent.mouseEnter(screen.getAllByTestId('cost-tooltip-trigger')[0])
    await flushPromises()

    const text = document.body.textContent
    expect(text).toContain('Image')
    expect(text).toContain('Image count')
    expect(text).toContain('Per-image price')
    expect(text).toContain('not recorded')
    expect(text).not.toContain('(2K)')
  })
})

describe('admin UsageTable request ID column', () => {
  beforeEach(() => {
    appStoreMocks.showSuccess.mockReset()
    appStoreMocks.showError.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders and copies the request ID', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    const { container } = mountTable([{ ...baseImageRow, request_id: 'req-admin-visible-id' }], [{ key: 'request_id', label: 'Request ID' }])

    expect(container.textContent).toContain('req-admin-visible-id')
    fireEvent.click(container.querySelector('button[title="Copy to clipboard"]')!)
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith('req-admin-visible-id')
    expect(appStoreMocks.showSuccess).toHaveBeenCalledWith('Request ID copied')
  })

  it('renders and copies the upstream ID', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    const { container } = mountTable(
      [{ ...baseImageRow, request_id: '', upstream_request_id: '20260903082826779695' }],
      [{ key: 'upstream_request_id', label: 'Upstream ID' }]
    )

    expect(container.textContent).toContain('20260903082826779695')
    const copyButtons = container.querySelectorAll('button[title="Copy to clipboard"]')
    expect(copyButtons).toHaveLength(1)
    fireEvent.click(copyButtons[0])
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith('20260903082826779695')
    expect(appStoreMocks.showSuccess).toHaveBeenCalledWith('Upstream ID copied')
  })
})

describe('admin UsageTable IP geolocation batch toolbar', () => {
  beforeEach(() => {
    ipGeoMocks.getEntry.mockReset()
    ipGeoMocks.fetchOne.mockReset()
    ipGeoMocks.fetchBatch.mockReset()
    ipGeoMocks.getEntry.mockReturnValue({ status: 'idle' })
  })

  const ipRows = [
    { request_id: 'r1', ip_address: '8.8.8.8' },
    { request_id: 'r2', ip_address: '8.8.8.8' },
    { request_id: 'r3', ip_address: '1.1.1.1' }
  ]
  const ipColumns = [{ key: 'ip_address', label: 'IP' }]

  it('does not render the batch toolbar when the ip_address column is not visible', () => {
    const { container } = mountTable([{ request_id: 'r1', ip_address: '8.8.8.8' }], [], ['ip_address'])
    expect(container.textContent).not.toContain('usage.ipGeo.batchFetch')
  })

  it('renders the batch toolbar with a pending count when the ip_address column is visible', () => {
    const { container } = mountTable(ipRows, ipColumns, ['ip_address'])
    expect(container.textContent).toContain('usage.ipGeo.pending')
    const button = screen.getByRole('button', { name: 'usage.ipGeo.batchFetch' })
    expect(button).not.toBeDisabled()
  })

  it('fetches deduplicated IPs from the current page when the batch button is clicked', async () => {
    ipGeoMocks.fetchBatch.mockResolvedValue(true)
    const onIpGeoBatchFailed = vi.fn()
    stub.keys = ['ip_address']
    render(<UsageTable data={rows(ipRows)} columns={ipColumns} onIpGeoBatchFailed={onIpGeoBatchFailed} />)
    fireEvent.click(screen.getByRole('button', { name: 'usage.ipGeo.batchFetch' }))
    await flushPromises()
    expect(ipGeoMocks.fetchBatch).toHaveBeenCalledWith(['8.8.8.8', '1.1.1.1'])
    expect(onIpGeoBatchFailed).not.toHaveBeenCalled()
  })

  it('emits ipGeoBatchFailed when the batch request reports a network-level failure', async () => {
    ipGeoMocks.fetchBatch.mockResolvedValue(false)
    const onIpGeoBatchFailed = vi.fn()
    stub.keys = ['ip_address']
    render(<UsageTable data={rows([{ request_id: 'r1', ip_address: '8.8.8.8' }])} columns={ipColumns} onIpGeoBatchFailed={onIpGeoBatchFailed} />)
    fireEvent.click(screen.getByRole('button', { name: 'usage.ipGeo.batchFetch' }))
    await flushPromises()
    expect(onIpGeoBatchFailed).toHaveBeenCalledTimes(1)
  })

  it('renders IpGeoCell content for ip_address cells', () => {
    ipGeoMocks.getEntry.mockReturnValue({ status: 'success', label: 'CN · Guangdong · Shenzhen', detail: {} })
    const { container } = mountTable([{ request_id: 'r1', ip_address: '121.35.47.43' }], ipColumns, ['ip_address'])
    expect(container.textContent).toContain('121.35.47.43')
    expect(container.textContent).toContain('CN · Guangdong · Shenzhen')
  })
})

describe('admin UsageTable deleted-user badge', () => {
  const USER_KEYS = ['user', 'model', 'reasoning_effort', 'billing_mode', 'tokens', 'cost']

  it('renders deleted badge for a soft-deleted user row', () => {
    const row = {
      request_id: 'req-deleted-user-1',
      model: 'claude-3',
      user_id: 2,
      user: { id: 2, email: 'd@test.com', deleted_at: '2026-05-28T00:00:00Z' },
      actual_cost: 0,
      total_cost: 0,
      input_cost: 0,
      output_cost: 0,
      rate_multiplier: 1,
      input_tokens: 1,
      output_tokens: 1
    }

    const { container } = mountTable([row], [{ key: 'user', label: 'User' }], USER_KEYS)
    expect(container.textContent).toContain('Deleted')
    expect(container.textContent).toContain('d@test.com')
  })

  it('does NOT render deleted badge for an active user row', () => {
    const row = {
      request_id: 'req-active-user-1',
      model: 'claude-3',
      user_id: 3,
      user: { id: 3, email: 'active@test.com', deleted_at: null },
      actual_cost: 0,
      total_cost: 0,
      input_cost: 0,
      output_cost: 0,
      rate_multiplier: 1,
      input_tokens: 1,
      output_tokens: 1
    }

    const { container } = mountTable([row], [{ key: 'user', label: 'User' }], USER_KEYS)
    expect(container.textContent).not.toContain('Deleted')
    expect(container.textContent).toContain('active@test.com')
  })
})
