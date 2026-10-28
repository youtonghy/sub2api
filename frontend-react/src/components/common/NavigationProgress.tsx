import { useNavigation } from 'react-router'

import styles from './NavigationProgress.module.css'

/** 路由切换时（守卫与懒加载期间）在页面顶部显示进度条 */
export default function NavigationProgress() {
  const navigation = useNavigation()
  const active = navigation.state !== 'idle'
  return <div className={styles.bar} data-active={active || undefined} role="progressbar" aria-hidden={!active} aria-busy={active} />
}
