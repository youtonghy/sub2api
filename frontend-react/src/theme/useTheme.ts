import { useSyncExternalStore } from 'react'

import {
  getTheme,
  getThemePreference,
  setTheme,
  setThemePreference,
  subscribeTheme,
  toggleTheme,
  type ThemeMode,
  type ThemePreference,
} from './theme'

export function useTheme(): {
  theme: ThemeMode
  preference: ThemePreference
  isDark: boolean
  setTheme: typeof setTheme
  setThemePreference: typeof setThemePreference
  toggleTheme: typeof toggleTheme
} {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getTheme)
  const preference = useSyncExternalStore(subscribeTheme, getThemePreference, getThemePreference)
  return { theme, preference, isDark: theme === 'dark', setTheme, setThemePreference, toggleTheme }
}
