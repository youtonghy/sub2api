import { act, renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useForm, type UseFormOptions } from '@/composables/useForm'
import { useAppStore } from '@/stores/app'
import { resetStore } from '@/stores/__tests__/storeHarness'

// Mock API 依赖（app store 内部引用了这些）
vi.mock('@/api/admin/system', () => ({
  checkUpdates: vi.fn(),
}))
vi.mock('@/api/auth', () => ({
  getPublicSettings: vi.fn(),
}))

const setup = <T>(options: UseFormOptions<T>) => renderHook(() => useForm(options))

describe('useForm', () => {
  beforeEach(() => {
    resetStore(useAppStore)
    vi.clearAllMocks()
  })

  it('submit 期间 loading 为 true，完成后为 false', async () => {
    let resolveSubmit: () => void
    const submitFn = vi.fn(
      () => new Promise<void>((resolve) => { resolveSubmit = resolve })
    )

    const { result } = setup({ form: { name: 'test' }, submitFn })

    expect(result.current.loading).toBe(false)

    let submitPromise!: Promise<void>
    act(() => { submitPromise = result.current.submit() })
    // 提交中
    expect(result.current.loading).toBe(true)

    await act(async () => {
      resolveSubmit!()
      await submitPromise
    })

    expect(result.current.loading).toBe(false)
  })

  it('submit 成功时显示成功消息', async () => {
    const submitFn = vi.fn().mockResolvedValue(undefined)
    const showSuccessSpy = vi.spyOn(useAppStore.getState(), 'showSuccess')

    const { result } = setup({ form: { name: 'test' }, submitFn, successMsg: '保存成功' })

    await act(() => result.current.submit())

    expect(showSuccessSpy).toHaveBeenCalledWith('保存成功')
  })

  it('submit 成功但无 successMsg 时不调用 showSuccess', async () => {
    const submitFn = vi.fn().mockResolvedValue(undefined)
    const showSuccessSpy = vi.spyOn(useAppStore.getState(), 'showSuccess')

    const { result } = setup({ form: { name: 'test' }, submitFn })

    await act(() => result.current.submit())

    expect(showSuccessSpy).not.toHaveBeenCalled()
  })

  it('submit 失败时显示错误消息并抛出错误', async () => {
    const error = Object.assign(new Error('提交失败'), {
      response: { data: { message: '服务器错误' } },
    })
    const submitFn = vi.fn().mockRejectedValue(error)
    const showErrorSpy = vi.spyOn(useAppStore.getState(), 'showError')

    const { result } = setup({ form: { name: 'test' }, submitFn })

    await act(() => expect(result.current.submit()).rejects.toThrow('提交失败'))

    expect(showErrorSpy).toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })

  it('submit 失败时使用自定义 errorMsg', async () => {
    const submitFn = vi.fn().mockRejectedValue(new Error('network'))
    const showErrorSpy = vi.spyOn(useAppStore.getState(), 'showError')

    const { result } = setup({ form: { name: 'test' }, submitFn, errorMsg: '自定义错误提示' })

    await act(() => expect(result.current.submit()).rejects.toThrow())

    expect(showErrorSpy).toHaveBeenCalledWith('自定义错误提示')
  })

  it('loading 中不会重复提交', async () => {
    let resolveSubmit: () => void
    const submitFn = vi.fn(
      () => new Promise<void>((resolve) => { resolveSubmit = resolve })
    )

    const { result } = setup({ form: { name: 'test' }, submitFn })

    let p1!: Promise<void>
    act(() => {
      // 第一次提交
      p1 = result.current.submit()
      // 第二次提交（应被忽略，因为 loading=true）
      void result.current.submit()
    })

    expect(submitFn).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSubmit!()
      await p1
    })
  })

  it('传递 form 数据到 submitFn', async () => {
    const formData = { name: 'test', email: 'test@example.com' }
    const submitFn = vi.fn().mockResolvedValue(undefined)

    const { result } = setup({ form: formData, submitFn })

    await act(() => result.current.submit())

    expect(submitFn).toHaveBeenCalledWith(formData)
  })
})
