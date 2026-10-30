import { Pencil, Server, Trash2 } from 'lucide-react'

import { Button } from '@/components/arc/button/button'
import { useI18n } from '@/i18n/useI18n'
import type { ProviderInstance } from '@/types/payment'
import type { TypeOption } from './providerConfig'
import { PAYMENT_MODE_POPUP, PAYMENT_MODE_QRCODE, PAYMENT_MODE_REDIRECT } from './providerConfig'
import ToggleSwitch from './ToggleSwitch'
import styles from './ProviderCard.module.css'

const PROVIDER_KEY_LABELS: Record<string, string> = {
  easypay: 'admin.settings.payment.providerEasypay',
  alipay: 'admin.settings.payment.providerAlipay',
  wxpay: 'admin.settings.payment.providerWxpay',
  stripe: 'admin.settings.payment.providerStripe',
  airwallex: 'admin.settings.payment.providerAirwallex'
}

export type ProviderToggleField = 'enabled' | 'refund_enabled' | 'allow_user_refund'

export interface ProviderCardProps {
  provider: ProviderInstance
  enabled: boolean
  availableTypes: TypeOption[]
  onToggleField?: (field: ProviderToggleField) => void
  onToggleType?: (type: string) => void
  onEdit?: () => void
  onDelete?: () => void
}

/** 服务商实例行，对应 Vue 版 ProviderCard.vue：名称、标识、支付模式、支持类型开关、启用/退款开关与编辑删除 */
export default function ProviderCard({
  provider,
  enabled,
  availableTypes,
  onToggleField,
  onToggleType,
  onEdit,
  onDelete
}: ProviderCardProps) {
  const { t } = useI18n()

  const keyLabel = t(PROVIDER_KEY_LABELS[provider.provider_key] || provider.provider_key)

  let modeLabel = ''
  if (provider.payment_mode === PAYMENT_MODE_QRCODE) modeLabel = t('admin.settings.payment.modeQRCode')
  else if (provider.payment_mode === PAYMENT_MODE_POPUP) modeLabel = t('admin.settings.payment.modePopup')
  else if (provider.payment_mode === PAYMENT_MODE_REDIRECT) modeLabel = t('admin.settings.payment.modeRedirect')

  const isSelected = (type: string) =>
    Array.isArray(provider.supported_types) && provider.supported_types.includes(type)

  const active = provider.enabled && enabled

  return (
    <div
      className={styles.card}
      data-disabled={!enabled || undefined}
      title={
        !enabled
          ? t('admin.settings.payment.typeDisabled') + ' · ' + t('admin.settings.payment.enableTypesFirst')
          : undefined
      }
    >
      <div className={styles.row}>
        {/* Left: icon + name + key badge + type badges */}
        <div className={styles.info}>
          <span className={styles.icon} data-active={active || undefined}>
            <Server size={16} aria-hidden="true" />
          </span>
          <span className={styles.name}>{provider.name}</span>
          <span className={styles.meta}>{keyLabel}</span>
          {provider.payment_mode && <span className={styles.meta}>· {modeLabel}</span>}
          {enabled && availableTypes.length > 0 && (
            <span className={styles.separator} aria-hidden="true">
              |
            </span>
          )}
          {enabled && (
            <div className={styles.types}>
              {availableTypes.map((pt) => (
                <button
                  key={pt.value}
                  type="button"
                  className={styles.typeChip}
                  aria-pressed={isSelected(pt.value)}
                  onClick={() => onToggleType?.(pt.value)}
                >
                  {pt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: toggles + actions */}
        <div className={styles.controls}>
          <ToggleSwitch
            label={t('common.enabled')}
            checked={provider.enabled}
            onToggle={() => onToggleField?.('enabled')}
          />
          <ToggleSwitch
            label={t('admin.settings.payment.refundEnabled')}
            checked={provider.refund_enabled}
            onToggle={() => onToggleField?.('refund_enabled')}
          />
          {provider.refund_enabled && (
            <ToggleSwitch
              label={t('admin.settings.payment.allowUserRefund')}
              checked={provider.allow_user_refund}
              onToggle={() => onToggleField?.('allow_user_refund')}
            />
          )}
          <div className={styles.actions}>
            <Button type="button" variant="ghost" size="sm" onClick={() => onEdit?.()}>
              <Pencil size={14} aria-hidden="true" />
              {t('common.edit')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onDelete?.()}>
              <Trash2 size={14} aria-hidden="true" />
              {t('common.delete')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
