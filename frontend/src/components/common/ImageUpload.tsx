import { ImageIcon, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'

import { Button } from '@/components/arc/button/button'
import { useI18n } from '@/i18n/useI18n'
import { sanitizeSvg } from '@/utils/sanitize'
import styles from './ImageUpload.module.css'

export interface ImageUploadProps {
  /** 图片 data URL 或 SVG 源码（Vue 版 v-model） */
  value: string
  onChange: (value: string) => void
  /** image：读取为 data URL；svg：读取为文本并内联渲染 */
  mode?: 'image' | 'svg'
  size?: 'sm' | 'md'
  uploadLabel?: string
  removeLabel?: string
  hint?: string
  /** 字节数上限，默认 300 KB */
  maxSize?: number
}

/** 图片/SVG 上传：预览框 + 上传与移除按钮；只采用最近一次选择的读取结果 */
export default function ImageUpload({
  value,
  onChange,
  mode = 'image',
  size = 'md',
  uploadLabel = '',
  removeLabel = '',
  hint = '',
  maxSize = 300 * 1024
}: ImageUploadProps) {
  const { t } = useI18n()
  const [error, setError] = useState('')
  const readerRef = useRef<FileReader | null>(null)

  useEffect(() => () => readerRef.current?.abort(), [])

  const removeImage = () => {
    readerRef.current?.abort()
    onChange('')
  }

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const file = input.files?.[0]
    setError('')

    if (!file) return
    readerRef.current?.abort()

    if (maxSize && file.size > maxSize) {
      setError(t('common.fileTooLargeKb', { size: (file.size / 1024).toFixed(1), max: (maxSize / 1024).toFixed(0) }))
      input.value = ''
      return
    }

    const reader = new FileReader()
    readerRef.current = reader
    if (mode === 'svg') {
      reader.onload = (e) => {
        const text = e.target?.result as string
        if (text) onChange(text.trim())
      }
      reader.readAsText(file)
    } else {
      if (!file.type.startsWith('image/')) {
        setError(t('common.selectImageFile'))
        input.value = ''
        return
      }
      reader.onload = (e) => {
        onChange(e.target?.result as string)
      }
      reader.readAsDataURL(file)
    }

    reader.onerror = () => {
      setError(t('common.fileReadFailed'))
    }
    input.value = ''
  }

  return (
    <div className={styles.root}>
      {/* Preview Box */}
      <div className={styles.preview} data-size={size} data-filled={value ? '' : undefined}>
        {mode === 'svg' && value ? (
          <span className={styles.svg} dangerouslySetInnerHTML={{ __html: sanitizeSvg(value) }} />
        ) : mode === 'image' && value ? (
          <img src={value} alt="" className={styles.image} />
        ) : (
          <ImageIcon className={styles.placeholder} strokeWidth={1.5} aria-hidden="true" />
        )}
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        <div className={styles.actions}>
          <label className={styles.uploadButton}>
            <input type="file" accept={mode === 'svg' ? '.svg' : 'image/*'} className={styles.fileInput} onChange={handleUpload} />
            <Upload size={16} strokeWidth={1.75} aria-hidden="true" />
            {uploadLabel || t('common.upload')}
          </label>
          {value && (
            <Button type="button" variant="danger" size="sm" onClick={removeImage}>
              <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
              {removeLabel || t('common.remove')}
            </Button>
          )}
        </div>
        {hint && <p className={styles.hint}>{hint}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    </div>
  )
}
