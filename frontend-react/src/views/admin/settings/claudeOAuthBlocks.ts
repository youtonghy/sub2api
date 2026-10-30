/** Claude OAuth system prompt 分块的解析与序列化（来自 Vue 版 SettingsView.vue，纯函数） */

export type ClaudeOAuthSystemPromptPreset =
  | 'billing'
  | 'system'
  | 'expansion'
  | 'custom'

export interface ClaudeOAuthSystemPromptBlock {
  id: string
  enabled: boolean
  expanded: boolean
  type: 'text'
  preset: ClaudeOAuthSystemPromptPreset
  text: string
  cacheControlEnabled: boolean
  cacheControlTTL: string
}

interface ClaudeOAuthSystemPromptRawBlock {
  enabled?: boolean
  type?: string
  text?: string
  cache_control?: unknown
}

export const defaultClaudeCodeSystemPrompt =
  "You are Claude Code, Anthropic's official CLI for Claude."

export const defaultClaudeCodeExpansionPrompt = `You are an interactive agent that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.

IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.
IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or local files.

# Tone and style
 - Only use emojis if the user explicitly requests it. Avoid using emojis in all communication unless asked.
 - Your responses should be short and concise.
 - When referencing specific functions or pieces of code include the pattern file_path:line_number to allow the user to easily navigate to the source code location.
 - When referencing GitHub issues or pull requests, use the owner/repo#123 format (e.g. anthropics/claude-code#100) so they render as clickable links.
 - Do not use a colon before tool calls. Your tool calls may not be shown directly in the output, so text like "Let me read the file:" followed by a read tool call should just be "Let me read the file." with a period.`

let claudeOAuthSystemPromptBlockID = 0

function nextClaudeOAuthSystemPromptBlockID(): string {
  claudeOAuthSystemPromptBlockID += 1
  return `claude-oauth-system-prompt-block-${claudeOAuthSystemPromptBlockID}`
}

export function normalizeClaudeOAuthSystemPromptCacheTTL(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '5m'
}

export function detectClaudeOAuthSystemPromptPreset(
  text: string,
): ClaudeOAuthSystemPromptPreset {
  const trimmed = text.trim()
  if (trimmed === '{billing_header}') {
    return 'billing'
  }
  if (
    trimmed === '{claude_code_system_prompt}' ||
    trimmed === defaultClaudeCodeSystemPrompt
  ) {
    return 'system'
  }
  if (
    trimmed === '{claude_code_expansion_prompt}' ||
    trimmed === defaultClaudeCodeExpansionPrompt
  ) {
    return 'expansion'
  }
  return 'custom'
}

function normalizeClaudeOAuthSystemPromptBlockText(
  text: string,
  expansionPrompt = '',
): string {
  const trimmed = text.trim()
  if (trimmed === '{claude_code_system_prompt}') {
    return defaultClaudeCodeSystemPrompt
  }
  if (trimmed === '{claude_code_expansion_prompt}') {
    return expansionPrompt.trim() || defaultClaudeCodeExpansionPrompt
  }
  return text
}

export function createClaudeOAuthSystemPromptBlock(
  overrides: Partial<ClaudeOAuthSystemPromptBlock> = {},
): ClaudeOAuthSystemPromptBlock {
  const text = overrides.text ?? ''
  return {
    id: nextClaudeOAuthSystemPromptBlockID(),
    enabled: overrides.enabled ?? true,
    expanded: overrides.expanded ?? true,
    type: 'text',
    preset: overrides.preset ?? detectClaudeOAuthSystemPromptPreset(text),
    text,
    cacheControlEnabled: overrides.cacheControlEnabled ?? false,
    cacheControlTTL: overrides.cacheControlTTL ?? '5m',
  }
}

