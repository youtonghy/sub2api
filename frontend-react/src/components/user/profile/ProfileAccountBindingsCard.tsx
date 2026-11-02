import type { User } from '@/types'
import ProfileIdentityBindingsSection from './ProfileIdentityBindingsSection'

export interface ProfileAccountBindingsCardProps {
  user: User | null
  linuxdoEnabled?: boolean
  dingtalkEnabled?: boolean
  oidcEnabled?: boolean
  oidcProviderName?: string
  wechatEnabled?: boolean
  wechatOpenEnabled?: boolean
  wechatMpEnabled?: boolean
}

/** 独立卡片形式的登录方式绑定，对应 Vue 版 ProfileAccountBindingsCard.vue */
export default function ProfileAccountBindingsCard(props: ProfileAccountBindingsCardProps) {
  return <ProfileIdentityBindingsSection {...props} />
}
