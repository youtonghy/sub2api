/** 系统设置页共用的小工具 */

export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ')
}

/** number 输入框的值：空串保持空串（对应 v-model.number 清空时的 ""），否则转为数字 */
export function numberInputValue(raw: string): number | '' {
  if (raw === '') return ''
  const parsed = Number(raw)
  return Number.isNaN(parsed) ? '' : parsed
}
