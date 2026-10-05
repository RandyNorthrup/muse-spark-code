// The host side of the selected-fix handoff (M97 lane W, PLAN.md D76).
// Stores guarded previews, hashes the selected files, and rechecks the
// permission mode, workspace trust and identity, and the evidence and file
// hashes before each selected patch. A confirm that fails any recheck is
// refused with a LEGAL_FIX_REFUSALS word; an unknown or disposed preview
// refuses with `previewExpired`.
//
// Applying the authorized paths through the normal edit tools is lane B's
// router, through the injected `LegalFixApplier`: this module never edits,
// installs, builds or shells. Until that applier is wired, a confirm that
// passes every guard refuses with `fixUnavailable` rather than reporting an
// empty success.

import { createHash, randomUUID } from 'node:crypto'
import {
  LEGAL_FIX_FILE_READ_MAX_BYTES,
  LEGAL_FIX_PREVIEWS_MAX,
  LEGAL_RESULT_VERSION,
  type PermissionMode,
} from '../shared/constants'
import {
  authorizeLegalFix,
  compareStrings,
  eligibleFixTargets,
  fixPaths,
  liveEvidence,
} from '../core/legalFix'
import type { LegalFinding } from '../shared/legal'
import {
  findingDigest,
  type ConfirmLegalFixMessage,
  type LegalFixExcluded,
  type LegalFixFailure,
  type LegalFixPreviewMessage,
  type LegalFixResultMessage,
  type LegalFixSnapshot,
  type RequestLegalFixMessage,
} from '../shared/legalFix'

/** The guarded files, resolved and read through the host's own checks. */
export interface LegalFixFileAccess {
  /**
   * The workspace-confined absolute path for a finding's relative file;
   * undefined when it escapes the workspace (denied traversal).
   */
  resolveRelativePath(relativePath: string): Promise<string | undefined>
  /** Up to `maxBytes` of the file; undefined when it cannot be read. */
  readBytes(absolutePath: string, maxBytes: number): Promise<Uint8Array | undefined>
}

/**
 * Lane B's seam: applies the authorized findings through the normal edit
 * tools and the current permission mode's approvals. Partial failures are
 * returned per path, never thrown away.
 */
export interface LegalFixApplier {
  apply(
    findings: readonly LegalFinding[],
    paths: readonly string[],
  ): Promise<{ readonly applied: readonly string[]; readonly failed: readonly LegalFixFailure[] }>
}

/** The live host state a preview is taken in and a confirm rechecks. */
export interface LegalFixHostState {
  readonly permissionMode: PermissionMode
  readonly workspacePath: string
  readonly isTrusted: boolean
  readonly files: LegalFixFileAccess
  readonly applier: LegalFixApplier | undefined
}

interface StoredPreview {
  readonly findings: readonly LegalFinding[]
  readonly snapshot: LegalFixSnapshot
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Read one guarded file: its hash, or the reason it stays out of the batch. */
async function hashGuardedFile(
  relativePath: string,
  files: LegalFixFileAccess,
): Promise<{ readonly hash: string } | { readonly exclusion: LegalFixExcluded['reason'] }> {
  const absolute = await files.resolveRelativePath(relativePath)
  if (absolute === undefined) {
    // Denied traversal: the path is not part of this workspace's scan.
    return { exclusion: 'unknownFinding' }
  }
  // Bounded reads return nothing past the bound, so a file that is gone,
  // unreadable, or larger than the guard bound all read as undefined and
  // stay out as `unknownFinding`; bytes past the bound (an exact-size file,
  // or a document read under its own larger cap) read as `fileTooLarge`.
  const bytes = await files.readBytes(absolute, LEGAL_FIX_FILE_READ_MAX_BYTES + 1)
  if (bytes === undefined) {
    return { exclusion: 'unknownFinding' }
  }
  return bytes.length > LEGAL_FIX_FILE_READ_MAX_BYTES
    ? { exclusion: 'fileTooLarge' }
    : { hash: sha256Hex(bytes) }
}

/** The stored fix previews, oldest evicted past the named bound. */
export class LegalFixPreviews {
  private readonly stored = new Map<string, StoredPreview>()

  /** Forget every preview: later confirms refuse with `previewExpired`. */
  dispose(): void {
    this.stored.clear()
  }

  get size(): number {
    return this.stored.size
  }

