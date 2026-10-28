import { useCallback, useEffect, useRef, useState } from 'react'

import type { BasePaginationResponse, FetchOptions } from '@/types'
import { getPersistedPageSize, setPersistedPageSize } from './usePersistedPageSize'

export interface PaginationState {
  page: number
  page_size: number
  total: number
  pages: number
}

export interface TableLoaderOptions<T, P> {
  fetchFn: (page: number, pageSize: number, params: P, options?: FetchOptions) => Promise<BasePaginationResponse<T>>
  initialParams?: P
  pageSize?: number
  debounceMs?: number
}

const isAbortError = (error: any) => {
  return error?.name === 'AbortError' || error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError'
}

/**
 * 通用表格数据加载 Hook，对应 Vue 版 useTableLoader
 * 统一处理分页、筛选、搜索防抖和请求取消
 *
 * 与 Vue 版的差异：Vue 版直接修改 reactive 的 params/pagination；这里用 setParams/updatePagination，
 * 二者立即生效（load 读取的是最新值），所以 `setParams({ search }); debouncedReload()` 可以连写。
 */
export function useTableLoader<T, P extends Record<string, any>>(options: TableLoaderOptions<T, P>) {
  const { initialParams, pageSize, debounceMs = 300 } = options

  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [params, setParamsState] = useState<P>(() => ({ ...(initialParams || {}) }) as P)
  const [pagination, setPaginationState] = useState<PaginationState>(() => ({
    page: 1,
    page_size: pageSize ?? getPersistedPageSize(),
    total: 0,
    pages: 0
  }))

  const paramsRef = useRef(params)
  const paginationRef = useRef(pagination)
  const fetchFnRef = useRef(options.fetchFn)
  const abortControllerRef = useRef<AbortController | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetchFnRef.current = options.fetchFn
  })

  const setParams = useCallback((patch: Partial<P> | ((prev: P) => P)) => {
    const next = typeof patch === 'function' ? patch(paramsRef.current) : { ...paramsRef.current, ...patch }
    paramsRef.current = next
    setParamsState(next)
  }, [])

  const updatePagination = useCallback((patch: Partial<PaginationState>) => {
    const next = { ...paginationRef.current, ...patch }
    paginationRef.current = next
    setPaginationState(next)
  }, [])

  const load = useCallback(async () => {
    abortControllerRef.current?.abort()
    const currentController = new AbortController()
    abortControllerRef.current = currentController
    setLoading(true)

    try {
      const { page, page_size } = paginationRef.current
      const response = await fetchFnRef.current(page, page_size, paramsRef.current, {
        signal: currentController.signal
      })

      setItems(response.items || [])
      updatePagination({ total: response.total || 0, pages: response.pages || 0 })
    } catch (error) {
      if (!isAbortError(error)) {
        console.error('Table load error:', error)
        throw error
      }
    } finally {
      if (abortControllerRef.current === currentController) {
        setLoading(false)
      }
    }
  }, [updatePagination])

  const reload = useCallback(() => {
    updatePagination({ page: 1 })
    return load()
  }, [load, updatePagination])

  const debouncedReload = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null
      // load 已记录错误，这里避免未处理的 Promise 拒绝
      void reload().catch(() => {})
    }, debounceMs)
  }, [reload, debounceMs])

  const handlePageChange = useCallback(
    (page: number) => {
      // 确保页码在有效范围内
      const validPage = Math.max(1, Math.min(page, paginationRef.current.pages || 1))
      updatePagination({ page: validPage })
      void load().catch(() => {}) // load 已记录错误
    },
    [load, updatePagination]
  )

  const handlePageSizeChange = useCallback(
    (size: number) => {
      updatePagination({ page_size: size, page: 1 })
      setPersistedPageSize(size)
      void load().catch(() => {}) // load 已记录错误
    },
    [load, updatePagination]
  )

  useEffect(
    () => () => {
      abortControllerRef.current?.abort()
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    },
    []
  )

  return {
    items,
    loading,
    params,
    setParams,
    pagination,
    updatePagination,
    load,
    reload,
    debouncedReload,
    handlePageChange,
    handlePageSizeChange
  }
}
