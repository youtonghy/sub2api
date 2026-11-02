/**
 * 浮层（下拉、日期面板）的挂载点：位于对话框内时挂到对话框内容上，
 * 避免 Radix 模态对话框的焦点陷阱把焦点拉回、以及外部点击被拦截；否则挂到 body。
 */
export function resolvePortalContainer(anchor: Element | null): HTMLElement {
  const dialog = anchor?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]')
  return dialog ?? document.body
}
