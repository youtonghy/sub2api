/**
 * 路由元信息，与 Vue 版 RouteMeta 一一对应（见 frontend/src/router/meta.d.ts）。
 * React Router 中放在每条路由的 handle 上。
 */
export interface RouteMeta {
  /** 默认 true，显式 false 时为公开页面 */
  requiresAuth?: boolean
  requiresAdmin?: boolean
  /** 静态标题，titleKey 翻译失败时使用 */
  title?: string
  /** 支付功能关闭时拦截 */
  requiresPayment?: boolean
  /** 风控功能关闭时拦截 */
  requiresRiskControl?: boolean
  /** 订阅功能显式关闭时拦截 */
  requiresSubscription?: boolean
  titleKey?: string
  descriptionKey?: string
}

/** 页面外层布局：app 为侧边栏外壳，auth 为登录类页面，none 为页面自带完整布局 */
export type RouteLayout = 'app' | 'auth' | 'none'

export interface AppRouteHandle {
  name: string
  meta: RouteMeta
}

/** title.ts 等纯函数使用的最小路由形状 */
export interface RouteLike {
  name?: string | null
  params: Record<string, string | undefined>
  meta: RouteMeta
}
