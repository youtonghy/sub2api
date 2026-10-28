# React 迁移说明

`frontend-react/` 是正在用 React 19 + Arc UI 重写的前端。迁移完成前，生产环境仍由 `frontend/`（Vue）构建并嵌入后端；本目录的构建输出到 `frontend-react/dist`，不影响生产。

## 同步基线

共享代码（`api/`、`types/`、`utils/`、`constants/`、`i18n/locales/`）从 Vue 版复制而来。Vue 版仍在持续变化，每个阶段结束和切换前都要把增量同步过来：

```bash
git diff <基线提交>..HEAD -- frontend/src
```

| 同步时间 | 基线提交 | 说明 |
| --- | --- | --- |
| 2026-10-28 | `3c0200d35` | 首次复制 |

同步后在上表追加一行，记录新的基线提交。

## 与 Vue 版的差异

- `i18n/`：使用 `@intlify/core-base`（vue-i18n 的框架无关内核），消息格式不变。组件内用 `useI18n()`，组件外直接 `import { t } from '@/i18n'`。
- `stores/`：Pinia store 换成 Zustand，状态与方法同名。组件内用 `useAppStore(selector)`，组件外用 `useAppStore.getState()`。
- `constants/platformCatalog.ts`、`constants/platforms.ts`、`utils/ipGeoLookup.ts`：Vue 响应式换成模块状态加订阅函数，导出 API 不变。
- 主题：`<html data-theme>` 与 `data-accent="retoo"`，沿用 localStorage 键 `theme`；未保存时跟随系统。
- 路由：`router/routes.ts` 与 Vue 路由表一一对应（路径、名称、meta）。守卫是 `router/guard.ts` 中的纯函数，由每条路由的 loader 调用；未迁移的页面暂用 `pending()`，迁移后替换为真实 import。
- 布局：`AppLayout`（侧边栏外壳）与 `AuthLayout`（登录类页面）作为父路由，页面内不再包裹布局组件；登录页的页脚插槽改用 `<AuthFooter>`。
- 新增文案放在 `i18n/locales/{en,zh}/shell.ts`，与 Vue 共享的语言文件保持原样。
- Arc Pro 文件清单见仓库根目录 `NOTICE`，新增 Pro 组件时同步更新。

## 常用命令

```bash
pnpm install
pnpm dev          # 默认端口 3001，代理到 VITE_DEV_PROXY_TARGET（默认 http://localhost:8080）
pnpm run lint:check
pnpm run test:run
pnpm run build
```

Arc 组件通过 shadcn CLI 安装（`components.json` 已配置 `@uiarc` 与 `@uiarc-pro`，Pro 需要环境变量 `ARC_PRO_TOKEN`）：

```bash
npx shadcn@latest add @uiarc/<id>
npx shadcn@latest add @uiarc-pro/<id>
```
