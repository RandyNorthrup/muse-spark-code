import { isProtectedPath } from '../core/protectedPaths'
import { bytesFingerprint, fingerprint } from '../core/verify/fingerprint'
import { confineWorkspacePath } from '../core/workspacePath'
import type { ToolIo } from '../core/backends/modelapi/tools'
// Selected user edits use the window's existing checkpoint admission and
// conditional tool writes. Preparation cannot publish; apply never synthesizes.
import { LEGAL_FIX_FILE_READ_MAX_BYTES, UI_TEXT } from '../shared/constants'
import type { LegalFinding } from '../shared/legal'
import type { LegalPreparedPatch } from '../shared/legalScanEntry'
import type { LegalFixApplier } from './legalFix'

export interface LegalFixApplierDeps {
  readonly prepare: (findings: readonly LegalFinding[]) => Promise<readonly LegalPreparedPatch[]>
  readonly readHash: (path: string) => Promise<string | undefined>
  readonly approveOwnership: (paths: readonly string[]) => Promise<boolean>
  readonly write: (
    path: string,
    before: string,
    after: string,
    isCurrent: () => boolean,
  ) => Promise<boolean>
}

export function createLegalFixApplier(deps: LegalFixApplierDeps): LegalFixApplier {
  const prepared = new Map<string, LegalPreparedPatch>()
  return {
    prepare: async (findings) => {
      prepared.clear()
      const entries = await deps.prepare(findings)
      for (const entry of entries) prepared.set(entry.patch.path, entry)
      return entries.map((entry) => entry.patch)
    },
    apply: async (_findings, paths, patches, isCurrent) => {
      const applied: string[] = []
      const failed: { path: string; reason: string }[] = []
      let isApproved: boolean
      try {
        isApproved = isCurrent() && (await deps.approveOwnership(paths))
      } catch {
        return {
          applied: [],
          failed: paths.map((path) => ({ path, reason: UI_TEXT.editReviewFailed })),
        }
      }
      for (const path of paths) {
        const entry = prepared.get(path)
        const shown = patches.find((patch) => patch.path === path)
        let reason: string | undefined
        if (!isApproved) reason = UI_TEXT.legalFixDenied
        else if (!isCurrent()) reason = UI_TEXT.legalFixRefusedExpired
        else if (entry === undefined || shown?.diff !== entry.patch.diff)
          reason = UI_TEXT.legalFixRefusedStale
        else {
          try {
            let isEvidenceCurrent = true
            for (const evidence of entry.evidence) {
              if ((await deps.readHash(evidence.path)) !== evidence.hash || !isCurrent())
                isEvidenceCurrent = false
            }
            if (
              isEvidenceCurrent &&
              isCurrent() &&
              (await deps.write(path, entry.before, entry.after, isCurrent))
            )
              applied.push(path)
            else reason = UI_TEXT.legalFixRefusedStale
          } catch {
            reason = UI_TEXT.editReviewFailed
          }
        }
        if (reason !== undefined) failed.push({ path, reason })
      }
      prepared.clear()
      return { applied, failed }
    },
  }
}

export interface LegalFixEditsDeps {
  readonly workspaceRoot: string | undefined
  readonly platform: NodeJS.Platform
  readonly io: Pick<ToolIo, 'realPath' | 'readBytes' | 'writeFileIfUnchanged'>
  readonly withAdmission: (
    check: () => void,
    canPublish: (assertCanWrite: () => void) => Promise<boolean>,
  ) => Promise<boolean>
}

/** The same confined, conditional tool write used on either backend. */
export function legalFixFileEdits(
  deps: LegalFixEditsDeps,
): Pick<LegalFixApplierDeps, 'readHash' | 'write'> {
  const resolve = async (relative: string) => {
    if (deps.workspaceRoot === undefined) return
    const confined = await confineWorkspacePath(
      deps.workspaceRoot,
      relative,
      deps.platform,
      deps.io,
    )
    if (!confined.ok || confined.canonical !== relative || isProtectedPath(relative)) return
    return confined
  }
  return {
    readHash: async (relative) => {
      const confined = await resolve(relative)
      if (confined === undefined) return
      const bytes = await deps.io.readBytes(
        confined.checkedAbsolute,
        LEGAL_FIX_FILE_READ_MAX_BYTES,
        confined.checkedAbsolute,
      )
      return bytes === undefined ? undefined : bytesFingerprint(bytes)
    },
    write: async (relative, before, after, isCurrent) => {
      const check = () => {
        if (!isCurrent()) throw new Error(UI_TEXT.legalFixRefusedExpired)
      }
      check()
      const confined = await resolve(relative)
      check()
      if (confined === undefined) return false
      return await deps.withAdmission(
        check,
        async (assertCanWrite) =>
          (await deps.io.writeFileIfUnchanged(
            confined.checkedAbsolute,
            fingerprint(before),
            after,
            {
              expectedCanonicalPath: confined.checkedAbsolute,
              unsavedAt: [confined.absolute, confined.checkedAbsolute],
              assertCanWrite,
            },
          )) === 'written',
      )
    },
  }
}
