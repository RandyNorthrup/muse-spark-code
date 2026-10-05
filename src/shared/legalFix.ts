// The selected-fix handoff's wire contract (M97 lane W, PLAN.md D76):
// what the webview sends to preview and confirm fixes for exactly the
// findings the user selected, and what the host answers. Every object is
// strict and every string bounded, as in `legal.ts`; no field carries a
// secret value, whole files, or raw source beyond a finding's own excerpt.
//
// The host, not the webview, is the security boundary: it rechecks the
// permission mode, workspace trust and identity, and the evidence and file
// hashes before each selected patch, and refuses stale work with a
// LEGAL_FIX_REFUSALS word instead of writing.

import * as z from 'zod/mini'
import {
  LEGAL_FINDING_ID_MAX_CHARS,
  LEGAL_FIX_FILE_READ_MAX_BYTES,
  LEGAL_FINDINGS_MAX,
  LEGAL_FIX_DIGEST_MAX_CHARS,
  LEGAL_FIX_EXCLUSIONS,
  LEGAL_FIX_OUTCOMES,
  LEGAL_FIX_REFUSALS,
  LEGAL_PATH_MAX_CHARS,
  LEGAL_TEXT_MAX_CHARS,
  PERMISSION_MODES,
} from './constants'
import { legalFindingSchema, legalScanResultSchema } from './legal'

const idSchema = z.string().check(z.minLength(1), z.maxLength(LEGAL_FINDING_ID_MAX_CHARS))
const pathSchema = z.string().check(z.minLength(1), z.maxLength(LEGAL_PATH_MAX_CHARS))
// A hex digest (FNV-1a evidence digests, SHA-256 file hashes): short and
// bounded, never file content.
const digestSchema = z.string().check(z.minLength(1), z.maxLength(LEGAL_FIX_DIGEST_MAX_CHARS))
const textSchema = z.string().check(z.minLength(1), z.maxLength(LEGAL_TEXT_MAX_CHARS))

/** One finding's identity with the digest of its evidence at preview time. */
export const legalFixEvidenceSchema = z.strictObject({
  id: idSchema,
  digest: digestSchema,
})

/** One guarded file's identity with its content hash at preview time. */
export const legalFixFileHashSchema = z.strictObject({
  path: pathSchema,
  hash: digestSchema,
})

/**
 * What the host stores under a preview id (and what crosses the wire
 * inside the preview): the scan's versions, the evidence digests, the file
 * hashes, and the workspace and mode the preview was taken in. A confirm
 * whose live state differs in any of these is refused as stale.
 */
export const legalFixSnapshotSchema = z.extend(
  z.pick(legalScanResultSchema, {
    version: true,
    ruleVersion: true,
    dataVersion: true,
    scope: true,
  }),
  {
    evidence: z.array(legalFixEvidenceSchema).check(z.maxLength(LEGAL_FINDINGS_MAX)),
    fileHashes: z.array(legalFixFileHashSchema).check(z.maxLength(LEGAL_FINDINGS_MAX)),
    workspacePath: z.string().check(z.maxLength(LEGAL_PATH_MAX_CHARS)),
    permissionMode: z.enum(PERMISSION_MODES),
  },
)
export type LegalFixSnapshot = z.infer<typeof legalFixSnapshotSchema>

/**
 * The report the selection was read from: its rule/data versions and scope,
 * echoed so the preview's snapshot names the exact scan it guards.
 */
export const legalFixScanMetaSchema = z.extend(
  z.pick(legalScanResultSchema, { ruleVersion: true, dataVersion: true, scope: true }),
  { scanId: z.optional(idSchema) },
)

/**
 * The webview asks the host to preview fixes for exactly these findings:
 * the selected ids, in the report's order. Browser evidence is never
 * authoritative; the host looks the ids up in its own scan record. `includeProjectLicense` is the user's separate
 * project-license confirmation (D76); without it those findings stay out
 * of the preview.
 */
export const requestLegalFixMessageSchema = z.strictObject({
  type: z.literal('requestLegalFix'),
  requestId: z.optional(idSchema),
  scan: legalFixScanMetaSchema,
  findings: z.array(legalFindingSchema).check(z.maxLength(LEGAL_FINDINGS_MAX)),
  includeProjectLicense: z.boolean(),
})
export type RequestLegalFixMessage = z.infer<typeof requestLegalFixMessageSchema>

/** One selected finding the preview leaves out, and the word for why. */
export const legalFixExcludedSchema = z.strictObject({
  id: idSchema,
  reason: z.enum(LEGAL_FIX_EXCLUSIONS),
})
export type LegalFixExcluded = z.infer<typeof legalFixExcludedSchema>

