import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

import { totpAPI } from '@/api'
import { Button } from '@/components/arc/button/button'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { useI18n } from '@/i18n/useI18n'
import type { TotpStatus } from '@/types'
import TotpDisableDialog from './TotpDisableDialog'
import TotpSetupModal from './TotpSetupModal'
import shared from './Profile.module.css'

const formatDate = (timestamp: number) => {
  // Backend returns Unix timestamp in seconds, convert to milliseconds
  const date = new Date(timestamp * 1000)
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** 两步验证状态与启用/停用入口，对应 Vue 版 ProfileTotpCard.vue */
export default function ProfileTotpCard() {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<TotpStatus | null>(null)
  const [showSetupModal, setShowSetupModal] = useState(false)
  const [showDisableDialog, setShowDisableDialog] = useState(false)

  const loadStatus = async () => {
    setLoading(true)
    try {
      setStatus(await totpAPI.getStatus())
    } catch (error) {
      console.error('Failed to load TOTP status:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时加载（Vue 版 onMounted）
    void loadStatus()
  }, [])

  return (
    <section className={shared.panel}>
      <div className={shared.panelHeader}>
        <div>
          <h2 className={shared.panelTitle}>{t('profile.totp.title')}</h2>
          <p className={shared.panelDescription}>{t('profile.totp.description')}</p>
        </div>
      </div>
      <div className={shared.panelBody}>
        {loading ? (
          <div className={shared.loadingRow}>
            <LoadingSpinner size="lg" />
          </div>
        ) : status && !status.feature_enabled ? (
          /* Feature disabled globally */
          <div className={shared.statusInfo}>
            <span className={shared.statusIcon}>
              <ShieldAlert size={24} strokeWidth={1.5} aria-hidden="true" />
            </span>
            <div>
              <p className={shared.statusTitle}>{t('profile.totp.featureDisabled')}</p>
              <p className={shared.muted}>{t('profile.totp.featureDisabledHint')}</p>
            </div>
          </div>
        ) : status?.enabled ? (
          <div className={shared.statusRow}>
            <div className={shared.statusInfo}>
              <span className={shared.statusIcon} data-tone="success">
                <ShieldCheck size={24} strokeWidth={1.5} aria-hidden="true" />
              </span>
              <div>
                <p className={shared.statusTitle}>{t('profile.totp.enabled')}</p>
                {status.enabled_at && (
                  <p className={shared.muted}>
                    {t('profile.totp.enabledAt')}: {formatDate(status.enabled_at)}
                  </p>
                )}
              </div>
            </div>
            <Button type="button" variant="danger" onClick={() => setShowDisableDialog(true)}>
              {t('profile.totp.disable')}
            </Button>
          </div>
        ) : (
          <div className={shared.statusRow}>
            <div className={shared.statusInfo}>
              <span className={shared.statusIcon}>
                <ShieldCheck size={24} strokeWidth={1.5} aria-hidden="true" />
              </span>
              <div>
                <p className={shared.statusTitle}>{t('profile.totp.notEnabled')}</p>
                <p className={shared.muted}>{t('profile.totp.notEnabledHint')}</p>
              </div>
            </div>
            <Button type="button" onClick={() => setShowSetupModal(true)}>
              {t('profile.totp.enable')}
            </Button>
          </div>
        )}
      </div>

      {showSetupModal && (
        <TotpSetupModal
          onClose={() => setShowSetupModal(false)}
          onSuccess={() => {
            setShowSetupModal(false)
            void loadStatus()
          }}
        />
      )}

      {showDisableDialog && (
        <TotpDisableDialog
          onClose={() => setShowDisableDialog(false)}
          onSuccess={() => {
            setShowDisableDialog(false)
            void loadStatus()
          }}
        />
      )}
    </section>
  )
}
