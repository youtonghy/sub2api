/**
 * 侧边栏导航：与 Vue 版 AppSidebar 的菜单声明、功能开关、简易模式过滤和自定义菜单一一对应。
 * 条目 id 即路由路径。
 */
import { useEffect } from 'react'
import {
  ArrowLeftRight,
  ChartColumn,
  CreditCard,
  Fingerprint,
  Folder,
  Gift,
  Globe,
  Images,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  Network,
  Puzzle,
  Receipt,
  ReceiptText,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Signal,
  Tag,
  Ticket,
  User,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

import type { SidebarEntry, SidebarSection } from '@/components/arc/blocks/sidebar-rail/sidebar-rail'
import { useBatchImageAccess } from '@/composables/useBatchImageAccess'
import { useI18n } from '@/i18n/useI18n'
import { useAdminSettingsStore } from '@/stores/adminSettings'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { CustomMenuItem } from '@/types'
import { FeatureFlags, resolveFeatureFlag } from '@/utils/featureFlags'
import { sanitizeSvg } from '@/utils/sanitize'
import { resolveSiteBillingMode } from '@/utils/siteBillingMode'

interface NavItem {
  path: string
  label: string
  icon?: LucideIcon
  iconSvg?: string
  hideInSimpleMode?: boolean
  children?: NavItem[]
  /** 返回 false 时隐藏；undefined/true 时显示，避免设置未加载时菜单闪烁 */
  featureFlag?: () => boolean | undefined
}

// 递归过滤 featureFlag() === false 的节点（含子节点）
function applyFeatureFlags(items: NavItem[]): NavItem[] {
  const out: NavItem[] = []
  for (const item of items) {
    if (item.featureFlag && item.featureFlag() === false) continue
    out.push(item.children ? { ...item, children: applyFeatureFlags(item.children) } : item)
  }
  return out
}

// 新手引导定位的元素，与 Vue 版保持相同的 id / data-tour
const TOUR_IDS: Record<string, { domId?: string; dataTour?: string }> = {
  '/admin/accounts': { domId: 'sidebar-channel-manage' },
  '/admin/groups': { domId: 'sidebar-group-manage' },
  '/admin/redeem': { domId: 'sidebar-wallet' },
  '/keys': { dataTour: 'sidebar-my-keys' },
}

function customIcon(svg: string) {
  return <span dangerouslySetInnerHTML={{ __html: sanitizeSvg(svg) }} />
}

function toEntry(item: NavItem): SidebarEntry {
  return {
    id: item.path,
    label: item.label,
    icon: item.icon,
    iconNode: item.iconSvg ? customIcon(item.iconSvg) : undefined,
    children: item.children?.map(toEntry),
    ...TOUR_IDS[item.path],
  }
}

function customMenuNav(items: CustomMenuItem[]): NavItem[] {
  return items.map((item) => ({ path: `/custom/${item.id}`, label: item.label, iconSvg: item.icon_svg }))
}

export interface AppNavigation {
  sections: SidebarSection[]
  /** 所有可导航的条目 id（路由路径），用于计算当前高亮 */
  paths: string[]
}

export function useAppNavigation(): AppNavigation {
  const { t } = useI18n()
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const isSimpleMode = useAuthStore((state) => state.isSimpleMode)
  const settings = useAppStore((state) => state.cachedPublicSettings)
  const backendModeEnabled = useAppStore((state) => state.backendModeEnabled)
  const adminCustomMenuItems = useAdminSettingsStore((state) => state.customMenuItems)
  const opsMonitoringEnabled = useAdminSettingsStore((state) => state.opsMonitoringEnabled)
  const adminPaymentEnabled = useAdminSettingsStore((state) => state.paymentEnabled)
  const { canUseBatchImage, refreshBatchImageAccess } = useBatchImageAccess()

  useEffect(() => {
    void refreshBatchImageAccess()
  }, [refreshBatchImageAccess])

  // Fetch admin settings (for feature-gated nav items like Ops).
  useEffect(() => {
    if (isAdmin) {
      void useAdminSettingsStore.getState().fetch()
    }
  }, [isAdmin])

  const flag = (definition: (typeof FeatureFlags)[keyof typeof FeatureFlags]) => () => resolveFeatureFlag(settings, definition)
  const flagChannelMonitor = flag(FeatureFlags.channelMonitor)
  const flagPayment = flag(FeatureFlags.payment)
  const flagAvailableChannels = flag(FeatureFlags.availableChannels)
  const flagSubscription = flag(FeatureFlags.subscription)
  const flagAffiliate = flag(FeatureFlags.affiliate)
  const flagRiskControl = flag(FeatureFlags.riskControl)
  const flagPluginManagement = flag(FeatureFlags.pluginManagement)

  // 购买入口文案随站点计费模式切换：仅充值 → 「充值」，仅订阅 → 「订阅」，否则「充值/订阅」
  const purchaseNavLabel = (() => {
    switch (resolveSiteBillingMode(settings)) {
      case 'recharge_only':
        return t('nav.recharge')
      case 'subscription_only':
        return t('nav.subscribe')
      default:
        return t('nav.buySubscription')
    }
  })()

  const userCustomItems = (settings?.custom_menu_items ?? [])
    .filter((item) => item.visibility === 'user')
    .sort((a, b) => a.sort_order - b.sort_order)
  const adminCustomItems = adminCustomMenuItems
    .filter((item) => item.visibility === 'admin')
    .sort((a, b) => a.sort_order - b.sort_order)

  // 用户自己的导航项（用户端主菜单与管理员的「我的账户」共享）。
  // 顺序：密钥 → 用量 → 可用渠道 → 渠道状态 → 订阅/支付 → 兑换/资料。
  function buildSelfNavItems(withDashboard: boolean): NavItem[] {
    const items: NavItem[] = []
    if (withDashboard) {
      items.push({ path: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard })
    }
    items.push(
      { path: '/keys', label: t('nav.apiKeys'), icon: KeyRound },
      { path: '/batch-image', label: t('nav.batchImage'), icon: Images, hideInSimpleMode: true, featureFlag: () => canUseBatchImage },
      { path: '/usage', label: t('nav.usage'), icon: ChartColumn, hideInSimpleMode: true },
      { path: '/available-channels', label: t('nav.availableChannels'), icon: Network, hideInSimpleMode: true, featureFlag: flagAvailableChannels },
      { path: '/monitor', label: t('nav.channelStatus'), icon: Signal, featureFlag: flagChannelMonitor },
      { path: '/subscriptions', label: t('nav.mySubscriptions'), icon: CreditCard, hideInSimpleMode: true, featureFlag: flagSubscription },
      { path: '/purchase', label: purchaseNavLabel, icon: Wallet, hideInSimpleMode: true, featureFlag: flagPayment },
      { path: '/orders', label: t('nav.myOrders'), icon: ReceiptText, hideInSimpleMode: true, featureFlag: flagPayment },
      { path: '/redeem', label: t('nav.redeem'), icon: Gift, hideInSimpleMode: true },
      { path: '/affiliate', label: t('nav.affiliate'), icon: Users, hideInSimpleMode: true, featureFlag: flagAffiliate },
      { path: '/profile', label: t('nav.profile'), icon: User },
      ...customMenuNav(userCustomItems),
    )
    return items
  }

  function finalizeNav(items: NavItem[]): NavItem[] {
    const visible = applyFeatureFlags(items)
    return isSimpleMode ? visible.filter((item) => !item.hideInSimpleMode) : visible
  }

  function buildAdminNavItems(): NavItem[] {
    const baseItems: NavItem[] = [
      { path: '/admin/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
      { path: '/admin/ops', label: t('nav.ops'), icon: ChartColumn, featureFlag: () => opsMonitoringEnabled },
      { path: '/admin/users', label: t('nav.users'), icon: Users, hideInSimpleMode: true },
      { path: '/admin/groups', label: t('nav.groups'), icon: Folder },
      {
        path: '/admin/channels',
        label: t('nav.channelManagement'),
        icon: Network,
        hideInSimpleMode: true,
        children: [
          { path: '/admin/channels/pricing', label: t('nav.channelPricing'), icon: Tag },
          { path: '/admin/channels/monitor', label: t('nav.channelMonitor'), icon: Signal, featureFlag: flagChannelMonitor },
        ],
      },
      // 「仅充值」站点连管理端的「订阅管理」入口也一并收起（路由本身不拦截）
      { path: '/admin/subscriptions', label: t('nav.subscriptions'), icon: CreditCard, hideInSimpleMode: true, featureFlag: flagSubscription },
      { path: '/admin/accounts', label: t('nav.accounts'), icon: Globe },
      { path: '/admin/accounts/model-verification', label: t('nav.modelFingerprint'), icon: Fingerprint },
      { path: '/admin/plugins', label: t('nav.plugins'), icon: Puzzle, featureFlag: flagPluginManagement },
      { path: '/admin/announcements', label: t('nav.announcements'), icon: Megaphone },
      { path: '/admin/proxies', label: t('nav.proxies'), icon: Server },
      {
        path: '/admin/security-audit',
        label: t('nav.securityAudit'),
        icon: Shield,
        featureFlag: flagRiskControl,
        children: [
          { path: '/admin/risk-control', label: t('nav.contentModeration'), icon: ShieldCheck },
          { path: '/admin/prompt-audit', label: t('nav.promptAudit'), icon: ShieldCheck },
        ],
      },
      { path: '/admin/redeem', label: t('nav.redeemCodes'), icon: Ticket, hideInSimpleMode: true },
      { path: '/admin/promo-codes', label: t('nav.promoCodes'), icon: Gift, hideInSimpleMode: true },
      {
        path: '/admin/affiliates',
        label: t('nav.affiliateManagement'),
        icon: Users,
        hideInSimpleMode: true,
        featureFlag: flagAffiliate,
        children: [
          { path: '/admin/affiliates/invites', label: t('nav.affiliateInviteRecords'), icon: Users },
          { path: '/admin/affiliates/rebates', label: t('nav.affiliateRebateRecords'), icon: Receipt },
          { path: '/admin/affiliates/transfers', label: t('nav.affiliateTransferRecords'), icon: ArrowLeftRight },
        ],
      },
      {
        path: '/admin/orders-group',
        label: t('nav.orderManagement'),
        icon: Receipt,
        hideInSimpleMode: true,
        featureFlag: () => adminPaymentEnabled,
        children: [
          { path: '/admin/orders/dashboard', label: t('nav.paymentDashboard'), icon: ChartColumn },
          { path: '/admin/orders', label: t('nav.orderManagement'), icon: Receipt },
          { path: '/admin/orders/plans', label: t('nav.paymentPlans'), icon: CreditCard },
        ],
      },
      { path: '/admin/usage', label: t('nav.usage'), icon: ChartColumn },
      { path: '/admin/audit-logs', label: t('nav.auditLogs'), icon: Shield, hideInSimpleMode: true },
    ]

    const visible = applyFeatureFlags(baseItems)
    // 简单模式下，在系统设置前插入 API 密钥
    const items = isSimpleMode ? visible.filter((item) => !item.hideInSimpleMode) : visible
    if (isSimpleMode) {
      items.push({ path: '/keys', label: t('nav.apiKeys'), icon: KeyRound })
    }
    items.push({ path: '/admin/settings', label: t('nav.settings'), icon: Settings })
    items.push(...customMenuNav(adminCustomItems))
    return items
  }

  let sections: SidebarSection[] = []
  if (isAdmin) {
    sections = [{ id: 'admin', items: buildAdminNavItems().map(toEntry) }]
    // 管理员的「我的账户」分区（简单模式下隐藏）
    if (!isSimpleMode) {
      sections.push({ id: 'personal', heading: t('nav.myAccount'), items: finalizeNav(buildSelfNavItems(false)).map(toEntry) })
    }
  } else if (!backendModeEnabled) {
    sections = [{ id: 'user', items: finalizeNav(buildSelfNavItems(true)).map(toEntry) }]
  }

  // 分组只负责展开，不参与高亮匹配
  const paths = sections.flatMap((section) =>
    section.items.flatMap((entry) => (entry.children?.length ? entry.children.map((child) => child.id) : [entry.id])),
  )
  return { sections, paths }
}

/**
 * 当前高亮条目：精确匹配或前缀匹配（与 Vue 版 isActive 相同），多个命中时取最长路径，
 * 避免 /admin/accounts 抢走 /admin/accounts/model-verification 的高亮。
 */
export function resolveActiveEntry(pathname: string, paths: string[]): string | null {
  let best: string | null = null
  for (const path of paths) {
    if (pathname === path || pathname.startsWith(`${path}/`)) {
      if (!best || path.length > best.length) best = path
    }
  }
  return best
}
