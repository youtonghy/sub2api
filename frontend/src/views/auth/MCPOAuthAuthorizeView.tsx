/**
 * MCP OAuth 授权确认页，对应 Vue 版 views/auth/MCPOAuthAuthorizeView.vue。
 * - 只接受白名单内、各出现一次的查询参数，先在前端校验再请求预览；预览结果必须与请求一致
 * - 预览时冻结授权参数，批准/拒绝都提交冻结的副本，路由变化后旧请求和迟到的预览一律作废
 * - 平台管理范围的批准走 step-up 二次验证；只跟随与回调地址同源同路径的服务端跳转
 * 页面自带整页布局（路由 layout: 'none'）。
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { mcpAPI, type MCPAccessScope, type MCPAuthorization, type MCPConsent } from '@/api/mcp'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { RadioCards } from '@/components/arc/radio-cards/radio-cards'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import TotpStepUpDialog from '@/components/auth/TotpStepUpDialog'
import McpIcon from '@/components/common/McpIcon'
import { isStepUpBlocked, isStepUpCancelled, stepUpBlockReason, useStepUp } from '@/composables/useStepUp'
import { useI18n } from '@/i18n/useI18n'
import { useAuthStore } from '@/stores/auth'
import styles from './MCPOAuthAuthorizeView.module.css'

const REQUIRED_PARAMS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'resource'] as const
const ALLOWED_PARAMS: readonly string[] = [...REQUIRED_PARAMS, 'scope', 'state']

class InvalidRequestError extends Error {}

function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : fallback
}

/**
 * 解析查询串。重复参数、无值参数（?state）、白名单外参数或超长值都视为非法，
 * 与 Vue 版对 route.query 中数组、null 值的拒绝规则一致。
 */
function parseAuthorization(search: string): MCPAuthorization {
  const values: Record<string, string> = {}
  for (const segment of search.replace(/^\?/, '').split('&')) {
    if (!segment) continue
    if (!segment.includes('=')) throw new InvalidRequestError()
    const [[key, value]] = Array.from(new URLSearchParams(segment).entries())
    if (!ALLOWED_PARAMS.includes(key) || key in values || value.length > 4096) {
      throw new InvalidRequestError()
    }
    values[key] = value
  }
  if (
    REQUIRED_PARAMS.some((key) => !values[key]) ||
    values.response_type !== 'code' ||
    values.code_challenge_method !== 'S256' ||
    !/^[A-Za-z0-9_-]{43}$/.test(values.code_challenge) ||
    (values.scope !== undefined && values.scope !== '' && values.scope !== 'mcp')
  ) {
    throw new InvalidRequestError()
  }
  return values as unknown as MCPAuthorization
}

function validatePreview(result: MCPConsent, request: MCPAuthorization): void {
  if (
    result.client_id !== request.client_id ||
    result.redirect_uri !== request.redirect_uri ||
    result.resource !== request.resource ||
    result.scope !== 'mcp' ||
    typeof result.client_name !== 'string'
  ) {
    throw new InvalidRequestError()
  }
  const redirect = new URL(result.redirect_uri)
  if (!['https:', 'http:'].includes(redirect.protocol) || redirect.username || redirect.password || redirect.hash) {
    throw new InvalidRequestError()
  }
}

