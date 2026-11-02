/**
 * 替换专属分组弹窗，对应 Vue 版 GroupReplaceModal.vue：
 * 从其他启用的专属标准分组中选一个替换当前分组，迁移该用户绑定在旧分组上的 API Key。
 */
import { ArrowRight, Shield } from 'lucide-react'
import { useEffect, useState } from 'react'

import { adminAPI } from '@/api/admin'
import { Button } from '@/components/arc/button/button'
import { RadioGroup } from '@/components/arc/radio-group/radio-group'
import BaseDialog from '@/components/common/BaseDialog'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminGroup, AdminUser } from '@/types'
import { extractApiErrorMessage } from '@/utils/apiError'
import styles from './GroupReplaceModal.module.css'

export interface GroupReplaceModalProps {
  show: boolean
  user: AdminUser | null
  oldGroup: { id: number; name: string } | null
  allGroups: AdminGroup[]
  onClose?: () => void
  onSuccess?: () => void
}

export default function GroupReplaceModal({ show, user, oldGroup, allGroups, onClose, onSuccess }: GroupReplaceModalProps) {
  const { t } = useI18n()
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 可选的专属标准分组（排除当前 oldGroup）
  const availableGroups = oldGroup
    ? allGroups.filter(
        (g) => g.status === 'active' && g.is_exclusive && g.subscription_type === 'standard' && g.id !== oldGroup.id
      )
    : []

  useEffect(() => {
    if (!show) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 对应 Vue 版 watch(show)：打开时清空选择
    setSelectedGroupId(null)
  }, [show])

  const handleReplace = async () => {
    if (!user || !oldGroup || !selectedGroupId) return
    setSubmitting(true)
    const appStore = useAppStore.getState()
    try {
      const result = await adminAPI.users.replaceGroup(user.id, oldGroup.id, selectedGroupId)
      appStore.showSuccess(t('admin.users.replaceGroupSuccess', { count: result.migrated_keys }))
      onSuccess?.()
      onClose?.()
    } catch (error) {
      appStore.showError(extractApiErrorMessage(error, t('common.error')))
      console.error('Failed to replace group:', error)
    } finally {
      setSubmitting(false)
    }
  }

  const selectedName = availableGroups.find((g) => g.id === selectedGroupId)?.name

  return (
    <BaseDialog
      show={show}
      title={t('admin.users.replaceGroupTitle')}
      width="narrow"
      onClose={() => onClose?.()}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onClose?.()}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!selectedGroupId || submitting}
            loading={submitting}
            data-testid="group-replace-confirm"
            onClick={() => void handleReplace()}
          >
            {submitting ? t('common.saving') : t('admin.users.replaceGroupConfirm')}
          </Button>
        </>
      }
    >
      {oldGroup && (
        <div className={styles.content}>
          {/* 提示信息 */}
          <p className={styles.hint}>{t('admin.users.replaceGroupHint', { old: oldGroup.name })}</p>

          {/* 当前分组 */}
          <div className={styles.summary}>
            <Shield size={16} strokeWidth={1.75} className={styles.summaryIcon} aria-hidden="true" />
            <span className={styles.oldName}>{oldGroup.name}</span>
            <ArrowRight size={16} strokeWidth={1.75} className={styles.arrow} aria-hidden="true" />
            {selectedGroupId ? (
              <span className={styles.newName}>{selectedName}</span>
            ) : (
              <span className={styles.placeholder}>?</span>
            )}
          </div>

          {/* 可选分组列表 */}
          {availableGroups.length > 0 ? (
            <div className={styles.options}>
              <RadioGroup
                label={t('admin.users.groups')}
                value={selectedGroupId == null ? '' : String(selectedGroupId)}
                onValueChange={(value) => setSelectedGroupId(Number(value))}
                options={availableGroups.map((group) => ({
                  value: String(group.id),
                  label: group.name,
                  description: group.platform
                }))}
              />
            </div>
          ) : (
            // 无可选分组
            <p className={styles.empty}>{t('admin.users.noOtherGroups')}</p>
          )}
        </div>
      )}
    </BaseDialog>
  )
}
