import { useI18n } from '@/i18n/useI18n'
import styles from './LoadingSpinner.module.css'

export type SpinnerSize = 'sm' | 'md' | 'lg' | 'xl'
export type SpinnerColor = 'primary' | 'secondary' | 'white' | 'gray'

export interface LoadingSpinnerProps {
  /** 默认 md */
  size?: SpinnerSize
  /** 默认 primary */
  color?: SpinnerColor
  className?: string
}

/**
 * 行内加载指示，对应 Vue 版 LoadingSpinner.vue。整块区域加载请优先用 Skeleton，
 * 这里只用于按钮、单元格等行内忙碌状态。
 */
export default function LoadingSpinner({ size = 'md', color = 'primary', className }: LoadingSpinnerProps) {
  const { t } = useI18n()
  return (
    <span
      className={[styles.spinner, className].filter(Boolean).join(' ')}
      data-size={size}
      data-color={color}
      role="status"
      aria-label={t('common.loading')}
    >
      <span className={styles.srOnly}>{t('common.loading')}</span>
    </span>
  )
}
