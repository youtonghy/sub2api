/**
 * 选择我的 API Key，对应 Vue 版 MonitorKeyPickerDialog.vue：只列出分组平台与当前服务商一致的 Key，
 * 支持按名称 / Key / 分组名搜索，点击行即选中；关闭时清空搜索词。
 */
import { useState } from 'react'

import type { Provider } from '@/api/admin/channelMonitor'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import GroupBadge from '@/components/common/GroupBadge'
import SearchInput from '@/components/common/SearchInput'
import { useI18n } from '@/i18n/useI18n'
import type { ApiKey } from '@/types'
import { maskApiKey } from '@/utils/maskApiKey'
import styles from './MonitorKeyPickerDialog.module.css'

export interface MonitorKeyPickerDialogProps {
  show: boolean
  loading: boolean
  keys: ApiKey[]
  provider: Provider
  /** 默认 {} */
  userGroupRates?: Record<number, number>
  onClose?: () => void
  onPick?: (key: ApiKey) => void
}

export default function MonitorKeyPickerDialog({
  show,
  loading,
  keys,
  provider,
  userGroupRates = {},
  onClose,
  onPick
}: MonitorKeyPickerDialogProps) {
  const { t } = useI18n()
  const [search, setSearch] = useState('')

  // 关闭时清空搜索词（Vue 版 watch(show)）
  const [lastShow, setLastShow] = useState(show)
  if (lastShow !== show) {
    setLastShow(show)
    if (!show) setSearch('')
  }

  const q = search.trim().toLowerCase()
  const filteredKeys = keys.filter((k) => {
    if (k.group?.platform !== provider) return false
    if (!q) return true
    return k.name.toLowerCase().includes(q) || k.key.toLowerCase().includes(q) || (k.group?.name || '').toLowerCase().includes(q)
  })

  return (
    <BaseDialog
      show={show}
      title={t('admin.channelMonitor.form.selectKeyTitle')}
      width="wide"
      onClose={onClose}
      footer={
        <Button type="button" variant="secondary" onClick={() => onClose?.()}>
          {t('common.cancel')}
        </Button>
      }
    >
      <div className={styles.stack}>
        <p className={styles.hint}>{t('admin.channelMonitor.form.selectKeyHint')}</p>
        <SearchInput value={search} placeholder={t('keys.searchPlaceholder')} onChange={setSearch} />

        {loading ? (
          <p className={styles.empty}>{t('common.loading')}</p>
        ) : filteredKeys.length === 0 ? (
          <p className={styles.empty}>{t('admin.channelMonitor.form.noActiveKey')}</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th>{t('keys.apiKey')}</th>
                  <th>{t('keys.group')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredKeys.map((k) => (
                  <tr
                    key={k.id}
                    tabIndex={0}
                    onClick={() => onPick?.(k)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onPick?.(k)
                      }
                    }}
                  >
                    <td className={styles.name}>{k.name}</td>
                    <td className={styles.key}>{maskApiKey(k.key)}</td>
                    <td>
                      {k.group ? (
                        <GroupBadge
                          name={k.group.name}
                          platform={k.group.platform}
                          subscriptionType={k.group.subscription_type}
                          rateMultiplier={k.group.rate_multiplier}
                          userRateMultiplier={userGroupRates[k.group.id]}
                        />
                      ) : (
                        <span className={styles.none}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </BaseDialog>
  )
}
