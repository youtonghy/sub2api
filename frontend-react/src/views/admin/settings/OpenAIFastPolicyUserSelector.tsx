/**
 * OpenAI Fast/Flex 策略的用户选择器（对应 Vue 版 OpenAIFastPolicyUserSelector.vue）。
 * 值仍是用户 ID 列表，显示时按 ID 拉取邮箱；v-model 改为 value + onChange。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

import { adminAPI } from '@/api/admin'
import type { SimpleUser } from '@/api/admin/usage'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { useI18n } from '@/i18n/useI18n'
import styles from './OpenAIFastPolicyUserSelector.module.css'

export interface OpenAIFastPolicyUserSelectorProps {
  value: number[]
  onChange: (value: number[]) => void
}

export default function OpenAIFastPolicyUserSelector({ value, onChange }: OpenAIFastPolicyUserSelectorProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SimpleUser[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedUsers, setSelectedUsers] = useState<Record<number, SimpleUser>>({})
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSequence = useRef(0)
  const valueRef = useRef(value)

  const selectedUserIds = useMemo(
    () => Array.from(new Set(value.filter((id) => Number.isInteger(id) && id > 0))),
    [value]
  )
  const selectedKey = selectedUserIds.join(',')

  const availableResults = useMemo(() => {
    const selected = new Set(selectedUserIds)
    return searchResults
      .filter((user) => !selected.has(user.id))
      .sort((a, b) => Number(a.deleted) - Number(b.deleted))
  }, [searchResults, selectedUserIds])

  function selectedUserLabel(userId: number): string {
    return selectedUsers[userId]?.email || t('admin.settings.openaiFastPolicy.userIdFallback', { id: userId })
  }

  function clearPendingSearch(): void {
    if (searchTimer.current) {
      clearTimeout(searchTimer.current)
      searchTimer.current = null
    }
    searchSequence.current += 1
  }

  function debounceSearch(query: string): void {
    clearPendingSearch()
    const trimmed = query.trim()
    setShowDropdown(true)
    if (!trimmed) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }

    const sequence = searchSequence.current
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const results = await adminAPI.usage.searchUsers(trimmed)
        if (sequence === searchSequence.current) setSearchResults(results)
      } catch {
        if (sequence === searchSequence.current) setSearchResults([])
      } finally {
        if (sequence === searchSequence.current) setSearchLoading(false)
      }
    }, 300)
  }

  function selectUser(user: SimpleUser): void {
    setSelectedUsers((prev) => ({ ...prev, [user.id]: user }))
    onChange([...selectedUserIds, user.id])
    clearPendingSearch()
    setSearchQuery('')
    setSearchResults([])
    setSearchLoading(false)
    setShowDropdown(false)
  }

  function removeUser(userId: number): void {
    onChange(selectedUserIds.filter((id) => id !== userId))
  }

  // 已选 ID 变化时补齐邮箱（对应 Vue 版 watch(selectedUserIds, immediate)）
  const selectedUsersRef = useRef(selectedUsers)
  useEffect(() => {
    valueRef.current = value
    selectedUsersRef.current = selectedUsers
  })
  useEffect(() => {
    const ids = selectedKey ? selectedKey.split(',').map(Number) : []
    const missing = ids.filter((id) => !selectedUsersRef.current[id])
    if (missing.length === 0) return
    let cancelled = false
    void Promise.all(
      missing.map(async (id) => {
        try {
          const user = await adminAPI.users.getById(id, true)
          return { id: user.id, email: user.email, deleted: Boolean(user.deleted_at) } satisfies SimpleUser
        } catch {
          return null
        }
      })
    ).then((users) => {
      if (cancelled) return
      setSelectedUsers((prev) => {
        const next = { ...prev }
        for (const user of users) {
          if (user && valueRef.current.includes(user.id)) next[user.id] = user
        }
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [selectedKey])

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent): void {
      const target = event.target as Node | null
      if (target && !containerRef.current?.contains(target)) setShowDropdown(false)
    }
    document.addEventListener('click', handleDocumentClick)
    return () => {
      document.removeEventListener('click', handleDocumentClick)
      if (searchTimer.current) clearTimeout(searchTimer.current)
      searchSequence.current += 1
    }
  }, [])

  return (
    <div ref={containerRef} className={styles.root}>
      {selectedUserIds.length > 0 ? (
        <div className={s.chips}>
          {selectedUserIds.map((userId) => (
            <span key={userId} className={styles.selected}>
              <span className={styles.selectedLabel} title={selectedUserLabel(userId)}>
                {selectedUserLabel(userId)}
              </span>
              <span className={s.muted}>#{userId}</span>
              {selectedUsers[userId]?.deleted ? (
                <span className={s.muted}>{t('admin.settings.openaiFastPolicy.userDeleted')}</span>
              ) : null}
              <button
                type="button"
                className={s.chipRemove}
                aria-label={t('admin.settings.openaiFastPolicy.removeUser')}
                title={t('admin.settings.openaiFastPolicy.removeUser')}
                onClick={() => removeUser(userId)}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className={styles.searchBox}>
        <Search size={14} className={styles.searchIcon} aria-hidden="true" />
        <input
          value={searchQuery}
          type="text"
          autoComplete="off"
          className={`${s.input} ${styles.searchInput}`}
          placeholder={t('admin.settings.openaiFastPolicy.userSearchPlaceholder')}
          onChange={(event) => {
            setSearchQuery(event.target.value)
            debounceSearch(event.target.value)
          }}
          onFocus={() => setShowDropdown(true)}
        />
      </div>

      {showDropdown && searchQuery.trim() ? (
        <div className={styles.dropdown}>
          {searchLoading ? (
            <div className={styles.dropdownMessage}>{t('common.loading')}</div>
          ) : availableResults.length === 0 ? (
            <div className={styles.dropdownMessage}>{t('admin.settings.openaiFastPolicy.userSearchEmpty')}</div>
          ) : (
            availableResults.map((user) => (
              <button key={user.id} type="button" className={styles.option} onClick={() => selectUser(user)}>
                <span className={styles.optionLabel}>
                  {user.email}
                  {user.deleted ? <span className={s.muted}> {t('admin.settings.openaiFastPolicy.userDeleted')}</span> : null}
                </span>
                <span className={s.muted}>#{user.id}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
