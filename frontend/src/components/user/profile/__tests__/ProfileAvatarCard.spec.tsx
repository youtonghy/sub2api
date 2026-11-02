import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ProfileAvatarCard from '@/components/user/profile/ProfileAvatarCard'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { User } from '@/types'

const mocks = vi.hoisted(() => ({ updateProfile: vi.fn(), showSuccess: vi.fn(), showError: vi.fn() }))

vi.mock('@/api', () => ({ userAPI: { updateProfile: mocks.updateProfile } }))
vi.mock('@/utils/apiError', () => ({
  extractApiErrorMessage: (error: unknown) => (error as Error).message || 'request failed'
}))
vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === 'profile.avatar.title') return 'Profile avatar'
      if (key === 'profile.avatar.description') return 'Upload and manage your avatar'
      if (key === 'profile.avatar.uploadAction') return 'Upload image'
      if (key === 'profile.avatar.uploadHint') return 'Uploaded images are compressed to 20KB when possible'
      if (key === 'profile.avatar.saveSuccess') return 'Avatar updated'
      if (key === 'profile.avatar.deleteSuccess') return 'Avatar removed'
      if (key === 'profile.avatar.invalidType') return 'Please choose an image file'
      if (key === 'profile.avatar.gifTooLarge') return 'GIF avatars must already be 20KB or smaller'
      if (key === 'profile.avatar.compressTooLarge') return 'Unable to compress this image below 20KB'
      if (key === 'profile.avatar.compressFailed') return 'Failed to compress the selected image'
      if (key === 'profile.avatar.readFailed') return 'Failed to read the selected image'
      if (key === 'common.save') return 'Save'
      if (key === 'common.delete') return 'Delete'
      if (key === 'profile.avatar.compressedReady') return `Compressed from ${params?.from} to ${params?.to}`
      if (key === 'profile.avatar.sizeReady') return `Ready: ${params?.size}`
      return key
    },
    te: () => true,
    locale: 'en'
  })
}))

function createUser(overrides: Partial<User> = {}): User {
  return {
    id: 5,
    username: 'alice',
    email: 'alice@example.com',
    avatar_url: null,
    role: 'user',
    balance: 10,
    concurrency: 2,
    status: 'active',
    allowed_groups: null,
    balance_notify_enabled: true,
    balance_notify_threshold: null,
    balance_notify_extra_emails: [],
    created_at: '2026-04-20T00:00:00Z',
    updated_at: '2026-04-20T00:00:00Z',
    ...overrides
  }
}

const flushAsyncWork = () => act(async () => {})

const originalFileReader = globalThis.FileReader
const originalImage = globalThis.Image
const originalCreateElement = document.createElement.bind(document)

function installAvatarCompressionMocks(blobSize = 8 * 1024) {
  class MockFileReader {
    result: string | ArrayBuffer | null = null
    onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null
    onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null
    error: DOMException | null = null

    readAsDataURL(blob: Blob) {
      if (blob.type === 'image/webp') {
        this.result = 'data:image/webp;base64,' + Buffer.from('compressed-avatar').toString('base64')
      } else {
        this.result = 'data:image/png;base64,' + Buffer.from('original-avatar').toString('base64')
      }
      this.onload?.call(this as unknown as FileReader, new ProgressEvent('load') as ProgressEvent<FileReader>)
    }
  }

  class MockImage {
    naturalWidth = 1200
    naturalHeight = 1200
    onload: (() => void) | null = null
    onerror: (() => void) | null = null

    set src(_value: string) {
      this.onload?.()
    }
  }

  globalThis.FileReader = MockFileReader as unknown as typeof FileReader
  globalThis.Image = MockImage as unknown as typeof Image
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
    if (tagName === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext: () => ({ clearRect: vi.fn(), drawImage: vi.fn() }),
        toBlob: (callback: BlobCallback) => {
          callback(new Blob([new Uint8Array(blobSize)], { type: 'image/webp' }))
        }
      } as unknown as HTMLCanvasElement
    }
    return originalCreateElement(tagName, options)
  }) as typeof document.createElement)
}

function selectFile(file: File) {
  const fileInput = screen.getByTestId('profile-avatar-file-input')
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
  fireEvent.change(fileInput)
}

describe('ProfileAvatarCard', () => {
  beforeEach(() => {
    mocks.updateProfile.mockReset()
    mocks.showSuccess.mockReset()
    mocks.showError.mockReset()
    useAppStore.setState({ showSuccess: mocks.showSuccess, showError: mocks.showError })
    useAuthStore.setState({ user: null })
  })

  afterEach(() => {
    globalThis.FileReader = originalFileReader
    globalThis.Image = originalImage
    vi.restoreAllMocks()
  })

  it('does not render a manual avatar input field', () => {
    render(<ProfileAvatarCard user={createUser()} />)
    expect(screen.queryByTestId('profile-avatar-input')).toBeNull()
  })

  it('compresses an uploaded image that exceeds the 20KB target before saving', async () => {
    installAvatarCompressionMocks()
    mocks.updateProfile.mockResolvedValue(createUser({ avatar_url: 'data:image/webp;base64,Y29tcHJlc3NlZC1hdmF0YXI=' }))
    render(<ProfileAvatarCard user={createUser()} />)

    selectFile(new File([new Uint8Array(220 * 1024)], 'avatar.png', { type: 'image/png' }))
    await flushAsyncWork()
    await act(async () => {
      fireEvent.click(screen.getByTestId('profile-avatar-save'))
    })

    expect(mocks.updateProfile).toHaveBeenCalledWith({ avatar_url: 'data:image/webp;base64,Y29tcHJlc3NlZC1hdmF0YXI=' })
    expect(mocks.showError).not.toHaveBeenCalled()
  })

  it('shows a preview after selecting an avatar in embedded mode', async () => {
    installAvatarCompressionMocks()
    render(<ProfileAvatarCard user={createUser()} embedded />)

    selectFile(new File([new Uint8Array(220 * 1024)], 'avatar.png', { type: 'image/png' }))
    await flushAsyncWork()

    expect(screen.getByTestId('profile-avatar-preview').getAttribute('src')).toBe(
      'data:image/webp;base64,Y29tcHJlc3NlZC1hdmF0YXI='
    )
  })

  it('deletes the current avatar', async () => {
    mocks.updateProfile.mockResolvedValue(createUser({ avatar_url: null }))
    render(<ProfileAvatarCard user={createUser({ avatar_url: 'https://cdn.example.com/old.png' })} />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('profile-avatar-delete'))
    })

    expect(mocks.updateProfile).toHaveBeenCalledWith({ avatar_url: '' })
    expect(useAuthStore.getState().user?.avatar_url).toBeNull()
    expect(mocks.showSuccess).toHaveBeenCalledWith('Avatar removed')
  })
})
