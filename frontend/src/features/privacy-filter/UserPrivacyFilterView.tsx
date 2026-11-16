/**
 * 用户端隐私过滤页：只读，列出当前用户自己的请求命中隐私过滤的记录。
 * 页面标题与说明来自路由 meta，由 AppLayout 渲染。
 */
import { useEffect, useState } from 'react'

import { keysAPI } from '@/api'
import type { SelectOption } from '@/components/common/Select'
import { userPrivacyFilterAPI } from './api'
import PrivacyFilterEvents from './components/PrivacyFilterEvents'
import styles from './privacyFilter.module.css'

/** 与使用记录页一致，筛选下拉只取前 100 个密钥 */
const API_KEY_OPTION_LIMIT = 100

export default function UserPrivacyFilterView() {
  const [apiKeyOptions, setApiKeyOptions] = useState<SelectOption[]>([])

  useEffect(() => {
    let cancelled = false
    keysAPI
      .list(1, API_KEY_OPTION_LIMIT)
      .then((page) => {
        if (!cancelled) setApiKeyOptions(page.items.map((key) => ({ value: key.id, label: key.name })))
      })
      .catch((err) => {
        // 密钥下拉只是筛选辅助，加载失败时列表仍可用，不打断用户
        console.error('Failed to load API keys for privacy filter records:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className={styles.page}>
      <PrivacyFilterEvents variant="user" fetchEvents={userPrivacyFilterAPI.listEvents} apiKeyOptions={apiKeyOptions} />
    </div>
  )
}
