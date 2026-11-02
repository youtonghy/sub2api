/**
 * 公开的法律文档页，对应 Vue 版 views/public/LegalDocumentView.vue。
 * 登录协议文档来自公共设置 login_agreement_documents；admin-compliance 使用仓库内 docs/legal 下的文档。
 */
import { FileText, Globe, Settings, Shield } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'

import { Alert } from '@/components/arc/alert/alert'
import buttonStyles from '@/components/arc/button/button.module.css'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { LoginAgreementDocument } from '@/types'
import { renderSanitizedMarkdown } from '@/utils/markdown'
import { sanitizeUrl } from '@/utils/url'
import zhAdminCompliance from '../../../../docs/legal/admin-compliance.zh.md?raw'
import enAdminCompliance from '../../../../docs/legal/admin-compliance.en.md?raw'
import styles from './LegalDocumentView.module.css'

function documentIconFor(title: string): ReactNode {
  const props = { size: 22, strokeWidth: 1.75, 'aria-hidden': true } as const
  if (title.includes('政策') || title.includes('隐私')) {
    return <Shield {...props} />
  }
  if (title.includes('国家') || title.includes('地区')) {
    return <Globe {...props} />
  }
  if (title.includes('特定')) {
    return <Settings {...props} />
  }
  return <FileText {...props} />
}

export default function LegalDocumentView() {
  const { t, locale } = useI18n()
  const params = useParams()
  const settings = useAppStore((state) => state.cachedPublicSettings)
  const [loading, setLoading] = useState(() => !useAppStore.getState().cachedPublicSettings)
  const [loadError, setLoadError] = useState(false)

  const documentId = String(params.documentId || '')
  const isAdminComplianceDocument = documentId === 'admin-compliance'
  const siteName = settings?.site_name || 'RetooAi'
  const siteLogo = sanitizeUrl(settings?.site_logo || '', { allowRelative: true, allowDataUrl: true })
  const updatedAt = isAdminComplianceDocument ? '' : settings?.login_agreement_updated_at || ''
  const documentTypeLabel = isAdminComplianceDocument ? t('legal.adminCompliance') : t('legal.loginAgreement')

  let currentDocument: LoginAgreementDocument | null = null
  if (isAdminComplianceDocument) {
    currentDocument = {
      id: 'admin-compliance',
      title: t('adminCompliance.title'),
      content_md: locale === 'zh' ? zhAdminCompliance : enAdminCompliance
    }
  } else if (documentId) {
    currentDocument = (settings?.login_agreement_documents ?? []).find((doc) => doc.id === documentId) ?? null
  }

  const content = currentDocument?.content_md?.trim() || ''
  const hasContent = Boolean(content)
  // 与 Vue 版相同的 marked（breaks + gfm）+ DOMPurify 流程
  const renderedHtml = renderSanitizedMarkdown(content)
  const documentIcon = documentIconFor(currentDocument?.title || '')

  useEffect(() => {
    let cancelled = false
    void useAppStore
      .getState()
      .fetchPublicSettings()
      .then((loadedSettings) => {
        if (cancelled) return
        if (!loadedSettings) {
          setLoadError(true)
        }
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  let main
  if (loading) {
    main = <Skeleton label={t('common.loading')} lines={6} />
  } else if (loadError) {
    main = (
      <Alert tone="danger" title={t('legal.loadFailed')}>
        {t('legal.retryLater')}
      </Alert>
    )
  } else if (!currentDocument) {
    main = (
      <section className={styles.notFound}>
        <span className={styles.notFoundIcon}>
          <FileText size={18} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div>
          <h1 className={styles.notFoundTitle}>{t('legal.notFound')}</h1>
          <p className={styles.notFoundText}>{t('legal.notFoundDescription')}</p>
        </div>
      </section>
    )
  } else {
    main = (
      <article>
        <div className={styles.docHeader}>
          <span className={styles.docIcon}>
            {documentIcon}
          </span>
          <div className={styles.docHeading}>
            <p className={styles.docType}>{documentTypeLabel}</p>
            <h1 className={styles.docTitle}>{currentDocument.title}</h1>
            {updatedAt && <p className={styles.updatedAt}>{t('legal.updatedAt', { date: updatedAt })}</p>}
          </div>
        </div>

        {hasContent ? (
          <div className={styles.content} dangerouslySetInnerHTML={{ __html: renderedHtml }} />
        ) : (
          <div className={styles.empty}>{t('legal.empty')}</div>
        )}
      </article>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link to="/home" className={styles.brand}>
            {settings ? (
              <>
                <span className={styles.logo}>
                  <img src={siteLogo || '/logo.svg'} alt="Logo" />
                </span>
                <span className={styles.siteName}>{siteName}</span>
              </>
            ) : (
              <>
                <span className={`${styles.logo} ${styles.placeholder}`} aria-hidden="true" />
                <span className={styles.namePlaceholder} aria-hidden="true" />
              </>
            )}
          </Link>
          <Link to="/login" className={[buttonStyles.button, buttonStyles.primary, buttonStyles.md, styles.loginLink].join(' ')}>
            {t('home.login')}
          </Link>
        </div>
      </header>

      <main className={styles.main}>{main}</main>
    </div>
  )
}
