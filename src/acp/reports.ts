import type { ContentBlock } from '@agentclientprotocol/sdk'
import { REPORT_EXIT_CODES, SLASH_COMMAND_NAMES, UI_TEXT } from '../shared/constants'

export interface AcpReportsPort {
  /** ACP defines text blocks, not a Markdown capability. The client adapter chooses this. */
  readonly format: 'md' | 'text'
  execute(
    args: string,
    context: {
      readonly cwd: string
      readonly sessionId: string
      readonly format: 'md' | 'text'
      readonly signal: AbortSignal
    },
  ): Promise<{ readonly code: number; readonly text: string }>
}

/** One quote-aware tokenizer for the local slash boundary and CLI report arguments. */
function* reportTokens(text: string) {
  let token = ''
  let quote = ''
  let isStarted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index)
    if (quote !== '') {
      if (char === quote) quote = ''
      else token += char
    } else if (char === '"' || char === "'") {
      quote = char
      isStarted = true
    } else if (/\s/.test(char)) {
      if (isStarted) yield { value: token, end: index }
      token = ''
      isStarted = false
    } else {
      token += char
      isStarted = true
    }
  }
  if (quote !== '') throw new Error(UI_TEXT.reportUi.generationFailed)
  if (isStarted) yield { value: token, end: text.length }
}

/** Shell-like quotes without expansion, substitution, or starting a shell. */
export function reportArguments(text: string): string[] {
  return [...reportTokens(text)].map((token) => token.value)
}

/** Reserve the whole command, including malformed/attached invocations, before any model turn. */
export function acpReportArguments(blocks: readonly ContentBlock[]): string | undefined {
  const first = blocks[0]
  if (first?.type !== 'text') return undefined
  const text = first.text.trim()
  const prefix = `/${SLASH_COMMAND_NAMES.report}`
  if (!text.startsWith(prefix)) return undefined
  // Consume only the head: malformed quotes in the arguments still belong to /report.
  try {
    const command = reportTokens(text).next().value
    if (command === undefined || text.slice(0, command.end) !== prefix) return undefined
    return blocks.length === 1 ? text.slice(command.end).trim() : '--invalid-report-attachment'
  } catch {
    return undefined
  }
}

/** An absent or failing integration is local failure, never a prompt sent to the backend. */
export async function runAcpReport(
  args: string,
  port: AcpReportsPort | undefined,
  context: { readonly cwd: string; readonly sessionId: string; readonly signal: AbortSignal },
): Promise<string> {
  try {
    context.signal.throwIfAborted()
    if (port === undefined) return UI_TEXT.reportUi.generationFailed
    const result = await port.execute(args, { ...context, format: port.format })
    context.signal.throwIfAborted()
    if (
      Object.values(REPORT_EXIT_CODES).every((code) => code !== result.code) ||
      typeof result.text !== 'string'
    )
      throw new Error(UI_TEXT.reportUi.generationFailed)
    return result.text
  } catch {
    return UI_TEXT.reportUi.generationFailed
  }
}
