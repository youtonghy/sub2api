import { useCallback, useRef, useState } from 'react'

import { getUserBreakdown, type UserBreakdownParams } from '@/api/admin/dashboard'
import type { UserBreakdownItem } from '@/types'

/**
 * 分布图行内展开的用户明细（对应 Vue 版各图表内的 toggleBreakdown）。
 * 再次点击同一行收起；展开新行时清空旧数据并请求；请求失败显示为空。
 * 只采纳最后一次展开的响应，快速切换行时旧响应不会覆盖新行。
 */
export function useUserBreakdown() {
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [items, setItems] = useState<UserBreakdownItem[]>([])
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  const toggle = useCallback(async (key: string, params: UserBreakdownParams) => {
    if (expandedKey === key) {
      seq.current++
      setExpandedKey(null)
      setLoading(false)
      return
    }
    const current = ++seq.current
    setExpandedKey(key)
    setLoading(true)
    setItems([])
    try {
      const res = await getUserBreakdown(params)
      if (current !== seq.current) return
      setItems(res.users || [])
    } catch {
      if (current !== seq.current) return
      setItems([])
    } finally {
      if (current === seq.current) setLoading(false)
    }
  }, [expandedKey])

  return { expandedKey, items, loading, toggle }
}
