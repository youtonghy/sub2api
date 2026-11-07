# React 迁移说明

本前端由 Vue 3 版用 React 19 + Arc UI 重写而来，2026-11-02 切换为生产前端（Vue 版已删除），构建产物输出到 `backend/internal/web/dist` 由后端嵌入。

## 移植上游改动

上游（Wei-Shaw/sub2api）仍是 Vue 前端，合并上游后需要手动把 `frontend/` 下的改动移植过来。切换时 Vue 版与本前端对齐到提交 `3c0200d35`；之后每次合并上游，先看上游 Vue 前端的增量：

```bash
git diff <上次已移植的上游提交>..<本次上游提交> -- frontend/src
```

`api/`、`types/`、`utils/`、`constants/`、`i18n/locales/` 基本可以直接对照复制；组件与页面按下面的差异改写。

| 移植时间 | 上游提交 | 说明 |
| --- | --- | --- |
| 2026-10-28 | `958812fc0` | 切换前最后一次合并的上游 |
| 2026-11-08 | `6b4b37db4` | 上游 v0.2.20：管理 MCP、注册邮箱黑名单、管理员密钥全权模式、Grok 模型目录诊断、OpenAI 生图尺寸档位等 |

## 与 Vue 版的差异

- `i18n/`：使用 `@intlify/core-base`（vue-i18n 的框架无关内核），消息格式不变。组件内用 `useI18n()`，组件外直接 `import { t } from '@/i18n'`。
- `stores/`：Pinia store 换成 Zustand，状态与方法同名。组件内用 `useAppStore(selector)`，组件外用 `useAppStore.getState()`。
- `constants/platformCatalog.ts`、`constants/platforms.ts`、`utils/ipGeoLookup.ts`：Vue 响应式换成模块状态加订阅函数，导出 API 不变。
- 主题：`<html data-theme>` 与 `data-accent="retoo"`，沿用 localStorage 键 `theme`；未保存时跟随系统。
- 路由：`router/routes.ts` 与 Vue 路由表一一对应（路径、名称、meta）。守卫是 `router/guard.ts` 中的纯函数，由每条路由的 loader 调用；页面全部懒加载。
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
