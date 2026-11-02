/**
 * CreateAccountModal 的表单状态容器。
 *
 * Vue 版依赖 ref + watch 的组合：处理函数同步写入多个字段，watch 回调在本轮写入结束后
 * （渲染前）按创建顺序批量执行，并拿到旧值。表单里大量默认值联动（平台切换、账号模式、
 * 协议切换等）依赖这一语义，这里用一个可订阅的状态容器复刻：
 * - set() 立即更新快照并通知订阅者（组件通过 useSyncExternalStore 重新渲染）；
 * - watch() 回调在微任务中批量执行，每次只运行最早注册且值已变化的回调，
 *   与 Vue 调度器按创建顺序运行 pre-flush 任务的行为一致；
 * - 处理函数通过 get() 读取最新值，不受闭包旧值影响。
 */

type Listener = () => void

interface WatchEntry<T> {
  source: (state: T) => unknown
  cb: (value: any, oldValue: any) => void
  last: unknown
}

export interface ReactiveStore<T extends object> {
  get: () => T
  set: (patch: Partial<T>) => void
  subscribe: (listener: Listener) => () => void
  watch: <V>(
    source: (state: T) => V,
    cb: (value: V, oldValue: V) => void,
    options?: { immediate?: boolean }
  ) => void
}

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => Object.is(item, b[index]))
  }
  return Object.is(a, b)
}

const MAX_WATCH_ITERATIONS = 1000

export function createReactiveStore<T extends object>(initial: T): ReactiveStore<T> {
  let state = initial
  const listeners = new Set<Listener>()
  const watchers: WatchEntry<T>[] = []
  let scheduled = false

  const flush = () => {
    let iterations = 0
    for (;;) {
      const dirty = watchers.find((entry) => !same(entry.source(state), entry.last))
      if (!dirty) break
      if (++iterations > MAX_WATCH_ITERATIONS) {
        console.warn('[CreateAccountModal] watcher flush exceeded the iteration limit')
        break
      }
      const value = dirty.source(state)
      const oldValue = dirty.last
      dirty.last = value
      dirty.cb(value, oldValue)
    }
    scheduled = false
  }

  const schedule = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(flush)
  }

  return {
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch }
      listeners.forEach((listener) => listener())
      if (watchers.length > 0) schedule()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    watch: (source, cb, options) => {
      const entry: WatchEntry<T> = { source, cb, last: source(state) }
      watchers.push(entry)
      if (options?.immediate) {
        cb(entry.last as any, undefined as any)
      }
    }
  }
}
