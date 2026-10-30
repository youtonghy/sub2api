/**
 * 分组用户 RPM 覆盖弹窗，对应 Vue 版 GroupRPMOverridesModal.vue。
 * 添加 / 修改 / 删除先在本地暂存，保存时一次性提交；"全部清空"直接调用清空接口。
 * RPM 必须是非负整数（0 表示不限制）。
 */
import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import type { GroupRPMOverrideEntry } from '@/api/admin/groups'
import { Button } from '@/components/arc/button/button'
import arcInput from '@/components/arc/input/input.module.css'
import BaseDialog from '@/components/common/BaseDialog'
import Pagination from '@/components/common/Pagination'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminGroup } from '@/types'
import { formNumberValue, toModelNumber, type FormNumber } from './groupForm'
import { GroupOverridesSummary, OverridesLoading, UserSearchField, UserStatusBadge } from './GroupOverridesParts'
import styles from './GroupOverrides.module.css'
import { useGroupUserSearch } from './useGroupUserSearch'

type LocalEntry = GroupRPMOverrideEntry

export interface GroupRPMOverridesModalProps {
  show: boolean
  group: AdminGroup | null
  onClose: () => void
  onSuccess: () => void
}

const cloneEntries = (entries: GroupRPMOverrideEntry[]): LocalEntry[] => entries.map((e) => ({ ...e }))

const invalidRpm = (value: FormNumber) =>
  value == null || !Number.isInteger(value) || (value as number) < 0

