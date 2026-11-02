import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

// 复用 api/channels.ts 的用户侧最小形态 DTO。
// admin 侧 ChannelModelPricing 字段更多，但结构上是用户 DTO 的超集，admin 视图传入可直接通过结构化子类型检查。
import type { UserPricingInterval, UserSupportedModel, UserSupportedModelPricing } from '@/api/channels'
import { platformTone } from '@/components/admin/channel/platformTone'
import PlatformIcon from '@/components/common/PlatformIcon'
import { BILLING_MODE_IMAGE, BILLING_MODE_PER_REQUEST, BILLING_MODE_TOKEN, BILLING_MODE_VIDEO } from '@/constants/channel'
import { useI18n } from '@/i18n/useI18n'
import type { GroupPlatform } from '@/types'
import { formatScaled, resolveIntervalPrices } from '@/utils/pricing'
import PricingRow from './PricingRow'
import styles from './SupportedModelChip.module.css'

export interface SupportedModelChipProps {
  model: UserSupportedModel
  /** i18n 前缀：管理端传 `admin.availableChannels.pricing`，用户端传 `availableChannels.pricing`。 */
  pricingKeyPrefix?: string
  noPricingLabel?: string
  showPlatform?: boolean
  /**
   * 当 model.platform 缺失（如 admin 聚合场景）时，用父行的平台作为兜底着色。
   * 仅用于视觉，不影响业务逻辑。
   */
  platformHint?: string
  className?: string
}

/** 按 token 定价展示时的换算单位：每百万 token。 */
const perMillionScale = 1_000_000

function formatRange(min: number, max: number | null): string {
  const maxLabel = max == null ? '∞' : String(max)
  return `(${min}, ${maxLabel}]`
}

