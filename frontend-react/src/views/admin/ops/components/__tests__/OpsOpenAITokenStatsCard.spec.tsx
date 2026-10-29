import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import OpsOpenAITokenStatsCard from '../OpsOpenAITokenStatsCard'
import styles from '../OpsOpenAITokenStatsCard.module.css'

const { mockGetOpenAITokenStats } = vi.hoisted(() => ({ mockGetOpenAITokenStats: vi.fn() }))

vi.mock('@/api/admin/ops', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  opsAPI: {
    getOpenAITokenStats: (...args: any[]) => mockGetOpenAITokenStats(...args)
  }
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, any>) => {
      if (key === 'admin.ops.openaiTokenStats.pageInfo' && params) {
        return `第 ${params.page}/${params.total} 页`
      }
      return key
    },
    te: () => true,
    locale: 'en'
  })
}))

// Select 桩：原生 select，按渲染顺序取用（对应 Vue 版 SelectControlStub）
vi.mock('@/components/common/Select', () => ({
  default: ({ value, options, onChange }: any) => (
    <select
      data-testid="select-stub"
      value={String(value)}
      onChange={(e) => {
        const option = options.find((o: any) => String(o.value) === e.target.value)
        onChange?.(option ? option.value : e.target.value, option ?? null)
      }}
    >
      {options.map((o: any) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  )
}))

vi.mock('@/components/common/EmptyState', () => ({
  default: ({ title, description }: { title?: string; description?: string }) => (
    <div className="empty-state" data-testid="empty-state">
      {title}|{description}
    </div>
  )
}))

const sampleResponse = {
  time_range: '30d' as const,
  start_time: '2026-01-01T00:00:00Z',
  end_time: '2026-01-31T00:00:00Z',
  platform: 'openai',
  group_id: 7,
  items: [
    {
      model: 'gpt-4o-mini',
      request_count: 12,
      avg_tokens_per_sec: 22.5,
      avg_first_token_ms: 123.45,
      total_output_tokens: 1234,
      avg_duration_ms: 321,
      requests_with_first_token: 10
    }
  ],
  total: 40,
  page: 1,
  page_size: 20,
  top_n: null
}

const selects = () => screen.getAllByTestId('select-stub') as HTMLSelectElement[]
const nextPageButton = () => screen.getByRole('button', { name: 'admin.ops.openaiTokenStats.nextPage' })

async function settle() {
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
}

describe('OpsOpenAITokenStatsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(cleanup)

  it('默认不限定平台并展示各平台模型的统计', async () => {
    const models = ['gpt-4o-mini', 'o3', 'claude-sonnet-4-5', 'gemini-2.5-pro']
    mockGetOpenAITokenStats.mockResolvedValue({
      ...sampleResponse,
      platform: '',
      group_id: null,
      items: models.map((model) => ({ ...sampleResponse.items[0], model })),
      total: models.length
    })

    const { container } = render(<OpsOpenAITokenStatsCard refreshToken={0} />)
    await waitFor(() => expect(container.textContent).toContain('gemini-2.5-pro'))

    expect(mockGetOpenAITokenStats).toHaveBeenCalledTimes(1)
    expect(mockGetOpenAITokenStats).toHaveBeenCalledWith({
      time_range: '30d',
      platform: undefined,
      group_id: undefined,
      top_n: 20
    })
    for (const model of models) {
      expect(container.textContent).toContain(model)
    }
  })

  it.each([
    ['anthropic', 'claude-sonnet-4-5'],
    ['gemini', 'gemini-2.5-pro']
  ])('切换至 %s 平台后刷新统计并重置分页', async (platform, model) => {
    mockGetOpenAITokenStats.mockImplementation(async (params: Record<string, any>) => ({
      ...sampleResponse,
      platform: params.platform,
      page: params.page ?? 1,
      items: [
        {
          ...sampleResponse.items[0],
          model: params.platform === platform ? model : 'gpt-4o-mini'
        }
      ]
    }))

    const { container, rerender } = render(<OpsOpenAITokenStatsCard platformFilter="openai" groupIdFilter={7} refreshToken={0} />)
    await settle()
    fireEvent.change(selects()[1], { target: { value: 'pagination' } })
    await settle()
    fireEvent.click(nextPageButton())
    await waitFor(() => expect(mockGetOpenAITokenStats).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })))
    await settle()

    mockGetOpenAITokenStats.mockClear()
    rerender(<OpsOpenAITokenStatsCard platformFilter={platform} groupIdFilter={7} refreshToken={0} />)
    await waitFor(() => expect(container.textContent).toContain(model))

    expect(mockGetOpenAITokenStats).toHaveBeenCalledTimes(1)
    expect(mockGetOpenAITokenStats).toHaveBeenCalledWith({
      time_range: '30d',
      platform,
      group_id: 7,
      page: 1,
      page_size: 20
    })
    expect(container.textContent).not.toContain('gpt-4o-mini')
  })

  it('默认加载并透传 platform/group 过滤，支持时间窗口切换', async () => {
    mockGetOpenAITokenStats.mockResolvedValue(sampleResponse)

    render(<OpsOpenAITokenStatsCard platformFilter="openai" groupIdFilter={7} refreshToken={0} />)

    await waitFor(() =>
      expect(mockGetOpenAITokenStats).toHaveBeenCalledWith(
        expect.objectContaining({
          time_range: '30d',
          platform: 'openai',
          group_id: 7,
          top_n: 20
        })
      )
    )
    await settle()

    fireEvent.change(selects()[0], { target: { value: '1h' } })

    await waitFor(() =>
      expect(mockGetOpenAITokenStats).toHaveBeenCalledWith(
        expect.objectContaining({
          time_range: '1h',
          platform: 'openai',
          group_id: 7
        })
      )
    )
  })

  it('支持分页与 TopN 模式切换并按参数请求', async () => {
    mockGetOpenAITokenStats.mockImplementation(async (params: Record<string, any>) => ({
      ...sampleResponse,
      time_range: params.time_range ?? '30d',
      page: params.page ?? 1,
      page_size: params.page_size ?? 20,
      top_n: params.top_n ?? null,
      total: 40
    }))

    render(<OpsOpenAITokenStatsCard refreshToken={0} />)
    await settle()

    fireEvent.change(selects()[1], { target: { value: 'pagination' } })
    await waitFor(() =>
      expect(mockGetOpenAITokenStats).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          page_size: 20
        })
      )
    )
    await settle()

    // Vue 版取 findAll('button')[1]（上一页、下一页）；这里按名称取下一页按钮
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(2)
    fireEvent.click(nextPageButton())
    await waitFor(() =>
      expect(mockGetOpenAITokenStats).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
          page_size: 20
        })
      )
    )
    await settle()

    fireEvent.change(selects()[1], { target: { value: 'topn' } })
    await settle()
    fireEvent.change(selects()[2], { target: { value: '50' } })

    await waitFor(() =>
      expect(mockGetOpenAITokenStats).toHaveBeenCalledWith(
        expect.objectContaining({
          top_n: 50
        })
      )
    )
  })

  it('接口返回空数据时显示空态', async () => {
    mockGetOpenAITokenStats.mockResolvedValue({
      ...sampleResponse,
      items: [],
      total: 0
    })

    render(<OpsOpenAITokenStatsCard refreshToken={0} />)

    expect(await screen.findByTestId('empty-state')).toBeInTheDocument()
  })

  it('数据表使用固定高度滚动容器，避免纵向无限增长', async () => {
    mockGetOpenAITokenStats.mockResolvedValue(sampleResponse)

    render(<OpsOpenAITokenStatsCard refreshToken={0} />)

    // Vue 版断言 Tailwind 类 max-h-[420px]；React 版对应 CSS Module 的 .scroll（max-height: 420px; overflow: auto）
    expect(styles.scroll).toBeTruthy()
    const scroll = await screen.findByTestId('openai-token-stats-scroll')
    expect(scroll).toHaveClass(styles.scroll)
  })

  it('接口异常时显示错误提示', async () => {
    mockGetOpenAITokenStats.mockRejectedValue(new Error('加载失败'))

    const { container } = render(<OpsOpenAITokenStatsCard refreshToken={0} />)

    await waitFor(() => expect(container.textContent).toContain('加载失败'))
  })
})