  /**
   * Preview fixes for exactly the selected findings: split them into the
   * eligible ones and the excluded-with-reason ones, hash the guarded
   * files, and store the snapshot the confirm rechecks. Only an empty
   * selection refuses the preview itself; mode, trust and staleness are
   * rechecked at confirm, when a write is actually at stake.
   */
  async preview(
    message: RequestLegalFixMessage,
    state: LegalFixHostState,
  ): Promise<LegalFixPreviewMessage> {
    const previewId = randomUUID()
    if (message.findings.length === 0) {
      return {
        type: 'legalFixPreview',
        previewId,
        eligible: [],
        excluded: [],
        paths: [],
        refusal: 'nothingSelected',
      }
    }
    const selectedIds = message.findings.map((finding) => finding.id)
    const { eligible, excluded } = eligibleFixTargets(
      message.findings,
      selectedIds,
      message.includeProjectLicense,
    )
    const kept: LegalFinding[] = []
    const fileExcluded: LegalFixExcluded[] = []
    const hashes = new Map<string, string>()
    for (const finding of eligible) {
      if (finding.file === undefined) {
        kept.push(finding)
        continue
      }
      const guarded = await hashGuardedFile(finding.file, state.files)
      if ('exclusion' in guarded) {
        fileExcluded.push({ id: finding.id, reason: guarded.exclusion })
        continue
      }
      kept.push(finding)
      hashes.set(finding.file, guarded.hash)
    }
    const snapshot: LegalFixSnapshot = {
      version: LEGAL_RESULT_VERSION,
      ruleVersion: message.scan.ruleVersion,
      dataVersion: message.scan.dataVersion,
      scope: message.scan.scope,
      evidence: kept.map((finding) => ({ id: finding.id, digest: findingDigest(finding) })),
      fileHashes: [...hashes].map(([path, hash]) => ({ path, hash })),
      workspacePath: state.workspacePath,
      permissionMode: state.permissionMode,
    }
    const preview: LegalFixPreviewMessage = {
      type: 'legalFixPreview',
      previewId,
      snapshot,
      eligible: kept.map((finding) => finding.id),
      excluded: [...excluded, ...fileExcluded].map((entry) => ({
        id: entry.id,
        reason: entry.reason,
      })),
      paths: [...fixPaths(kept)],
    }
    this.stored.set(previewId, { findings: kept, snapshot })
    while (this.stored.size > LEGAL_FIX_PREVIEWS_MAX) {
      const oldest = this.stored.keys().next()
      if (oldest.done === true) {
        break
      }
      this.stored.delete(oldest.value)
    }
    return preview
  }

  /**
   * Confirm exactly the preview the user saw: recheck mode, trust,
   * workspace, evidence and file hashes, then hand the authorized paths to
   * the applier. Any mismatch refuses before any write.
   */
  async confirm(
    message: ConfirmLegalFixMessage,
    state: LegalFixHostState,
  ): Promise<LegalFixResultMessage> {
    const stored = this.stored.get(message.previewId)
    if (stored === undefined) {
      return {
        type: 'legalFixResult',
        previewId: message.previewId,
        outcome: 'refused',
        applied: [],
        failed: [],
        refusal: 'previewExpired',
      }
    }
    const fileHashes: Record<string, string | undefined> = {}
    for (const { path } of stored.snapshot.fileHashes) {
      const guarded = await hashGuardedFile(path, state.files)
      fileHashes[path] = 'hash' in guarded ? guarded.hash : undefined
    }
    const authorization = authorizeLegalFix(stored.snapshot, {
      permissionMode: state.permissionMode,
      workspacePath: state.workspacePath,
      isTrusted: state.isTrusted,
      evidence: liveEvidence(stored.findings),
      fileHashes,
    })
    if (!authorization.ok) {
      return {
        type: 'legalFixResult',
        previewId: message.previewId,
        outcome: 'refused',
        applied: [],
        failed: [],
        refusal: authorization.refusal,
      }
    }
    if (state.applier === undefined) {
      return {
        type: 'legalFixResult',
        previewId: message.previewId,
        outcome: 'refused',
        applied: [],
        failed: [],
        refusal: 'fixUnavailable',
      }
    }
    const { applied, failed } = await state.applier.apply(stored.findings, authorization.paths)
    this.stored.delete(message.previewId)
    return {
      type: 'legalFixResult',
      previewId: message.previewId,
      outcome: failed.length === 0 ? 'applied' : 'partial',
      applied: [...applied].toSorted(compareStrings),
      failed: [...failed],
    }
  }
}
