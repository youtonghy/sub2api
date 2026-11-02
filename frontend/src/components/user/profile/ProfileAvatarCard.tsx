import { useRef, useState, type ChangeEvent } from 'react'

import { userAPI } from '@/api'
import { Button } from '@/components/arc/button/button'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { User } from '@/types'
import { extractApiErrorMessage } from '@/utils/apiError'
import styles from './Profile.module.css'

export interface ProfileAvatarCardProps {
  user: User | null
  embedded?: boolean
}

const targetAvatarUploadBytes = 20 * 1024
const avatarScaleSteps = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.44, 0.36]
const avatarQualitySteps = [0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.44, 0.36]

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('avatar_read_failed'))
    reader.readAsDataURL(file)
  })
}

/** 头像上传（超过 20KB 时压缩为 webp），对应 Vue 版 ProfileAvatarCard.vue */
export default function ProfileAvatarCard({ user, embedded = false }: ProfileAvatarCardProps) {
  const { t } = useI18n()
  const [avatarDraft, setAvatarDraft] = useState('')
  const [avatarSaving, setAvatarSaving] = useState(false)
  const [prevAvatarUrl, setPrevAvatarUrl] = useState(user?.avatar_url)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 对应 Vue 版 watch(user.avatar_url)：外部头像变化时丢弃草稿
  if (user?.avatar_url !== prevAvatarUrl) {
    setPrevAvatarUrl(user?.avatar_url)
    setAvatarDraft('')
  }

  const displayName = user?.username?.trim() || user?.email?.trim() || t('profile.user')
  const avatarInitial = displayName.charAt(0).toUpperCase() || 'U'
  const avatarPreviewUrl = avatarDraft.trim() || user?.avatar_url?.trim() || ''

  function normalizeUploadedAvatar(value: string): string | null {
    const normalized = value.trim()
    if (!normalized) {
      return null
    }
    if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(normalized)) {
      useAppStore.getState().showError(t('profile.avatar.uploadRequired'))
      return null
    }
    return normalized
  }

  function loadImage(dataURL: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error(t('profile.avatar.readFailed')))
      image.src = dataURL
    })
  }

  function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error(t('profile.avatar.compressFailed')))
            return
          }
          resolve(blob)
        },
        type,
        quality
      )
    })
  }

  async function compressAvatarFile(file: File): Promise<File> {
    const sourceDataURL = await readFileAsDataURL(file)
    const image = await loadImage(sourceDataURL)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error(t('profile.avatar.compressFailed'))
    }

    for (const scale of avatarScaleSteps) {
      const width = Math.max(1, Math.round(image.naturalWidth * scale))
      const height = Math.max(1, Math.round(image.naturalHeight * scale))
      canvas.width = width
      canvas.height = height
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(image, 0, 0, width, height)

      for (const quality of avatarQualitySteps) {
        const blob = await canvasToBlob(canvas, 'image/webp', quality)
        if (blob.size <= targetAvatarUploadBytes) {
          const fileName = file.name.replace(/\.[^.]+$/, '') || 'avatar'
          return new File([blob], `${fileName}.webp`, { type: 'image/webp' })
        }
      }
    }

    throw new Error(t('profile.avatar.compressTooLarge'))
  }

  async function prepareAvatarUpload(file: File): Promise<File> {
    if (!file.type.startsWith('image/')) {
      throw new Error(t('profile.avatar.invalidType'))
    }
    if (file.type === 'image/gif') {
      if (file.size > targetAvatarUploadBytes) {
        throw new Error(t('profile.avatar.gifTooLarge'))
      }
      return file
    }
    if (file.size <= targetAvatarUploadBytes) {
      return file
    }
    return compressAvatarFile(file)
  }

  async function handleAvatarFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target
    const file = input.files?.[0]
    input.value = ''
    if (!file) {
      return
    }

    try {
      const preparedFile = await prepareAvatarUpload(file)
      const dataURL = await readFileAsDataURL(preparedFile)
      const normalized = normalizeUploadedAvatar(dataURL)
      if (!normalized) {
        return
      }
      setAvatarDraft(normalized)
    } catch (error: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('common.error')))
    }
  }

  async function handleAvatarSave() {
    const normalized = normalizeUploadedAvatar(avatarDraft)
    if (!normalized) {
      return
    }

    setAvatarSaving(true)
    try {
      const updated = await userAPI.updateProfile({ avatar_url: normalized })
      useAuthStore.setState({ user: updated })
      setAvatarDraft(updated.avatar_url?.trim() || '')
      useAppStore.getState().showSuccess(t('profile.avatar.saveSuccess'))
    } catch (error: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('common.error')))
    } finally {
      setAvatarSaving(false)
    }
  }

  async function handleAvatarDelete() {
    if (avatarSaving) {
      return
    }
    if (!avatarDraft.trim() && !user?.avatar_url?.trim()) {
      useAppStore.getState().showError(t('profile.avatar.emptyDeleteHint'))
      return
    }

    setAvatarSaving(true)
    try {
      const updated = await userAPI.updateProfile({ avatar_url: '' })
      useAuthStore.setState({ user: updated })
      setAvatarDraft('')
      useAppStore.getState().showSuccess(t('profile.avatar.deleteSuccess'))
    } catch (error: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('common.error')))
    } finally {
      setAvatarSaving(false)
    }
  }

  const size = embedded ? 64 : 96
  const content = (
    <div className={embedded ? styles.stack : styles.avatarLayout}>
      <div className={styles.avatarBox} style={{ width: size, height: size, fontSize: embedded ? 20 : 30 }}>
        {avatarPreviewUrl ? (
          <img data-testid="profile-avatar-preview" src={avatarPreviewUrl} alt={displayName} />
        ) : (
          <span>{avatarInitial}</span>
        )}
      </div>

      <div className={styles.stack}>
        <div>
          {embedded ? (
            <p className={styles.embeddedTitle}>{t('profile.avatar.title')}</p>
          ) : (
            <p className={styles.label}>{displayName}</p>
          )}
          <p className={styles.muted}>{t('profile.avatar.uploadHint')}</p>
        </div>

        <div className={styles.inlineActions}>
          <input
            ref={fileInputRef}
            data-testid="profile-avatar-file-input"
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => void handleAvatarFileChange(event)}
          />
          <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
            {t('profile.avatar.uploadAction')}
          </Button>
          <Button
            data-testid="profile-avatar-save"
            type="button"
            size="sm"
            disabled={avatarSaving || !avatarDraft}
            onClick={() => void handleAvatarSave()}
          >
            {t('common.save')}
          </Button>
          <Button
            data-testid="profile-avatar-delete"
            type="button"
            variant="secondary"
            size="sm"
            disabled={avatarSaving}
            onClick={() => void handleAvatarDelete()}
          >
            {t('common.delete')}
          </Button>
        </div>
      </div>
    </div>
  )

  if (embedded) return content

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <h2 className={styles.panelTitle}>{t('profile.avatar.title')}</h2>
          <p className={styles.panelDescription}>{t('profile.avatar.description')}</p>
        </div>
      </div>
      <div className={styles.panelBody}>{content}</div>
    </section>
  )
}