export default function GroupRPMOverridesModal({ show, group, onClose, onSuccess }: GroupRPMOverridesModalProps) {
  const { t } = useI18n()

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [serverEntries, setServerEntries] = useState<GroupRPMOverrideEntry[]>([])
  const [localEntries, setLocalEntries] = useState<LocalEntry[]>([])
  const [newRpm, setNewRpm] = useState<FormNumber>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const search = useGroupUserSearch()
  const loadVersion = useRef(0)

  const isDirty = (() => {
    if (localEntries.length !== serverEntries.length) return true
    const serverMap = new Map(serverEntries.map((e) => [e.user_id, e.rpm_override]))
    return localEntries.some((e) => serverMap.get(e.user_id) !== e.rpm_override)
  })()

  const paginatedLocalEntries = localEntries.slice((currentPage - 1) * pageSize, (currentPage - 1) * pageSize + pageSize)

  const adjustPage = (entries: LocalEntry[], size = pageSize) => {
    const totalPages = Math.max(1, Math.ceil(entries.length / size))
    setCurrentPage((page) => (page > totalPages ? totalPages : page))
  }

  const groupId = group?.id
  useEffect(() => {
    loadVersion.current++
    if (!show || !group) return
    const version = loadVersion.current
    /* eslint-disable react-hooks/set-state-in-effect -- 打开弹窗或切换分组时重置并加载 */
    setCurrentPage(1)
    search.reset()
    setNewRpm(null)
    setLoading(true)
    setServerEntries([])
    setLocalEntries([])
    /* eslint-enable react-hooks/set-state-in-effect */
    adminAPI.groups
      .getGroupRPMOverrides(group.id)
      .then((entries) => {
        if (version !== loadVersion.current) return
        setServerEntries(entries)
        const local = cloneEntries(entries)
        setLocalEntries(local)
        adjustPage(local, 10)
      })
      .catch((error) => {
        if (version !== loadVersion.current) return
        useAppStore.getState().showError(t('admin.groups.failedToLoad'))
        console.error('Error loading RPM overrides:', error)
      })
      .finally(() => {
        if (version === loadVersion.current) setLoading(false)
      })
    // 仅在 show 或分组 ID 变化时重新加载（Vue 版 watch [show, group.id]）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, groupId])

  useEffect(
    () => () => {
      loadVersion.current++
    },
    []
  )

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize)
    setCurrentPage(1)
  }

  const handleAddLocal = () => {
    const user = search.selectedUser
    if (!user || invalidRpm(newRpm)) return
    const entry: LocalEntry = {
      user_id: user.id,
      user_name: user.username || '',
      user_email: user.email,
      user_notes: user.notes || '',
      user_status: user.status || 'active',
      rpm_override: newRpm as number
    }
    const idx = localEntries.findIndex((e) => e.user_id === user.id)
    const next = idx >= 0 ? localEntries.map((e, i) => (i === idx ? entry : e)) : [...localEntries, entry]
    setLocalEntries(next)
    search.clearSelection()
    setNewRpm(null)
    adjustPage(next)
  }

  const updateLocalRpm = (userId: number, value: string) => {
    if (!value.trim()) return
    const num = Number(value)
    if (!Number.isInteger(num) || num < 0) return
    setLocalEntries(localEntries.map((e) => (e.user_id === userId ? { ...e, rpm_override: num } : e)))
  }

  const removeLocal = (userId: number) => {
    const next = localEntries.filter((e) => e.user_id !== userId)
    setLocalEntries(next)
    adjustPage(next)
  }

  const clearAllLocal = async () => {
    if (!group || clearing) return
    setClearing(true)
    try {
      await adminAPI.groups.clearGroupRPMOverrides(group.id)
      setLocalEntries([])
      setServerEntries([])
      useAppStore.getState().showSuccess(t('admin.groups.rpmSaved'))
    } catch (error) {
      useAppStore.getState().showError(t('admin.groups.failedToSave'))
      console.error('Error clearing RPM overrides:', error)
    } finally {
      setClearing(false)
    }
  }

  const handleCancel = () => {
    const local = cloneEntries(serverEntries)
    setLocalEntries(local)
    adjustPage(local)
  }

  const handleSave = async () => {
    if (!group) return
    setSaving(true)
    try {
      const entries = localEntries.map((e) => ({ user_id: e.user_id, rpm_override: e.rpm_override }))
      await adminAPI.groups.batchSetGroupRPMOverrides(group.id, entries)
      useAppStore.getState().showSuccess(t('admin.groups.rpmSaved'))
      onSuccess()
      onClose()
    } catch (error) {
      useAppStore.getState().showError(t('admin.groups.failedToSave'))
      console.error('Error saving RPM overrides:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    if (isDirty) {
      setLocalEntries(cloneEntries(serverEntries))
    }
    onClose()
  }

  const commitRpm = (userId: number, input: HTMLInputElement) => updateLocalRpm(userId, input.value)

  return (
    <BaseDialog show={show} title={t('admin.groups.rpmOverridesTitle')} width="wide" onClose={handleClose}>
      {group ? (
        <div className={styles.stack}>
          {/* 分组信息 */}
          <GroupOverridesSummary group={group} extra={`${t('admin.groups.groupRpmDefault')}: ${group.rpm_limit || 0}`} />

          {/* 操作区：添加用户 */}
          <div className={styles.panel}>
            <h4 className={styles.panelTitle}>{t('admin.groups.addUserRpm')}</h4>
            <div className={styles.addRow}>
              <UserSearchField search={search} />
              <div className={styles.numberCell}>
                <input
                  value={formNumberValue(newRpm)}
                  type="number"
                  step="1"
                  min="0"
                  autoComplete="off"
                  className={`${arcInput.input} ${styles.hideSpinner}`}
                  placeholder="100"
                  aria-label={t('admin.groups.columns.rpmOverride')}
                  onChange={(event) => setNewRpm(toModelNumber(event.target.value))}
                />
              </div>
              <Button
                type="button"
                variant="primary"
                disabled={!search.selectedUser || invalidRpm(newRpm)}
                onClick={handleAddLocal}
              >
                {t('common.add')}
              </Button>
            </div>
            {localEntries.length > 0 ? (
              <div className={`${styles.batchRow} ${styles.batchRowEnd}`}>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  loading={clearing}
                  disabled={clearing}
                  onClick={() => void clearAllLocal()}
                >
                  {t('admin.groups.clearAll')}
                </Button>
              </div>
            ) : null}
          </div>

          {/* 加载状态 */}
          {loading ? (
            <OverridesLoading />
          ) : (
            <div>
              {/* 列表 */}
              <h4 className={styles.listTitle}>
                {t('admin.groups.rpmOverrides')} ({localEntries.length})
              </h4>
              {localEntries.length === 0 ? (
                <div className={styles.empty}>{t('admin.groups.noRpmOverrides')}</div>
              ) : (
                <div>
                  <div className={styles.tableRegion}>
                    <div className={styles.tableScroll}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>{t('admin.groups.columns.userEmail')}</th>
                            <th>ID</th>
                            <th>{t('admin.groups.columns.userName')}</th>
                            <th>{t('admin.groups.columns.userNotes')}</th>
                            <th>{t('admin.groups.columns.userStatus')}</th>
                            <th title={t('admin.groups.columns.rpmOverrideHint')}>{t('admin.groups.columns.rpmOverride')}</th>
                            <th className={styles.actionCell} />
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedLocalEntries.map((entry) => (
                            <tr key={entry.user_id}>
                              <td>{entry.user_email}</td>
                              <td>{entry.user_id}</td>
                              <td className={styles.cellStrong}>{entry.user_name || '-'}</td>
                              <td className={styles.cellNotes} title={entry.user_notes}>
                                {entry.user_notes || '-'}
                              </td>
                              <td>
                                <UserStatusBadge status={entry.user_status} />
                              </td>
                              <td>
                                {/* 失焦或回车时提交（Vue 版 @change），无效值保留在输入框但不暂存 */}
                                <input
                                  key={`${entry.user_id}:${entry.rpm_override}`}
                                  type="number"
                                  step="1"
                                  min="0"
                                  autoComplete="off"
                                  defaultValue={entry.rpm_override}
                                  aria-label={t('admin.groups.columns.rpmOverride')}
                                  className={`${arcInput.input} ${styles.hideSpinner} ${styles.cellInput}`}
                                  onBlur={(event) => commitRpm(entry.user_id, event.currentTarget)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault()
                                      commitRpm(entry.user_id, event.currentTarget)
                                    }
                                  }}
                                />
                              </td>
                              <td className={styles.actionCell}>
                                <button
                                  type="button"
                                  className={styles.removeButton}
                                  aria-label={t('common.delete')}
                                  onClick={() => removeLocal(entry.user_id)}
                                >
                                  <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <Pagination
                    total={localEntries.length}
                    page={currentPage}
                    pageSize={pageSize}
                    onPageChange={setCurrentPage}
                    onPageSizeChange={handlePageSizeChange}
                  />
                </div>
              )}
            </div>
          )}

          {/* 底部 */}
          <div className={styles.footer}>
            {isDirty ? (
              <>
                <span className={styles.unsaved}>{t('admin.groups.unsavedChanges')}</span>
                <button type="button" className={styles.revert} onClick={handleCancel}>
                  {t('admin.groups.revertChanges')}
                </button>
              </>
            ) : null}
            <div className={styles.footerActions}>
              <Button type="button" variant="secondary" size="sm" onClick={handleClose}>
                {t('common.close')}
              </Button>
              {isDirty ? (
                <Button type="button" variant="primary" size="sm" loading={saving} disabled={saving} onClick={handleSave}>
                  {t('common.save')}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </BaseDialog>
  )
}
