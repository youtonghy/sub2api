import { useState, useSyncExternalStore } from 'react'

/**
 * 可订阅的可变状态，用于移植 Vue 组合式函数中的 ref 状态。
 * 异步方法总是读取最新值（不受闭包旧值影响），组件通过 useObservable 订阅后在变化时重新渲染。
 */
export interface ObservableState<T extends object> {
  /** 当前快照（每次 set 都会生成新对象） */
  get: () => T
  set: (patch: Partial<T>) => void
  subscribe: (listener: () => void) => () => void
}

export function createObservableState<T extends object>(initial: T): ObservableState<T> {
  let snapshot = { ...initial }
  const listeners = new Set<() => void>()
  return {
    get: () => snapshot,
    set: (patch) => {
      snapshot = { ...snapshot, ...patch }
      listeners.forEach((listener) => listener())
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

/** 订阅 createObservableState 生成的状态，变化时重新渲染 */
export function useObservable<T extends object>(state: ObservableState<T>): T {
  return useSyncExternalStore(state.subscribe, state.get, state.get)
}

/**
 * 创建一次实例并订阅其状态。factory 返回的对象需带 `observable` 字段。
 * 返回的实例引用稳定；读取其 getter 总是得到最新值。
 */
export function useObservableInstance<I extends { observable: ObservableState<object> }>(factory: () => I): I {
  const [instance] = useState(factory)
  useObservable(instance.observable)
  return instance
}
