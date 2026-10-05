// The read-only legal scan's contract (M97, PLAN.md D76): what a finding
// is, what the `legal_scan` tool takes and returns, and what crosses
// postMessage between the host and the webview.
//
// Shared by the host and webview TypeScript projects (like protocol.ts), so
// this file must not import from `vscode`, Node, or the DOM.
//
// Boundaries are validated: every object is strict, so an unknown key fails
// instead of sliding through; every string is bounded; no field carries a
// secret value. The only raw file content a finding may hold is the bounded
// evidence excerpt; whole files, credentials and PII values never belong in
// a finding, a result, or a message.

import * as z from 'zod/mini'
import {
  LEGAL_CATEGORIES,
  LEGAL_EVIDENCE_EXCERPT_MAX_CHARS,
  LEGAL_EXCLUSIONS_MAX,
  LEGAL_FINDING_ID_MAX_CHARS,
  LEGAL_FINDINGS_MAX,
  LEGAL_FILES_SCANNED_MAX,
  LEGAL_HEADER_POLICIES,
  LEGAL_INCOMPLETE_MAX,
  LEGAL_PATH_MAX_CHARS,
  LEGAL_RESULT_VERSION,
  LEGAL_SCAN_PATHS_MAX,
  LEGAL_SEVERITIES,
  LEGAL_TEXT_MAX_CHARS,
  LEGAL_VERSION_MAX_CHARS,
} from './constants'

// A finding's stable id (`rule/version/counter`): quoted in the report and
// sorted deterministically.
const idSchema = z.string().check(z.minLength(1), z.maxLength(LEGAL_FINDING_ID_MAX_CHARS))
// A workspace-relative path with forward slashes, as D76's file:line.
const pathSchema = z.string().check(z.minLength(1), z.maxLength(LEGAL_PATH_MAX_CHARS))
const lineSchema = z.int().check(z.gte(1))
// A paragraph of the scanner's own words, never workspace bytes.
const textSchema = z.string().check(z.minLength(1), z.maxLength(LEGAL_TEXT_MAX_CHARS))
// Package coordinates and license expressions are short identifiers; the
// finding-id bound fits them.
const identifierSchema = z.string().check(z.minLength(1), z.maxLength(LEGAL_FINDING_ID_MAX_CHARS))

/**
 * One evidence-based finding (D76): its severity and category, where it was
 * seen, what declared it, why it matters, what to do, and whether the
 * selected-fix handoff may offer it. Missing evidence stays unknown: every
 * applicable field is optional except the id, severity, category,
 * explanation, recommendation and fixable flag.
 */
export const legalFindingSchema = z.strictObject({
  id: idSchema,
  severity: z.enum(LEGAL_SEVERITIES),
  category: z.enum(LEGAL_CATEGORIES),
  file: z.optional(pathSchema),
  line: z.optional(lineSchema),
  endLine: z.optional(lineSchema),
  packageName: z.optional(identifierSchema),
  packageVersion: z.optional(identifierSchema),
  licenseExpression: z.optional(identifierSchema),
  evidenceSource: textSchema,
  /** Graded 0 (a lead) to 1 (directly observed); never a proven verdict. */
  confidence: z.number().check(z.gte(0), z.lte(1)),
  explanation: textSchema,
  recommendation: textSchema,
  /** Only fixable findings may enter the selected-fix handoff. */
  fixable: z.boolean(),
  /** The only raw file content allowed: a short excerpt around the evidence. */
  evidenceExcerpt: z.optional(
    z.string().check(z.minLength(1), z.maxLength(LEGAL_EVIDENCE_EXCERPT_MAX_CHARS)),
  ),
})
export type LegalFinding = z.infer<typeof legalFindingSchema>

/**
 * What the `legal_scan` tool takes (D76): nothing by default, which scans
 * the whole workspace under the configured header policy. `paths` names an
 * explicit subset; `headerPolicy` overrides the setting for this scan only.
 * It never exposes a write operation.
 */
export const legalScanInputSchema = z.strictObject({
  paths: z.optional(z.array(pathSchema).check(z.maxLength(LEGAL_SCAN_PATHS_MAX))),
  headerPolicy: z.optional(z.enum(LEGAL_HEADER_POLICIES)),
})
export type LegalScanInput = z.infer<typeof legalScanInputSchema>

/**
 * The versioned, deterministic result (D76): rule/data versions, scan scope,
 * distribution assumptions, exclusions, incomplete checks and sorted
 * evidence. Changing only the model or backend never changes these facts.
 */
export const legalScanResultSchema = z.strictObject({
  version: z.literal(LEGAL_RESULT_VERSION),
  ruleVersion: z.string().check(z.minLength(1), z.maxLength(LEGAL_VERSION_MAX_CHARS)),
  dataVersion: z.string().check(z.minLength(1), z.maxLength(LEGAL_VERSION_MAX_CHARS)),
  /** Workspace-relative root scanned; empty means the whole workspace. */
  scope: z.string().check(z.maxLength(LEGAL_PATH_MAX_CHARS)),
  /** What distribution the obligations were read against, in one sentence. */
  distribution: textSchema,
  exclusions: z.array(pathSchema).check(z.maxLength(LEGAL_EXCLUSIONS_MAX)),
  incompleteChecks: z.array(textSchema).check(z.maxLength(LEGAL_INCOMPLETE_MAX)),
  findings: z.array(legalFindingSchema).check(z.maxLength(LEGAL_FINDINGS_MAX)),
  /** SHA-256 of every text file read by the scanner; host-owned fix baseline. */
  evidenceFiles: z.optional(
    z
      .array(
        z.strictObject({
          path: pathSchema,
          hash: z.string().check(z.regex(/^[a-f0-9]{64}$/)),
        }),
      )
      .check(z.maxLength(LEGAL_FILES_SCANNED_MAX)),
  ),
})
export type LegalScanResult = z.infer<typeof legalScanResultSchema>

/**
 * The deterministic scanner (lane S) as lanes B, W and R call it: lane 0's
 * input in, lane 0's result out, stopped by the signal. A type only, so both
 * the activation bundle and the Model API bundle name the same contract
 * without either carrying the scanner. It never writes, runs a command or
 * installs; it reads the workspace under lane 0's limits.
 */
export type LegalScanRunner = (
  input: LegalScanInput,
  signal: AbortSignal,
) => Promise<LegalScanResult>

/** The webview asks the host to run the deterministic scan (lane W's report). */
export const legalScanRequestMessageSchema = z.strictObject({
  type: z.literal('requestLegalScan'),
  input: z.optional(legalScanInputSchema),
})
export type LegalScanRequestMessage = z.infer<typeof legalScanRequestMessageSchema>

/** The host answers with the report; `requestId` matches one request. */
export const legalScanReportMessageSchema = z.strictObject({
  type: z.literal('legalScanReport'),
  requestId: z.string(),
  result: legalScanResultSchema,
})
export type LegalScanReportMessage = z.infer<typeof legalScanReportMessageSchema>
