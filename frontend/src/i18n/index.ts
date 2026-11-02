/**
 * i18n 核心：使用 vue-i18n 的框架无关内核 @intlify/core-base，
 * 消息格式（命名插值、复数 `|`、转义）与 Vue 版完全一致，locale 文件原样复用。
 * JIT 编译把消息编译为 AST 而不是 JS 代码，兼容禁止 eval 的 CSP。
 */
import {
  clearCompileCache,
  compile,
  createCoreContext,
  fallbackWithLocaleChain,
  registerLocaleFallbacker,
  registerMessageCompiler,
  registerMessageResolver,
  resolveValue,
  translate
} from '@intlify/core-base'

export type LocaleCode = 'en' | 'zh'

type LocaleMessages = Record<string, any>

/** 与 Vue 版相同的存储键，切换后用户的语言偏好保持不变 */
const LOCALE_KEY = 'sub2api_locale'
const DEFAULT_LOCALE: LocaleCode = 'en'

const localeLoaders: Record<LocaleCode, () => Promise<{ default: LocaleMessages }>> = {
  en: () => import('./locales/en'),
  zh: () => import('./locales/zh')
}

registerMessageCompiler(compile)
registerMessageResolver(resolveValue)
registerLocaleFallbacker(fallbackWithLocaleChain)

function isLocaleCode(value: string): value is LocaleCode {
  return value === 'en' || value === 'zh'
}

function getDefaultLocale(): LocaleCode {
  const saved = localStorage.getItem(LOCALE_KEY)
  if (saved && isLocaleCode(saved)) {
    return saved
  }

  const browserLang = navigator.language.toLowerCase()
  if (browserLang.startsWith('zh')) {
    return 'zh'
  }

  return DEFAULT_LOCALE
}

const messages: Record<string, LocaleMessages> = {}

const context = createCoreContext({
  locale: getDefaultLocale(),
  fallbackLocale: DEFAULT_LOCALE,
  messages,
  // 缺失的 key 直接返回 key 本身，与 vue-i18n 的 t() 行为一致
  unresolving: false,
  // 引导步骤使用富文本内容（driver.js 支持 HTML），这些内容是内部定义的
  warnHtmlMessage: false
})

const listeners = new Set<() => void>()
let revision = 0

function notify(): void {
  revision += 1
  listeners.forEach((listener) => listener())
}

/** 订阅语言或消息变化，供 useSyncExternalStore 使用 */
export function subscribeI18n(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 每次语言或消息变化都会递增，作为 React 订阅的快照 */
export function getI18nRevision(): number {
  return revision
}

const loadedLocales = new Set<LocaleCode>()

export function setLocaleMessage(locale: LocaleCode, localeMessages: LocaleMessages): void {
  messages[locale] = localeMessages
  clearCompileCache()
  notify()
}

export async function loadLocaleMessages(locale: LocaleCode): Promise<void> {
  if (loadedLocales.has(locale)) {
    return
  }

  const module = await localeLoaders[locale]()
  loadedLocales.add(locale)
  setLocaleMessage(locale, module.default)
}

export async function initI18n(): Promise<void> {
  const current = getLocale()
  await loadLocaleMessages(current)
  document.documentElement.setAttribute('lang', current)
}

export async function setLocale(locale: string): Promise<void> {
  if (!isLocaleCode(locale)) {
    return
  }

  await loadLocaleMessages(locale)
  context.locale = locale
  localStorage.setItem(LOCALE_KEY, locale)
  document.documentElement.setAttribute('lang', locale)
  notify()
}

export function getLocale(): LocaleCode {
  const current = context.locale
  return isLocaleCode(current) ? current : DEFAULT_LOCALE
}

/**
 * 翻译函数，参数与 vue-i18n 的 t() 相同：
 * t(key)、t(key, named)、t(key, plural)、t(key, named, plural)、t(key, list)
 */
export function t(key: string, ...args: unknown[]): string {
  const result = (translate as (...params: unknown[]) => unknown)(context, key, ...args)
  return typeof result === 'string' ? result : key
}

/** 与 vue-i18n 的 te() 相同：只有可翻译的消息（字符串、AST、消息函数）才算存在 */
export function te(key: string, locale?: string): boolean {
  const target = locale ?? context.locale
  const value = resolveValue(messages[target] ?? {}, key) as unknown
  if (typeof value === 'string' || typeof value === 'function') {
    return true
  }
  return value !== null && typeof value === 'object' && 'type' in value && 'body' in value
}

export const availableLocales = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'zh', name: '中文', flag: '🇨🇳' }
] as const
