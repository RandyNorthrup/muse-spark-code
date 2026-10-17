// The selected-fix handoff's guards (M97 lane W, PLAN.md D76). Pure and
// backend-agnostic: no `vscode`, no Node, no DOM. The host
// (`src/host/legalFix.ts`) supplies the live state; the webview
// (`LegalReport.tsx`) reuses the eligibility preview. Every refusal names a
// LEGAL_FIX_REFUSALS word; every exclusion a LEGAL_FIX_EXCLUSIONS word.

import {
  UI_TEXT,
  type LegalFixExclusion,
  type LegalFixRefusal,
  type PermissionMode,
} from '../shared/constants'
import type { LegalFinding } from '../shared/legal'
import { findingDigest, type LegalFixSnapshot } from '../shared/legalFix'

/**
 * A project-license change (D76): the project's own license declaration,
 * not a dependency's. It can never enter "safe ones"; it needs its own
 * separate explicit confirmation. A dependency finding always names its
 * package, so `license` without one is the project's.
 */
export function isProjectLicenseChange(finding: LegalFinding): boolean {
  return finding.packageName === undefined && finding.category === 'license'
}

/**
 * Byte-order string comparison: deterministic across machines, unlike a
 * locale-aware sort, so the same scan previews the same file order.
 */
export function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0
  }
  return left < right ? -1 : 1
}

/** The workspace-relative files of findings, sorted and deduplicated. */
export function fixPaths(findings: readonly LegalFinding[]): readonly string[] {
  const paths = new Set<string>()
  for (const finding of findings) {
    if (finding.file !== undefined) {
      paths.add(finding.file)
    }
  }
  return [...paths].toSorted(compareStrings)
}

export interface EligibleFixTargets {
  readonly eligible: readonly LegalFinding[]
  readonly excluded: readonly { readonly id: string; readonly reason: LegalFixExclusion }[]
}

/**
 * The exact selection (D76): only the selected ids, in the scan's own
 * order, that the scanner marked fixable and that need no separate
 * confirmation. Everything else is listed with its reason, never silently
 * dropped or added. An empty selection is eligible for nothing; Bypass
 * still requires the user to select.
 */
export function eligibleFixTargets(
  findings: readonly LegalFinding[],
  selectedIds: readonly string[],
  isProjectLicenseIncluded: boolean,
): EligibleFixTargets {
  const selected = new Set(selectedIds)
  const byId = new Map(findings.map((finding) => [finding.id, finding] as const))
  const unfixable = new Set(
    findings
      .filter(
        (finding) =>
          !finding.fixable ||
          finding.file
            ?.split('/')
            .some((segment) =>
              [
                'node_modules',
                'vendor',
                'third_party',
                'third-party',
                'gems',
                'site-packages',
                'registry',
                'packages',
              ].includes(segment.toLowerCase()),
            ) === true,
      )
      .map((finding) => finding.id),
  )
  const eligible: LegalFinding[] = []
  for (const finding of findings) {
    if (
      !selected.has(finding.id) ||
      unfixable.has(finding.id) ||
      (!isProjectLicenseIncluded && isProjectLicenseChange(finding))
    )
      continue
    eligible.push(finding)
  }
  const excluded: { readonly id: string; readonly reason: LegalFixExclusion }[] = []
  for (const id of selected) {
    const finding = byId.get(id)
    if (finding === undefined) {
      excluded.push({ id, reason: 'unknownFinding' })
    } else if (unfixable.has(id)) {
      excluded.push({ id, reason: 'notFixable' })
    } else if (!isProjectLicenseIncluded && isProjectLicenseChange(finding)) {
      excluded.push({ id, reason: 'projectLicenseSeparate' })
    }
  }
  return { eligible, excluded }
}

