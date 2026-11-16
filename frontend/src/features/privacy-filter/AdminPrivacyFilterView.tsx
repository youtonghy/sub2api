/**
 * 管理端隐私过滤页：「过滤记录」看全站命中记录，「过滤设置」配置模式、类别与生效分组。
 * 页面标题与说明来自路由 meta，由 AppLayout 渲染。
 */
import { useEffect, useState } from 'react'

import { adminAPI } from '@/api/admin'
import { Tabs, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminGroup } from '@/types'
import { extractApiErrorMessage } from '@/utils/apiError'
import { adminPrivacyFilterAPI } from './api'
import PrivacyFilterEvents from './components/PrivacyFilterEvents'
import PrivacyFilterPanel from './components/PrivacyFilterPanel'
import styles from './privacyFilter.module.css'

type PrivacyFilterTab = 'records' | 'settings'

export default function AdminPrivacyFilterView() {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<PrivacyFilterTab>('records')
  const [groups, setGroups] = useState<AdminGroup[]>([])

  useEffect(() => {
    let cancelled = false
    adminAPI.groups
      .getAll()
      .then((next) => {
        if (!cancelled) setGroups(next)
      })
      .catch((err) => {
        if (!cancelled) useAppStore.getState().showError(extractApiErrorMessage(err, t('privacyFilter.loadFailed')))
      })
    return () => {
      cancelled = true
    }
  }, [t])

  return (
    <div className={styles.page}>
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PrivacyFilterTab)}>
        <TabsList aria-label={t('privacyFilter.title')}>
          <TabsTrigger value="records" data-test="tab-records">
            {t('privacyFilter.tabs.records')}
          </TabsTrigger>
          <TabsTrigger value="settings" data-test="tab-settings">
            {t('privacyFilter.tabs.settings')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* 两个面板都保持挂载，切换页签不丢筛选条件和未保存的设置 */}
      <div role="tabpanel" data-test="tab-panel-records" hidden={activeTab !== 'records'}>
        <PrivacyFilterEvents variant="admin" fetchEvents={adminPrivacyFilterAPI.listEvents} />
      </div>
      <div role="tabpanel" data-test="tab-panel-settings" hidden={activeTab !== 'settings'}>
        <PrivacyFilterPanel groups={groups} />
      </div>
    </div>
  )
}
