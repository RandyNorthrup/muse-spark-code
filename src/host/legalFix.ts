// The host side of the selected-fix handoff (M97 lane W, PLAN.md D76).
// Stores the host's scan and its exact byte hashes, prepares reviewed patches,
// consumes previews before awaiting confirm, and rechecks the
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
  LEGAL_FINDINGS_MAX,
  type PermissionMode,
} from '../shared/constants'
import {
  authorizeLegalFix,
  compareStrings,
  eligibleFixTargets,
  fixPaths,
  liveEvidence,
} from '../core/legalFix'
import type { LegalScanResult, LegalFinding } from '../shared/legal'
import {
  findingDigest,
  legalFixPatchSchema,
  type LegalFixPatch,
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
  /** Read-only preparation; apply must use these exact diffs and check isCurrent before every write. */
  prepare?(
    findings: readonly LegalFinding[],
    paths: readonly string[],
  ): Promise<readonly LegalFixPatch[]>
  apply(
    findings: readonly LegalFinding[],
    paths: readonly string[],
    patches: readonly LegalFixPatch[],
    isCurrent: () => boolean,
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
  readonly patches: readonly LegalFixPatch[]
  readonly snapshot: LegalFixSnapshot
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Read one guarded file: its hash, or the reason it stays out of the batch. */
async function hashGuardedFile(
  relativePath: string,
  files: LegalFixFileAccess,
  isCurrent: () => boolean,
): Promise<{ readonly hash: string } | { readonly exclusion: LegalFixExcluded['reason'] }> {
  const absolute = await files.resolveRelativePath(relativePath)
  if (absolute === undefined || !isCurrent()) {
    // Denied traversal: the path is not part of this workspace's scan.
    return { exclusion: 'unknownFinding' }
  }
  // Bounded reads return nothing past the bound, so a file that is gone,
  // unreadable, or larger than the guard bound all read as undefined and
  // stay out as `unknownFinding`; bytes past the bound (an exact-size file,
  // or a document read under its own larger cap) read as `fileTooLarge`.
  const bytes = await files.readBytes(absolute, LEGAL_FIX_FILE_READ_MAX_BYTES + 1)
  if (bytes === undefined || !isCurrent()) {
    return { exclusion: 'unknownFinding' }
  }
  return bytes.length > LEGAL_FIX_FILE_READ_MAX_BYTES
    ? { exclusion: 'fileTooLarge' }
    : { hash: sha256Hex(bytes) }
}

/** The stored fix previews, oldest evicted past the named bound. */
export class LegalFixPreviews {
  private readonly stored = new Map<string, StoredPreview>()
  private generation = 0
  private disposed = false
  private context: string | undefined
  private scan:
    | { readonly id: string; readonly result: LegalScanResult; readonly workspacePath: string }
    | undefined

  private current(state: LegalFixHostState): boolean {
    const context = JSON.stringify([state.permissionMode, state.workspacePath, state.isTrusted])
    if (this.context !== undefined && context !== this.context) this.invalidate()
    this.context = context
    return !this.disposed
  }

  /** Only the scanner's host result can establish a fix baseline. */
  setScan(id: string, result: LegalScanResult, workspacePath: string): void {
    if (this.disposed) return
    this.invalidate()
    this.scan = { id, result: structuredClone(result), workspacePath }
  }

  invalidate(): void {
    this.generation += 1
    this.stored.clear()
  }

  /** Forget every preview: later confirms refuse with `previewExpired`. */
  dispose(): void {
    this.disposed = true
    this.invalidate()
    this.scan = undefined
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
    this.current(state)
    const generation = this.generation
    const isCurrent = () => this.current(state) && generation === this.generation
    const refused = (refusal: LegalFixPreviewMessage['refusal']): LegalFixPreviewMessage => ({
      type: 'legalFixPreview',
      previewId,
      requestId: message.requestId,
      eligible: [],
      excluded: [],
      paths: [],
      refusal,
    })
    const scan = this.scan
    if (
      scan === undefined ||
      scan.id !== message.scan.scanId ||
      scan.workspacePath !== state.workspacePath ||
      scan.result.ruleVersion !== message.scan.ruleVersion ||
      scan.result.dataVersion !== message.scan.dataVersion ||
      scan.result.scope !== message.scan.scope ||
      scan.result.evidenceFiles === undefined ||
      scan.result.evidenceFiles.length > LEGAL_FINDINGS_MAX
    )
      return refused('staleEvidence')
    const selectedIds = message.findings.map((finding) => finding.id)
    const { eligible, excluded } = eligibleFixTargets(
      scan.result.findings,
      selectedIds,
      message.includeProjectLicense,
    )
    const kept: LegalFinding[] = []
    const fileExcluded: LegalFixExcluded[] = []
    const hashes = new Map<string, string>()
    for (const { path, hash } of scan.result.evidenceFiles) {
      const guarded = await hashGuardedFile(path, state.files, isCurrent)
      if (!isCurrent()) return refused('previewExpired')
      if (!('hash' in guarded) || guarded.hash !== hash) return refused('staleEvidence')
      hashes.set(path, hash)
    }
    for (const finding of eligible) {
      if (finding.file === undefined || !hashes.has(finding.file)) {
        fileExcluded.push({ id: finding.id, reason: 'unknownFinding' })
      } else kept.push(finding)
    }
    let patches: readonly LegalFixPatch[] = []
    if (kept.length > 0 && state.applier?.prepare !== undefined) {
      const prepared = await state.applier.prepare(kept, fixPaths(kept))
      if (!isCurrent()) return refused('previewExpired')
      const paths = new Set(fixPaths(kept))
      const parsed = prepared.map((patch) => legalFixPatchSchema.safeParse(patch))
      if (
        parsed.some((entry) => !entry.success) ||
        prepared.some((patch) => !paths.has(patch.path)) ||
        new Set(prepared.map((patch) => patch.path)).size !== paths.size ||
        prepared.length !== paths.size
      )
        return refused('fixUnavailable')
      patches = structuredClone(prepared)
    }
    if (!isCurrent()) return refused('previewExpired')
    const snapshot: LegalFixSnapshot = {
      version: LEGAL_RESULT_VERSION,
      ruleVersion: scan.result.ruleVersion,
      dataVersion: scan.result.dataVersion,
      scope: scan.result.scope,
      evidence: kept.map((finding) => ({ id: finding.id, digest: findingDigest(finding) })),
      fileHashes: [...hashes].map(([path, hash]) => ({ path, hash })),
      workspacePath: state.workspacePath,
      permissionMode: state.permissionMode,
    }
    const preview: LegalFixPreviewMessage = {
      type: 'legalFixPreview',
      requestId: message.requestId,
      patches: structuredClone([...patches]),
      previewId,
      snapshot,
      eligible: kept.map((finding) => finding.id),
      excluded: [...excluded, ...fileExcluded].map((entry) => ({
        id: entry.id,
        reason: entry.reason,
      })),
      paths: [...fixPaths(kept)],
    }
    this.stored.set(previewId, { findings: kept, snapshot, patches })
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
    // Claim synchronously, before any await: the same preview cannot dispatch twice.
    const stored = this.stored.get(message.previewId)
    this.stored.delete(message.previewId)
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
    const generation = this.generation
    this.current(state)
    const isCurrent = () => this.current(state) && generation === this.generation
    const preflight = authorizeLegalFix(stored.snapshot, {
      permissionMode: state.permissionMode,
      workspacePath: state.workspacePath,
      isTrusted: state.isTrusted,
      evidence: liveEvidence(this.scan?.result.findings ?? []),
      fileHashes: Object.fromEntries(
        stored.snapshot.fileHashes.map(({ path, hash }) => [path, hash]),
      ),
    })
    if (!preflight.ok)
      return {
        type: 'legalFixResult',
        previewId: message.previewId,
        outcome: 'refused',
        applied: [],
        failed: [],
        refusal: preflight.refusal,
      }
    const fileHashes: Record<string, string | undefined> = {}
    for (const { path } of stored.snapshot.fileHashes) {
      const guarded = await hashGuardedFile(path, state.files, isCurrent)
      if (!isCurrent())
        return {
          type: 'legalFixResult',
          previewId: message.previewId,
          outcome: 'refused',
          applied: [],
          failed: [],
          refusal: 'previewExpired',
        }
      fileHashes[path] = 'hash' in guarded ? guarded.hash : undefined
    }
    const authorization = authorizeLegalFix(stored.snapshot, {
      permissionMode: state.permissionMode,
      workspacePath: state.workspacePath,
      isTrusted: state.isTrusted,
      evidence: liveEvidence(this.scan?.result.findings ?? []),
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
    if (!isCurrent() || state.applier === undefined || stored.patches.length === 0) {
      return {
        type: 'legalFixResult',
        previewId: message.previewId,
        outcome: 'refused',
        applied: [],
        failed: [],
        refusal: 'fixUnavailable',
      }
    }
    const { applied, failed } = await state.applier.apply(
      stored.findings,
      fixPaths(stored.findings),
      stored.patches,
      isCurrent,
    )
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
