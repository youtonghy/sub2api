import { Check, Languages } from 'lucide-react'

import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu'
import { availableLocales } from '@/i18n'
import { useI18n } from '@/i18n/useI18n'

/** 语言切换，与 Vue 版 LocaleSwitcher 相同：切换后保存到 localStorage 并更新页面 lang */
export default function LocaleSwitcher() {
  const { locale, setLocale } = useI18n()
  const current = availableLocales.find((item) => item.code === locale) ?? availableLocales[0]

  return (
    <DropdownMenu
      label={current.name}
      icon={<Languages size={16} strokeWidth={1.75} aria-hidden="true" />}
      items={availableLocales.map((item) => ({
        label: item.name,
        icon: item.code === locale ? <Check size={16} strokeWidth={1.75} aria-hidden="true" /> : undefined,
        onSelect: () => void setLocale(item.code),
      }))}
    />
  )
}
