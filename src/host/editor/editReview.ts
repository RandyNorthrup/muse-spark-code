// Review of an edit the CLI already applied (M5): "Open diff" rebuilds the
// file's pre-edit text from the stored patch document and opens VS Code's
// diff editor (before on the left, the file on the right); "Revert" writes
// that text back. Every VS Code call is injected, so the module is tested
// with fakes on every platform. Paths come from the patch document and are
// confined to the workspace.

import path from 'node:path'
import type { ConditionalWrite } from '../../core/backends/modelapi/tools'
import { revertHunks } from '../../core/patchApply'
import { isSamePath } from '../../core/paths'
import { fingerprint } from '../../core/verify/fingerprint'
import { MUSE_EDIT_SCHEME, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { type PatchFile, parsePatchFiles } from '../../shared/patchDocument'
import type { EditedFile } from '../../core/verify/diagnosticsReport'
import type { Logger } from '../logger'

/** How a Revert's change is held to what it read (`ToolIo.writeFileIfUnchanged`'s options). */
export interface RevertWriteOptions {
  /** The checked canonical target: a link or junction on the way now refuses the change. */
  readonly expectedCanonicalPath: string
  /** An editor holding unsaved text at any of them refuses it, asked just before the change. */
  readonly unsavedAt: readonly string[]
  /** The checkpoint admission's final word, asked just before the change. */
  readonly assertCanWrite: () => void
}

/**
 * A Revert's conditional publication (M72's guarded file I/O): `changed`, and
 * nothing done, when the file is no longer what the Revert read.
 */
export interface RevertIo {
  /** Replaces the file while it holds the text read (`ToolIo.writeFileIfUnchanged`). */
  writeFileIfUnchanged(
    absolutePath: string,
    expectedFingerprint: string,
    content: string,
    options: RevertWriteOptions,
  ): Promise<ConditionalWrite>
  /** Moves the file to the trash while it holds the text read. */
  trashFileIfUnchanged(
    absolutePath: string,
    expectedFingerprint: string,
    options: RevertWriteOptions,
  ): Promise<ConditionalWrite>
  /** Writes the file while nothing is there: it was absent when read. */
  createFileIfAbsent(
    absolutePath: string,
    content: string,
    options: RevertWriteOptions,
  ): Promise<ConditionalWrite>
}

export interface EditReviewDeps {
  /** Selects Windows or POSIX path rules, so both are unit-tested anywhere. */
  readonly platform: NodeJS.Platform
  /** Undefined without a folder: nothing is reviewed against the process's own directory (D27). */
  readonly workspaceRoot: string | undefined
  /** The file's text, or undefined when it does not exist. */
  readonly readFile: (fsPath: string) => Promise<string | undefined>
  /** The canonical form of a path, links resolved through the nearest existing ancestor. */
  readonly realPath: (fsPath: string) => Promise<string>
  /** Dirty editor buffers must not be replaced or deleted by a disk revert (D27). */
  readonly hasUnsavedChanges: (fsPath: string) => boolean
  /** Manual writes invalidate all live verification without creating an own edit round. */
  readonly beginEdit?: (file: EditedFile) => (wasWritten: boolean) => void
  /**
   * Holds checkpoint admission (M72's restore lease) around one whole Revert:
   * its read, rebuild, checks and publication. `assertAdmitted` is the
   * admission's final word. A failure to let it go after the file changed
   * rejects, which the Revert reports as a cleanup failure, not as unwritten.
   */
  readonly withAdmission: <T>(work: (assertAdmitted: () => void) => Promise<T>) => Promise<T>
  readonly io: RevertIo
  /** `vscode.diff(before, after, title)`; `beforeUri` is a `muse-edit:` URI string. */
  readonly openDiff: (beforeUri: string, fsPath: string, title: string) => Promise<void>
  readonly log: Logger
}

export interface ReviewNotice {
  readonly level: 'info' | 'warning'
  readonly text: string
}

interface ResolvedFile {
  readonly file: PatchFile
  readonly relativePath: string
  readonly fsPath: string
  readonly canonicalPath: string
  readonly canonicalRelativePath: string
}

/** One file of a patch as the review pane lists it (M70). */
export interface DescribedFile {
  readonly fileIndex: number
  readonly file: PatchFile
  /** Workspace-relative with forward slashes; the tool's own path when refused. */
  readonly path: string
  /** Why its hunks cannot be reverted here; undefined when they can. */
  readonly refusal: string | undefined
}

type Rebuilt =
  | { readonly ok: true; readonly content: string; readonly isCreatedFile: boolean }
  | { readonly ok: false; readonly notice: ReviewNotice }

/** What one Revert of one file did: true once the file was changed, else the notices say why. */
interface RevertResult {
  readonly isReverted: boolean
  readonly notices: readonly ReviewNotice[]
}

/** The document the `muse-edit:` provider serves for `uriPath`. */
export function originalUriPath(itemId: string, relativePath: string): string {
  return `/${itemId}/${relativePath}`
}

/** The file no longer carries the edit as it was made, or no longer holds what was read. */
function changedNotice(resolved: ResolvedFile): ReviewNotice {
  return {
    level: 'warning',
    text: fill(UI_TEXT.editNotRebuildable, { path: resolved.relativePath }),
  }
}

function patchFilesOf(patchJson: string): readonly PatchFile[] | undefined {
  const files = parsePatchFiles(patchJson)
  return files === undefined || files.length === 0 ? undefined : files
}

// Windows extended-length prefixes. The CLI's patch document names files
// as `\\?\C:\ws\notes.md` (verified live 2026-09-22), which `path.relative`
// would treat as a different root from `C:\ws`.
const BOM = '\u{FEFF}'
const WIN_SEP = path.win32.sep
const UNC_PREFIX = `${WIN_SEP}${WIN_SEP}`
const EXTENDED_PREFIX = `${UNC_PREFIX}?${WIN_SEP}`
const EXTENDED_UNC_PREFIX = `${EXTENDED_PREFIX}UNC${WIN_SEP}`

/** The plain path behind a Windows extended-length (`\\?\`) path. */
export function stripExtendedLengthPrefix(filePath: string): string {
  if (filePath.startsWith(EXTENDED_UNC_PREFIX)) {
    return `${UNC_PREFIX}${filePath.slice(EXTENDED_UNC_PREFIX.length)}`
  }
  return filePath.startsWith(EXTENDED_PREFIX) ? filePath.slice(EXTENDED_PREFIX.length) : filePath
}

/** Edit review (M5): each call returns the notices to show in the transcript. */
export interface EditReviewActions {
  openDiff(itemId: string, patchJson: string): Promise<readonly ReviewNotice[]>
  /**
   * `check` is the caller's guard (M87: the conversation's session and no
   * running turn), asked after every wait and, with the checkpoint
   * admission's, just before each file changes; it throws to stop the Revert.
   */
  revert(itemId: string, patchJson: string, check?: () => void): Promise<readonly ReviewNotice[]>
  /** The review pane's files (M70): workspace-relative, or refused with the reason. */
  describe(patchJson: string): Promise<readonly DescribedFile[]>
  /** The review pane's Revert on one hunk (M70). */
  revertHunk(
    itemId: string,
    patchJson: string,
    fileIndex: number,
    hunkIndex: number,
  ): Promise<{ readonly isReverted: boolean; readonly notices: readonly ReviewNotice[] }>
}

export class EditReview implements EditReviewActions {
  private readonly originals = new Map<string, string>()
  /** Whole edits and individual hunks share one read/rebuild/write lane per canonical file. */
  private readonly pendingWrites = new Map<string, Promise<void>>()
  private readonly paths: path.PlatformPath

  public constructor(private readonly deps: EditReviewDeps) {
    this.paths = deps.platform === 'win32' ? path.win32 : path.posix
  }

  /** Whether a `path.relative` result stays below its base. */
  private isBelow(relative: string): boolean {
    return (
      relative !== '' &&
      relative !== '..' &&
      !relative.startsWith(`..${this.paths.sep}`) &&
      !this.paths.isAbsolute(relative)
    )
  }

  /**
   * Workspace-confined location of a patch file, or undefined when it
   * escapes: by text, then by the canonical forms, so a link inside the
   * workspace that leads outside it is refused (PLAN.md D24).
   */
  private async resolve(
    workspaceRoot: string,
    file: PatchFile,
    check?: () => void,
  ): Promise<ResolvedFile | undefined> {
    const root = this.paths.resolve(stripExtendedLengthPrefix(workspaceRoot))
    const fsPath = this.paths.resolve(root, stripExtendedLengthPrefix(file.path))
    const relative = this.paths.relative(root, fsPath)
    if (!this.isBelow(relative)) {
      return undefined
    }
    let canonicalPath: string
    let canonicalRelativePath: string
    try {
      const [realRoot, realTarget] = await Promise.all([
        this.deps.realPath(root),
        this.deps.realPath(fsPath),
      ])
      check?.()
      if (!this.isBelow(this.paths.relative(realRoot, realTarget))) {
        return undefined
      }
      canonicalPath = realTarget
      canonicalRelativePath = this.paths.relative(realRoot, realTarget).replaceAll('\\', '/')
    } catch (error: unknown) {
      check?.()
      this.deps.log.warn(`Edit review could not resolve ${relative}: ${String(error)}`)
      return undefined
    }
    return {
      file,
      relativePath: relative.replaceAll('\\', '/'),
      fsPath,
      canonicalPath,
      canonicalRelativePath,
    }
  }

  /**
   * Rebuilds the pre-edit text from `raw`, the file's text as read; a notice
   * explains why when it cannot. A UTF-8 BOM is not part of any hunk: it is
   * set aside for the match and kept on the text written back (PLAN.md D27).
   */
  private rebuild(resolved: ResolvedFile, raw: string): Rebuilt {
    const hasBom = raw.startsWith(BOM)
    const current = hasBom ? raw.slice(BOM.length) : raw
    const result = revertHunks(current, resolved.file.hunks, resolved.file.created)
    if (result.ok) {
      return { ...result, content: hasBom ? `${BOM}${result.content}` : result.content }
    }
    this.deps.log.warn(`Edit review of ${resolved.relativePath}: ${result.reason}`)
    return { ok: false, notice: changedNotice(resolved) }
  }

  /** Resolves each file once, collecting folder, patch and confinement refusals. */
  private async resolvePatch(
    patchJson: string,
    check?: () => void,
  ): Promise<{
    resolved: ResolvedFile[]
    notices: ReviewNotice[]
  }> {
    const { workspaceRoot } = this.deps
    if (workspaceRoot === undefined) {
      return { resolved: [], notices: [{ level: 'warning', text: UI_TEXT.editReviewNeedsFolder }] }
    }
    const files = patchFilesOf(patchJson)
    if (files === undefined) {
      return { resolved: [], notices: [{ level: 'warning', text: UI_TEXT.editNoPatch }] }
    }
    const resolvedFiles: ResolvedFile[] = []
    const notices: ReviewNotice[] = []
    for (const file of files) {
      check?.()
      const resolved = await this.resolve(workspaceRoot, file, check)
      check?.()
      if (resolved === undefined) {
        notices.push({
          level: 'warning',
          text: fill(UI_TEXT.editPathRefused, { path: file.path }),
        })
        continue
      }
      resolvedFiles.push(resolved)
    }
    return { resolved: resolvedFiles, notices }
  }

  /** Resolves and rebuilds every file for the read-only diff preview. */
  private async prepare(patchJson: string): Promise<{
    ready: { resolved: ResolvedFile; rebuilt: Rebuilt & { ok: true } }[]
    notices: ReviewNotice[]
  }> {
    const { resolved, notices } = await this.resolvePatch(patchJson)
    const ready: { resolved: ResolvedFile; rebuilt: Rebuilt & { ok: true } }[] = []
    for (const file of resolved) {
      const rebuilt = this.rebuild(file, (await this.deps.readFile(file.fsPath)) ?? '')
      if (rebuilt.ok) {
        ready.push({ resolved: file, rebuilt })
      } else {
        notices.push(rebuilt.notice)
      }
    }
    return { ready, notices }
  }

  /** The editor can become dirty while the saved text is read. */
  private unsavedNotice(resolved: ResolvedFile): ReviewNotice | undefined {
    return this.deps.hasUnsavedChanges(resolved.fsPath) ||
      this.deps.hasUnsavedChanges(resolved.canonicalPath)
      ? {
          level: 'warning',
          text: fill(UI_TEXT.editUnsavedChanges, { path: resolved.relativePath }),
        }
      : undefined
  }

  /**
   * Under admission, after the read: the path still leads to the checked
   * canonical target inside the workspace, and no editor holds unsaved text
   * for it.
   */
  private async writeRefusal(
    resolved: ResolvedFile,
    check?: () => void,
  ): Promise<ReviewNotice | undefined> {
    const { workspaceRoot } = this.deps
    const checked =
      workspaceRoot === undefined
        ? undefined
        : await this.resolve(workspaceRoot, resolved.file, check)
    if (
      checked === undefined ||
      !isSamePath(checked.canonicalPath, resolved.canonicalPath, this.deps.platform)
    ) {
      return {
        level: 'warning',
        text: fill(UI_TEXT.editPathRefused, { path: resolved.file.path }),
      }
    }
    return this.unsavedNotice(resolved)
  }

  /**
   * One Revert of one file as one operation under checkpoint admission (M72):
   * the saved text is read, the pre-edit text rebuilt from it, the path and
   * the editor checked again, and the result published only while the file
   * still holds what was read, so a save or a swap meanwhile refuses it.
   * Reverts of one file queue behind each other; a failure frees the lane.
   * `check`, the caller's guard (M87), is asked after each wait, and with
   * the admission's final word just before the change.
   */
  private async writeRevert(
    itemId: string,
    resolved: ResolvedFile,
    hunkIndex?: number,
    check?: () => void,
  ): Promise<RevertResult> {
    const canonical = this.paths.normalize(resolved.canonicalPath)
    const key = this.deps.platform === 'win32' ? canonical.toLowerCase() : canonical
    const previous = this.pendingWrites.get(key)
    const ending = new AbortController()
    // Node 20 hosts lack Promise.withResolvers; this lane is released in finally.
    const finished = new Promise<void>((resolve) => {
      ending.signal.addEventListener(
        'abort',
        () => {
          resolve()
        },
        { once: true },
      )
    })
    this.pendingWrites.set(key, finished)
    // A Revert that changed the file stands even when letting its admission
    // go fails afterwards: reported as unwritten, it could be retried and
    // take the same hunk out twice.
    const outcome: { committed?: RevertResult } = {}
    try {
      await previous
      check?.()
      return await this.deps.withAdmission(async (assertAdmitted) => {
        const assertCanWrite =
          check === undefined
            ? assertAdmitted
            : () => {
                assertAdmitted()
                check()
              }
        const result = await this.revertAdmitted(itemId, resolved, assertCanWrite, hunkIndex, check)
        if (result.isReverted) {
          outcome.committed = result
        }
        return result
      })
    } catch (error: unknown) {
      if (outcome.committed === undefined) {
        throw error
      }
      this.deps.log.warn(
        `Reverted ${resolved.relativePath}, but its checkpoint admission was not released: ${String(error)}`,
      )
      return outcome.committed
    } finally {
      ending.abort()
      if (this.pendingWrites.get(key) === finished) {
        this.pendingWrites.delete(key)
      }
    }
  }

  /** The Revert itself, under admission: read, rebuild, recheck, then the conditional change. */
  private async revertAdmitted(
    itemId: string,
    resolved: ResolvedFile,
    assertAdmitted: () => void,
    hunkIndex: number | undefined,
    check?: () => void,
  ): Promise<RevertResult> {
    check?.()
    const raw = await this.deps.readFile(resolved.canonicalPath)
    check?.()
    const rebuilt = this.rebuild(resolved, raw ?? '')
    if (!rebuilt.ok) {
      return { isReverted: false, notices: [rebuilt.notice] }
    }
    const refusal = await this.writeRefusal(resolved, check)
    check?.()
    if (refusal !== undefined) {
      return { isReverted: false, notices: [refusal] }
    }
    const complete = this.deps.beginEdit?.({
      relative: resolved.canonicalRelativePath,
      absolute: resolved.canonicalPath,
    })
    let published: ConditionalWrite = 'changed'
    try {
      published = await this.publish(resolved, raw, rebuilt, assertAdmitted)
    } finally {
      complete?.(published === 'written')
    }
    if (published === 'changed') {
      return {
        isReverted: false,
        notices: [this.unsavedNotice(resolved) ?? changedNotice(resolved)],
      }
    }
    this.originals.delete(originalUriPath(itemId, resolved.relativePath))
    const hunk = hunkIndex === undefined ? '' : `hunk ${String(hunkIndex + 1)} of `
    this.deps.log.info(`Reverted ${hunk}Muse edit ${itemId} on ${resolved.relativePath}`)
    return {
      isReverted: true,
      notices: [
        {
          level: 'info',
          text: fill(
            rebuilt.isCreatedFile ? UI_TEXT.editCreatedRemovedPath : UI_TEXT.editRevertedPath,
            { path: resolved.relativePath },
          ),
        },
      ],
    }
  }

  /**
   * The change, held to the text read (`raw`, undefined: no file): a created
   * file emptied goes to the trash, other text replaces the file, and a file
   * that was absent is written only while nothing is there.
   */
  private async publish(
    resolved: ResolvedFile,
    raw: string | undefined,
    rebuilt: Rebuilt & { ok: true },
    assertAdmitted: () => void,
  ): Promise<ConditionalWrite> {
    const target = resolved.canonicalPath
    const options = {
      expectedCanonicalPath: target,
      unsavedAt: [resolved.fsPath, target],
      assertCanWrite: assertAdmitted,
    }
    if (raw === undefined) {
      // Nothing is there to take out.
      return rebuilt.isCreatedFile
        ? 'changed'
        : await this.deps.io.createFileIfAbsent(target, rebuilt.content, options)
    }
    return rebuilt.isCreatedFile
      ? await this.deps.io.trashFileIfUnchanged(target, fingerprint(raw), options)
      : await this.deps.io.writeFileIfUnchanged(target, fingerprint(raw), rebuilt.content, options)
  }

  /** Content for a `muse-edit:` URI path; undefined when nothing was staged. */
  public provide(uriPath: string): string | undefined {
    return this.originals.get(uriPath)
  }

  /** Opens one diff per file in the patch; returns the notices to show. */
  public async openDiff(itemId: string, patchJson: string): Promise<readonly ReviewNotice[]> {
    const { ready, notices } = await this.prepare(patchJson)
    for (const { resolved, rebuilt } of ready) {
      const uriPath = originalUriPath(itemId, resolved.relativePath)
      this.originals.set(uriPath, rebuilt.content)
      await this.deps.openDiff(
        `${MUSE_EDIT_SCHEME}:${uriPath}`,
        resolved.fsPath,
        `${this.paths.basename(resolved.fsPath)} (${UI_TEXT.diffTitleSuffix})`,
      )
    }
    return notices
  }

  /**
   * The patch's files as the review pane lists them (M70): each by its
   * workspace-relative path, or, for one that resolves outside the
   * workspace, by the path the tool named and the reason it is refused.
   */
  public async describe(patchJson: string): Promise<readonly DescribedFile[]> {
    const { workspaceRoot } = this.deps
    const files = patchFilesOf(patchJson)
    if (files === undefined) {
      throw new Error(UI_TEXT.editNoPatch)
    }
    const described: DescribedFile[] = []
    for (const [fileIndex, file] of files.entries()) {
      const resolved =
        workspaceRoot === undefined ? undefined : await this.resolve(workspaceRoot, file)
      described.push(
        resolved === undefined
          ? {
              fileIndex,
              file,
              path: file.path,
              refusal:
                workspaceRoot === undefined
                  ? UI_TEXT.editReviewNeedsFolder
                  : fill(UI_TEXT.editPathRefused, { path: file.path }),
            }
          : { fileIndex, file, path: resolved.relativePath, refusal: undefined },
      )
    }
    return described
  }

  /**
   * One hunk of one file taken out again (M70's review pane): the file as it
   * is now with that hunk reverse-applied, the rest of the edit left alone.
   * True when the file was written back; the notices say why when it was not.
   */
  public async revertHunk(
    itemId: string,
    patchJson: string,
    fileIndex: number,
    hunkIndex: number,
  ): Promise<{ readonly isReverted: boolean; readonly notices: readonly ReviewNotice[] }> {
    const { workspaceRoot } = this.deps
    if (workspaceRoot === undefined) {
      return {
        isReverted: false,
        notices: [{ level: 'warning', text: UI_TEXT.editReviewNeedsFolder }],
      }
    }
    const file = patchFilesOf(patchJson)?.[fileIndex]
    const hunk = file?.hunks[hunkIndex]
    if (file === undefined || hunk === undefined) {
      return { isReverted: false, notices: [{ level: 'warning', text: UI_TEXT.editNoPatch }] }
    }
    // Only the one hunk. A file the edit created goes only when nothing is
    // left once the hunk is out (D27); lines still there are written back.
    const resolved = await this.resolve(workspaceRoot, { ...file, hunks: [hunk] })
    if (resolved === undefined) {
      return {
        isReverted: false,
        notices: [{ level: 'warning', text: fill(UI_TEXT.editPathRefused, { path: file.path }) }],
      }
    }
    return await this.writeRevert(itemId, resolved, hunkIndex)
  }

  /**
   * Writes the pre-edit text back (or trashes a created file); returns the
   * notices. `check` (M87) throws to stop it before any further read or change.
   */
  public async revert(
    itemId: string,
    patchJson: string,
    check?: () => void,
  ): Promise<readonly ReviewNotice[]> {
    check?.()
    const { resolved, notices } = await this.resolvePatch(patchJson, check)
    for (const file of resolved) {
      check?.()
      const result = await this.writeRevert(itemId, file, undefined, check)
      notices.push(...result.notices)
    }
    return notices
  }
}
