/** 标签输入：已添加的项显示为可删除的标签，后面是输入框（注册邮箱后缀白名单、转发 IP 请求头共用） */
import type { ClipboardEvent, KeyboardEvent } from 'react'
import { X } from 'lucide-react'

import s from '@/components/admin/settings/SettingsLayout.module.css'

export interface TagInputProps {
  tags: string[]
  draft: string
  onDraftChange: (value: string) => void
  onRemove: (tag: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onBlur: () => void
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void
  placeholder?: string
  removeLabel: (tag: string) => string
  id?: string
  inputTestId?: string
  tagTestId?: string
}

export default function TagInput({
  tags,
  draft,
  onDraftChange,
  onRemove,
  onKeyDown,
  onBlur,
  onPaste,
  placeholder,
  removeLabel,
  id,
  inputTestId,
  tagTestId
}: TagInputProps) {
  return (
    <div className={s.tagInput}>
      {tags.map((tag) => (
        <span key={tag} className={s.chip} data-testid={tagTestId}>
          <span>{tag}</span>
          <button type="button" className={s.chipRemove} aria-label={removeLabel(tag)} onClick={() => onRemove(tag)}>
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        id={id}
        type="text"
        className={s.tagInputField}
        value={draft}
        placeholder={placeholder}
        data-testid={inputTestId}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onPaste={onPaste}
      />
    </div>
  )
}
