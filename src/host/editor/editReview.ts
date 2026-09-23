// Review of an edit the CLI already applied (M5): "Open diff" rebuilds the
// file's pre-edit text from the stored patch document and opens VS Code's
// diff editor (before on the left, the file on the right); "Revert" writes
// that text back. Every VS Code call is injected, so the module is tested
// with fakes on every platform. Paths come from the patch document and are
// confined to the workspace.

import path from 'node:path'
import { revertHunks } from '../../core/patchApply'
import { MUSE_EDIT_SCHEME, UI_TEXT } from '../../shared/constants'
import { type PatchFile, parsePatchFiles } from '../../shared/patchDocument'
import type { Logger } from '../logger'

export interface EditReviewDeps {
  /** Selects Windows or POSIX path rules, so both are unit-tested anywhere. */
  readonly platform: NodeJS.Platform
  readonly workspaceRoot: string
  /** The file's text, or undefined when it does not exist. */
  readonly readFile: (fsPath: string) => Promise<string | undefined>
  /** The canonical form of a path, links resolved through the nearest existing ancestor. */
  readonly realPath: (fsPath: string) => Promise<string>
  readonly writeFile: (fsPath: string, content: string) => Promise<void>
  /** Move to the trash (a file the edit created). */
  readonly deleteFile: (fsPath: string) => Promise<void>
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

export class EditReview {
  private readonly originals = new Map<string, string>()
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
  private async resolve(file: PatchFile): Promise<ResolvedFile | undefined> {
    const root = this.paths.resolve(stripExtendedLengthPrefix(this.deps.workspaceRoot))
    const fsPath = this.paths.resolve(root, stripExtendedLengthPrefix(file.path))
    const relative = this.paths.relative(root, fsPath)
    if (!this.isBelow(relative)) {
      return undefined
    }
    try {
      const [realRoot, realTarget] = await Promise.all([
        this.deps.realPath(root),
        this.deps.realPath(fsPath),
      ])
      if (!this.isBelow(this.paths.relative(realRoot, realTarget))) {
        return undefined
      }
    } catch (error: unknown) {
      this.deps.log.warn(`Edit review could not resolve ${relative}: ${String(error)}`)
      return undefined
    }
    return { file, relativePath: relative.replaceAll('\\', '/'), fsPath }
  }

  /** Rebuilds the pre-edit text; a notice explains why when it cannot. */
  private async rebuild(resolved: ResolvedFile): Promise<Rebuilt> {
    const current = (await this.deps.readFile(resolved.fsPath)) ?? ''
    const result = revertHunks(current, resolved.file.hunks)
    if (result.ok) {
      return result
    }
    this.deps.log.warn(`Edit review of ${resolved.relativePath}: ${result.reason}`)
    return {
      ok: false,
      notice: {
        level: 'warning',
        text: `${resolved.relativePath} ${UI_TEXT.editNotRebuildable}.`,
      },
    }
  }

  /** Resolves and rebuilds every file of the patch, collecting notices. */
  private async prepare(patchJson: string): Promise<{
    ready: { resolved: ResolvedFile; rebuilt: Rebuilt & { ok: true } }[]
    notices: ReviewNotice[]
  }> {
    const files = patchFilesOf(patchJson)
    if (files === undefined) {
      return { ready: [], notices: [{ level: 'warning', text: UI_TEXT.editNoPatch }] }
    }
    const ready: { resolved: ResolvedFile; rebuilt: Rebuilt & { ok: true } }[] = []
    const notices: ReviewNotice[] = []
    for (const file of files) {
      const resolved = await this.resolve(file)
      if (resolved === undefined) {
        notices.push({ level: 'warning', text: `${file.path} ${UI_TEXT.editPathRefused}.` })
        continue
      }
      const rebuilt = await this.rebuild(resolved)
      if (rebuilt.ok) {
        ready.push({ resolved, rebuilt })
      } else {
        notices.push(rebuilt.notice)
      }
    }
    return { ready, notices }
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

  /** Writes the pre-edit text back (or trashes a created file); returns the notices. */
  public async revert(itemId: string, patchJson: string): Promise<readonly ReviewNotice[]> {
    const { ready, notices } = await this.prepare(patchJson)
    for (const { resolved, rebuilt } of ready) {
      if (rebuilt.isCreatedFile) {
        await this.deps.deleteFile(resolved.fsPath)
        notices.push({
          level: 'info',
          text: `${resolved.relativePath}: ${UI_TEXT.editCreatedRemoved}.`,
        })
      } else {
        await this.deps.writeFile(resolved.fsPath, rebuilt.content)
        notices.push({ level: 'info', text: `${UI_TEXT.editReverted} ${resolved.relativePath}.` })
      }
      this.originals.delete(originalUriPath(itemId, resolved.relativePath))
      this.deps.log.info(`Reverted Muse edit ${itemId} on ${resolved.relativePath}`)
    }
    return notices
  }
}
