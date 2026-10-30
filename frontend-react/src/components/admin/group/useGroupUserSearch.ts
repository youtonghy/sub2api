/**
 * 分组专属倍率 / RPM 覆盖弹窗共用的用户搜索：输入防抖 300ms 后按邮箱或用户名搜索，
 * 选中后把邮箱回填到输入框；点击页面任意位置收起下拉；卸载时取消排队中的搜索。
 */
import { useEffect, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import type { AdminUser } from '@/types'

export function useGroupUserSearch() {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<AdminUser[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    // 点击外部关闭下拉
    const handleClickOutside = () => setShowDropdown(false)
    document.addEventListener('click', handleClickOutside)
    return () => {
      clearTimeout(searchTimeout.current)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [])

  const handleSearchUsers = (query: string) => {
    setSearchQuery(query)
    clearTimeout(searchTimeout.current)
    setSelectedUser(null)
    if (!query.trim()) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await adminAPI.users.list(1, 10, { search: query.trim() })
        setSearchResults(res.items)
        setShowDropdown(true)
      } catch {
        setSearchResults([])
      }
    }, 300)
  }

  const selectUser = (user: AdminUser) => {
    setSelectedUser(user)
    setSearchQuery(user.email)
    setShowDropdown(false)
    setSearchResults([])
  }

  /** 打开弹窗或切换分组时清空搜索 */
  const reset = () => {
    setSearchQuery('')
    setSearchResults([])
    setSelectedUser(null)
  }

  /** 添加成功后清空输入与选中用户（保留结果列表，与 Vue 版一致） */
  const clearSelection = () => {
    setSearchQuery('')
    setSelectedUser(null)
  }

  return {
    searchQuery,
    searchResults,
    showDropdown,
    setShowDropdown,
    selectedUser,
    handleSearchUsers,
    selectUser,
    reset,
    clearSelection
  }
}