/**
 * The host's preview: the exact eligible findings and the only paths a
 * confirm may authorize, plus who stays out and why. Nothing is authorized
 * by this message; `confirmLegalFix` still has to pass every recheck.
 */
export const legalFixPatchSchema = z.strictObject({
  path: pathSchema,
  diff: z.string().check(z.minLength(1), z.maxLength(LEGAL_FIX_FILE_READ_MAX_BYTES)),
})
export type LegalFixPatch = z.infer<typeof legalFixPatchSchema>

export const legalFixPreviewMessageSchema = z.strictObject({
  type: z.literal('legalFixPreview'),
  requestId: z.optional(idSchema),
  patches: z.optional(z.array(legalFixPatchSchema).check(z.maxLength(LEGAL_FINDINGS_MAX))),
  previewId: idSchema,
  /**
   * Present exactly when `refusal` is absent: the guarded baseline the
   * confirm rechecks. A refused preview stores nothing; confirming its id
   * refuses with `previewExpired`.
   */
  snapshot: z.optional(legalFixSnapshotSchema),
  eligible: z.array(idSchema).check(z.maxLength(LEGAL_FINDINGS_MAX)),
  excluded: z.array(legalFixExcludedSchema).check(z.maxLength(LEGAL_FINDINGS_MAX)),
  paths: z.array(pathSchema).check(z.maxLength(LEGAL_FINDINGS_MAX)),
  refusal: z.optional(z.enum(LEGAL_FIX_REFUSALS)),
})
export type LegalFixPreviewMessage = z.infer<typeof legalFixPreviewMessageSchema>

/** The webview confirms exactly the preview it showed the user. */
export const confirmLegalFixMessageSchema = z.strictObject({
  type: z.literal('confirmLegalFix'),
  previewId: idSchema,
})
export type ConfirmLegalFixMessage = z.infer<typeof confirmLegalFixMessageSchema>

/** One path the applier could not fix, in the host's own words. */
export const legalFixFailureSchema = z.strictObject({
  path: pathSchema,
  reason: textSchema,
})
export type LegalFixFailure = z.infer<typeof legalFixFailureSchema>

/**
 * What the confirm ends as: every selected path applied, some applied and
 * the rest listed (never reported as complete success), or refused before
 * any write with a LEGAL_FIX_REFUSALS word.
 */
export const legalFixResultMessageSchema = z.strictObject({
  type: z.literal('legalFixResult'),
  previewId: idSchema,
  outcome: z.enum(LEGAL_FIX_OUTCOMES),
  applied: z.array(pathSchema).check(z.maxLength(LEGAL_FINDINGS_MAX)),
  failed: z.array(legalFixFailureSchema).check(z.maxLength(LEGAL_FINDINGS_MAX)),
  refusal: z.optional(z.enum(LEGAL_FIX_REFUSALS)),
})
export type LegalFixResultMessage = z.infer<typeof legalFixResultMessageSchema>

// FNV-1a (32-bit) for evidence digests: deterministic on every machine,
// with no dependency. Code units or code points alike stay a stable
// fingerprint; only stability across calls matters here.
const FNV_OFFSET_BASIS = 0x81_1c_9d_c5
const FNV_PRIME = 0x01_00_01_93
const FNV_HEX_RADIX = 16
const FNV_HEX_LENGTH = 8

/**
 * The evidence digest (FNV-1a, 8 hex digits): a stable fingerprint of what
 * the scanner said, so a changed report refuses instead of fixing from
 * stale words. Field order is fixed; every applicable field participates.
 */
export function findingDigest(finding: z.infer<typeof legalFindingSchema>): string {
  const stable = JSON.stringify([
    finding.id,
    finding.severity,
    finding.category,
    finding.file ?? '',
    finding.line ?? 0,
    finding.endLine ?? 0,
    finding.packageName ?? '',
    finding.packageVersion ?? '',
    finding.licenseExpression ?? '',
    finding.evidenceSource,
    finding.confidence,
    finding.explanation,
    finding.recommendation,
    finding.fixable,
    finding.evidenceExcerpt ?? '',
  ])
  let hash = FNV_OFFSET_BASIS
  for (let index = 0; index < stable.length; index += 1) {
    hash ^= stable.codePointAt(index) ?? 0
    hash = Math.imul(hash, FNV_PRIME)
  }
  return (hash >>> 0).toString(FNV_HEX_RADIX).padStart(FNV_HEX_LENGTH, '0')
}
