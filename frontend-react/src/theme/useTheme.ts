import { useSyncExternalStore } from 'react'

import { getTheme, setTheme, subscribeTheme, toggleTheme, type ThemeMode } from './theme'

export function useTheme(): { theme: ThemeMode; isDark: boolean; setTheme: typeof setTheme; toggleTheme: typeof toggleTheme } {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getTheme)
  return { theme, isDark: theme === 'dark', setTheme, toggleTheme }
}
