/**
 * MCP 连接页，对应 Vue 版 views/user/MCPView.vue：
 * 展示服务器 URL 与 OAuth 接入步骤，列出已授权应用并可在确认后撤销。
 * 服务器 URL 与授权列表分别加载，任一失败不影响另一个。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'

import { mcpAPI, type MCPGrant } from '@/api/mcp'
import { Alert } from '@/components/arc/alert/alert'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { Input } from '@/components/arc/input/input'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import BaseDialog from '@/components/common/BaseDialog'
import McpIcon from '@/components/common/McpIcon'
import { useClipboard } from '@/composables/useClipboard'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { formatDate } from '@/utils/format'
import styles from './MCPView.module.css'

function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : fallback
}

function isActive(grant: MCPGrant): boolean {
  return !grant.revoked_at && !grant.invalidated && new Date(grant.expires_at).getTime() > Date.now()
}

export default function MCPView() {
  const { t } = useI18n()
  const { copyToClipboard } = useClipboard()

  const [endpoint, setEndpoint] = useState('')
  const [connectionLoading, setConnectionLoading] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [grants, setGrants] = useState<MCPGrant[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [revokeTarget, setRevokeTarget] = useState<MCPGrant | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [revokeError, setRevokeError] = useState('')

  // 同步读取的忙碌标记，避免同一帧内重复点击发出重复请求
  const connectionLoadingRef = useRef(false)
  const loadingRef = useRef(false)
  const revokingRef = useRef(false)
  const unmountedRef = useRef(false)

  const loadConnection = useCallback(async () => {
    if (connectionLoadingRef.current) return
    connectionLoadingRef.current = true
    setConnectionLoading(true)
    setConnectionError('')
    setEndpoint('')
    try {
      const result = await mcpAPI.getConnectionConfig()
      if (!unmountedRef.current) setEndpoint(result.resource)
    } catch (error) {
      if (!unmountedRef.current) setConnectionError(errorMessage(error, t('mcp.connectionLoadFailed')))
    } finally {
      connectionLoadingRef.current = false
      if (!unmountedRef.current) setConnectionLoading(false)
    }
  }, [t])

  const loadGrants = useCallback(async () => {
    if (loadingRef.current || revokingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setLoadError('')
    try {
      const result = await mcpAPI.listGrants()
      if (!unmountedRef.current) setGrants(result)
    } catch (error) {
      if (!unmountedRef.current) setLoadError(errorMessage(error, t('mcp.loadFailed')))
    } finally {
      loadingRef.current = false
      if (!unmountedRef.current) setLoading(false)
    }
  }, [t])

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [])

  useMountOnce(() => {
    void loadConnection()
    void loadGrants()
  })

  const grantStatus = (grant: MCPGrant): string => {
    if (grant.revoked_at) return t('mcp.revoked')
    if (grant.invalidated) return t('mcp.invalidated')
    return isActive(grant) ? t('mcp.active') : t('mcp.expired')
  }

  const closeRevoke = () => {
    if (revokingRef.current) return
    setRevokeTarget(null)
    setRevokeError('')
  }

  const revokeGrant = async () => {
    if (!revokeTarget || revokingRef.current || loadingRef.current) return
    revokingRef.current = true
    setRevoking(true)
    setRevokeError('')
    const id = revokeTarget.id
    try {
      await mcpAPI.revokeGrant(id)
      if (unmountedRef.current) return
      const revokedAt = new Date().toISOString()
      setGrants((current) => current.map((grant) => (grant.id === id ? { ...grant, revoked_at: revokedAt } : grant)))
      setRevokeTarget(null)
      useAppStore.getState().showSuccess(t('mcp.revokeSuccess'))
    } catch (error) {
      if (!unmountedRef.current) setRevokeError(errorMessage(error, t('mcp.revokeFailed')))
    } finally {
      revokingRef.current = false
      if (!unmountedRef.current) setRevoking(false)
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.panel} aria-labelledby="mcp-connection-title" aria-busy={connectionLoading}>
        <div className={styles.header}>
          <span className={styles.iconTile} aria-hidden="true">
            <McpIcon size={22} strokeWidth={1.75} />
          </span>
          <div className={styles.headerCopy}>
            <h2 id="mcp-connection-title" className={styles.title}>
              {t('mcp.connectionTitle')}
            </h2>
            <p className={styles.description}>{t('mcp.connectionDescription')}</p>
          </div>
        </div>

        <div className={styles.endpointRow}>
          <div className={styles.endpointField}>
            <Input
              id="mcp-endpoint"
              label={t('mcp.endpoint')}
              value={endpoint}
              placeholder={connectionLoading ? t('mcp.connectionLoading') : ''}
              className={styles.mono}
              readOnly
            />
          </div>
          <Button
            data-testid="copy-endpoint"
            variant="secondary"
            className={styles.copyButton}
            disabled={!endpoint || connectionLoading}
            onClick={() => void copyToClipboard(endpoint)}
          >
            <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>{t('mcp.copyEndpoint')}</span>
          </Button>
        </div>

        {connectionError && (
          <div className={styles.connectionError}>
            <Alert tone="danger" title={connectionError} />
            <div>
              <Button
                data-testid="retry-connection"
                variant="secondary"
                size="sm"
                disabled={connectionLoading}
                onClick={() => void loadConnection()}
              >
                <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
                <span>{t('common.refresh')}</span>
              </Button>
            </div>
          </div>
        )}

        <ol className={styles.steps}>
          <li>{t('mcp.connectStep1')}</li>
          <li>{t('mcp.connectStep2')}</li>
          <li>{t('mcp.connectStep3')}</li>
        </ol>

        <p className={styles.capabilities}>{t('mcp.capabilities')}</p>
      </section>

      <section className={styles.panel} aria-labelledby="mcp-grants-title">
        <div className={styles.grantsHeader}>
          <div className={styles.headerCopy}>
            <h2 id="mcp-grants-title" className={styles.title}>
              {t('mcp.grantsTitle')}
            </h2>
            <p className={styles.description}>{t('mcp.grantsDescription')}</p>
          </div>
          <Button
            data-testid="refresh-grants"
            variant="secondary"
            disabled={loading || revoking}
            onClick={() => void loadGrants()}
          >
            <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>{t('common.refresh')}</span>
          </Button>
        </div>

        <div aria-busy={loading}>
          {loadError ? (
            <Alert tone="danger" title={loadError} />
          ) : loading ? (
            <Skeleton lines={3} label={t('mcp.loading')} />
          ) : grants.length === 0 ? (
            <EmptyState
              title={t('mcp.grantsTitle')}
              description={t('mcp.empty')}
              icon={<McpIcon size={24} strokeWidth={1.5} />}
            />
          ) : (
            <ul className={styles.grantList}>
              {grants.map((grant) => {
                const active = isActive(grant)
                return (
                  <li key={grant.id} className={styles.grant} data-grant-id={grant.id}>
                    <div className={styles.grantBody}>
                      <div className={styles.grantTitleRow}>
                        <span className={styles.grantName}>{grant.client_name}</span>
                        <Badge size="sm">{grant.scope === 'admin' ? t('mcp.adminScope') : t('mcp.userScope')}</Badge>
                        <Badge size="sm" tone={grant.read_only ? 'info' : 'warning'}>
                          {grant.read_only ? t('mcp.readOnly') : t('mcp.readWrite')}
                        </Badge>
                        <span className={active ? styles.statusActive : styles.statusInactive}>{grantStatus(grant)}</span>
                      </div>
                      <p className={styles.clientId} title={grant.client_id}>
                        {grant.client_id}
                      </p>
                      <div className={styles.grantMeta}>
                        <span>{t('mcp.createdAt', { date: formatDate(grant.created_at) })}</span>
                        <span>{t('mcp.expiresAt', { date: formatDate(grant.expires_at) })}</span>
                        <span>
                          {grant.last_used_at
                            ? t('mcp.lastUsedAt', { date: formatDate(grant.last_used_at) })
                            : t('mcp.neverUsed')}
                        </span>
                      </div>
                    </div>
                    {!grant.revoked_at && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className={styles.revokeButton}
                        aria-label={`${t('mcp.revoke')} ${grant.client_name}`}
                        onClick={() => setRevokeTarget(grant)}
                      >
                        {t('mcp.revoke')}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      <BaseDialog
        show={!!revokeTarget}
        title={t('mcp.revokeTitle')}
        width="narrow"
        closeOnEscape={!revoking}
        showCloseButton={!revoking}
        onClose={closeRevoke}
        footer={
          <div className={styles.dialogFooter}>
            <Button variant="secondary" disabled={revoking} onClick={closeRevoke}>
              {t('common.cancel')}
            </Button>
            <Button
              data-testid="confirm-revoke"
              variant="danger"
              loading={revoking}
              disabled={revoking || loading}
              onClick={() => void revokeGrant()}
            >
              {revoking ? t('common.processing') : t('mcp.revoke')}
            </Button>
          </div>
        }
      >
        <p className={styles.dialogText}>{t('mcp.revokeConfirm', { name: revokeTarget?.client_name || '' })}</p>
        {revokeError && (
          <div className={styles.dialogError}>
            <Alert tone="danger" title={revokeError} />
          </div>
        )}
      </BaseDialog>
    </div>
  )
}
