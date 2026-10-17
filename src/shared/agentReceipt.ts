import type { ItemSnapshot } from './agentEvents'
import type { AgentEvidence, AgentReceipt } from './agentEvidence'
import { AGENT_RECEIPT_MAX_ROWS, AGENT_RECEIPT_MAX_CHARS } from './constants'
import { redactSecrets } from './redact'
import * as z from 'zod/mini'
import { parsePatchFiles, ADD_MARKER, REMOVE_MARKER } from './patchDocument'

const commandArgs = z.object({ command: z.optional(z.string()) })
const SHELL_NAMES: ReadonlySet<string> = new Set(['bash', 'powershell', 'shell', 'exec_command'])

/** M4's captured patch document; counts are evidence, never inferred from arguments. */
export function agentFilesFromPatch(document: string): AgentReceipt['files'] | undefined {
  const parsed = parsePatchFiles(document)
  return parsed?.map((file) => ({
    path: file.path.replaceAll('\\', '/'),
    added: file.hunks.flatMap((hunk) => hunk.lines).filter((line) => line.startsWith(ADD_MARKER))
      .length,
    removed: file.hunks
      .flatMap((hunk) => hunk.lines)
      .filter((line) => line.startsWith(REMOVE_MARKER)).length,
  }))
}

/** Commands come from validated tool arguments, never from the final reply. */
export function agentCommandOf(item: ItemSnapshot): string | undefined {
  if (item.commandText !== undefined) return item.commandText
  if (item.tool === undefined || !SHELL_NAMES.has(item.tool) || item.args === undefined)
    return undefined
  try {
    const raw: unknown = JSON.parse(item.args)
    return commandArgs.safeParse(raw).data?.command
  } catch {
    return undefined
  }
}

/** Bounded before redaction; redact complete strings before clipping their display. */
export function buildAgentReceipt(
  items: readonly ItemSnapshot[],
  evidence?: AgentEvidence,
  finalMessage?: string,
): AgentReceipt {
  let remaining = AGENT_RECEIPT_MAX_CHARS
  let isTruncated = items.length > AGENT_RECEIPT_MAX_ROWS
  const text = (value: string) => {
    const safe = redactSecrets(value)
    const clipped = safe.slice(0, remaining)
    remaining -= clipped.length
    isTruncated ||= safe.length > clipped.length
    return clipped
  }
  const selected = items.slice(-AGENT_RECEIPT_MAX_ROWS)
  const final = text(
    finalMessage ?? selected.findLast((item) => item.kind === 'agentMessage')?.text ?? '',
  )
  isTruncated ||= (evidence?.unfinished?.length ?? 0) > AGENT_RECEIPT_MAX_ROWS
  const unfinished = (evidence?.unfinished ?? [])
    .slice(0, AGENT_RECEIPT_MAX_ROWS)
    .map((value) => text(value))
  const files: AgentReceipt['files'] = []
  const checks: AgentReceipt['checks'] = []
  for (const item of selected) {
    const changed = item.changedFiles ?? []
    const available = AGENT_RECEIPT_MAX_ROWS - files.length
    isTruncated ||= changed.length > available
    const selectedFiles = changed.slice(0, available)
    for (const file of selectedFiles) {
      const path = text(file.path.replaceAll('\\', '/'))
      if (path !== '') files.push({ ...file, path })
    }
    const command = agentCommandOf(item)
    if (
      (command !== undefined || item.thenRun !== undefined) &&
      checks.length >= AGENT_RECEIPT_MAX_ROWS
    )
      isTruncated = true
    if (command !== undefined && checks.length < AGENT_RECEIPT_MAX_ROWS)
      checks.push({ command: text(command), exitCode: item.exitCode, durationMs: item.durationMs })
    if (item.thenRun !== undefined && checks.length < AGENT_RECEIPT_MAX_ROWS)
      checks.push({
        command: text(item.thenRun.command),
        exitCode: item.thenRun.exitCode,
        outcome: item.thenRun.outcome,
      })
    const verified = item.verifySummary?.checks ?? []
    const checksAvailable = AGENT_RECEIPT_MAX_ROWS - checks.length
    isTruncated ||= verified.length > checksAvailable
    const selectedChecks = verified.slice(0, checksAvailable)
    for (const check of selectedChecks) {
      checks.push({ command: text(check.name), outcome: check.outcome })
    }
  }
  return {
    files,
    checks,
    stopReason: evidence?.stopReason ?? 'unknown',
    finalMessage: final,
    unfinished,
    truncated: isTruncated,
  }
}
