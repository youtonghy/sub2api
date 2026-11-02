import type { SubscriptionPlan } from '@/types/payment'
import { normalizeVisibleMethod } from '@/components/payment/paymentFlow'

/** 路由 query（对应 vue-router 的 LocationQuery：值可能是字符串、数组或空） */
export type RouteQuery = Record<string, string | null | undefined | Array<string | null>>

export interface ParsedWechatResumeRoute {
  orderAmount: number
  orderType: 'balance' | 'subscription'
  paymentType: string
  planId?: number
  openid?: string
  wechatResumeToken?: string
}

/** URLSearchParams → RouteQuery：重复键保留为数组，与 vue-router 的解析一致 */
export function searchParamsToQuery(params: URLSearchParams): RouteQuery {
  const query: RouteQuery = {}
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key)
    query[key] = values.length > 1 ? values : values[0]
  }
  return query
}

/** RouteQuery → 查询字符串（跳过 null / undefined） */
export function queryToSearch(query: RouteQuery): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) {
      if (item !== null && item !== undefined) params.append(key, item)
    }
  }
  const search = params.toString()
  return search ? `?${search}` : ''
}

function readQueryString(query: RouteQuery, key: string): string {
  const value = query[key]
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }
  return typeof value === 'string' ? value : ''
}

export function hasWechatResumeQuery(query: RouteQuery): boolean {
  if (readQueryString(query, 'wechat_resume') === '1') {
    return true
  }
  return readQueryString(query, 'wechat_resume_token') !== ''
    || readQueryString(query, 'openid') !== ''
}

export function parseWechatResumeRoute(
  query: RouteQuery,
  plans: SubscriptionPlan[],
  fallbackBalanceAmount: number,
): ParsedWechatResumeRoute | null {
  if (!hasWechatResumeQuery(query)) {
    return null
  }

  const wechatResumeToken = readQueryString(query, 'wechat_resume_token')
  const paymentType = normalizeVisibleMethod(readQueryString(query, 'payment_type')) || 'wxpay'
  const planId = Number.parseInt(readQueryString(query, 'plan_id'), 10)
  const hasPlanId = Number.isFinite(planId) && planId > 0
  const orderType = readQueryString(query, 'order_type') === 'subscription' || hasPlanId
    ? 'subscription'
    : 'balance'

  if (wechatResumeToken) {
    return {
      wechatResumeToken,
      paymentType,
      orderType,
      orderAmount: 0,
      planId: hasPlanId ? planId : undefined,
    }
  }

  const openid = readQueryString(query, 'openid')
  if (!openid) {
    return null
  }

  const rawAmount = Number.parseFloat(readQueryString(query, 'amount'))
  const orderAmount = Number.isFinite(rawAmount) && rawAmount > 0
    ? rawAmount
    : (orderType === 'subscription'
      ? (plans.find(plan => plan.id === planId)?.price ?? 0)
      : fallbackBalanceAmount)

  return {
    openid,
    paymentType,
    orderType,
    orderAmount,
    planId: hasPlanId ? planId : undefined,
  }
}

export function stripWechatResumeQuery(query: RouteQuery): RouteQuery {
  const nextQuery: RouteQuery = { ...query }
  delete nextQuery.wechat_resume
  delete nextQuery.wechat_resume_token
  delete nextQuery.openid
  delete nextQuery.state
  delete nextQuery.scope
  delete nextQuery.payment_type
  delete nextQuery.amount
  delete nextQuery.order_type
  delete nextQuery.plan_id
  return nextQuery
}
