import { useCallback, useMemo, useRef, useState } from 'react'

interface UseTableSelectionOptions<T> {
  /** 当前可见行（Vue 版为 Ref<T[]>，这里直接传数组） */
  rows: T[]
  getId: (row: T) => number
}

/**
 * 表格多选状态，对应 Vue 版 useTableSelection。
 * 内部用 ref 保存最新集合，同一事件里连续调用（如滑动多选的 batchUpdate）不会读到旧值。
 */
export function useTableSelection<T>({ rows, getId }: UseTableSelectionOptions<T>) {
  const [selectedSet, setSelectedSetState] = useState<Set<number>>(() => new Set())
  const latest = useRef(selectedSet)

  const replaceSelectedSet = useCallback((next: Set<number>) => {
    latest.current = next
    setSelectedSetState(next)
  }, [])

  const selectedIds = useMemo(() => Array.from(selectedSet), [selectedSet])
  const selectedCount = selectedSet.size

  const isSelected = useCallback((id: number) => latest.current.has(id), [])

  const setSelectedIds = useCallback((ids: number[]) => replaceSelectedSet(new Set(ids)), [replaceSelectedSet])

  const select = useCallback(
    (id: number) => {
      if (latest.current.has(id)) return
      const next = new Set(latest.current)
      next.add(id)
      replaceSelectedSet(next)
    },
    [replaceSelectedSet]
  )

  const deselect = useCallback(
    (id: number) => {
      if (!latest.current.has(id)) return
      const next = new Set(latest.current)
      next.delete(id)
      replaceSelectedSet(next)
    },
    [replaceSelectedSet]
  )

  const toggle = useCallback(
    (id: number) => {
      if (latest.current.has(id)) deselect(id)
      else select(id)
    },
    [select, deselect]
  )

  const clear = useCallback(() => {
    if (latest.current.size === 0) return
    replaceSelectedSet(new Set())
  }, [replaceSelectedSet])

  const removeMany = useCallback(
    (ids: number[]) => {
      if (ids.length === 0 || latest.current.size === 0) return
      const next = new Set(latest.current)
      let changed = false
      ids.forEach((id) => {
        if (next.delete(id)) changed = true
      })
      if (changed) replaceSelectedSet(next)
    },
    [replaceSelectedSet]
  )

  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedSet.has(getId(row)))

  const toggleVisible = (checked: boolean) => {
    const next = new Set(latest.current)
    rows.forEach((row) => {
      const id = getId(row)
      if (checked) next.add(id)
      else next.delete(id)
    })
    replaceSelectedSet(next)
  }

  const batchUpdate = useCallback(
    (updater: (draft: Set<number>) => void) => {
      const draft = new Set(latest.current)
      updater(draft)
      replaceSelectedSet(draft)
    },
    [replaceSelectedSet]
  )

  const selectVisible = () => toggleVisible(true)

  return {
    selectedSet,
    selectedIds,
    selectedCount,
    allVisibleSelected,
    isSelected,
    setSelectedIds,
    select,
    deselect,
    toggle,
    clear,
    removeMany,
    toggleVisible,
    selectVisible,
    batchUpdate
  }
}
