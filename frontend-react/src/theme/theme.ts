/**
 * 主题：Arc 通过 <html data-theme="dark"> 切换深色模式，data-accent 选择强调色。
 * 沿用 Vue 版的 localStorage 键 `theme`：未保存时跟随系统，与 Vue 版行为一致。
 */
export type ThemeMode = 'light' | 'dark'
export type ThemePreference = ThemeMode | 'system'

const THEME_KEY = 'theme'
const ACCENT = 'retoo'
const DARK_QUERY = '(prefers-color-scheme: dark)'

const listeners = new Set<() => void>()

function readPreference(): ThemePreference {
  const saved = localStorage.getItem(THEME_KEY)
  return saved === 'dark' || saved === 'light' ? saved : 'system'
}

function resolve(preference: ThemePreference): ThemeMode {
  if (preference !== 'system') return preference
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

let preference: ThemePreference = 'system'
let current: ThemeMode = 'light'
let systemWatcher: MediaQueryList | null = null

function notify(): void {
  listeners.forEach((listener) => listener())
}

function apply(): void {
  current = resolve(preference)
  const root = document.documentElement
  root.setAttribute('data-theme', current)
  root.setAttribute('data-accent', ACCENT)
}

function onSystemChange(): void {
  if (preference !== 'system') return
  apply()
  notify()
}

/** 挂载前调用，避免首屏闪烁 */
export function initTheme(): void {
  preference = readPreference()
  apply()
  if (!systemWatcher) {
    systemWatcher = window.matchMedia(DARK_QUERY)
    systemWatcher.addEventListener?.('change', onSystemChange)
  }
}

export function getTheme(): ThemeMode {
  return current
}

export function getThemePreference(): ThemePreference {
  return preference
}

export function setThemePreference(next: ThemePreference): void {
  preference = next
  if (next === 'system') {
    localStorage.removeItem(THEME_KEY)
  } else {
    localStorage.setItem(THEME_KEY, next)
  }
  apply()
  notify()
}

export function setTheme(theme: ThemeMode): void {
  setThemePreference(theme)
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
