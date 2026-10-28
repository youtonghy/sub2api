/**
 * 主题：Arc 通过 <html data-theme="dark"> 切换深色模式，data-accent 选择强调色。
 * 沿用 Vue 版的 localStorage 键 `theme`，切换后用户的主题偏好保持不变。
 */
export type ThemeMode = 'light' | 'dark'

const THEME_KEY = 'theme'
const ACCENT = 'retoo'

const listeners = new Set<() => void>()

function readTheme(): ThemeMode {
  const savedTheme = localStorage.getItem(THEME_KEY)
  const shouldUseDark =
    savedTheme === 'dark' ||
    (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)
  return shouldUseDark ? 'dark' : 'light'
}

let current: ThemeMode = 'light'

function apply(theme: ThemeMode): void {
  current = theme
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  root.setAttribute('data-accent', ACCENT)
}

/** 挂载前调用，避免首屏闪烁 */
export function initTheme(): void {
  apply(readTheme())
}

export function getTheme(): ThemeMode {
  return current
}

export function setTheme(theme: ThemeMode): void {
  apply(theme)
  localStorage.setItem(THEME_KEY, theme)
  listeners.forEach((listener) => listener())
}

export function toggleTheme(): void {
  setTheme(current === 'dark' ? 'light' : 'dark')
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
