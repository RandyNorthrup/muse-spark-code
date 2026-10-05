// The Model API backend's native `legal_scan` (M97, PLAN.md D76): the same
// deterministic read-only scan the `ide` server offers Muse Code. A read in
// every mode — it never writes, runs a command or installs — offered only
// with a scanner behind it, in a trusted workspace; trust lost after the
// offer refuses the call. The scan itself is lane S's; this lane validates
// lane 0's input and result around it, never its internals.

import * as z from 'zod/mini'
import {
  UI_TEXT,
  LEGAL_HEADER_POLICIES,
  MODEL_API_MODEL_TEXT,
  MODEL_API_TOOLS,
} from '../../../shared/constants'
import {
  legalScanInputSchema,
  legalScanResultSchema,
  type LegalScanRunner,
} from '../../../shared/legal'

/** What the model reads in the tool list: what the scan is and is not. */
export const LEGAL_SCAN_DESCRIPTION =
  'Run the workspace’s deterministic licensing and legal scan and return its findings as JSON. Read-only: it changes nothing, runs no command and installs nothing. Applying a fix is separate: never edit, remove or install from this tool.'

/** The arguments, mirroring lane 0's input: a subset, a per-scan policy, or neither. */
export const LEGAL_SCAN_PARAMETERS: Record<string, unknown> = {
  paths: {
    type: 'array',
    items: { type: 'string' },
    description: 'Workspace-relative files or folders to scan; the whole workspace when absent',
  },
  headerPolicy: {
    type: 'string',
    enum: [...LEGAL_HEADER_POLICIES],
    description: 'Header policy for this scan only; the configured policy when absent',
  },
}

/** The call's outcome: the result's JSON, or the refusal the model reads. */
export type LegalScanCallOutcome =
  | { readonly ok: true; readonly json: string }
  | { readonly ok: false; readonly reason: string; readonly isRestricted: boolean }

function refused(reason: string, isRestricted = false): LegalScanCallOutcome {
  return { ok: false, reason, isRestricted }
}

/** Throws when the turn stopped; read afresh at each call. */
function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('the legal scan was cancelled')
  }
}

/**
 * A `legal_scan` call over an injected scanner: strict arguments (a write, a
 * command, a fix or an install arrives only as an unknown key and is
 * refused), trust rechecked, the signal honoured, and the result validated
 * before its JSON leaves. A throw means the turn stopped, as elsewhere.
 */
export async function runLegalScanCall(
  args: Readonly<Record<string, unknown>>,
  runner: LegalScanRunner | undefined,
  isTrusted: boolean,
  signal: AbortSignal,
): Promise<LegalScanCallOutcome> {
  if (runner === undefined) {
    return refused(`unknown tool ${MODEL_API_TOOLS.legalScan}`)
  }
  const parsed = legalScanInputSchema.safeParse(args)
  if (!parsed.success) {
    return refused(`invalid arguments: ${z.prettifyError(parsed.error)}`)
  }
  throwIfCancelled(signal)
  if (!isTrusted) {
    return refused(MODEL_API_MODEL_TEXT.legalScanRestrictedMode, true)
  }
  const result = await runner(parsed.data, signal)
  throwIfCancelled(signal)
  const checked = legalScanResultSchema.safeParse(result)
  return checked.success
    ? {
        ok: true,
        json: JSON.stringify({ ...checked.data, disclaimer: UI_TEXT.legalScanDisclaimer }),
      }
    : refused('the legal scan returned an invalid result')
}
