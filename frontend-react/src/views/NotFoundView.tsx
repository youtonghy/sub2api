/**
 * 404 页面，对应 Vue 版 NotFoundView.vue：返回上一页或进入仪表盘。
 * 正文与按钮文案在 Vue 版中即为硬编码英文，这里保持一致。
 */
import { ArrowLeft, House, TriangleAlert } from 'lucide-react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/arc/button/button'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { useI18n } from '@/i18n/useI18n'
import styles from './NotFoundView.module.css'

export default function NotFoundView() {
  const { t } = useI18n()
  const navigate = useNavigate()

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <p className={styles.code} aria-hidden="true">
          404
        </p>
        <EmptyState
          label="404"
          icon={<TriangleAlert width={24} height={24} strokeWidth={1.5} />}
          title={t('errors.pageNotFound')}
          description={t('shell.notFound.description')}
          action={
            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => void navigate(-1)}>
                <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
                {t('shell.notFound.goBack')}
              </Button>
              <Button onClick={() => void navigate('/dashboard')}>
                <House size={16} strokeWidth={1.75} aria-hidden="true" />
                {t('shell.notFound.goToDashboard')}
              </Button>
            </div>
          }
        />

        {/* Help Link */}
        <p className={styles.help}>
          {t('shell.notFound.needHelp')} <a href="#">{t('shell.notFound.contactSupport')}</a>
        </p>
      </div>
    </div>
  )
}
