/**
 * 路由：React Router 数据模式。每条路由的 loader 运行与 Vue 版 beforeEach 相同的守卫，
 * 布局作为父路由，导航时侧边栏外壳不会重新挂载。
 */
import { createBrowserRouter, redirect, type LoaderFunctionArgs, type RouteObject } from 'react-router'

import AppLayout from '@/layouts/AppLayout'
import AuthLayout from '@/layouts/AuthLayout'
import RootLayout from '@/layouts/RootLayout'
import RouteErrorBoundary from '@/layouts/RouteErrorBoundary'
import { resolveNavigation } from './guard'
import type { AppRouteHandle } from './meta'
import { appRoutes, redirectRoutes, type AppRouteDef } from './routes'

function guardLoader(def: AppRouteDef) {
  return async ({ request, params }: LoaderFunctionArgs) => {
    const url = new URL(request.url)
    const target = await resolveNavigation({
      path: url.pathname,
      fullPath: `${url.pathname}${url.search}${url.hash}`,
      name: def.name,
      params,
      meta: def.meta,
    })
    if (target) {
      throw redirect(target)
    }
    return null
  }
}

function toRouteObjects(def: AppRouteDef): RouteObject[] {
  const handle: AppRouteHandle = { name: def.name, meta: def.meta }
  return [def.path, ...(def.aliases ?? [])].map((path) => ({
    path,
    handle,
    loader: guardLoader(def),
    lazy: {
      Component: async () => (await def.view()).default,
    },
  }))
}

function routesFor(layout: AppRouteDef['layout']): RouteObject[] {
  return appRoutes.filter((def) => def.layout === layout).flatMap(toRouteObjects)
}

export const routes: RouteObject[] = [
  {
    Component: RootLayout,
    ErrorBoundary: RouteErrorBoundary,
    HydrateFallback: () => null,
    children: [
      ...redirectRoutes.map(({ path, to }) => ({ path, loader: () => redirect(to) })),
      { Component: AppLayout, children: routesFor('app') },
      { Component: AuthLayout, children: routesFor('auth') },
      ...routesFor('none'),
    ],
  },
]

export function createAppRouter() {
  return createBrowserRouter(routes)
}