export default function MCPOAuthAuthorizeView() {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const stepUp = useStepUp()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [consent, setConsent] = useState<MCPConsent | null>(null)
  const [scope, setScope] = useState<MCPAccessScope>('user')
  const [readOnly, setReadOnly] = useState(true)

  const authorizationRef = useRef<Readonly<MCPAuthorization> | null>(null)
  const generationRef = useRef(0)
  const submittingRef = useRef(false)

  const invalidRequest = () => new Error(t('mcp.invalidRequest'))

  // 每次查询串变化都清空旧的确认内容并重新校验和预览，旧请求的结果与提交全部作废
  const search = location.search
  const [shownSearch, setShownSearch] = useState(search)
  if (shownSearch !== search) {
    setShownSearch(search)
    setLoading(true)
    setSubmitting(false)
    setPreviewError('')
    setSubmitError('')
    setConsent(null)
    setScope('user')
    setReadOnly(true)
  }

  useEffect(() => {
    const generation = generationRef
    const current = ++generation.current
    stepUp.onCancel()
    authorizationRef.current = null
    submittingRef.current = false

    void (async () => {
      try {
        const request = parseAuthorization(search)
        const result = await mcpAPI.previewAuthorization({ ...request })
        if (current !== generationRef.current) return
        validatePreview(result, request)
        authorizationRef.current = Object.freeze({ ...request })
        setConsent(result)
      } catch (error) {
        if (current !== generationRef.current) return
        setPreviewError(
          error instanceof InvalidRequestError ? t('mcp.invalidRequest') : errorMessage(error, t('mcp.consentLoadFailed'))
        )
      } finally {
        if (current === generationRef.current) setLoading(false)
      }
    })()

    return () => {
      // 卸载或换请求时作废进行中的预览与提交，并关闭 step-up 弹窗
      generation.current++
      authorizationRef.current = null
      stepUp.onCancel()
    }
    // stepUp 控制器与 t 在组件生命周期内稳定，只随查询串重新加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const decide = async (approved: boolean) => {
    const authorization = authorizationRef.current
    if (loading || submittingRef.current || !consent || !authorization) return
    const current = generationRef.current
    const expectedRedirect = new URL(consent.redirect_uri)
    const input = {
      authorization: { ...authorization },
      approved,
      scope: approved && isAdmin ? scope : ('user' as const),
      read_only: approved ? readOnly : true,
    }
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError('')
    try {
      const action = async () => {
        // A changed route or unmounted page must not retry a previous consent.
        if (current !== generationRef.current) throw invalidRequest()
        try {
          return await mcpAPI.authorize(input)
        } catch (error) {
          // Do not open a step-up prompt for a request that is no longer shown.
          if (current !== generationRef.current) throw invalidRequest()
          throw error
        }
      }
      const result = approved && input.scope === 'admin' ? await stepUp.run(action) : await action()
      if (current !== generationRef.current) return
      const destination = new URL(result.redirect_url)
      if (
        destination.origin !== expectedRedirect.origin ||
        destination.pathname !== expectedRedirect.pathname ||
        destination.username ||
        destination.password ||
        destination.hash
      ) {
        throw new Error(t('mcp.invalidRedirect'))
      }
      window.location.assign(result.redirect_url)
    } catch (error) {
      if (current !== generationRef.current) return
      if (!isStepUpCancelled(error)) {
        setSubmitError(
          isStepUpBlocked(error)
            ? stepUpBlockReason(error) === 'STEP_UP_ADMIN_API_KEY_FORBIDDEN'
              ? t('stepUp.adminApiKeyForbidden')
              : t('stepUp.notEnabled')
            : errorMessage(error, t('mcp.consentSubmitFailed'))
        )
      }
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void decide(true)
  }

  const redirectOrigin = consent ? new URL(consent.redirect_uri).origin : ''

  const scopeOptions = [
    { value: 'user', label: t('mcp.userScope'), description: t('mcp.userScopeHint') },
    ...(isAdmin ? [{ value: 'admin', label: t('mcp.adminScope'), description: t('mcp.adminScopeHint') }] : []),
  ]
  const permissionOptions = [
    { value: 'read', label: t('mcp.readOnly'), description: t('mcp.readOnlyHint') },
    { value: 'write', label: t('mcp.readWrite'), description: t('mcp.readWriteHint') },
  ]

  return (
    <main className={styles.screen}>
      <section className={styles.card} aria-labelledby="mcp-consent-title" aria-busy={loading || submitting}>
        <div className={styles.header}>
          <span className={styles.iconTile} aria-hidden="true">
            <McpIcon size={22} strokeWidth={1.75} />
          </span>
          <div className={styles.headerCopy}>
            <h1 id="mcp-consent-title" className={styles.title}>
              {t('mcp.consentTitle')}
            </h1>
            <p className={styles.description}>{t('mcp.consentDescription')}</p>
          </div>
        </div>

        {loading ? (
          <Skeleton lines={4} label={t('mcp.consentLoading')} />
        ) : previewError ? (
          <div className={styles.stack}>
            <Alert tone="danger" title={previewError}>
              {t('mcp.consentRetryHint')}
            </Alert>
            <div>
              <Button type="button" variant="secondary" onClick={() => void navigate('/settings/mcp')}>
                {t('mcp.backToConnections')}
              </Button>
            </div>
          </div>
        ) : consent ? (
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.details}>
              <dl className={styles.detailList}>
                <div>
                  <dt>{t('mcp.applicationName')}</dt>
                  <dd data-testid="client-name" className={styles.clientName}>
                    {consent.client_name}
                  </dd>
                </div>
                <div>
                  <dt>{t('mcp.clientId')}</dt>
                  <dd className={`${styles.mono} ${styles.truncate}`} title={consent.client_id}>
                    {consent.client_id}
                  </dd>
                </div>
                <div>
                  <dt>{t('mcp.returnAddress')}</dt>
                  <dd data-testid="redirect-origin" className={styles.origin}>
                    {redirectOrigin}
                  </dd>
                  <dd data-testid="redirect-uri" className={styles.mono}>
                    {consent.redirect_uri}
                  </dd>
                </div>
                <div>
                  <dt>{t('mcp.requestedAccess')}</dt>
                  <dd>{t('mcp.requestedAccessDescription')}</dd>
                  <dd className={styles.mono}>{consent.resource}</dd>
                </div>
              </dl>
            </div>

            <Alert tone="warning" title={t('mcp.untrustedApplicationHint')} />

            {user?.email && <p className={styles.signedIn}>{t('mcp.signedInAs', { email: user.email })}</p>}

            <div className={styles.field}>
              <span id="mcp-consent-scope-label" className={styles.fieldLabel}>
                {t('mcp.scope')}
              </span>
              <RadioCards
                id="mcp-consent-scope"
                aria-labelledby="mcp-consent-scope-label"
                layout="list"
                options={scopeOptions}
                value={scope}
                disabled={submitting}
                onValueChange={(value) => setScope(value === 'admin' ? 'admin' : 'user')}
              />
            </div>

            <div className={styles.field}>
              <span id="mcp-consent-permissions-label" className={styles.fieldLabel}>
                {t('mcp.permissions')}
              </span>
              <RadioCards
                id="mcp-consent-permissions"
                aria-labelledby="mcp-consent-permissions-label"
                layout="list"
                options={permissionOptions}
                value={readOnly ? 'read' : 'write'}
                disabled={submitting}
                onValueChange={(value) => setReadOnly(value !== 'write')}
              />
              {scope === 'admin' && !readOnly && (
                <p data-testid="admin-write-hint" className={styles.warningText}>
                  {t('mcp.adminWriteHint')}
                </p>
              )}
            </div>

            {submitError && <Alert tone="danger" title={submitError} />}

            <div className={styles.actions}>
              <Button data-testid="deny" type="button" variant="secondary" disabled={submitting} onClick={() => void decide(false)}>
                {t('mcp.deny')}
              </Button>
              <Button data-testid="approve" type="submit" variant="primary" disabled={submitting}>
                {submitting ? t('common.processing') : t('mcp.approve')}
              </Button>
            </div>
          </form>
        ) : null}
      </section>
      <TotpStepUpDialog controller={stepUp} />
    </main>
  )
}