export function createDefaultClaudeOAuthSystemPromptBlocks(
  expansionPrompt = '',
): ClaudeOAuthSystemPromptBlock[] {
  const normalizedExpansionPrompt = expansionPrompt.trim()
  const expansionText =
    normalizedExpansionPrompt || defaultClaudeCodeExpansionPrompt

  return [
    createClaudeOAuthSystemPromptBlock({
      preset: 'billing',
      text: '{billing_header}',
    }),
    createClaudeOAuthSystemPromptBlock({
      preset: 'system',
      text: defaultClaudeCodeSystemPrompt,
    }),
    createClaudeOAuthSystemPromptBlock({
      preset:
        expansionText === defaultClaudeCodeExpansionPrompt
          ? 'expansion'
          : 'custom',
      text: expansionText,
      cacheControlEnabled: true,
      cacheControlTTL: '5m',
    }),
  ]
}

function parseClaudeOAuthSystemPromptCacheControl(cacheControl: unknown): {
  enabled: boolean
  ttl: string
} {
  if (cacheControl === true) {
    return { enabled: true, ttl: '5m' }
  }
  if (
    cacheControl &&
    typeof cacheControl === 'object' &&
    !Array.isArray(cacheControl)
  ) {
    return {
      enabled: true,
      ttl: normalizeClaudeOAuthSystemPromptCacheTTL(
        (cacheControl as Record<string, unknown>).ttl,
      ),
    }
  }
  return { enabled: false, ttl: '5m' }
}

export function parseClaudeOAuthSystemPromptBlocks(
  raw: string,
  expansionPrompt = '',
): ClaudeOAuthSystemPromptBlock[] {
  const trimmed = raw.trim()
  if (!trimmed) {
    return createDefaultClaudeOAuthSystemPromptBlocks(expansionPrompt)
  }

  try {
    const parsed = JSON.parse(trimmed) as
      | ClaudeOAuthSystemPromptRawBlock[]
      | { blocks?: ClaudeOAuthSystemPromptRawBlock[] }
    const rawBlocks = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.blocks)
        ? parsed.blocks
        : []

    if (rawBlocks.length === 0) {
      return createDefaultClaudeOAuthSystemPromptBlocks(expansionPrompt)
    }

    return rawBlocks.map((block) => {
      const cacheControl = parseClaudeOAuthSystemPromptCacheControl(
        block.cache_control,
      )
      const text = normalizeClaudeOAuthSystemPromptBlockText(
        typeof block.text === 'string' ? block.text : '',
        expansionPrompt,
      )
      return createClaudeOAuthSystemPromptBlock({
        enabled: block.enabled !== false,
        type: 'text',
        text,
        preset: detectClaudeOAuthSystemPromptPreset(text),
        cacheControlEnabled: cacheControl.enabled,
        cacheControlTTL: cacheControl.ttl,
      })
    })
  } catch {
    return createDefaultClaudeOAuthSystemPromptBlocks(expansionPrompt)
  }
}

export function serializeClaudeOAuthSystemPromptBlocksToJSON(
  blocks: ClaudeOAuthSystemPromptBlock[],
): string {
  const source =
    blocks.length > 0
      ? blocks
      : [
          createClaudeOAuthSystemPromptBlock({
            enabled: false,
            preset: 'custom',
            text: '',
          }),
        ]

  const rawBlocks = source.map((block) => {
    const raw: ClaudeOAuthSystemPromptRawBlock = {
      enabled: block.enabled,
      type: block.type || 'text',
      text: block.text,
    }
    if (block.cacheControlEnabled) {
      raw.cache_control = {
        type: 'ephemeral',
        ttl: normalizeClaudeOAuthSystemPromptCacheTTL(block.cacheControlTTL),
      }
    }
    return raw
  })

  return JSON.stringify(rawBlocks, null, 2)
}

export const defaultClaudeOAuthSystemPromptBlocks =
  serializeClaudeOAuthSystemPromptBlocksToJSON(
    createDefaultClaudeOAuthSystemPromptBlocks(),
  )
