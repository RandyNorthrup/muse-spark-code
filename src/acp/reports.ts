import type { ContentBlock } from '@agentclientprotocol/sdk'
import { REPORT_EXIT_CODES, SLASH_COMMAND_NAMES, UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'
import { redactSecrets } from '../shared/redact'

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

/**
The tokenizer's own failure: an unterminated quote reserves nothing. Its
message is the fixed sentence, never the text it failed on.
*/
class ReportTokensError extends Error {}

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
  if (quote !== '') throw new ReportTokensError(UI_TEXT.reportUi.generationFailed)
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
  } catch (error: unknown) {
    // Only the tokenizer's own failure reserves nothing: anything else keeps
    // its kind past the slash boundary.
    if (!(error instanceof ReportTokensError)) throw error
    return undefined
  }
}

/** A thrown report failure as the session reads it: its reason, scrubbed, or the plain sentence. */
function reportFailureText(error: Error): string {
  const reason = error.message === '' ? undefined : redactSecrets(error.message)
  return reason === undefined
    ? UI_TEXT.reportUi.generationFailed
    : fill(UI_TEXT.reportUi.generationReason, { reason })
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
      throw new Error('the report integration answered outside the report protocol')
    return result.text
  } catch (error: unknown) {
    // Only a non-error keeps its kind past the boundary. A thrown failure
    // names its reason, scrubbed of secrets and account ids (the port's own
    // text is already scrubbed where it was rendered); a cancelled turn
    // stays the fixed sentence.
    if (!(error instanceof Error)) throw error
    return context.signal.aborted ? UI_TEXT.reportUi.generationFailed : reportFailureText(error)
  }
}
