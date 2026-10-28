import { marked } from 'marked'
import DOMPurify from 'dompurify'

/**
 * Markdown → 安全 HTML：与 Vue 版公告、合规弹窗相同的 marked（breaks + gfm）+ DOMPurify 流程。
 * 选项按次传入，不修改 marked 的全局配置。
 */
export function renderSanitizedMarkdown(content: string | null | undefined): string {
  if (!content) return ''
  const html = marked.parse(content, { breaks: true, gfm: true, async: false })
  return DOMPurify.sanitize(html)
}
