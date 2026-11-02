/**
 * 分页栏，对应 Vue 版 Pagination.vue：区间信息、每页条数选择（变更时持久化）、可选的跳页输入，
 * 页码导航使用 Arc pagination（五页窗口滑动）。
 */
import { useState } from 'react'

import { Button } from '@/components/arc/button/button'
import { Pagination as ArcPagination } from '@/components/arc/pagination/pagination'
import { setPersistedPageSize } from '@/composables/usePersistedPageSize'
import { useI18n } from '@/i18n/useI18n'
import { getConfiguredTablePageSizeOptions, normalizeTablePageSize } from '@/utils/tablePreferences'
import Select, { type SelectValue } from './Select'
import styles from './Pagination.module.css'

export interface PaginationProps {
  total: number
  /** 当前页（从 1 开始） */
  page: number
  pageSize: number
  /** 页码变化（Vue 版 update:page） */
  onPageChange?: (page: number) => void
  /** 每页条数变化（Vue 版 update:pageSize），已写入持久化存储 */
  onPageSizeChange?: (pageSize: number) => void
  /** 保留以兼容 Vue 版；实际选项来自系统配置的表格分页选项 */
  pageSizeOptions?: number[]
  /** 默认 true */
  showPageSizeSelector?: boolean
  /** 默认 false */
  showJump?: boolean
}

export default function Pagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  showPageSizeSelector = true,
  showJump = false
}: PaginationProps) {
  const { t } = useI18n()
  const [jumpPage, setJumpPage] = useState('')

  const totalPages = Math.ceil(total / pageSize)
  const fromItem = total === 0 ? 0 : (page - 1) * pageSize + 1
  const toItem = Math.min(page * pageSize, total)

  const pageSizeSelectOptions = Array.from(
    new Set([...getConfiguredTablePageSizeOptions(), normalizeTablePageSize(pageSize)])
  )
    .sort((a, b) => a - b)
    .map((size) => ({ value: size, label: String(size) }))

  const goToPage = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages && newPage !== page) {
      onPageChange?.(newPage)
    }
  }

  const handlePageSizeChange = (value: SelectValue) => {
    if (value === null || typeof value === 'boolean') return
    const newPageSize = normalizeTablePageSize(typeof value === 'string' ? parseInt(value, 10) : value)
    setPersistedPageSize(newPageSize)
    onPageSizeChange?.(newPageSize)
  }

  const submitJump = () => {
    const value = jumpPage.trim()
    if (!value) return
    const pageNum = Number.parseInt(value, 10)
    if (Number.isNaN(pageNum)) return
    const nextPage = Math.min(Math.max(pageNum, 1), totalPages)
    setJumpPage('')
    goToPage(nextPage)
  }

  return (
    <div className={styles.root}>
      <div className={styles.info}>
        <p className={styles.range}>
          {t('pagination.showing')} <span className={styles.strong}>{fromItem}</span> {t('pagination.to')}{' '}
          <span className={styles.strong}>{toItem}</span> {t('pagination.of')}{' '}
          <span className={styles.strong}>{total}</span> {t('pagination.results')}
        </p>
        <p className={styles.compact}>{t('pagination.pageOf', { page, total: totalPages })}</p>

        {/* Page size selector */}
        {showPageSizeSelector && (
          <div className={styles.group}>
            <span className={styles.label}>{t('pagination.perPage')}:</span>
            <div className={styles.pageSize}>
              <Select
                value={pageSize}
                options={pageSizeSelectOptions}
                aria-label={t('pagination.perPage')}
                onChange={handlePageSizeChange}
              />
            </div>
          </div>
        )}

        {showJump && (
          <div className={styles.group}>
            <span className={styles.label}>{t('pagination.jumpTo')}</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={jumpPage}
              className={styles.jumpInput}
              placeholder={t('pagination.jumpPlaceholder')}
              aria-label={t('pagination.jumpTo')}
              onChange={(event) => setJumpPage(event.target.value)}
              onKeyUp={(event) => {
                if (event.key === 'Enter') submitJump()
              }}
            />
            <Button type="button" variant="ghost" size="sm" onClick={submitJump}>
              {t('pagination.jumpAction')}
            </Button>
          </div>
        )}
      </div>

      <ArcPagination
        page={page}
        pageCount={totalPages}
        onPageChange={goToPage}
        label={t('pagination.pageOf', { page, total: totalPages })}
        labels={{
          previous: t('pagination.previous'),
          next: t('pagination.next'),
          page: (number) => t('pagination.goToPage', { page: number }),
        }}
      />
    </div>
  )
}
