import HelpTooltip from '@/components/common/HelpTooltip'
import { useI18n } from '@/i18n/useI18n'
import styles from './AccountForm.module.css'
import own from './UpstreamRequestIdHeaderField.module.css'

export interface UpstreamRequestIdHeaderFieldProps {
  /** Vue 版 v-model（默认 ''） */
  value: string
  onChange: (value: string) => void
  platform?: string
  type?: string
}

interface HeaderExample {
  label: string
  header: string
  note?: string
}

// 各平台官方 API 在响应头中声明请求标识的头名。
const OFFICIAL_REQUEST_ID_HEADERS: Record<string, { platform: string; header: string }> = {
  openai: { platform: 'OpenAI', header: 'x-request-id' },
  anthropic: { platform: 'Anthropic', header: 'request-id' },
  gemini: { platform: 'Gemini', header: 'x-goog-request-id' },
  antigravity: { platform: 'Antigravity', header: 'x-goog-request-id' },
  grok: { platform: 'Grok', header: 'xai-request-id' }
}

/** 上游请求 ID 响应头字段，帮助提示里按平台 / 类型列出常见头名 */
export default function UpstreamRequestIdHeaderField({ value, onChange, platform, type }: UpstreamRequestIdHeaderFieldProps) {
  const { t } = useI18n()

  // 只有 API Key 接入可能指向第三方中继；OAuth / Bedrock / Service Account 都直连官方。
  const examples: HeaderExample[] = []
  if (type === 'apikey') {
    examples.push({
      label: 'sub2api',
      header: 'X-Client-Request-ID',
      note: t('admin.accounts.upstreamRequestIdHeaderHelp.sub2apiNote')
    })
    examples.push({ label: 'new-api / one-api', header: 'X-Oneapi-Request-Id' })
  }
  const official = platform ? OFFICIAL_REQUEST_ID_HEADERS[platform] : undefined
  if (official) {
    examples.push({
      label: t('admin.accounts.upstreamRequestIdHeaderHelp.official', { platform: official.platform }),
      header: official.header
    })
  }

  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor="upstream-request-id-header">
          {t('admin.accounts.upstreamRequestIdHeader')}
        </label>
        <HelpTooltip width="20rem">
          <p className={own.text}>{t('admin.accounts.upstreamRequestIdHeaderHelp.intro')}</p>
          {examples.length ? (
            <>
              <p className={own.title}>{t('admin.accounts.upstreamRequestIdHeaderHelp.examplesTitle')}</p>
              <ul className={own.list}>
                {examples.map((item) => (
                  <li key={item.label}>
                    <div className={own.item}>
                      <span className={own.itemLabel}>{item.label}</span>
                      <code className={own.code}>{item.header}</code>
                    </div>
                    {item.note ? <p className={own.note}>{item.note}</p> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </HelpTooltip>
      </div>
      <input
        id="upstream-request-id-header"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        data-testid="upstream-request-id-header"
        type="text"
        className={styles.input}
        placeholder={t('admin.accounts.upstreamRequestIdHeaderPlaceholder')}
      />
    </div>
  )
}
