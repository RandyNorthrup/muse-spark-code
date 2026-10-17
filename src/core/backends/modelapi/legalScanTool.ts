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
  LEGAL_SCAN_TOOL_MODEL_TEXT,
  MODEL_API_TOOLS,
} from '../../../shared/constants'
import {
  legalScanInputSchema,
  legalScanResultSchema,
  type LegalScanRunner,
} from '../../../shared/legal'

/** What the model reads in the tool list: what the scan is and is not. */
export const LEGAL_SCAN_DESCRIPTION = LEGAL_SCAN_TOOL_MODEL_TEXT.description

/** The arguments, mirroring lane 0's input: a subset, a per-scan policy, or neither. */
export const LEGAL_SCAN_PARAMETERS: Record<string, unknown> = {
  paths: {
    type: 'array',
    items: { type: 'string' },
    description: LEGAL_SCAN_TOOL_MODEL_TEXT.pathsDescription,
  },
  headerPolicy: {
    type: 'string',
    enum: [...LEGAL_HEADER_POLICIES],
    description: LEGAL_SCAN_TOOL_MODEL_TEXT.headerPolicyDescription,
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
    throw new Error(LEGAL_SCAN_TOOL_MODEL_TEXT.cancelled)
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
  // Node consumers share this adapter; the caller supplies its installed display text.
  disclaimer = UI_TEXT.legalScanDisclaimer,
): Promise<LegalScanCallOutcome> {
  if (runner === undefined) {
    return refused(`${LEGAL_SCAN_TOOL_MODEL_TEXT.unknownTool} ${MODEL_API_TOOLS.legalScan}`)
  }
  const parsed = legalScanInputSchema.safeParse(args)
  if (!parsed.success) {
    return refused(
      `${LEGAL_SCAN_TOOL_MODEL_TEXT.invalidArguments}: ${z.prettifyError(parsed.error)}`,
    )
  }
  throwIfCancelled(signal)
  if (!isTrusted) {
    return refused(LEGAL_SCAN_TOOL_MODEL_TEXT.legalScanRestrictedMode, true)
  }
  const result = await runner(parsed.data, signal)
  throwIfCancelled(signal)
  const checked = legalScanResultSchema.safeParse(result)
  return checked.success
    ? {
        ok: true,
        json: JSON.stringify({ ...checked.data, disclaimer }),
      }
    : refused(LEGAL_SCAN_TOOL_MODEL_TEXT.invalidResult)
}
