/**
 * 分组专属倍率弹窗，对应 Vue 版 GroupRateMultipliersModal.vue。
 * 所有修改先在本地暂存（添加 / 改倍率 / 删除 / 批量乘数 / 清空），保存时一次性提交；关闭时丢弃未保存的修改。
 * 只展示已设置 rate_multiplier 的条目，rpm_override 由 GroupRPMOverridesModal 管理。
 */
import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import type { GroupRateMultiplierEntry } from '@/api/admin/groups'
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

type LocalEntry = GroupRateMultiplierEntry

export interface GroupRateMultipliersModalProps {
  show: boolean
  group: AdminGroup | null
  onClose: () => void
  onSuccess: () => void
}

const cloneEntries = (entries: GroupRateMultiplierEntry[]): LocalEntry[] => entries.map((e) => ({ ...e }))

// 与 Vue 模板中 `newRate <= 0` 的 JS 比较语义一致（"" 视为 0）
const notPositive = (value: FormNumber) => value == null || (value as number) <= 0

export default function GroupRateMultipliersModal({ show, group, onClose, onSuccess }: GroupRateMultipliersModalProps) {
  const { t } = useI18n()

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverEntries, setServerEntries] = useState<GroupRateMultiplierEntry[]>([])
  const [localEntries, setLocalEntries] = useState<LocalEntry[]>([])
  const [newRate, setNewRate] = useState<FormNumber>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [batchFactor, setBatchFactor] = useState<FormNumber>(null)
  const search = useGroupUserSearch()
  const loadVersion = useRef(0)

  // 是否显示"最终倍率"预览列
  const showFinalRate = batchFactor != null && (batchFactor as number) > 0 && batchFactor !== 1

  // 计算最终倍率预览
  const computeFinalRate = (rate: number | null | undefined) => {
    const base = rate ?? group?.rate_multiplier ?? 1
    if (!batchFactor) return base
    return parseFloat((base * Number(batchFactor)).toFixed(6))
  }

  // 检测是否有未保存的修改
  const isDirty = (() => {
    if (localEntries.length !== serverEntries.length) return true
    const serverMap = new Map(serverEntries.map((e) => [e.user_id, e.rate_multiplier ?? null]))
    return localEntries.some((e) => serverMap.get(e.user_id) !== (e.rate_multiplier ?? null))
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
    setBatchFactor(null)
    search.reset()
    setNewRate(null)
    setLoading(true)
    setServerEntries([])
    setLocalEntries([])
    /* eslint-enable react-hooks/set-state-in-effect */
    adminAPI.groups
      .getGroupRateMultipliers(group.id)
      .then((raw) => {
        if (version !== loadVersion.current) return
        // 仅显示已设置 rate_multiplier 的条目；rpm_override 在另一个弹窗管理，保留不动
        const entries = raw.filter((e) => e.rate_multiplier != null)
        setServerEntries(entries)
        const local = cloneEntries(entries)
        setLocalEntries(local)
        adjustPage(local, 10)
      })
      .catch((error) => {
        if (version !== loadVersion.current) return
        useAppStore.getState().showError(t('admin.groups.failedToLoad'))
        console.error('Error loading group rate multipliers:', error)
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

  // 本地添加（或覆盖已有用户）
  const handleAddLocal = () => {
    const user = search.selectedUser
    if (!user || notPositive(newRate)) return
    const entry: LocalEntry = {
      user_id: user.id,
      user_name: user.username || '',
      user_email: user.email,
      user_notes: user.notes || '',
      user_status: user.status || 'active',
      rate_multiplier: newRate as number,
      rpm_override: null
    }
    const idx = localEntries.findIndex((e) => e.user_id === user.id)
    const next = idx >= 0 ? localEntries.map((e, i) => (i === idx ? entry : e)) : [...localEntries, entry]
    setLocalEntries(next)
    search.clearSelection()
    setNewRate(null)
    adjustPage(next)
  }

  // 本地修改倍率
  const updateLocalRate = (userId: number, value: string) => {
    const index = localEntries.findIndex((e) => e.user_id === userId)
    if (index < 0) return
    let rate: number | null
    if (value.trim() === '') {
      rate = null
    } else {
      const num = parseFloat(value)
      if (!Number.isFinite(num) || num <= 0) return
      rate = num
    }
    setLocalEntries(localEntries.map((e, i) => (i === index ? { ...e, rate_multiplier: rate } : e)))
  }

  // 本地删除
  const removeLocal = (userId: number) => {
    const next = localEntries.filter((e) => e.user_id !== userId)
    setLocalEntries(next)
    adjustPage(next)
  }

  // 批量乘数应用到本地
  const applyBatchFactor = () => {
    if (!batchFactor || (batchFactor as number) <= 0) return
    const factor = Number(batchFactor)
    setLocalEntries(
      localEntries.map((entry) =>
        entry.rate_multiplier != null
          ? { ...entry, rate_multiplier: parseFloat((entry.rate_multiplier * factor).toFixed(6)) }
          : entry
      )
    )
    setBatchFactor(null)
  }

  // 本地清空
  const clearAllLocal = () => setLocalEntries([])

  // 取消：恢复到服务器数据
  const handleCancel = () => {
    const local = cloneEntries(serverEntries)
    setLocalEntries(local)
    setBatchFactor(null)
    adjustPage(local)
  }

  // 保存：一次性提交所有数据（只提交 rate_multiplier；rpm_override 由独立弹窗管理）
  const handleSave = async () => {
    if (!group) return
    setSaving(true)
    try {
      const entries = localEntries
        .filter((e) => e.rate_multiplier != null)
        .map((e) => ({ user_id: e.user_id, rate_multiplier: e.rate_multiplier as number }))
      await adminAPI.groups.batchSetGroupRateMultipliers(group.id, entries)
      useAppStore.getState().showSuccess(t('admin.groups.rateSaved'))
      onSuccess()
      onClose()
    } catch (error) {
      useAppStore.getState().showError(t('admin.groups.failedToSave'))
      console.error('Error saving rate multipliers:', error)
    } finally {
      setSaving(false)
    }
  }

  // 关闭时如果有未保存修改，先恢复
  const handleClose = () => {
    if (isDirty) {
      setLocalEntries(cloneEntries(serverEntries))
    }
    onClose()
  }

  const commitRate = (userId: number, input: HTMLInputElement) => updateLocalRate(userId, input.value)

  return (
    <BaseDialog show={show} title={t('admin.groups.rateMultipliersTitle')} width="wide" onClose={handleClose}>
      {group ? (
        <div className={styles.stack}>
          {/* 分组信息 */}
          <GroupOverridesSummary
            group={group}
            extra={`${t('admin.groups.columns.rateMultiplier')}: ${group.rate_multiplier}x`}
          />

          {/* 操作区 */}
          <div className={styles.panel}>
            {/* 添加用户 */}
            <h4 className={styles.panelTitle}>{t('admin.groups.addUserRate')}</h4>
            <div className={styles.addRow}>
              <UserSearchField search={search} />
              <div className={styles.numberCell}>
                <input
                  value={formNumberValue(newRate)}
                  type="number"
                  step="0.001"
                  min="0"
                  autoComplete="off"
                  className={`${arcInput.input} ${styles.hideSpinner}`}
                  placeholder="1.0"
                  aria-label={t('admin.groups.columns.rateMultiplier')}
                  onChange={(event) => setNewRate(toModelNumber(event.target.value))}
                />
              </div>
              <Button
                type="button"
                variant="primary"
                disabled={!search.selectedUser || notPositive(newRate)}
                onClick={handleAddLocal}
              >
                {t('common.add')}
              </Button>
            </div>

            {/* 批量调整 + 全部清空 */}
            {localEntries.length > 0 ? (
              <div className={styles.batchRow}>
                <span className={styles.batchLabel}>{t('admin.groups.batchAdjust')}</span>
                <div className={styles.batchControls}>
                  <span>×</span>
                  <input
                    value={formNumberValue(batchFactor)}
                    type="number"
                    step="0.1"
                    min="0"
                    autoComplete="off"
                    className={`${arcInput.input} ${styles.hideSpinner} ${styles.batchInput}`}
                    placeholder="0.5"
                    aria-label={t('admin.groups.batchAdjust')}
                    onChange={(event) => setBatchFactor(toModelNumber(event.target.value))}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={!batchFactor || (batchFactor as number) <= 0}
                    onClick={applyBatchFactor}
                  >
                    {t('admin.groups.applyMultiplier')}
                  </Button>
                </div>
                <div className={styles.pushRight}>
                  <Button type="button" size="sm" variant="danger" onClick={clearAllLocal}>
                    {t('admin.groups.clearAll')}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          {/* 加载状态 */}
          {loading ? (
            <OverridesLoading />
          ) : (
            <div>
              {/* 已设置的用户列表 */}
              <h4 className={styles.listTitle}>
                {t('admin.groups.rateMultipliers')} ({localEntries.length})
              </h4>

              {localEntries.length === 0 ? (
                <div className={styles.empty}>{t('admin.groups.noRateMultipliers')}</div>
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
                            <th>{t('admin.groups.columns.rateMultiplier')}</th>
                            {showFinalRate ? <th className={styles.accentCell}>{t('admin.groups.finalRate')}</th> : null}
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
                                  key={`${entry.user_id}:${entry.rate_multiplier ?? ''}`}
                                  type="number"
                                  step="0.001"
                                  min="0.001"
                                  autoComplete="off"
                                  defaultValue={entry.rate_multiplier ?? ''}
                                  placeholder={String(group.rate_multiplier ?? 1)}
                                  aria-label={t('admin.groups.columns.rateMultiplier')}
                                  className={`${arcInput.input} ${styles.hideSpinner} ${styles.cellInput}`}
                                  onBlur={(event) => commitRate(entry.user_id, event.currentTarget)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault()
                                      commitRate(entry.user_id, event.currentTarget)
                                    }
                                  }}
                                />
                              </td>
                              {showFinalRate ? (
                                <td className={styles.accentCell}>{computeFinalRate(entry.rate_multiplier)}</td>
                              ) : null}
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

                  {/* 分页 */}
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

          {/* 底部操作栏 */}
          <div className={styles.footer}>
            {/* 左侧：未保存提示 + 撤销 */}
            {isDirty ? (
              <>
                <span className={styles.unsaved}>{t('admin.groups.unsavedChanges')}</span>
                <button type="button" className={styles.revert} onClick={handleCancel}>
                  {t('admin.groups.revertChanges')}
                </button>
              </>
            ) : null}
            {/* 右侧：关闭 / 保存 */}
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
