import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'

import { adminAPI } from '@/api/admin'
import type { UpstreamGroupSource } from '@/api/admin/accounts'
import Toggle from '@/components/common/Toggle'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import styles from './UpstreamGroupSyncButton.module.css'

export interface UpstreamGroupSyncButtonProps {
  /** 探测来源：已保存账号用 account_id，新填写的凭据用 base_url + api_key；null 时按钮禁用 */
  source: UpstreamGroupSource | null
  name: string
  notes: string
  onNameChange: (name: string) => void
  onNotesChange: (notes: string) => void
  /** 是否展示"自动同步"开关（仅 api_key 账号） */
  allowAuto?: boolean
  auto?: boolean
  onAutoChange?: (enabled: boolean) => void
}

/** 从上游分组同步账号名称与备注：只覆盖请求期间未被手动改动的字段 */
export default function UpstreamGroupSyncButton({
  source,
  name,
  notes,
  onNameChange,
  onNotesChange,
  allowAuto,
  auto = false,
  onAutoChange
}: UpstreamGroupSyncButtonProps) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const request = useRef<AbortController | undefined>(undefined)
  // 请求返回时要和"最新"的表单值比较，判断用户是否在请求期间改过
  const latest = useRef({ name, notes })
  useEffect(() => {
    latest.current = { name, notes }
  }, [name, notes])

  // 来源变化（换地址 / 密钥 / 代理）或卸载时丢弃在途请求。
  // 父组件每次渲染都可能新建 source 对象，按内容比较而非引用。
  const sourceKey = source ? JSON.stringify(source) : ''
  useEffect(() => () => request.current?.abort(), [sourceKey])

  const sync = async () => {
    if (!source || loading) return
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    const previousName = latest.current.name
    const previousNotes = latest.current.notes
    try {
      const fields = await adminAPI.accounts.previewUpstreamGroup(source, controller.signal)
      if (controller.signal.aborted) return
      if (!fields.name && !fields.notes) {
        useAppStore.getState().showInfo(t('admin.accounts.upstreamBilling.groupUnavailable'))
        return
      }
      if (fields.name && latest.current.name === previousName) onNameChange(fields.name)
      if (fields.notes && latest.current.notes === previousNotes) onNotesChange(fields.notes)
    } catch {
      if (!controller.signal.aborted) useAppStore.getState().showError(t('admin.accounts.upstreamBilling.groupFailed'))
    } finally {
      if (request.current === controller) {
        request.current = undefined
        setLoading(false)
      }
    }
  }

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.syncButton}
        disabled={!source || loading}
        title={!source ? t('admin.accounts.upstreamBilling.groupCredentials') : undefined}
        onClick={() => void sync()}
        data-testid="upstream-group-sync"
      >
        <RefreshCw size={12} aria-hidden="true" className={loading ? styles.spin : undefined} />
        {t('admin.accounts.upstreamBilling.syncGroup')}
      </button>
      {allowAuto ? (
        <span className={styles.auto} title={t('admin.accounts.upstreamBilling.autoSyncGroupHint')} data-testid="upstream-billing-group-sync">
          {t('admin.accounts.upstreamBilling.autoSyncGroup')}
          <Toggle
            value={auto}
            onChange={(enabled) => onAutoChange?.(enabled)}
            aria-label={t('admin.accounts.upstreamBilling.autoSyncGroup')}
          />
        </span>
      ) : null}
    </div>
  )
}