/** What the host re-reads before each selected patch (D76). */
export interface LegalFixLiveState {
  readonly permissionMode: PermissionMode
  readonly workspacePath: string
  readonly isTrusted: boolean
  /** Current evidence digests by finding id. */
  readonly evidence: Readonly<Record<string, string>>
  /** Current SHA-256 hex of each guarded file; undefined when unreadable. */
  readonly fileHashes: Readonly<Record<string, string | undefined>>
}

export type LegalFixAuthorization =
  | { readonly ok: true; readonly paths: readonly string[] }
  | { readonly ok: false; readonly refusal: LegalFixRefusal }

/**
 * Authorize exactly the snapshotted findings against the live state (D76):
 * recheck selection, permission state, trust, workspace, evidence hashes
 * and file hashes. The first mismatch refuses; a changed file or changed
 * evidence needs a fresh report/preview. Plan refuses writes; an untrusted
 * workspace (Restricted Mode) does too.
 */
export function authorizeLegalFix(
  snapshot: LegalFixSnapshot,
  live: LegalFixLiveState,
): LegalFixAuthorization {
  if (snapshot.evidence.length === 0) {
    // Nothing selected: Bypass never pre-authorizes, and neither does a scan.
    return { ok: false, refusal: 'nothingSelected' }
  }
  if (live.permissionMode === 'plan') {
    return { ok: false, refusal: 'planRefusesWrites' }
  }
  if (!live.isTrusted) {
    return { ok: false, refusal: 'workspaceUntrusted' }
  }
  if (live.workspacePath !== snapshot.workspacePath) {
    return { ok: false, refusal: 'workspaceChanged' }
  }
  if (live.permissionMode !== snapshot.permissionMode)
    return { ok: false, refusal: 'previewExpired' }
  for (const { id, digest } of snapshot.evidence) {
    if (live.evidence[id] !== digest) {
      return { ok: false, refusal: 'staleEvidence' }
    }
  }
  const paths = new Set<string>()
  for (const { path, hash } of snapshot.fileHashes) {
    if (live.fileHashes[path] !== hash) {
      // A changed (or vanished, or unreadable) file needs a fresh preview.
      return { ok: false, refusal: 'staleEvidence' }
    }
    paths.add(path)
  }
  return { ok: true, paths: [...paths].toSorted(compareStrings) }
}

/** Recompute the live evidence digests for findings the user selected. */
export function liveEvidence(findings: readonly LegalFinding[]): Record<string, string> {
  const digests: Record<string, string> = {}
  for (const finding of findings) {
    digests[finding.id] = findingDigest(finding)
  }
  return digests
}

/** The refusal word in the display language, read when shown (PLAN.md D33). */
export function legalFixRefusalText(refusal: LegalFixRefusal): string {
  switch (refusal) {
    case 'nothingSelected': {
      return UI_TEXT.legalFixNothingSelected
    }
    case 'planRefusesWrites': {
      return UI_TEXT.legalFixRefusedPlan
    }
    case 'workspaceUntrusted': {
      return UI_TEXT.legalFixRefusedTrust
    }
    case 'workspaceChanged': {
      return UI_TEXT.legalFixRefusedWorkspace
    }
    case 'staleEvidence': {
      return UI_TEXT.legalFixRefusedStale
    }
    case 'previewExpired': {
      return UI_TEXT.legalFixRefusedExpired
    }
    case 'fixUnavailable': {
      return UI_TEXT.legalFixRefusedUnavailable
    }
  }
}

/** The exclusion word in the display language, read when shown (PLAN.md D33). */
export function legalFixExclusionText(exclusion: LegalFixExclusion): string {
  switch (exclusion) {
    case 'notFixable': {
      return UI_TEXT.legalFixReasonNotFixable
    }
    case 'projectLicenseSeparate': {
      return UI_TEXT.legalFixReasonProjectLicense
    }
    case 'unknownFinding': {
      return UI_TEXT.legalFixReasonUnknown
    }
    case 'fileTooLarge': {
      return UI_TEXT.legalFixReasonTooLarge
    }
  }
}
