import type { ReactNode } from 'react'

import { Button } from '@/components/arc/button/button'
import { useI18n } from '@/i18n/useI18n'
import BaseDialog from './BaseDialog'
import styles from './ConfirmDialog.module.css'

export interface ConfirmDialogProps {
  show: boolean
  title: string
  message: string
  /** 默认 common.confirm */
  confirmText?: string
  /** 默认 common.cancel */
  cancelText?: string
  /** 确认按钮使用危险样式 */
  danger?: boolean
  /** 确认中：禁用按钮并显示加载态（Vue 版无此项，可选） */
  loading?: boolean
  onConfirm?: () => void
  onCancel?: () => void
  /** 追加在消息下方的内容（Vue 版默认插槽） */
  children?: ReactNode
}

/** 确认对话框，对应 Vue 版 ConfirmDialog.vue；关闭（Escape、关闭按钮）等同于取消 */
export default function ConfirmDialog({
  show,
  title,
  message,
  confirmText,
  cancelText,
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
  children
}: ConfirmDialogProps) {
  const { t } = useI18n()

  return (
    <BaseDialog
      show={show}
      title={title}
      width="narrow"
      onClose={() => onCancel?.()}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onCancel?.()} disabled={loading}>
            {cancelText || t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant={danger ? 'danger' : 'primary'}
            onClick={() => onConfirm?.()}
            loading={loading}
          >
            {confirmText || t('common.confirm')}
          </Button>
        </>
      }
    >
      <div className={styles.content}>
        <p className={styles.message}>{message}</p>
        {children}
      </div>
    </BaseDialog>
  )
}
