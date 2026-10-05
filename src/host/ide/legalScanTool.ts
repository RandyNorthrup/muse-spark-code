// The read-only legal scan for Muse Code through the `ide` session server
// (M97, PLAN.md D76): the same deterministic scan as the Model API backend's
// native `legal_scan`, offered as `mcp__ide__legalScan` in the server's items.
// Like every code intelligence tool it changes nothing, so it declares
// `readOnlyHint`; unlike web fetch it needs no per-call confirmation — the
// scan reads the workspace the user already opened, and applying any fix is
// a separate step through the existing approval/edit paths, never this tool.
// Listed only in a trusted workspace. The scan itself is lane S's; this lane
// calls it through lane 0's tool-input/result contract, never its internals.

import * as z from 'zod/mini'
import type { McpTool } from '../../core/mcp'
import {
  IDE_LEGAL_SCAN_TOOL,
  LEGAL_HEADER_POLICIES,
  MCP_ANNOTATIONS_READ_ONLY,
} from '../../shared/constants'
import {
  legalScanInputSchema,
  legalScanResultSchema,
  type LegalScanInput,
  type LegalScanResult,
} from '../../shared/legal'
import type { Logger } from '../logger'

/**
 * The deterministic scanner (lane S) as this lane calls it: lane 0's input
 * in, lane 0's result out, stopped by the signal. It never writes, runs a
 * command or installs; it reads the workspace under lane 0's limits.
 */
export type LegalScanRunner = (
  input: LegalScanInput,
  signal: AbortSignal,
) => Promise<LegalScanResult>

export interface IdeLegalScanDeps {
  /** A trusted workspace: the tool is listed only then, and each call rechecks. */
  readonly isOffered: () => boolean
  /** The scan; a throw reaches the model as a tool error. */
  readonly runScan: LegalScanRunner
  readonly log: Logger
}

/** Whether Muse Code is offered the scan: a trusted workspace, nothing else. */
export function isIdeLegalScanOffered(isTrusted: boolean): boolean {
  return isTrusted
}

/** Throws when the caller stopped waiting; read afresh at each call. */
function throwIfCancelled(signal: AbortSignal, message: string): void {
  if (signal.aborted) {
    throw new Error(message)
  }
}

async function callLegalScan(
  args: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
  deps: IdeLegalScanDeps,
): Promise<string> {
  // Strict: a write, a command, a fix or an install smuggled in as an
  // unknown key is refused here, before the scanner is even asked.
  const parsed = legalScanInputSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`invalid arguments: ${z.prettifyError(parsed.error)}`)
  }
  throwIfCancelled(signal, 'the legal scan was cancelled before it started')
  // Trust may have gone while the turn waited: a call then finds no tool.
  if (!deps.isOffered()) {
    throw new Error('the legal scan is unavailable while the workspace is untrusted')
  }
  const result = await deps.runScan(parsed.data, signal)
  throwIfCancelled(signal, 'the legal scan was cancelled')
  const checked = legalScanResultSchema.safeParse(result)
  if (!checked.success) {
    // The scanner's shape is lane S's contract: log what broke it, never
    // the raw value (a finding holds evidence excerpts).
    deps.log.error(`The legal scan returned an invalid result: ${z.prettifyError(checked.error)}`)
    throw new Error('the legal scan returned an invalid result')
  }
  return JSON.stringify(checked.data)
}

/** The tool as it stands now: none while the workspace is untrusted. */
export function ideLegalScanTools(deps: IdeLegalScanDeps): readonly McpTool[] {
  if (!deps.isOffered()) {
    return []
  }
  return [
    {
      name: IDE_LEGAL_SCAN_TOOL,
      description:
        'Run the workspace’s deterministic licensing and legal scan and return its findings as JSON. Read-only: it changes nothing, runs no command and installs nothing. Applying a fix is separate: never edit, remove or install from this tool.',
      inputSchema: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Workspace-relative files or folders to scan; the whole workspace when absent',
          },
          headerPolicy: {
            type: 'string',
            enum: [...LEGAL_HEADER_POLICIES],
            description: 'Header policy for this scan only; the configured policy when absent',
          },
        },
        required: [],
        additionalProperties: false,
      },
      annotations: MCP_ANNOTATIONS_READ_ONLY,
      call: async (args, signal) => await callLegalScan(args, signal, deps),
    },
  ]
}
