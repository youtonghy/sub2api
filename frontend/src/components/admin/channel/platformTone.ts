import styles from './platformTone.module.css'

export type PlatformToneVariant = 'tag' | 'text' | 'selected'

/**
 * 平台色调属性，对应 Vue 版 getPlatformTagClass（tag）、getPlatformTextClass / platformTextClass（text）。
 * 返回 className 与 data-platform，直接展开到元素上；extra 为额外类名。
 */
export function platformTone(
  platform: string | null | undefined,
  variant: PlatformToneVariant | PlatformToneVariant[],
  extra?: string
) {
  const variants = Array.isArray(variant) ? variant : [variant]
  return {
    className: [styles.tone, ...variants.map((name) => styles[name]), extra].filter(Boolean).join(' '),
    'data-platform': platform || ''
  }
}
