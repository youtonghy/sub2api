import { apiClient } from '@/api/client'
import type { BasePaginationResponse, FetchOptions } from '@/types'
import type { PrivacyFilterConfig, PrivacyFilterEvent, PrivacyFilterEventQuery, PrivacyFilterStatus } from './types'

/** 去掉空筛选，避免把 '' / null 当成条件发给后端 */
function compactQuery(query: PrivacyFilterEventQuery): Record<string, string | number> {
  const params: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    params[key] = typeof value === 'string' ? value.trim() : value
  }
  return params
}

async function listEventsAt(
  path: string,
  page: number,
  pageSize: number,
  query: PrivacyFilterEventQuery,
  options?: FetchOptions
): Promise<BasePaginationResponse<PrivacyFilterEvent>> {
  const { data } = await apiClient.get<BasePaginationResponse<PrivacyFilterEvent>>(path, {
    params: { page, page_size: pageSize, ...compactQuery(query) },
    signal: options?.signal
  })
  return data
}

export const adminPrivacyFilterAPI = {
  async getConfig(): Promise<PrivacyFilterConfig> {
    const { data } = await apiClient.get<PrivacyFilterConfig>('/admin/privacy-filter/config')
    return data
  },
  async updateConfig(payload: PrivacyFilterConfig): Promise<PrivacyFilterConfig> {
    const { data } = await apiClient.put<PrivacyFilterConfig>('/admin/privacy-filter/config', payload)
    return data
  },
  async getStatus(): Promise<PrivacyFilterStatus> {
    const { data } = await apiClient.get<PrivacyFilterStatus>('/admin/privacy-filter/status')
    return data
  },
  listEvents(page: number, pageSize: number, query: PrivacyFilterEventQuery, options?: FetchOptions) {
    return listEventsAt('/admin/privacy-filter/events', page, pageSize, query, options)
  }
}

export const userPrivacyFilterAPI = {
  /** 只返回当前登录用户自己的记录 */
  listEvents(page: number, pageSize: number, query: PrivacyFilterEventQuery, options?: FetchOptions) {
    return listEventsAt('/privacy-filter/events', page, pageSize, query, options)
  }
}
