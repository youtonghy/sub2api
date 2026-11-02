/** 倒计时显示：mm:ss */
export function formatCountdown(remainingSeconds: number): string {
  const m = Math.floor(remainingSeconds / 60)
  const s = remainingSeconds % 60
  return m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0')
}

/** 订单剩余秒数：有 expiresAt 时按其计算，否则默认 30 分钟 */
export function secondsUntil(expiresAt: string | undefined | null): number {
  let seconds = 30 * 60
  if (expiresAt) {
    seconds = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
  }
  return seconds
}

/**
 * 在二维码中心绘制品牌 logo（白色圆角底）。
 * logoSize / pad / radius 与 Vue 版各调用处保持一致。
 */
export function drawQRLogo(
  canvas: HTMLCanvasElement,
  logoSrc: string,
  options: { logoSize: number; pad: number; radius: number },
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = new Image()
  img.src = logoSrc
  img.onload = () => {
    const { logoSize, pad, radius: r } = options
    const x = (canvas.width - logoSize) / 2
    const y = (canvas.height - logoSize) / 2
    // White background with rounded corners
    ctx.fillStyle = '#FFFFFF'
    ctx.beginPath()
    ctx.moveTo(x - pad + r, y - pad)
    ctx.arcTo(x + logoSize + pad, y - pad, x + logoSize + pad, y + logoSize + pad, r)
    ctx.arcTo(x + logoSize + pad, y + logoSize + pad, x - pad, y + logoSize + pad, r)
    ctx.arcTo(x - pad, y + logoSize + pad, x - pad, y - pad, r)
    ctx.arcTo(x - pad, y - pad, x + logoSize + pad, y - pad, r)
    ctx.fill()
    // Draw logo
    ctx.drawImage(img, x, y, logoSize, logoSize)
  }
}
