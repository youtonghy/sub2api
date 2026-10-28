import { Fragment, type ReactNode } from 'react'

import { useI18n } from './useI18n'

export interface I18nTProps {
  /** 消息 key，与 vue-i18n 的 <i18n-t keypath> 相同 */
  keypath: string
  /** 插入到 `{name}` 占位符的 React 节点，对应 Vue 版的具名插槽 */
  slots?: Record<string, ReactNode>
  /** 普通字符串或数字插值 */
  values?: Record<string, string | number>
  plural?: number
}

const MARKER = '\u0000'

/**
 * 替代 vue-i18n 的 <i18n-t>：把具名插槽渲染到消息中的占位符位置。
 */
export function I18nT({ keypath, slots = {}, values = {}, plural }: I18nTProps) {
  const { t } = useI18n()
  const named: Record<string, string | number> = { ...values }
  for (const name of Object.keys(slots)) {
    named[name] = `${MARKER}${name}${MARKER}`
  }

  const message = plural === undefined ? t(keypath, named) : t(keypath, named, plural)
  const parts = message.split(MARKER)

  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 && part in slots ? (
          <Fragment key={index}>{slots[part]}</Fragment>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        )
      )}
    </>
  )
}
