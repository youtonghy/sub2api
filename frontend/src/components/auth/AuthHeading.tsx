import type { ReactNode } from 'react'

import styles from './AuthHeading.module.css'

/** 登录类页面顶部的标题与说明 */
export default function AuthHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={styles.heading}>
      <h1 className={styles.title}>{title}</h1>
      {children !== undefined && children !== null && children !== '' && <p className={styles.subtitle}>{children}</p>}
    </div>
  )
}
