/**
 * 分组模型白名单：开关打开后列出候选模型，可勾选、排序、全选 / 反选并追加自定义条目（支持 * 通配）。
 * 工具栏在滚动列表之外，列表区域单独滚动。
 */
import { ArrowDown, ArrowUp } from 'lucide-react'

import { FormSection } from '@/components/account/AccountFormLayout'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import arcInput from '@/components/arc/input/input.module.css'
import { Switch } from '@/components/arc/switch/switch'
import { useI18n } from '@/i18n/useI18n'
import {
  invertModelAllowlistSelection,
  moveModelAllowlistItem,
  selectAllModelAllowlistItems
} from '@/views/admin/groupModelAllowlist'
import styles from './GroupForm.module.css'
import type { GroupFormController } from './useGroupForm'

export default function GroupModelAllowlistSection({ ctl }: { ctl: GroupFormController }) {
  const { t } = useI18n()
  const { allowlist, allowlistLoading, updateAllowlist } = ctl
  const selectedCount = allowlist.items.filter((item) => item.selected).length

  return (
    <FormSection
      title={t('admin.groups.modelAllowlist.title')}
      description={t('admin.groups.modelAllowlist.hint')}
      action={
        <Switch
          aria-label={t('admin.groups.modelAllowlist.title')}
          checked={allowlist.enabled}
          onCheckedChange={(enabled) =>
            updateAllowlist((state) => {
              state.enabled = enabled
            })
          }
        />
      }
    >
      {allowlist.enabled ? (
        <div className={styles.allowlist}>
          {!allowlistLoading && allowlist.items.length > 0 ? (
            <div className={styles.allowlistToolbar}>
              <span>
                {t('admin.groups.modelAllowlist.selectedSummary', {
                  selected: selectedCount,
                  total: allowlist.items.length
                })}
              </span>
              <div className={styles.toolbarActions}>
                <Button type="button" size="sm" variant="ghost" onClick={() => updateAllowlist(selectAllModelAllowlistItems)}>
                  {t('admin.groups.modelAllowlist.selectAll')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => updateAllowlist(invertModelAllowlistSelection)}>
                  {t('admin.groups.modelAllowlist.invertSelection')}
                </Button>
              </div>
            </div>
          ) : null}
          <div className={styles.allowlistItems}>
            {allowlistLoading ? (
              <p className={styles.hint}>{t('admin.groups.modelAllowlist.loading')}</p>
            ) : allowlist.items.length === 0 ? (
              <p className={styles.hint}>{t('admin.groups.modelAllowlist.empty')}</p>
            ) : null}
            {allowlist.items.map((item, index) => (
              <div key={item.id} className={styles.allowlistItem}>
                <Checkbox
                  aria-label={item.id}
                  checked={item.selected}
                  onCheckedChange={(checked) =>
                    updateAllowlist((state) => {
                      const target = state.items.find((entry) => entry.id === item.id)
                      if (target) target.selected = checked === true
                    })
                  }
                />
                <span className={styles.allowlistName}>
                  {item.id}{' '}
                  {item.id.includes('*') ? (
                    <Badge size="sm" tone="info">
                      {t('admin.groups.modelAllowlist.wildcardTag')}
                    </Badge>
                  ) : null}
                </span>
                <button
                  type="button"
                  className={styles.iconButton}
                  disabled={index === 0}
                  aria-label={`${item.id} ↑`}
                  onClick={() => updateAllowlist((state) => moveModelAllowlistItem(state, index, index - 1))}
                >
                  <ArrowUp size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  disabled={index === allowlist.items.length - 1}
                  aria-label={`${item.id} ↓`}
                  onClick={() => updateAllowlist((state) => moveModelAllowlistItem(state, index, index + 1))}
                >
                  <ArrowDown size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          <div className={styles.allowlistFooter}>
            <div className={styles.inlineForm}>
              <input
                type="text"
                className={arcInput.input}
                value={ctl.allowlistCustomEntry}
                placeholder={t('admin.groups.modelAllowlist.customPlaceholder')}
                aria-label={t('admin.groups.modelAllowlist.customPlaceholder')}
                onChange={(event) => ctl.setAllowlistCustomEntry(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    ctl.submitAllowlistCustomEntry()
                  }
                }}
              />
              <Button type="button" size="sm" variant="secondary" onClick={ctl.submitAllowlistCustomEntry}>
                {t('admin.groups.modelAllowlist.addCustom')}
              </Button>
            </div>
            {ctl.allowlistCustomErrorKey ? <p className={styles.error}>{t(ctl.allowlistCustomErrorKey)}</p> : null}
          </div>
        </div>
      ) : null}
    </FormSection>
  )
}
