/**
 * 与 Vue 版 v-model.number 相同的取值规则（Vue 的 looseToNumber）：
 * 能被 parseFloat 解析时取数字，否则保留原始字符串（例如清空输入时为 ''）。
 */
export function looseToNumber(raw: string): number | string {
  const parsed = parseFloat(raw)
  return Number.isNaN(parsed) ? raw : parsed
}

/** 数字（或空）转成输入框显示值 */
export function toInputValue(value: number | string | null | undefined): string {
  return value == null ? '' : String(value)
}

/** 随机密码（与 Vue 版 UserCreateModal / UserEditModal 的字符集与长度一致） */
export function generateRandomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*'
  let p = ''
  for (let i = 0; i < 16; i++) p += chars.charAt(Math.floor(Math.random() * chars.length))
  return p
}
