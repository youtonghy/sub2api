import { act, renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useTableLoader } from '@/composables/useTableLoader'

const createMockFetchFn = (items: any[] = [], total = 0, pages = 1) => {
  return vi.fn().mockResolvedValue({ items, total, pages })
}

// Vue 版直接在组件外调用 composable；React Hook 用 renderHook 挂载，result.current 始终是最新返回值
const setup = (options: Parameters<typeof useTableLoader>[0]) => renderHook(() => useTableLoader(options))

describe('useTableLoader', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    // handlePageSizeChange 会持久化每页条数，避免影响后续用例的默认值
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // --- 基础加载 ---

  describe('基础加载', () => {
    it('load 执行 fetchFn 并更新 items', async () => {
      const mockItems = [{ id: 1, name: 'item1' }, { id: 2, name: 'item2' }]
      const fetchFn = createMockFetchFn(mockItems, 2, 1)

      const { result } = setup({ fetchFn })

      expect(result.current.items).toHaveLength(0)

      await act(() => result.current.load())

      expect(result.current.items).toEqual(mockItems)
      expect(result.current.pagination.total).toBe(2)
      expect(result.current.pagination.pages).toBe(1)
      expect(result.current.loading).toBe(false)
    })

    it('load 期间 loading 为 true', async () => {
      let resolveLoad: (v: any) => void
      const fetchFn = vi.fn(
        () => new Promise<any>((resolve) => { resolveLoad = resolve })
      )

      const { result } = setup({ fetchFn })

      let p!: Promise<void>
      act(() => { p = result.current.load() })
      expect(result.current.loading).toBe(true)

      await act(async () => {
        resolveLoad!({ items: [], total: 0, pages: 0 })
        await p
      })

      expect(result.current.loading).toBe(false)
    })

    it('使用默认 pageSize=20', async () => {
      const fetchFn = createMockFetchFn()
      const { result } = setup({ fetchFn })

      await act(() => result.current.load())

      expect(fetchFn).toHaveBeenCalledWith(
        1,
        20,
        expect.anything(),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
      expect(result.current.pagination.page_size).toBe(20)
    })

    it('可自定义 pageSize', async () => {
      const fetchFn = createMockFetchFn()
      const { result } = setup({ fetchFn, pageSize: 50 })

      await act(() => result.current.load())

      expect(fetchFn).toHaveBeenCalledWith(
        1,
        50,
        expect.anything(),
        expect.anything()
      )
    })
  })

  // --- 分页 ---

  describe('分页', () => {
    it('handlePageChange 更新页码并加载', async () => {
      const fetchFn = createMockFetchFn([], 100, 5)
      const { result } = setup({ fetchFn })

      await act(() => result.current.load()) // 初始加载
      fetchFn.mockClear()

      act(() => result.current.handlePageChange(3))

      expect(result.current.pagination.page).toBe(3)
      // 等待 load 完成
      await act(() => vi.runAllTimersAsync())
      expect(fetchFn).toHaveBeenCalledWith(3, 20, expect.anything(), expect.anything())
    })

    it('handlePageSizeChange 重置到第1页并加载', async () => {
      const fetchFn = createMockFetchFn([], 100, 5)
      const { result } = setup({ fetchFn })

      await act(() => result.current.load())
      act(() => result.current.updatePagination({ page: 3 }))
      fetchFn.mockClear()

      act(() => result.current.handlePageSizeChange(50))

      expect(result.current.pagination.page).toBe(1)
      expect(result.current.pagination.page_size).toBe(50)
      await act(() => vi.runAllTimersAsync())
    })

    it('handlePageChange 限制页码范围', async () => {
      const fetchFn = createMockFetchFn([], 100, 5)
      const { result } = setup({ fetchFn })

      await act(() => result.current.load())

      // 超出范围的页码被限制
      act(() => result.current.handlePageChange(999))
      expect(result.current.pagination.page).toBe(5) // 限制在 pages=5

      act(() => result.current.handlePageChange(0))
      expect(result.current.pagination.page).toBe(1) // 最小为 1
      await act(() => vi.runAllTimersAsync())
    })
  })

  // --- 搜索防抖 ---

  describe('搜索防抖', () => {
    it('debouncedReload 在 300ms 内多次调用只执行一次', async () => {
      const fetchFn = createMockFetchFn()
      const { result } = setup({ fetchFn })

      // 快速连续调用
      act(() => {
        result.current.debouncedReload()
        result.current.debouncedReload()
        result.current.debouncedReload()
      })

      // 还没到 300ms，不应调用 fetchFn
      expect(fetchFn).not.toHaveBeenCalled()

      // 推进 300ms 并等待异步完成
      await act(() => vi.advanceTimersByTimeAsync(300))
      await act(() => vi.runAllTimersAsync())

      expect(fetchFn).toHaveBeenCalledTimes(1)
    })

    it('reload 重置到第 1 页', async () => {
      const fetchFn = createMockFetchFn([], 100, 5)
      const { result } = setup({ fetchFn })

      await act(() => result.current.load())
      act(() => result.current.updatePagination({ page: 3 }))

      await act(() => result.current.reload())

      expect(result.current.pagination.page).toBe(1)
    })

    it('setParams 立即生效，紧接着的 reload 使用新参数', async () => {
      const fetchFn = createMockFetchFn()
      const { result } = setup({ fetchFn, initialParams: { search: '' } })

      await act(async () => {
        result.current.setParams({ search: 'abc' })
        await result.current.reload()
      })

      expect(fetchFn).toHaveBeenCalledWith(1, 20, { search: 'abc' }, expect.anything())
      expect(result.current.params).toEqual({ search: 'abc' })
    })
  })

  // --- 请求取消 ---

  describe('请求取消', () => {
    it('新请求取消前一个未完成的请求', async () => {
      let callCount = 0
      const fetchFn = vi.fn((_page, _size, _params, options) => {
        callCount++
        const currentCall = callCount
        return new Promise<any>((resolve, reject) => {
          // 模拟监听 abort
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              reject({ name: 'CanceledError', code: 'ERR_CANCELED' })
            })
          }
          // 异步解决
          setTimeout(() => {
            resolve({ items: [{ id: currentCall }], total: 1, pages: 1 })
          }, 1000)
        })
      })

      const { result } = setup({ fetchFn })

      let p1!: Promise<void>
      let p2!: Promise<void>
      act(() => {
        // 第一次加载
        p1 = result.current.load()
        // 第二次加载（应取消第一次）
        p2 = result.current.load()
      })

      // 推进时间让第二次完成
      await act(async () => {
        vi.advanceTimersByTime(1000)
        await vi.runAllTimersAsync()
        // 等待两个 Promise settle
        await Promise.allSettled([p1, p2])
      })

      // 第二次请求的结果生效
      expect(fetchFn).toHaveBeenCalledTimes(2)
      expect(result.current.items).toEqual([{ id: 2 }])
    })
  })

  // --- 错误处理 ---

  describe('错误处理', () => {
    it('非取消错误会被抛出', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const fetchFn = vi.fn().mockRejectedValue(new Error('Server error'))
      const { result } = setup({ fetchFn })

      await act(() => expect(result.current.load()).rejects.toThrow('Server error'))
      consoleError.mockRestore()
    })

    it('取消错误被静默处理', async () => {
      const fetchFn = vi.fn().mockRejectedValue({ name: 'CanceledError', code: 'ERR_CANCELED' })
      const { result } = setup({ fetchFn })

      // 不应抛出
      await act(() => result.current.load())
    })
  })
})