/** 支持模型标签，悬停/聚焦时显示价格浮层，对应 Vue 版 SupportedModelChip.vue */
export default function SupportedModelChip({
  model,
  pricingKeyPrefix = 'availableChannels.pricing',
  noPricingLabel = '',
  showPlatform = true,
  platformHint = '',
  className
}: SupportedModelChipProps) {
  const { t } = useI18n()
  const effectivePlatform = model.platform || platformHint || ''
  const prefixKey = (k: string) => `${pricingKeyPrefix}.${k}`
  const pricing = model.pricing

  let billingModeLabel = '-'
  switch (pricing?.billing_mode) {
    case BILLING_MODE_TOKEN:
      billingModeLabel = t(prefixKey('billingModeToken'))
      break
    case BILLING_MODE_PER_REQUEST:
      billingModeLabel = t(prefixKey('billingModePerRequest'))
      break
    case BILLING_MODE_IMAGE:
      billingModeLabel = t(prefixKey('billingModeImage'))
      break
    case BILLING_MODE_VIDEO:
      billingModeLabel = t(prefixKey('billingModeVideo'))
      break
  }

  function formatInterval(iv: UserPricingInterval, p: UserSupportedModelPricing): string {
    if (p.billing_mode === BILLING_MODE_VIDEO) {
      return `${formatScaled(iv.per_request_price, 1)} ${t(prefixKey('unitPerSecond'))}`
    }
    if (p.billing_mode === BILLING_MODE_PER_REQUEST || p.billing_mode === BILLING_MODE_IMAGE) {
      return formatScaled(iv.per_request_price, 1)
    }
    const resolved = resolveIntervalPrices(iv, p)
    const input = formatScaled(resolved.input_price, perMillionScale)
    const output = formatScaled(resolved.output_price, perMillionScale)
    return `${input} / ${output}`
  }

  // ── Popover positioning ─────────────────────────────────────────────
  // Portal-to-body + fixed positioning avoids being clipped by
  // overflow-hidden ancestors (the parent table card). We re-measure on
  // hover enter, scroll, and resize. Pinning to the trigger's top-center
  // with a flip when the viewport edge is near keeps it aligned without a
  // full-blown positioning lib.
  const [show, setShow] = useState(false)
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({ top: '0px', left: '0px' })

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const margin = 8
    const popover = popoverRef.current
    const popWidth = popover?.offsetWidth || 320
    const popHeight = popover?.offsetHeight || 240
    const vw = window.innerWidth
    const vh = window.innerHeight

    let top = rect.bottom + margin
    // Flip upward if it would overflow below.
    if (top + popHeight > vh - margin) {
      top = Math.max(margin, rect.top - popHeight - margin)
    }

    let left = rect.left + rect.width / 2 - popWidth / 2
    if (left < margin) left = margin
    if (left + popWidth > vw - margin) left = vw - margin - popWidth

    setPopoverStyle({ top: `${Math.round(top)}px`, left: `${Math.round(left)}px` })
  }, [])

  useLayoutEffect(() => {
    if (!show) return
    updatePosition()
  }, [show, updatePosition])

  useEffect(() => {
    if (!show) return
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [show, updatePosition])

  const tone = effectivePlatform ? platformTone(effectivePlatform, 'tag', styles.chip) : { className: styles.chip }

  return (
    <div className={[styles.wrapper, className].filter(Boolean).join(' ')}>
      <span
        ref={triggerRef}
        {...tone}
        tabIndex={0}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
      >
        {effectivePlatform && <PlatformIcon platform={effectivePlatform as GroupPlatform} size="xs" />}
        {showPlatform && model.platform && <span className={styles.platformTag}>{model.platform}</span>}
        <span className={styles.chipName}>{model.name}</span>
      </span>

      {show &&
        createPortal(
          <div ref={popoverRef} role="tooltip" className={styles.popover} style={popoverStyle}>
            {/* Header：平台主题色背景，含模型名 + 平台徽章 */}
            <div {...(effectivePlatform ? platformTone(effectivePlatform, 'tag', styles.popoverHeader) : { className: styles.popoverHeader })}>
              <span className={styles.popoverTitle}>{model.name}</span>
              {model.platform && <span className={styles.popoverPlatform}>{model.platform}</span>}
            </div>

            <div className={styles.popoverBody}>
              {!pricing ? (
                <div className={styles.muted}>{noPricingLabel}</div>
              ) : (
                <div className={styles.rows}>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>{t(prefixKey('billingMode'))}</span>
                    <span>{billingModeLabel}</span>
                  </div>

                  {pricing.billing_mode === BILLING_MODE_TOKEN && (
                    <>
                      <PricingRow
                        label={t(prefixKey('inputPrice'))}
                        value={pricing.input_price}
                        unit={t(prefixKey('unitPerMillion'))}
                        scale={perMillionScale}
                      />
                      <PricingRow
                        label={t(prefixKey('outputPrice'))}
                        value={pricing.output_price}
                        unit={t(prefixKey('unitPerMillion'))}
                        scale={perMillionScale}
                      />
                      <PricingRow
                        label={t(prefixKey('cacheWrite5mPrice'))}
                        value={pricing.cache_write_price}
                        unit={t(prefixKey('unitPerMillion'))}
                        scale={perMillionScale}
                      />
                      {pricing.cache_write_1h_price != null && (
                        <PricingRow
                          label={t(prefixKey('cacheWrite1hPrice'))}
                          value={pricing.cache_write_1h_price}
                          unit={t(prefixKey('unitPerMillion'))}
                          scale={perMillionScale}
                        />
                      )}
                      <PricingRow
                        label={t(prefixKey('cacheReadPrice'))}
                        value={pricing.cache_read_price}
                        unit={t(prefixKey('unitPerMillion'))}
                        scale={perMillionScale}
                      />
                      {pricing.image_input_price != null && pricing.image_input_price > 0 && (
                        <PricingRow
                          label={t(prefixKey('imageInputPrice'))}
                          value={pricing.image_input_price}
                          unit={t(prefixKey('unitPerMillion'))}
                          scale={perMillionScale}
                        />
                      )}
                      {pricing.image_output_price != null && pricing.image_output_price > 0 && (
                        <PricingRow
                          label={t(prefixKey('imageOutputPrice'))}
                          value={pricing.image_output_price}
                          unit={t(prefixKey('unitPerMillion'))}
                          scale={perMillionScale}
                        />
                      )}
                    </>
                  )}

                  {pricing.billing_mode === BILLING_MODE_PER_REQUEST && pricing.per_request_price != null && (
                    <PricingRow
                      label={t(prefixKey('perRequestPrice'))}
                      value={pricing.per_request_price}
                      unit={t(prefixKey('unitPerRequest'))}
                      scale={1}
                    />
                  )}

                  {pricing.billing_mode === BILLING_MODE_IMAGE && pricing.image_output_price != null && (
                    <PricingRow
                      label={t(prefixKey('imageOutputPrice'))}
                      value={pricing.image_output_price}
                      unit={t(prefixKey('unitPerRequest'))}
                      scale={1}
                    />
                  )}

                  {pricing.billing_mode === BILLING_MODE_VIDEO && pricing.per_request_price != null && (
                    <PricingRow
                      label={t(prefixKey('videoPrice'))}
                      value={pricing.per_request_price}
                      unit={t(prefixKey('unitPerSecond'))}
                      scale={1}
                    />
                  )}

                  {pricing.intervals && pricing.intervals.length > 0 && (
                    <div className={styles.intervals}>
                      <div className={styles.intervalsTitle}>{t(prefixKey('intervals'))}</div>
                      <div className={styles.intervalRows}>
                        {pricing.intervals.map((iv, idx) => (
                          <div key={idx} className={styles.intervalRow}>
                            <span className={styles.rowLabel}>
                              {iv.tier_label ? iv.tier_label : formatRange(iv.min_tokens, iv.max_tokens)}
                            </span>
                            <span>{formatInterval(iv, pricing)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
