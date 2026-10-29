/**
 * 模型核验页，对应 Vue 版 ModelVerificationView.vue。
 * 先加载全部账号（lite），按所选平台过滤后交给 ModelFingerprintPanel。
 * 页面标题由顶栏显示，这里只保留说明文字与平台选择。
 */
import { Filter } from 'lucide-react'
import { useMemo, useState } from 'react'

import { adminAPI } from '@/api/admin'
import ModelFingerprintPanel from '@/components/admin/account/ModelFingerprintPanel'
import Select from '@/components/common/Select'
import TablePageLayout from '@/components/common/TablePageLayout'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import type { Account } from '@/types'
import styles from './ModelVerificationView.module.css'

export default function ModelVerificationView() {
  const { t } = useI18n()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [platform, setPlatform] = useState('')

  const providerOptions = useMemo(() => {
    const platforms = Array.from(new Set(accounts.map((account) => account.platform).filter(Boolean))).sort()
    return [
      { value: '', label: t('admin.accounts.modelFingerprint.selectProviderOption') },
      ...platforms.map((value) => ({ value, label: value }))
    ]
  }, [accounts, t])

  const filteredAccounts = useMemo(
    () => (platform ? accounts.filter((account) => account.platform === platform) : []),
    [accounts, platform]
  )

  useMountOnce(async () => {
    try {
      const result = await adminAPI.accounts.list(1, 1000, { lite: 'true' })
      setAccounts(result.items || [])
    } catch {
      setAccounts([])
    }
  })

  return (
    <TablePageLayout
      filters={
        <div className={styles.toolbar}>
          <p className={styles.description}>{t('admin.accounts.modelFingerprint.description')}</p>
          <div className={styles.provider}>
            <span className={styles.label}>{t('admin.accounts.modelFingerprint.provider')}</span>
            <Select
              value={platform}
              options={providerOptions}
              aria-label={t('admin.accounts.modelFingerprint.provider')}
              onChange={(value) => setPlatform(String(value ?? ''))}
            />
          </div>
        </div>
      }
      table={
        <div className={styles.region}>
          {!platform ? (
            <div className={styles.placeholder}>
              <Filter size={24} className={styles.placeholderIcon} aria-hidden="true" />
              <div>
                <p className={styles.placeholderTitle}>{t('admin.accounts.modelFingerprint.selectProvider')}</p>
                <p className={styles.placeholderHint}>{t('admin.accounts.modelFingerprint.selectProviderHint')}</p>
              </div>
            </div>
          ) : (
            <ModelFingerprintPanel accounts={filteredAccounts} platform={platform} active />
          )}
        </div>
      }
    />
  )
}
