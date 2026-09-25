// A conversation as Markdown (M30, PLAN.md D30): Claude Code's `/export`
// writes the conversation as text; Muse Code's own `muse export` writes a
// JSON trajectory for tools, not people. This renders a session's history
// (the same items the transcript is rebuilt from, user messages in their
// presentation form) on either backend. Items the panel hides are left out.
// The file's own words (headings, labels, counts) are in the display
// language (PLAN.md D33); what was said and run is written as it was.
//
// Pure: the host reads the history and writes the file.

import type { CitationSummary, ItemSnapshot } from '../../shared/agentEvents'
import { HIDDEN_ITEM_KINDS, UI_TEXT } from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'

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
// What a Markdown link's text must escape to stay one link.
const LINK_TEXT_SPECIAL = /[\\[\]]/g
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

/** A line of the file's own words, set in italics. */
function note(text: string): string {
  return `_${text}_`
}

function outputBlock(item: ItemSnapshot): readonly string[] {
  if (item.visibleOutput !== undefined && item.visibleOutput !== '') {
    return [UI_TEXT.exportOutputLabel, '', fenced(item.visibleOutput)]
  }
  return item.outputRef === undefined
    ? []
    : [note(plural(UI_TEXT.exportOutputStored, item.outputRef.byteLen))]
}

function toolSection(item: ItemSnapshot, heading: string): string {
  const lines = [`### ${heading}${statusSuffix(item)}`, '']
  if (item.args !== undefined && item.args !== '') {
    const args = prettyArgs(item.args)
    lines.push(UI_TEXT.exportArgumentsLabel, '', fenced(args.text, args.language), '')
  }
  const output = outputBlock(item)
  if (output.length > 0) {
    lines.push(...output, '')
  }
  if (item.patchSummary !== undefined) {
    const { files, added, removed } = item.patchSummary
    lines.push(note(plural(UI_TEXT.exportFilesChanged, files, { added, removed })), '')
  }
  if (item.failureReason !== undefined) {
    lines.push(note(fill(UI_TEXT.exportFailure, { reason: item.failureReason })), '')
  }
  return lines.join('\n').trimEnd()
}

function userSection(item: ItemSnapshot): string {
  const lines = [`## ${UI_TEXT.exportUserHeading}`, '', item.text ?? '']
  const images = item.attachments?.length ?? 0
  if (images > 0) {
    lines.push('', note(plural(UI_TEXT.exportImagesAttached, images)))
  }
  return lines.join('\n')
}

function subagentSection(item: ItemSnapshot): string {
  const role = item.role ?? UI_TEXT.exportSubagentNoRole
  const lines = [`### ${fill(UI_TEXT.exportSubagentHeading, { role })}${statusSuffix(item)}`, '']
  if (item.objective !== undefined) {
    lines.push(item.objective, '')
  }
  if (item.result !== undefined) {
    lines.push(quoted(item.result.text ?? item.result.summary), '')
  }
  return lines.join('\n').trimEnd()
}

/** A cited page as a Markdown link (M33): the title escaped, the URL in angle brackets. */
function citationLine(citation: CitationSummary): string {
  const title = (citation.title ?? citation.url).replaceAll(LINK_TEXT_SPECIAL, String.raw`\$&`)
  const url = citation.url.replaceAll('<', '%3C').replaceAll('>', '%3E')
  return `- [${title}](<${url}>)`
}

/** A reply, and the web pages it cites (M33). */
function agentSection(item: ItemSnapshot): string | undefined {
  if (item.text === undefined || item.text === '') {
    return undefined
  }
  const lines = [`## ${UI_TEXT.exportAgentHeading}`, '', item.text]
  const citations = item.citations ?? []
  if (citations.length > 0) {
    lines.push(
      '',
      `${UI_TEXT.citationsHeading}:`,
      '',
      ...citations.map((citation) => citationLine(citation)),
    )
  }
  return lines.join('\n')
}

function sectionOf(item: ItemSnapshot): string | undefined {
  switch (item.kind) {
    case USER_MESSAGE: {
      return userSection(item)
    }
    case AGENT_MESSAGE: {
      return agentSection(item)
    }
    case REASONING: {
      const text = item.summary?.join('\n\n') ?? item.text ?? ''
      return text === '' ? undefined : `### ${UI_TEXT.exportThinkingHeading}\n\n${quoted(text)}`
    }
    case TOOL_CALL: {
      // The tool's own name, as the model called it.
      const tool = item.tool ?? UI_TEXT.exportToolNoName
      return toolSection(item, fill(UI_TEXT.exportToolHeading, { tool }))
    }
    case USER_SHELL: {
      return toolSection(item, UI_TEXT.exportShellHeading)
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
    `- ${fill(UI_TEXT.exportSessionLine, { id: input.sessionId })}`,
    `- ${fill(UI_TEXT.exportBackendLine, { backend: input.backendLabel })}`,
    `- ${fill(UI_TEXT.exportModelLine, { model: input.modelId })}`,
    `- ${fill(UI_TEXT.exportTimeLine, { time: input.exportedAt })}`,
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
