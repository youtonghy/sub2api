import { useSyncExternalStore } from 'react'

import { getI18nRevision, getLocale, setLocale, subscribeI18n, t, te, type LocaleCode } from './index'

export interface UseI18nResult {
  t: typeof t
  te: typeof te
  locale: LocaleCode
  setLocale: typeof setLocale
}

/**
 * 与 vue-i18n 的 useI18n() 同名同形，语言或消息变化时触发组件重新渲染。
 */
export function useI18n(): UseI18nResult {
  useSyncExternalStore(subscribeI18n, getI18nRevision, getI18nRevision)
  return { t, te, locale: getLocale(), setLocale }
}
