// A conversation as Markdown (M30, PLAN.md D30): Claude Code's `/export`
// writes the conversation as text; Muse Code's own `muse export` writes a
// JSON trajectory for tools, not people. This renders a session's history
// (the same items the transcript is rebuilt from, user messages in their
// presentation form) on either backend. Items the panel hides are left out.
//
// Pure: the host reads the history and writes the file.

import type { ItemSnapshot } from '../../shared/agentEvents'
import { HIDDEN_ITEM_KINDS } from '../../shared/constants'

export interface TranscriptExport {
  readonly title: string
  readonly sessionId: string
  readonly backendLabel: string
  readonly modelId: string
  /** ISO 8601. */
  readonly exportedAt: string
  readonly items: readonly ItemSnapshot[]
}

const USER_MESSAGE = 'userMessage'
const AGENT_MESSAGE = 'agentMessage'
const REASONING = 'reasoning'
const TOOL_CALL = 'toolCall'
const USER_SHELL = 'userShell'
const SUBAGENT = 'subagent'
const MIN_FENCE = 3
const BACKTICK_RUN = /`+/g
const FILE_NAME_UNSAFE = /[^a-z0-9]+/g
const EDGE_DASHES = /^-+|-+$/g
const FILE_NAME_WORDS_MAX = 60
const JSON_INDENT = 2
const COMPLETED = 'completed'

/** A code fence longer than any backtick run inside `text`, so the block cannot end early. */
function fenced(text: string, language = ''): string {
  const longest = Math.max(
    0,
    ...Array.from(text.matchAll(BACKTICK_RUN), (match) => match[0].length),
  )
  const fence = '`'.repeat(Math.max(MIN_FENCE, longest + 1))
  return `${fence}${language}\n${text}\n${fence}`
}

function prettyArgs(args: string): { readonly text: string; readonly language: string } {
  try {
    return { text: JSON.stringify(JSON.parse(args), undefined, JSON_INDENT), language: 'json' }
  } catch {
    return { text: args, language: '' }
  }
}

function quoted(text: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n')
}

function statusSuffix(item: ItemSnapshot): string {
  return item.status === COMPLETED ? '' : ` (${item.status})`
}

function outputBlock(item: ItemSnapshot): readonly string[] {
  if (item.visibleOutput !== undefined && item.visibleOutput !== '') {
    return ['Output:', '', fenced(item.visibleOutput)]
  }
  if (item.outputRef !== undefined) {
    return [
      `_The output (${String(item.outputRef.byteLen)} bytes) is stored by the backend and not included._`,
    ]
  }
  return []
}

function toolSection(item: ItemSnapshot, heading: string): string {
  const lines = [`### ${heading}${statusSuffix(item)}`, '']
  if (item.args !== undefined && item.args !== '') {
    const args = prettyArgs(item.args)
    lines.push('Arguments:', '', fenced(args.text, args.language), '')
  }
  const output = outputBlock(item)
  if (output.length > 0) {
    lines.push(...output, '')
  }
  if (item.patchSummary !== undefined) {
    const { files, added, removed } = item.patchSummary
    lines.push(
      `_Changed ${String(files)} file${files === 1 ? '' : 's'}: +${String(added)} −${String(removed)}._`,
      '',
    )
  }
  if (item.failureReason !== undefined) {
    lines.push(`_Failed: ${item.failureReason}_`, '')
  }
  return lines.join('\n').trimEnd()
}

function userSection(item: ItemSnapshot): string {
  const lines = ['## You', '', item.text ?? '']
  const images = item.attachments?.length ?? 0
  if (images > 0) {
    lines.push('', `_${String(images)} image${images === 1 ? '' : 's'} attached._`)
  }
  return lines.join('\n')
}

function subagentSection(item: ItemSnapshot): string {
  const lines = [`### Subagent: ${item.role ?? 'agent'}${statusSuffix(item)}`, '']
  if (item.objective !== undefined) {
    lines.push(item.objective, '')
  }
  if (item.result !== undefined) {
    lines.push(quoted(item.result.text ?? item.result.summary), '')
  }
  return lines.join('\n').trimEnd()
}

function sectionOf(item: ItemSnapshot): string | undefined {
  switch (item.kind) {
    case USER_MESSAGE: {
      return userSection(item)
    }
    case AGENT_MESSAGE: {
      return item.text === undefined || item.text === '' ? undefined : `## Muse\n\n${item.text}`
    }
    case REASONING: {
      const text = item.summary?.join('\n\n') ?? item.text ?? ''
      return text === '' ? undefined : `### Thinking\n\n${quoted(text)}`
    }
    case TOOL_CALL: {
      return toolSection(item, `Tool: ${item.tool ?? 'tool'}`)
    }
    case USER_SHELL: {
      return toolSection(item, 'Shell command')
    }
    case SUBAGENT: {
      return subagentSection(item)
    }
    default: {
      return HIDDEN_ITEM_KINDS.has(item.kind) ? undefined : `_${item.fallbackText ?? item.kind}_`
    }
  }
}

export function renderTranscriptMarkdown(input: TranscriptExport): string {
  const header = [
    `# ${input.title}`,
    '',
    `- Session: \`${input.sessionId}\``,
    `- Backend: ${input.backendLabel}`,
    `- Model: ${input.modelId}`,
    `- Exported: ${input.exportedAt}`,
  ].join('\n')
  const sections = input.items.flatMap((item) => {
    const section = sectionOf(item)
    return section === undefined ? [] : [section]
  })
  return `${[header, '---', ...sections].join('\n\n')}\n`
}

/** `muse-<words-of-the-title>-<date>.<extension>`, safe on every file system. */
export function exportFileName(title: string, date: Date, extension: string): string {
  const words = title
    .toLowerCase()
    .replaceAll(FILE_NAME_UNSAFE, '-')
    .replaceAll(EDGE_DASHES, '')
    .slice(0, FILE_NAME_WORDS_MAX)
    .replaceAll(EDGE_DASHES, '')
  const day = date.toISOString().slice(0, 'yyyy-mm-dd'.length)
  return `muse-${words === '' ? 'conversation' : words}-${day}.${extension}`
}
