// Review of an edit the CLI already applied (M5): "Open diff" rebuilds the
// file's pre-edit text from the stored patch document and opens VS Code's
// diff editor (before on the left, the file on the right); "Revert" writes
// that text back. Every VS Code call is injected, so the module is tested
// with fakes on every platform. Paths come from the patch document and are
// confined to the workspace.

import path from 'node:path'
import { revertHunks } from '../../core/patchApply'
import { isSamePath } from '../../core/paths'
import { MUSE_EDIT_SCHEME, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { type PatchFile, parsePatchFiles } from '../../shared/patchDocument'
import type { EditedFile } from '../../core/verify/diagnosticsReport'
import type { Logger } from '../logger'

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
  /** Invoke the original/canonical editor guard immediately before I/O, after admission. */
  readonly writeFile: (fsPath: string, content: string, assertCanWrite: () => void) => Promise<void>
  /** Move to the trash after invoking the same final editor guard. */
  readonly deleteFile: (fsPath: string, assertCanWrite: () => void) => Promise<void>
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

/** The document the `muse-edit:` provider serves for `uriPath`. */
export function originalUriPath(itemId: string, relativePath: string): string {
  return `/${itemId}/${relativePath}`
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
  revert(itemId: string, patchJson: string): Promise<readonly ReviewNotice[]>
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
  private async resolve(workspaceRoot: string, file: PatchFile): Promise<ResolvedFile | undefined> {
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
      if (!this.isBelow(this.paths.relative(realRoot, realTarget))) {
        return undefined
      }
      canonicalPath = realTarget
      canonicalRelativePath = this.paths.relative(realRoot, realTarget).replaceAll('\\', '/')
    } catch (error: unknown) {
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
   * Rebuilds the pre-edit text; a notice explains why when it cannot. A
   * UTF-8 BOM is not part of any hunk: it is set aside for the match and
   * kept on the text written back (PLAN.md D27).
   */
  private async rebuild(resolved: ResolvedFile): Promise<Rebuilt> {
    const raw = (await this.deps.readFile(resolved.fsPath)) ?? ''
    const hasBom = raw.startsWith(BOM)
    const current = hasBom ? raw.slice(BOM.length) : raw
    const result = revertHunks(current, resolved.file.hunks, resolved.file.created)
    if (result.ok) {
      return { ...result, content: hasBom ? `${BOM}${result.content}` : result.content }
    }
    this.deps.log.warn(`Edit review of ${resolved.relativePath}: ${result.reason}`)
    return {
      ok: false,
      notice: {
        level: 'warning',
        text: fill(UI_TEXT.editNotRebuildable, { path: resolved.relativePath }),
      },
    }
  }

  /** Resolves each file once, collecting folder, patch and confinement refusals. */
  private async resolvePatch(patchJson: string): Promise<{
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
      const resolved = await this.resolve(workspaceRoot, file)
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
      const rebuilt = await this.rebuild(file)
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

  /** Queued writes and the final write both recheck the path and editor buffer. */
  private async writeRefusal(resolved: ResolvedFile): Promise<ReviewNotice | undefined> {
    const { workspaceRoot } = this.deps
    const checked =
      workspaceRoot === undefined ? undefined : await this.resolve(workspaceRoot, resolved.file)
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

  /** Rebuild from the bytes left by the preceding revert, then write once; failures free the lane. */
  private async writeRevert(
    itemId: string,
    resolved: ResolvedFile,
    hunkIndex?: number,
  ): Promise<{ readonly isReverted: boolean; readonly notices: readonly ReviewNotice[] }> {
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
    try {
      await previous
      const refusal = await this.writeRefusal(resolved)
      if (refusal !== undefined) {
        return { isReverted: false, notices: [refusal] }
      }
      const rebuilt = await this.rebuild(resolved)
      if (!rebuilt.ok) {
        return { isReverted: false, notices: [rebuilt.notice] }
      }
      const nowRefusal = await this.writeRefusal(resolved)
      if (nowRefusal !== undefined) {
        return { isReverted: false, notices: [nowRefusal] }
      }
      const assertCanWrite = () => {
        const unsaved = this.unsavedNotice(resolved)
        if (unsaved !== undefined) {
          throw new Error(unsaved.text)
        }
      }
      const complete = this.deps.beginEdit?.({
        relative: resolved.canonicalRelativePath,
        absolute: resolved.canonicalPath,
      })
      let wasWritten = false
      try {
        if (rebuilt.isCreatedFile) {
          await this.deps.deleteFile(resolved.canonicalPath, assertCanWrite)
        } else {
          await this.deps.writeFile(resolved.canonicalPath, rebuilt.content, assertCanWrite)
        }
        wasWritten = true
      } finally {
        complete?.(wasWritten)
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
    } finally {
      ending.abort()
      if (this.pendingWrites.get(key) === finished) {
        this.pendingWrites.delete(key)
      }
    }
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

  /** Writes the pre-edit text back (or trashes a created file); returns the notices. */
  public async revert(itemId: string, patchJson: string): Promise<readonly ReviewNotice[]> {
    const { resolved, notices } = await this.resolvePatch(patchJson)
    for (const file of resolved) {
      const result = await this.writeRevert(itemId, file)
      notices.push(...result.notices)
    }
    return notices
  }
}
