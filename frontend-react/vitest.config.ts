import { searchForWorkspaceRoot } from 'vite'
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src')
    }
  },
  define: {
    __INTLIFY_JIT_COMPILATION__: true,
    __INTLIFY_DROP_MESSAGE_COMPILER__: false,
    __INTLIFY_PROD_DEVTOOLS__: false
  },
  server: {
    fs: {
      // 管理员合规弹窗以 ?raw 引入仓库根目录 docs/legal/ 下的文档
      allow: [searchForWorkspaceRoot(process.cwd()), resolve(import.meta.dirname, '../docs/legal')]
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist']
  }
})
