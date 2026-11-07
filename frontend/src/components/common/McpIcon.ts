import { createLucideIcon } from 'lucide-react'

/**
 * Model Context Protocol 标志（modelcontextprotocol.io），对应 Vue 版 Icon.vue 的 'mcp'。
 * 按 24px 描边网格缩放，做成 Lucide 图标以便与侧边栏等 lucide 图标位通用。
 */
const McpIcon = createLucideIcon('mcp', [
  ['path', { d: 'M3.98 11.4L11.59 3.79C12.64 2.74 14.34 2.74 15.39 3.79C16.44 4.84 16.44 6.54 15.39 7.59L9.64 13.34', key: 'outer' }],
  ['path', { d: 'M9.72 13.26L15.39 7.59C16.44 6.54 18.14 6.54 19.2 7.59L19.24 7.63C20.29 8.68 20.29 10.39 19.24 11.44L12.35 18.32C12 18.67 12 19.24 12.35 19.59L13.77 21', key: 'tail' }],
  ['path', { d: 'M13.49 5.69L7.86 11.32C6.81 12.37 6.81 14.07 7.86 15.12C8.91 16.17 10.61 16.17 11.67 15.12L17.29 9.49', key: 'inner' }],
])

export default McpIcon
