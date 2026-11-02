import { ExternalLink, FileText, Globe, Settings, ShieldCheck, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'

import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog'
import { useI18n } from '@/i18n/useI18n'
import type { LoginAgreementDocument } from '@/types'
import styles from './LoginAgreementPrompt.module.css'

export interface LoginAgreementPromptProps {
  accepted: boolean
  documents: LoginAgreementDocument[]
  mode: 'modal' | 'checkbox' | string
  updatedAt?: string
  visible: boolean
  onAccept: () => void
  onReject: () => void
  onOpen: () => void
  /** 用对话框右上角关闭按钮或 Esc 关闭时调用；Vue 版对话框没有关闭入口 */
  onDismiss?: () => void
}

function documentPath(doc: LoginAgreementDocument): string {
  return `/legal/${encodeURIComponent(doc.id || doc.title)}`
}

function documentIcon(index: number, title: string): LucideIcon {
  const normalizedTitle = title.toLowerCase()
  if (
    normalizedTitle.includes('policy') ||
    normalizedTitle.includes('privacy') ||
    title.includes('政策') ||
    title.includes('隐私')
  ) {
    return ShieldCheck
  }
  if (
    normalizedTitle.includes('country') ||
    normalizedTitle.includes('region') ||
    title.includes('国家') ||
    title.includes('地区')
  ) {
    return Globe
  }
  if (index === 3) {
    return Settings
  }
  return FileText
}

export default function LoginAgreementPrompt({
  accepted,
  documents: rawDocuments,
  mode: rawMode,
  updatedAt = '',
  visible,
  onAccept,
  onReject,
  onOpen,
  onDismiss
}: LoginAgreementPromptProps) {
  const { t } = useI18n()
  const documents = rawDocuments.filter((doc) => doc.title.trim())
  const mode = rawMode === 'checkbox' ? 'checkbox' : 'modal'
  const dialogVisible = visible && documents.length > 0

  let inline = null
  if (mode === 'checkbox' && documents.length > 0) {
    inline = (
      <div className={styles.consent}>
        <Checkbox
          id="login-agreement-consent"
          checked={accepted}
          aria-labelledby="login-agreement-consent-label"
          onCheckedChange={(checked) => (checked === true ? onAccept() : onReject())}
        />
        <p className={styles.consentText}>
          <label id="login-agreement-consent-label" htmlFor="login-agreement-consent" className={styles.consentLabel}>
            {t('legal.loginAgreementPrompt.checkboxPrefix')}
          </label>
          {documents.map((doc, index) => (
            <span key={doc.id || doc.title}>
              <Link to={documentPath(doc)} target="_blank" rel="noopener noreferrer" className={styles.link}>
                {doc.title}
              </Link>
              {index < documents.length - 1 && <span>{t('legal.loginAgreementPrompt.documentSeparator')}</span>}
            </span>
          ))}
        </p>
      </div>
    )
  } else if (!accepted && documents.length > 0) {
    inline = (
      <div className={styles.notice}>
        <ShieldCheck className={styles.noticeIcon} size={16} strokeWidth={1.75} aria-hidden="true" />
        <div className={styles.noticeCopy}>
          <p className={styles.noticeTitle}>{t('legal.loginAgreementPrompt.noticeTitle')}</p>
          <p className={styles.noticeDescription}>{t('legal.loginAgreementPrompt.noticeDescription')}</p>
        </div>
        <Button type="button" size="sm" onClick={onOpen}>
          {t('legal.loginAgreementPrompt.viewTerms')}
        </Button>
      </div>
    )
  }

  return (
    <>
      {inline}
      <Dialog open={dialogVisible} onOpenChange={(open) => { if (!open) onDismiss?.() }}>
        <DialogContent
          className={styles.dialog}
          title={t('legal.loginAgreementPrompt.dialogTitle')}
          description={t('legal.loginAgreementPrompt.dialogDescription', {
            date: updatedAt || t('legal.loginAgreementPrompt.recently')
          })}
          onEscapeKeyDown={(event) => { if (!onDismiss) event.preventDefault() }}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <div className={styles.dialogBody}>
            {updatedAt && (
              <div>
                <Badge size="sm">{updatedAt}</Badge>
              </div>
            )}
            <p className={styles.sectionTitle}>{t('legal.loginAgreementPrompt.relatedDocuments')}</p>
            <div className={styles.documentGrid}>
              {documents.map((doc, index) => {
                const Icon = documentIcon(index, doc.title)
                return (
                  <Link
                    key={doc.id || doc.title}
                    to={documentPath(doc)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.documentCard}
                  >
                    <span className={styles.documentIcon}>
                      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <span className={styles.documentTitle}>{doc.title}</span>
                    <ExternalLink className={styles.documentExternal} size={16} strokeWidth={1.75} aria-hidden="true" />
                  </Link>
                )
              })}
            </div>
          </div>
          <div className={styles.dialogActions}>
            <Button type="button" variant="secondary" onClick={onReject}>
              {t('legal.loginAgreementPrompt.reject')}
            </Button>
            <Button type="button" onClick={onAccept}>
              {t('legal.loginAgreementPrompt.accept')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
