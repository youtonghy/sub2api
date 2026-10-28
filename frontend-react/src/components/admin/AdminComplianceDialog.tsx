/**
 * 管理员合规确认弹窗：必须输入确认短语才能继续使用后台，不能通过关闭按钮、Esc 或点击遮罩绕过。
 */
import { useMemo, useState } from 'react'
import { ExternalLink, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/arc/button/button'
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog'
import { Input } from '@/components/arc/input/input'
import { useI18n } from '@/i18n/useI18n'
import { useAdminComplianceStore } from '@/stores/adminCompliance'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { renderSanitizedMarkdown } from '@/utils/markdown'
import zhDocument from '../../../../docs/legal/admin-compliance.zh.md?raw'
import enDocument from '../../../../docs/legal/admin-compliance.en.md?raw'
import styles from './AdminComplianceDialog.module.css'

function noop(): void {
  // 强制确认弹窗不允许通过关闭按钮绕过。
}

export default function AdminComplianceDialog() {
  const { t, locale } = useI18n()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const shouldShow = useAdminComplianceStore((state) => state.shouldShow)
  const status = useAdminComplianceStore((state) => state.status)
  const submitting = useAdminComplianceStore((state) => state.submitting)
  const expectedPhrase = useAdminComplianceStore((state) => state.expectedPhrase)

  const [typedPhrase, setTypedPhrase] = useState('')
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)

  const visible = isAuthenticated && isAdmin && shouldShow
  const canSubmit = typedPhrase.trim() === expectedPhrase
  const currentDocument = locale === 'zh' ? zhDocument : enDocument
  const documentUrl = locale === 'zh'
    ? status?.document_url_zh || 'https://github.com/Wei-Shaw/sub2api/blob/main/docs/legal/admin-compliance.zh.md'
    : status?.document_url_en || 'https://github.com/Wei-Shaw/sub2api/blob/main/docs/legal/admin-compliance.en.md'
  const inputError = !attemptedSubmit || canSubmit ? '' : t('adminCompliance.inputMismatch')
  const renderedDocument = useMemo(() => renderSanitizedMarkdown(currentDocument), [currentDocument])

  // 确认短语变化或弹窗重新出现时清空输入（对应 Vue 版的两个 watch）
  const [tracked, setTracked] = useState({ expectedPhrase, visible })
  if (tracked.expectedPhrase !== expectedPhrase || tracked.visible !== visible) {
    setTracked({ expectedPhrase, visible })
    if (tracked.expectedPhrase !== expectedPhrase || visible) {
      setTypedPhrase('')
      setAttemptedSubmit(false)
    }
  }

  async function submit(): Promise<void> {
    setAttemptedSubmit(true)
    if (!canSubmit) {
      return
    }

    try {
      const nextStatus = await useAdminComplianceStore.getState().accept(typedPhrase.trim())
      if (!nextStatus.required) {
        useAppStore.getState().showSuccess(t('adminCompliance.accepted'))
        setTypedPhrase('')
        setAttemptedSubmit(false)
      }
    } catch (error) {
      const message = (error as { message?: string })?.message || t('adminCompliance.acceptFailed')
      useAppStore.getState().showError(message)
    }
  }

  async function logout(): Promise<void> {
    await useAuthStore.getState().logout()
    window.location.href = '/login'
  }

  return (
    <Dialog open={visible} onOpenChange={noop}>
      <DialogContent
        title={t('adminCompliance.title')}
        className={styles.dialog}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div className={styles.layout}>
          <div className={styles.notice} role="note">
            <TriangleAlert className={styles.noticeIcon} size={18} strokeWidth={1.75} aria-hidden="true" />
            <div className={styles.noticeText}>
              <p className={styles.noticeTitle}>{t('adminCompliance.blockingNotice')}</p>
              <p>{t('adminCompliance.riskNotice')}</p>
            </div>
          </div>

          <div className={styles.documentGrid}>
            <section className={styles.document}>
              <div className={styles.legal} dangerouslySetInnerHTML={{ __html: renderedDocument }} />
            </section>

            <aside className={styles.aside}>
              <div>
                <p className={styles.asideLabel}>{t('adminCompliance.version')}</p>
                <p className={styles.version}>{status?.version || 'v2026.06.10'}</p>
              </div>
              <a href={documentUrl} target="_blank" rel="noopener noreferrer" className={styles.docLink}>
                <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
                {t('adminCompliance.openDocument')}
              </a>
              <p className={styles.asideText}>{t('adminCompliance.documentSource')}</p>
            </aside>
          </div>

          <div className={styles.phraseGroup}>
            <div className={styles.phrase}>{expectedPhrase}</div>
            <Input
              id="admin-compliance-phrase"
              label={t('adminCompliance.inputLabel')}
              value={typedPhrase}
              onChange={(event) => setTypedPhrase(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void submit()
                }
              }}
              placeholder={t('adminCompliance.inputPlaceholder')}
              autoComplete="off"
              disabled={submitting}
              error={inputError || undefined}
            />
          </div>

          <p className={styles.legalNote}>{t('adminCompliance.legalNote')}</p>

          <div className={styles.footer}>
            <Button type="button" variant="secondary" disabled={submitting} onClick={() => void logout()}>
              {t('adminCompliance.logout')}
            </Button>
            <Button type="button" disabled={!canSubmit || submitting} onClick={() => void submit()}>
              {submitting ? t('common.submitting') : t('adminCompliance.accept')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
