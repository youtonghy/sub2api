/**
 * 账号行"更多"菜单，对应 Vue 版 AccountActionMenu.vue。
 * 菜单锚定在触发按钮的 DOMRect（anchorRect）上：渲染后测量自身尺寸，放不下时翻到按钮上方，
 * 窄屏（< 768px）水平居中于按钮，始终保持 8px 视口边距；内容尺寸或视口变化时重新定位。
 * 外观沿用 Arc dropdown-menu 的面板与菜单项 token。Arc dropdown-menu 自带触发器、
 * 无法锚定到任意矩形，因此保留自有定位逻辑。点击遮罩或按 Escape 关闭。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BarChart3, Clock, Copy, Link2, Play, RefreshCw, RotateCcw, Shield, Sparkles } from 'lucide-react'

import { useI18n } from '@/i18n/useI18n'
import type { Account } from '@/types'
import { supportsAccountQuota } from '@/utils/accountQuota'
import styles from './AccountActionMenu.module.css'

export interface AccountActionMenuProps {
  show: boolean
  account: Account | null
  anchorRect: DOMRect | null
  onClose?: () => void
  onTest?: (account: Account) => void
  onStats?: (account: Account) => void
  onSchedule?: (account: Account) => void
  onDuplicate?: (account: Account) => void
  onReauth?: (account: Account) => void
  onRefreshToken?: (account: Account) => void
  onRecoverState?: (account: Account) => void
  onResetQuota?: (account: Account) => void
  onSetPrivacy?: (account: Account) => void
  onCreateSparkShadow?: (account: Account) => void
}

const viewportPadding = 8

const readViewport = () => ({ width: window.innerWidth, height: window.innerHeight })

type Tone = 'default' | 'success' | 'accent' | 'warning'

export default function AccountActionMenu({
  show,
  account,
  anchorRect,
  onClose,
  onTest,
  onStats,
  onSchedule,
  onDuplicate,
  onReauth,
  onRefreshToken,
  onRecoverState,
  onResetQuota,
  onSetPrivacy,
  onCreateSparkShadow
}: AccountActionMenuProps) {
  const { t } = useI18n()
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(readViewport)
  const [position, setPosition] = useState({ top: viewportPadding, left: viewportPadding })
  const viewportRef = useRef(viewport)
  const anchorRef = useRef(anchorRect)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    viewportRef.current = viewport
    anchorRef.current = anchorRect
    onCloseRef.current = onClose
  })

  const updatePosition = useCallback(() => {
    const menu = menuRef.current
    const anchor = anchorRef.current
    if (!menu || !anchor) return
    const { width: viewportWidth, height: viewportHeight } = viewportRef.current

    const { width, height } = menu.getBoundingClientRect()
    const gap = 4
    const maxTop = viewportHeight - height - viewportPadding
    const top = anchor.bottom + gap <= maxTop ? anchor.bottom + gap : anchor.top - height - gap
    const left = viewportWidth < 768 ? anchor.left + anchor.width / 2 - width / 2 : anchor.right - width

    const next = {
      top: Math.max(viewportPadding, Math.min(top, maxTop)),
      left: Math.max(viewportPadding, Math.min(left, viewportWidth - width - viewportPadding))
    }
    setPosition((current) => (current.top === next.top && current.left === next.left ? current : next))
  }, [])

  // 视口尺寸变化：更新尺寸上限并重新定位
  useEffect(() => {
    const onResize = () => setViewport(readViewport())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const visible = show && anchorRect !== null

  // Measure after rendering; menu items and translated labels can change its size.
  useLayoutEffect(() => {
    if (!visible) return
    viewportRef.current = viewport
    anchorRef.current = anchorRect
    updatePosition()
  }, [visible, anchorRect, viewport, account, updatePosition])

  useEffect(() => {
    const menu = menuRef.current
    if (!visible || !menu || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => updatePosition())
    observer.observe(menu)
    return () => observer.disconnect()
  }, [visible, updatePosition])

  useEffect(() => {
    if (!show) return
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current?.()
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [show])

  if (!visible) return null

  const now = new Date()
  const canDuplicate =
    !!account && account.parent_account_id == null && ['apikey', 'upstream', 'bedrock', 'service_account'].includes(account.type)
  const isRateLimited = (() => {
    if (account?.rate_limit_reset_at && new Date(account.rate_limit_reset_at) > now) return true
    const modelLimits = (account?.extra as Record<string, unknown> | undefined)?.model_rate_limits as
      | Record<string, { rate_limit_reset_at: string }>
      | undefined
    if (modelLimits) {
      return Object.values(modelLimits).some((info) => new Date(info.rate_limit_reset_at) > now)
    }
    return false
  })()
  const isOverloaded = !!account?.overload_until && new Date(account.overload_until) > now
  const isTempUnschedulable = !!account?.temp_unschedulable_until && new Date(account.temp_unschedulable_until) > now
  const hasRecoverableState = account?.status === 'error' || isRateLimited || isOverloaded || isTempUnschedulable
  const isAntigravityOAuth = account?.platform === 'antigravity' && account?.type === 'oauth'
  const isOpenAIOAuth = account?.platform === 'openai' && account?.type === 'oauth'
  // 影子账号(链接型,持 parent_account_id)不持凭据、type 不可变,凭据/隐私类操作对其无效。
  const isShadow = account?.parent_account_id != null
  // A "parent" OpenAI OAuth account is one that is NOT itself a shadow (parent_account_id == null)
  const isOpenAIOAuthParent = isOpenAIOAuth && !isShadow
  const supportsPrivacy = (isAntigravityOAuth || isOpenAIOAuth) && !isShadow
  const hasQuotaLimit =
    supportsAccountQuota(account?.type) &&
    ((account?.quota_limit ?? 0) > 0 || (account?.quota_daily_limit ?? 0) > 0 || (account?.quota_weekly_limit ?? 0) > 0)

  const item = (
    label: string,
    icon: ReactNode,
    handler: ((account: Account) => void) | undefined,
    tone: Tone = 'default'
  ) => (
    <button
      type="button"
      role="menuitem"
      className={styles.item}
      data-tone={tone === 'default' ? undefined : tone}
      onClick={() => {
        if (account) handler?.(account)
        onClose?.()
      }}
    >
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      {label}
    </button>
  )

  const iconProps = { size: 16, strokeWidth: 1.75 }

  return createPortal(
    <div>
      {/* Backdrop: click anywhere outside to close */}
      <div className={styles.backdrop} onClick={() => onClose?.()} />
      <div
        ref={menuRef}
        role="menu"
        className={`action-menu-content ${styles.menu}`}
        style={{
          top: `${position.top}px`,
          left: `${position.left}px`,
          maxWidth: `${Math.max(0, viewport.width - viewportPadding * 2)}px`,
          maxHeight: `${Math.max(0, viewport.height - viewportPadding * 2)}px`
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {account && (
          <>
            {item(t('admin.accounts.testConnection'), <Play {...iconProps} />, onTest, 'success')}
            {item(t('admin.accounts.viewStats'), <BarChart3 {...iconProps} />, onStats)}
            {item(t('admin.scheduledTests.schedule'), <Clock {...iconProps} />, onSchedule)}
            {canDuplicate && item(t('admin.accounts.duplicateAccount'), <Copy {...iconProps} />, onDuplicate)}
            {/* 影子账号不持凭据:重授权/刷新 token 对其无效(后端拒绝),故隐藏(外审 G4)。 */}
            {(account.type === 'oauth' || account.type === 'setup-token') && !isShadow && (
              <>
                {item(t('admin.accounts.reAuthorize'), <Link2 {...iconProps} />, onReauth, 'accent')}
                {item(t('admin.accounts.refreshToken'), <RefreshCw {...iconProps} />, onRefreshToken, 'accent')}
              </>
            )}
            {isOpenAIOAuthParent &&
              item(t('admin.accounts.createSparkShadow'), <Sparkles {...iconProps} />, onCreateSparkShadow, 'warning')}
            {supportsPrivacy && item(t('admin.accounts.setPrivacy'), <Shield {...iconProps} />, onSetPrivacy, 'success')}
            {hasRecoverableState && <div className={styles.separator} role="separator" />}
            {hasRecoverableState &&
              item(t('admin.accounts.recoverState'), <RotateCcw {...iconProps} />, onRecoverState, 'success')}
            {hasQuotaLimit && item(t('admin.accounts.resetQuota'), <RefreshCw {...iconProps} />, onResetQuota, 'success')}
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
