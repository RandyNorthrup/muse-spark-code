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

/** Reserve the whole command, including malformed/attached invocations, before any model turn. */
export function acpReportArguments(blocks: readonly ContentBlock[]): string | undefined {
  const first = blocks[0]
  if (first?.type !== 'text') return undefined
  const text = first.text.trim()
  const prefix = `/${SLASH_COMMAND_NAMES.report}`
  if (
    text !== prefix &&
    !text.startsWith(`${prefix} `) &&
    !text.startsWith(`${prefix}\n`) &&
    !text.startsWith(`${prefix}\t`)
  )
    return undefined
  return blocks.length === 1 ? text.slice(prefix.length).trim() : '--invalid-report-attachment'
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
