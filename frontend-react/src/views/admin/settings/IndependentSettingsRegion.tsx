/** 独立保存的设置区域：加载中显示骨架，底部一行“保存”按钮（对应 Vue 版各卡片的保存区） */
import type { ReactNode } from 'react'

import { Button } from '@/components/arc/button/button'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { SettingsRegion } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { useI18n } from '@/i18n/useI18n'

export interface IndependentSettingsRegionProps {
  title: ReactNode
  description?: ReactNode
  loading: boolean
  saving: boolean
  onSave: () => void
  children?: ReactNode
  'data-testid'?: string
  saveTestId?: string
}

export default function IndependentSettingsRegion({
  title,
  description,
  loading,
  saving,
  onSave,
  children,
  'data-testid': testId,
  saveTestId
}: IndependentSettingsRegionProps) {
  const { t } = useI18n()
  return (
    <SettingsRegion title={title} description={description} data-testid={testId}>
      {loading ? (
        <Skeleton label={t('common.loading')} lines={2} />
      ) : (
        <>
          {children}
          <div className={s.inlineEnd}>
            <Button type="button" size="sm" loading={saving} disabled={saving} data-testid={saveTestId} onClick={onSave}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </>
      )}
    </SettingsRegion>
  )
}
