import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vue 版还断言 vite.config.ts 中的 vendor-stripe 分包规则；React 版 vite 配置没有 manualChunks
// （Stripe 只经动态 import 进入独立 chunk），该断言不再适用，只保留加载器契约。
const frontendRoot = resolve(__dirname, '../../../..')
const stripeConsumers = [
  'src/views/user/StripePaymentView.tsx',
  'src/views/user/StripePopupView.tsx',
  'src/components/payment/StripePaymentInline.tsx',
]

function readFrontendFile(path: string): string {
  return readFileSync(resolve(frontendRoot, path), 'utf8')
}

describe('Stripe lazy-loading contract', () => {
  it.each(stripeConsumers)('%s uses the side-effect-free Stripe loader', (path) => {
    const source = readFrontendFile(path)

    expect(source).toContain("await import('@stripe/stripe-js/pure')")
    expect(source).not.toMatch(/await import\(['"]@stripe\/stripe-js['"]\)/)
    // 只允许类型导入（编译后擦除），不能静态导入运行时代码
    expect(source).not.toMatch(/^import (?!type )[^\n]*from ['"]@stripe\/stripe-js(\/pure)?['"]/m)
  })
})
