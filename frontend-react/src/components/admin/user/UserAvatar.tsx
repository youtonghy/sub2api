/** 用户邮箱首字母头像（Vue 版各用户弹窗头部的圆形首字母） */
import styles from './userModals.module.css'

export function UserAvatar({ email }: { email: string }) {
  return (
    <span className={styles.avatar} aria-hidden="true">
      {email.charAt(0).toUpperCase()}
    </span>
  )
}
