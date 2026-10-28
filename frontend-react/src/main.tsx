import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { initI18n } from './i18n'
import { useAppStore } from '@/stores/app'
import { initTheme } from '@/theme/theme'
import { updateFavicon } from '@/utils/branding'
import { isIOSDevice } from '@/utils/device'
import './styles/global.css'

function initIOSViewportZoomFix() {
  // iOS Safari 在输入框字号小于 16px 时聚焦会自动放大页面，且失焦后不会恢复。
  // 限制 maximum-scale 可阻止该行为；iOS 10+ 用户仍可双指手动缩放，不影响可访问性。
  // 仅在 iOS 设备上注入，避免影响 Android Chrome 的手动缩放能力。
  if (!isIOSDevice()) return

  const viewport = document.querySelector('meta[name="viewport"]')
  if (!viewport) return

  const content = viewport.getAttribute('content') || ''
  if (/maximum-scale/i.test(content)) return
  viewport.setAttribute('content', `${content}, maximum-scale=1.0`)
}

async function bootstrap() {
  // 挂载前应用主题，保证所有路由一致且无闪烁
  initTheme()
  initIOSViewportZoomFix()

  // 挂载前读取后端注入的公开配置（window.__APP_CONFIG__），避免闪烁
  const appStore = useAppStore.getState()
  appStore.initFromInjectedConfig()

  const { siteName, siteLogo } = useAppStore.getState()
  if (siteName && siteName !== 'RetooAi') {
    document.title = `${siteName} - AI API Gateway`
  }
  updateFavicon(siteLogo)

  await initI18n()

  createRoot(document.getElementById('app')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

bootstrap()
