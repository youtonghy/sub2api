/**
 * 顶栏公告铃铛：Arc Popover 展示公告列表，点击条目用 Arc Dialog 打开详情（Markdown 经 DOMPurify 净化）。
 * 打开未读公告详情时自动标记已读；失败时详情保持打开，可通过「标记已读」重试。
 */
import { useMemo, useState } from 'react'
import { Bell, ChevronRight, CircleCheck, Clock, Eye, Inbox, Info, X } from 'lucide-react'

import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Dialog, DialogClose, DialogContent } from '@/components/arc/dialog/dialog'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { useI18n } from '@/i18n/useI18n'
import { useAnnouncementStore } from '@/stores/announcements'
import { useAppStore } from '@/stores/app'
import type { UserAnnouncement } from '@/types'
import { formatRelativeTime, formatRelativeWithDateTime } from '@/utils/format'
import { renderSanitizedMarkdown } from '@/utils/markdown'
import '@/styles/announcement-markdown.css'
import styles from './AnnouncementBell.module.css'

function errorMessage(err: unknown, fallback: string): string {
  return (err as { message?: string } | null)?.message || fallback
}

export default function AnnouncementBell() {
  const { t } = useI18n()
  const announcements = useAnnouncementStore((state) => state.announcements)
  const loading = useAnnouncementStore((state) => state.loading)
  const unreadCount = useAnnouncementStore((state) => state.unreadCount)

  // Local modal state
  const [isListOpen, setListOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  // 详情从 store 取最新数据，标记已读后 read_at 会同步更新
  const selectedAnnouncement = selectedId === null
    ? null
    : announcements.find((item) => item.id === selectedId) ?? null
  // 关闭后保留最后一条内容，让对话框的退出动画仍有内容可显示
  const [shownDetail, setShownDetail] = useState<UserAnnouncement | null>(null)
  if (selectedAnnouncement && selectedAnnouncement !== shownDetail) {
    setShownDetail(selectedAnnouncement)
  }
  const renderedDetail = useMemo(() => renderSanitizedMarkdown(shownDetail?.content), [shownDetail?.content])

  function openDetail(announcement: UserAnnouncement) {
    // 详情是模态对话框，先收起列表，避免浮层叠在对话框上方
    setListOpen(false)
    setSelectedId(announcement.id)
    if (!announcement.read_at) {
      void markAsRead(announcement.id)
    }
  }

  function closeDetail() {
    setSelectedId(null)
  }

  async function markAsRead(id: number): Promise<boolean> {
    const appStore = useAppStore.getState()
    try {
      const marked = await useAnnouncementStore.getState().markAsRead(id)
      if (!marked) appStore.showError(t('common.unknownError'))
      return marked
    } catch (err) {
      appStore.showError(errorMessage(err, t('common.unknownError')))
      return false
    }
  }

  async function markAsReadAndClose(id: number) {
    if (!await markAsRead(id)) return
    useAppStore.getState().showSuccess(t('announcements.markedAsRead'))
    closeDetail()
  }

  async function markAllAsRead() {
    const appStore = useAppStore.getState()
    try {
      await useAnnouncementStore.getState().markAllAsRead()
      appStore.showSuccess(t('announcements.allMarkedAsRead'))
    } catch (err) {
      appStore.showError(errorMessage(err, t('common.unknownError')))
    }
  }

  return (
    <>
      <Popover open={isListOpen} onOpenChange={setListOpen}>
        <PopoverTrigger
          className={styles.trigger}
          data-unread={unreadCount > 0 || undefined}
          aria-label={t('announcements.title')}
          title={t('announcements.title')}
        >
          <Bell size={18} strokeWidth={1.75} aria-hidden="true" />
          {/* 未读红点 */}
          {unreadCount > 0 && <span className={styles.dot} aria-hidden="true" />}
        </PopoverTrigger>

        <PopoverContent align="end" className={styles.panel} aria-label={t('announcements.title')}>
          <div className={styles.header}>
            <div className={styles.headingGroup}>
              <h2 className={styles.heading}>{t('announcements.title')}</h2>
              {unreadCount > 0 && (
                <p className={styles.summary}>
                  <span className={styles.count}>{unreadCount}</span> {t('announcements.unread')}
                </p>
              )}
            </div>
            <div className={styles.headerActions}>
              {unreadCount > 0 && (
                <Button size="sm" variant="secondary" disabled={loading} onClick={() => void markAllAsRead()}>
                  {t('announcements.markAllRead')}
                </Button>
              )}
              <PopoverClose className={styles.close} aria-label={t('common.close')}>
                <X size={16} strokeWidth={1.75} aria-hidden="true" />
              </PopoverClose>
            </div>
          </div>

          <div className={styles.body}>
            {loading ? (
              <Skeleton label={t('common.loading')} lines={4} className={styles.skeleton} />
            ) : announcements.length > 0 ? (
              <ul className={styles.list}>
                {announcements.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={styles.item}
                      data-unread={!item.read_at || undefined}
                      onClick={() => openDetail(item)}
                    >
                      <span className={styles.itemIcon} aria-hidden="true">
                        {item.read_at
                          ? <CircleCheck size={18} strokeWidth={1.75} />
                          : <Info size={18} strokeWidth={1.75} />}
                      </span>
                      <span className={styles.itemText}>
                        <span className={styles.itemTitle}>{item.title}</span>
                        <span className={styles.itemMeta}>
                          <time>{formatRelativeTime(item.created_at)}</time>
                          {!item.read_at && <Badge tone="info" size="sm">{t('announcements.unread')}</Badge>}
                        </span>
                      </span>
                      <ChevronRight className={styles.chevron} size={16} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title={t('announcements.empty')}
                description={t('announcements.emptyDescription')}
                icon={<Inbox size={24} strokeWidth={1.5} />}
              />
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* 公告详情 */}
      <Dialog open={selectedAnnouncement !== null} onOpenChange={(open) => { if (!open) closeDetail() }}>
        {shownDetail && (
          <DialogContent title={shownDetail.title} className={styles.detail}>
            <div className={styles.detailMeta}>
              <Badge tone="neutral" size="sm">{t('announcements.title')}</Badge>
              {!shownDetail.read_at && <Badge tone="info" size="sm">{t('announcements.unread')}</Badge>}
              <span className={styles.metaItem}>
                <Clock size={14} strokeWidth={1.75} aria-hidden="true" />
                <time>{formatRelativeWithDateTime(shownDetail.created_at)}</time>
              </span>
              <span className={styles.metaItem}>
                <Eye size={14} strokeWidth={1.75} aria-hidden="true" />
                {shownDetail.read_at ? t('announcements.read') : t('announcements.unread')}
              </span>
            </div>

            <div className={styles.detailContent}>
              <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderedDetail }} />
            </div>

            <div className={styles.detailFooter}>
              <p className={styles.hint}>
                <Info size={14} strokeWidth={1.75} aria-hidden="true" />
                {shownDetail.read_at ? t('announcements.readStatus') : t('announcements.markReadHint')}
              </p>
              <div className={styles.footerActions}>
                <DialogClose asChild>
                  <Button type="button" variant="secondary">{t('common.close')}</Button>
                </DialogClose>
                {!shownDetail.read_at && (
                  <Button type="button" onClick={() => void markAsReadAndClose(shownDetail.id)}>
                    {t('announcements.markRead')}
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
