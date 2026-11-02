import { useMatches, useParams } from 'react-router'

import type { AppRouteHandle, RouteLike } from './meta'

function isAppRouteHandle(handle: unknown): handle is AppRouteHandle {
  return typeof handle === 'object' && handle !== null && 'name' in handle && 'meta' in handle
}

/** 当前页面路由（最深一层带 handle 的匹配），形状与 title.ts 使用的 RouteLike 一致 */
export function useCurrentRoute(): RouteLike {
  const matches = useMatches()
  const params = useParams()
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const handle = matches[index].handle
    if (isAppRouteHandle(handle)) {
      return { name: handle.name, params, meta: handle.meta }
    }
  }
  return { name: null, params, meta: {} }
}
