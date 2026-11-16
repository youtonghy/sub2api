import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SelectProps } from '@/components/common/Select'
import type { DateRangePickerProps } from '@/components/common/DateRangePicker'
import PrivacyFilterEvents from '../components/PrivacyFilterEvents'
import type { PrivacyFilterEvent } from '../types'

const { showError } = vi.hoisted(() => ({ showError: vi.fn() }))

vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showError }) } }))
vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}(${Object.values(params).join(',')})` : key
  })
}))
// 下拉与日期选择器换成原生控件，便于直接触发筛选
vi.mock('@/components/common/Select', () => ({
  default: ({ value, options, onChange, ...rest }: SelectProps) => (
    <select
      aria-label={rest['aria-label']}
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(event) => {
        const picked = (options as Array<{ value: unknown }>).find((option) => String(option.value ?? '') === event.target.value)
        onChange?.((picked?.value ?? null) as never, null)
      }}
    >
      {(options as Array<{ value: unknown; label: string }>).map((option) => (
        <option key={String(option.value)} value={option.value === null ? '' : String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  )
}))
vi.mock('@/components/common/DateRangePicker', () => ({
  default: ({ startDate, endDate, onChange }: DateRangePickerProps) => (
    <button type="button" onClick={() => onChange?.({ startDate: '2026-11-01', endDate: '2026-11-02', preset: null })}>
      range {startDate}..{endDate}
    </button>
  )
}))

const adminEvent: PrivacyFilterEvent = {
  id: 1,
  created_at: '2026-11-16T08:00:00Z',
  api_key_id: 3,
  api_key_name: 'ci-key',
  model: 'claude-x',
  action: 'redact',
  fields: 1,
  total_hits: 3,
  categories: { credential: 2, email: 1 },
  request_id: 'local:req-1',
  user_id: 42,
  user_email: 'dev@example.com',
  group_name: 'claude-pro',
  endpoint: '/v1/messages'
}

function page(items: PrivacyFilterEvent[]) {
  return { items, total: items.length, page: 1, page_size: 20, pages: 1 }
}

describe('PrivacyFilterEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the last 7 days and shows admin-only columns', async () => {
    const fetchEvents = vi.fn().mockResolvedValue(page([adminEvent]))
    render(<PrivacyFilterEvents variant="admin" fetchEvents={fetchEvents} />)

    expect(await screen.findAllByText('dev@example.com')).not.toHaveLength(0)
    expect(screen.getAllByText('local:req-1')).not.toHaveLength(0)
    expect(screen.getAllByText('privacyFilter.categories.credential.label × 2')).not.toHaveLength(0)
    expect(screen.getAllByText('privacyFilter.records.actions.redact')).not.toHaveLength(0)
    expect(screen.getByText('privacyFilter.records.adminHint')).toBeTruthy()
    expect(screen.queryByLabelText('privacyFilter.records.filters.apiKey')).toBeNull()

    const [, , query] = fetchEvents.mock.calls[0]
    const days = (Date.parse(query.end_date) - Date.parse(query.start_date)) / 86400000
    expect(days).toBe(6)
  })

  it('reloads from page 1 with the chosen filters', async () => {
    const fetchEvents = vi.fn().mockResolvedValue(page([]))
    render(<PrivacyFilterEvents variant="admin" fetchEvents={fetchEvents} />)
    await waitFor(() => expect(fetchEvents).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('privacyFilter.records.filters.action'), { target: { value: 'failed' } })
    await waitFor(() => expect(fetchEvents).toHaveBeenCalledTimes(2))
    expect(fetchEvents.mock.calls[1][0]).toBe(1)
    expect(fetchEvents.mock.calls[1][2]).toMatchObject({ action: 'failed' })

    fireEvent.change(screen.getByLabelText('privacyFilter.records.filters.category'), { target: { value: 'ip' } })
    await waitFor(() => expect(fetchEvents).toHaveBeenCalledTimes(3))
    expect(fetchEvents.mock.calls[2][2]).toMatchObject({ action: 'failed', category: 'ip' })

    fireEvent.click(screen.getByRole('button', { name: /range/ }))
    await waitFor(() => expect(fetchEvents).toHaveBeenCalledTimes(4))
    expect(fetchEvents.mock.calls[3][2]).toMatchObject({ start_date: '2026-11-01', end_date: '2026-11-02' })

    expect(await screen.findByText('privacyFilter.records.empty')).toBeTruthy()
  })

  it('shows the user view without other users, groups or request IDs', async () => {
    const userEvent: PrivacyFilterEvent = {
      id: 2,
      created_at: '2026-11-16T08:00:00Z',
      api_key_name: '',
      model: '',
      action: 'failed',
      fields: 0,
      total_hits: 0,
      categories: {}
    }
    const fetchEvents = vi.fn().mockResolvedValue(page([userEvent]))
    render(
      <PrivacyFilterEvents variant="user" fetchEvents={fetchEvents} apiKeyOptions={[{ value: 5, label: 'my-key' }]} />
    )

    expect(await screen.findAllByText('privacyFilter.records.deletedKey')).not.toHaveLength(0)
    expect(screen.getByText('privacyFilter.records.userHint')).toBeTruthy()
    expect(screen.queryByText('privacyFilter.records.columns.requestId')).toBeNull()
    expect(screen.queryByText('privacyFilter.records.columns.user')).toBeNull()
    expect(screen.queryByLabelText('privacyFilter.records.filters.search')).toBeNull()

    fireEvent.change(screen.getByLabelText('privacyFilter.records.filters.apiKey'), { target: { value: '5' } })
    await waitFor(() => expect(fetchEvents).toHaveBeenCalledTimes(2))
    expect(fetchEvents.mock.calls[1][2]).toMatchObject({ api_key_id: 5 })
  })

  it('reports a load failure', async () => {
    const fetchEvents = vi.fn().mockRejectedValue(new Error('boom'))
    render(<PrivacyFilterEvents variant="user" fetchEvents={fetchEvents} />)
    await waitFor(() => expect(showError).toHaveBeenCalledTimes(1))
  })
})
