import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/arc/button/button'
import { useI18n } from '@/i18n/useI18n'
import styles from './AccountForm.module.css'
import type { HeaderOverrideRow } from './credentialsBuilder'
import HeaderOverrideJsonTools from './HeaderOverrideJsonTools'

export interface HeaderOverrideEditorProps {
  rows: HeaderOverrideRow[]
  /** Vue 版 update:rows */
  onChange: (rows: HeaderOverrideRow[]) => void
}

/** 请求头覆盖编辑器：逐行编辑名称 / 值，附 JSON 导入与复制 */
export default function HeaderOverrideEditor({ rows, onChange }: HeaderOverrideEditorProps) {
  const { t } = useI18n()

  const addRow = () => {
    onChange([...rows, { name: '', value: '' }])
  }

  const removeRow = (index: number) => {
    onChange(rows.filter((_, i) => i !== index))
  }

  const updateRow = (index: number, patch: Partial<HeaderOverrideRow>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  return (
    <>
      {rows.length > 0 ? (
        <div className={styles.editRows}>
          {rows.map((row, index) => (
            // 受控输入、无内部状态：按位置作 key，编辑时替换行对象也不会丢失焦点
            <div key={index} className={styles.editRow}>
              <input
                type="text"
                className={styles.input}
                value={row.name}
                onChange={(e) => updateRow(index, { name: e.target.value })}
                placeholder={t('admin.accounts.headerOverride.namePlaceholder')}
              />
              <input
                type="text"
                className={styles.input}
                value={row.value}
                onChange={(e) => updateRow(index, { value: e.target.value })}
                placeholder={t('admin.accounts.headerOverride.valuePlaceholder')}
              />
              <button
                type="button"
                className={styles.iconButton}
                data-tone="danger"
                aria-label={t('common.delete')}
                onClick={() => removeRow(index)}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <Button type="button" variant="secondary" onClick={addRow}>
        <Plus size={16} aria-hidden="true" />
        {t('admin.accounts.headerOverride.addRow')}
      </Button>

      <div className={styles.row}>
        <HeaderOverrideJsonTools rows={rows} onChange={onChange} />
      </div>

      <p className={styles.hint}>{t('admin.accounts.headerOverride.emptyValueHint')}</p>
    </>
  )
}
