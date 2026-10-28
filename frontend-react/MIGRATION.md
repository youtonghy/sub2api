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
- 主题：`<html data-theme>` 与 `data-accent="retoo"`，沿用 localStorage 键 `theme`。

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
