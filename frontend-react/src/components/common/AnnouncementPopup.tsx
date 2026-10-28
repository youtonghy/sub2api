/**
 * 公告弹窗：用户端展示 store 中排队的弹窗公告（关闭即标记已读）；
 * 管理端以 preview 模式预览公告，关闭时只回调 onClose，不标记已读。
 */
import { useMemo, useState } from 'react'
import { Check, Clock, X } from 'lucide-react'

import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog'
import { useI18n } from '@/i18n/useI18n'
import { useAnnouncementStore } from '@/stores/announcements'
import type { Announcement, UserAnnouncement } from '@/types'
import { formatRelativeWithDateTime } from '@/utils/format'
import { renderSanitizedMarkdown } from '@/utils/markdown'
import '@/styles/announcement-markdown.css'
import styles from './AnnouncementPopup.module.css'

export type PreviewAnnouncement = Pick<Announcement | UserAnnouncement, 'title' | 'content' | 'created_at'>

export interface AnnouncementPopupProps {
  /** 仅 preview 模式使用：要预览的公告，传 null 关闭 */
  announcement?: PreviewAnnouncement | null
  preview?: boolean
  /** preview 模式下点击关闭时调用 */
  onClose?: () => void
}

export default function AnnouncementPopup({ announcement = null, preview = false, onClose }: AnnouncementPopupProps) {
  const { t } = useI18n()
  const currentPopup = useAnnouncementStore((state) => state.currentPopup)
  const displayedAnnouncement = preview ? announcement : currentPopup
  // 关闭后保留最后一条内容，让对话框的退出动画仍有内容可显示
  const [shown, setShown] = useState(displayedAnnouncement)
  if (displayedAnnouncement && displayedAnnouncement !== shown) {
    setShown(displayedAnnouncement)
  }

  const renderedContent = useMemo(() => renderSanitizedMarkdown(shown?.content), [shown?.content])

  function handleDismiss() {
    if (preview) {
      onClose?.()
      return
    }
    void useAnnouncementStore.getState().dismissPopup()
  }

  // 与 Vue 版一致：点击遮罩或按 Esc 不会关闭，只能通过按钮确认；右上角关闭按钮等同于底部按钮
  return (
    <Dialog open={!!displayedAnnouncement} onOpenChange={(open) => { if (!open) handleDismiss() }}>
      {shown && (
        <DialogContent
          title={shown.title}
          className={styles.dialog}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <div className={styles.meta}>
            <Badge tone="warning" size="sm">{t('announcements.unread')}</Badge>
            <span className={styles.time}>
              <Clock size={14} strokeWidth={1.75} aria-hidden="true" />
              <time>{formatRelativeWithDateTime(shown.created_at)}</time>
            </span>
          </div>

          <div className={styles.content}>
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderedContent }} />
          </div>

          <div className={styles.footer}>
            <Button type="button" data-testid="announcement-popup-dismiss" onClick={handleDismiss}>
              <span className={styles.buttonLabel}>
                {preview
                  ? <X size={16} strokeWidth={1.75} aria-hidden="true" />
                  : <Check size={16} strokeWidth={1.75} aria-hidden="true" />}
                {preview ? t('common.close') : t('announcements.markRead')}
              </span>
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
