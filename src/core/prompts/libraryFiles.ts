// The file mechanics one prompt library keeps: the folder walk, the
// scan, the write lock and the atomic commit, shared by the prompt and
// sequence libraries (M88). One implementation of the link-rejecting,
// identity-checked protocol both scopes keep; each library brings its
// own folders, suffix and row codec.
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { PROMPT_FILE_MODE, PROMPT_FOLDER_MODE, UI_TEXT } from '../../shared/constants'
import { lstatIdentity, sameFile } from '../fs/fileIdentity'
import { readPromptFile } from './promptFile'

/** One parsed row plus the file it was read from. */
export interface LibraryRow<Row> {
  readonly value: Row
  readonly file: string
}

/**
Per-library shape: the folder segments under each scope's root, the
file suffix, and the row codec. `read` parses file text with
file-level validation only, so a hand-edited file stays listed.
*/
export interface LibraryShape<Row> {
  readonly userSegments: readonly string[]
  readonly workspaceSegments: readonly string[]
  readonly fileSuffix: string
  read(text: string): Row
  serialise(row: Row): string
  scopeOf(row: Row): 'user' | 'workspace'
  idOf(row: Row): string
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Portable disk engine beside the prompts; no VS Code state, no sync. */
export class LibraryFiles<Row> {
  public constructor(
    private readonly dataFolder: string,
    private readonly workspaceRoot: string | undefined,
    private readonly shape: LibraryShape<Row>,
  ) {}

  /** False without a folder: the workspace scope is then unavailable. */
  public get hasWorkspace(): boolean {
    return this.workspaceRoot !== undefined
  }

  public async folder(
    scope: 'user' | 'workspace',
    shouldCreate: boolean,
  ): Promise<string | undefined> {
    const base = scope === 'user' ? this.dataFolder : this.workspaceRoot
    if (base === undefined) throw new Error(UI_TEXT.promptWorkspaceRequired)
    if (shouldCreate && scope === 'user')
      await mkdir(base, { recursive: true, mode: PROMPT_FOLDER_MODE })
    // Resolve the host-selected root; reject links in every directory segment.
    const root = await realpath(base)
    let current = root
    const segments = scope === 'user' ? this.shape.userSegments : this.shape.workspaceSegments
    for (const segment of segments) {
      current = path.join(current, segment)
      if (shouldCreate) {
        try {
          await mkdir(current, { mode: PROMPT_FOLDER_MODE })
        } catch (error: unknown) {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
        }
      }
      let stat
      try {
        stat = await lstat(current)
      } catch (error: unknown) {
        if (!shouldCreate && isMissing(error)) return undefined
        throw error
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(UI_TEXT.promptStoreDamaged)
    }
    return current
  }

  public async scan(scope: 'user' | 'workspace'): Promise<LibraryRow<Row>[]> {
    let directory: string | undefined
    try {
      directory = await this.folder(scope, false)
    } catch (error: unknown) {
      if (isMissing(error)) return []
      throw error
    }
    if (directory === undefined) return []
    const entries = await readdir(directory, { withFileTypes: true })
    const rows: LibraryRow<Row>[] = []
    for (const entry of entries) {
      if (!entry.name.endsWith(this.shape.fileSuffix)) continue
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(UI_TEXT.promptStoreDamaged)
      const file = path.join(directory, entry.name)
      const value = this.shape.read(await readPromptFile(file))
      if (
        this.shape.scopeOf(value) !== scope ||
        rows.some((row) => this.shape.idOf(row.value) === this.shape.idOf(value))
      ) {
        throw new Error(UI_TEXT.promptStoreDamaged)
      }
      rows.push({ value, file })
    }
    return rows
  }

  public async mutate<T>(
    scope: 'user' | 'workspace',
    run: (directory: string) => Promise<T>,
  ): Promise<T> {
    const directory = await this.folder(scope, true)
    if (directory === undefined) throw new Error(UI_TEXT.promptStoreDamaged)
    const identity = await lstatIdentity(directory)
    const lock = path.join(directory, '.write-lock')
    let handle
    try {
      handle = await open(lock, 'wx', PROMPT_FILE_MODE)
    } catch (error) {
      // A lock that cannot be taken is contention: the fixed words reach
      // the caller, carrying the failure that proved it.
      throw new Error(UI_TEXT.promptStoreBusy, { cause: error })
    }
    try {
      if (!sameFile(identity, await lstatIdentity(directory)))
        throw new Error(UI_TEXT.promptStoreDamaged)
      return await run(directory)
    } finally {
      await handle.close()
      await rm(lock)
    }
  }

  /** A known row keeps its file; a new id names the digest plus the suffix. */
  public fileFor(directory: string, id: string, existing?: string): string {
    return (
      existing ??
      path.join(
        directory,
        `${createHash('sha256').update(id).digest('hex')}${this.shape.fileSuffix}`,
      )
    )
  }

  /**
  The atomic commit: temp file, sync, identity re-check, the expected
  row re-read (a changed library refuses busy), then the rename.
  */
  public async commit(
    directory: string,
    target: string,
    text: string,
    expected?: { file: string; serialised: string },
  ): Promise<void> {
    const identity = await lstatIdentity(directory)
    const temp = path.join(directory, `.${randomUUID()}.tmp`)
    const handle = await open(temp, 'wx', PROMPT_FILE_MODE)
    try {
      await handle.writeFile(text, 'utf8')
      await handle.sync()
      await handle.close()
      if (!sameFile(identity, await lstatIdentity(directory)))
        throw new Error(UI_TEXT.promptStoreDamaged)
      if (expected !== undefined) {
        const current = this.shape.serialise(this.shape.read(await readPromptFile(expected.file)))
        if (current !== expected.serialised) throw new Error(UI_TEXT.promptStoreBusy)
      }
      await rename(temp, target)
    } finally {
      await handle.close()
      await rm(temp, { force: true })
    }
  }
}
