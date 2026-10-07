import { randomUUID, createHash } from 'node:crypto'
import { lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  PROMPT_FILE_MODE,
  PROMPT_FOLDER_MODE,
  PROMPT_LIMITS,
  PROMPT_USER_FOLDER,
  PROMPT_WORKSPACE_FOLDER,
  UI_TEXT,
} from '../../shared/constants'
import {
  mergePromptScopes,
  parsePromptFile,
  serialisePromptFile,
  type PromptStoragePort,
  type SavedPrompt,
} from '../../shared/prompts'
import { sameFile, lstatIdentity } from '../fs/fileIdentity'

/** Reject caps at every ingress, including imported and synced files. */
export function validatePrompt(prompt: SavedPrompt): SavedPrompt {
  const file = serialisePromptFile(prompt)
  const checked = parsePromptFile(file)
  if (
    checked.title.trim() === '' ||
    checked.title.length > PROMPT_LIMITS.title ||
    checked.body.length > PROMPT_LIMITS.body ||
    Buffer.byteLength(file, 'utf8') > PROMPT_LIMITS.fileBytes
  ) {
    throw new Error(UI_TEXT.promptLimits)
  }
  return checked
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Portable disk store shared by VS Code, ACP and native hosts; no VS Code state. */
export class PromptStore implements PromptStoragePort {
  public constructor(
    private readonly dataFolder: string,
    private readonly workspaceRoot?: string,
  ) {}

  private async checkedFolder(
    scope: SavedPrompt['scope'],
    shouldCreate: boolean,
  ): Promise<string | undefined> {
    const base = scope === 'user' ? this.dataFolder : this.workspaceRoot
    if (base === undefined) throw new Error(UI_TEXT.promptWorkspaceRequired)
    if (shouldCreate && scope === 'user')
      await mkdir(base, { recursive: true, mode: PROMPT_FOLDER_MODE })
    // Resolve the host-selected root; reject links in every prompt-directory segment.
    const root = await realpath(base)
    let current = root
    const segments = scope === 'user' ? [PROMPT_USER_FOLDER] : PROMPT_WORKSPACE_FOLDER.split('/')
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

  private async scan(
    scope: SavedPrompt['scope'],
  ): Promise<{ prompt: SavedPrompt; file: string }[]> {
    let directory: string | undefined
    try {
      directory = await this.checkedFolder(scope, false)
    } catch (error: unknown) {
      if (isMissing(error)) return []
      throw error
    }
    if (directory === undefined) return []
    const entries = await readdir(directory, { withFileTypes: true })
    const rows: { prompt: SavedPrompt; file: string }[] = []
    for (const entry of entries) {
      if (!entry.name.endsWith('.md')) continue
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(UI_TEXT.promptStoreDamaged)
      const file = path.join(directory, entry.name)
      const prompt = validatePrompt(parsePromptFile(await readPromptFile(file)))
      if (prompt.scope !== scope || rows.some((row) => row.prompt.id === prompt.id)) {
        throw new Error(UI_TEXT.promptStoreDamaged)
      }
      rows.push({ prompt, file })
      if (rows.length > PROMPT_LIMITS.perScope) throw new Error(UI_TEXT.promptLimits)
    }
    return rows
  }

  private async mutate<T>(
    scope: SavedPrompt['scope'],
    run: (directory: string) => Promise<T>,
  ): Promise<T> {
    const directory = await this.checkedFolder(scope, true)
    if (directory === undefined) throw new Error(UI_TEXT.promptStoreDamaged)
    const identity = await lstatIdentity(directory)
    const lock = path.join(directory, '.write-lock')
    let handle
    try {
      handle = await open(lock, 'wx', PROMPT_FILE_MODE)
    } catch {
      throw new Error(UI_TEXT.promptStoreBusy)
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

  public async list(scope: SavedPrompt['scope']): Promise<readonly SavedPrompt[]> {
    try {
      const rows = await this.scan(scope)
      return rows.map((row) => row.prompt)
    } catch {
      throw new Error(UI_TEXT.promptStoreDamaged)
    }
  }

  public async write(input: SavedPrompt, shouldKeepNewer = false): Promise<void> {
    const prompt = validatePrompt(input)
    await this.mutate(prompt.scope, async (directory) => {
      const rows = await this.scan(prompt.scope)
      const existing = rows.find((row) => row.prompt.id === prompt.id)
      if (existing === undefined && rows.length >= PROMPT_LIMITS.perScope)
        throw new Error(UI_TEXT.promptLimits)
      // Trust cannot be upgraded by an edit or synchronization.
      // Sync's snapshot may be stale: choose the revision again under this same lock.
      const winner =
        shouldKeepNewer &&
        existing !== undefined &&
        Date.parse(existing.prompt.updatedAt) >= Date.parse(prompt.updatedAt)
          ? existing.prompt
          : prompt
      const next = { ...winner, untrusted: prompt.untrusted || existing?.prompt.untrusted === true }
      if (
        existing !== undefined &&
        serialisePromptFile(next) === serialisePromptFile(existing.prompt)
      )
        return
      const digest = createHash('sha256').update(prompt.id).digest('hex')
      const target = existing?.file ?? path.join(directory, `${digest}.md`)
      const temp = path.join(directory, `.${randomUUID()}.tmp`)
      const identity = await lstatIdentity(directory)
      const handle = await open(temp, 'wx', PROMPT_FILE_MODE)
      try {
        await handle.writeFile(serialisePromptFile(next), 'utf8')
        await handle.sync()
        await handle.close()
        if (!sameFile(identity, await lstatIdentity(directory)))
          throw new Error(UI_TEXT.promptStoreDamaged)
        if (existing !== undefined) {
          const current = validatePrompt(parsePromptFile(await readPromptFile(target)))
          if (serialisePromptFile(current) !== serialisePromptFile(existing.prompt))
            throw new Error(UI_TEXT.promptStoreBusy)
        }
        await rename(temp, target)
      } finally {
        await handle.close()
        await rm(temp, { force: true })
      }
    })
  }

  public async remove(scope: SavedPrompt['scope'], id: string): Promise<void> {
    await this.mutate(scope, async () => {
      const rows = await this.scan(scope)
      const row = rows.find((entry) => entry.prompt.id === id)
      if (row === undefined) throw new Error(UI_TEXT.promptFileInvalid)
      await rm(row.file)
    })
  }

  public async library(): Promise<SavedPrompt[]> {
    return mergePromptScopes(
      await this.list('user'),
      this.workspaceRoot === undefined ? [] : await this.list('workspace'),
    )
  }
}

/** Bounded read through one handle; refuse links/directories and never read credentials. */
export async function readPromptFile(file: string): Promise<string> {
  const before = await lstatIdentity(file)
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size > BigInt(PROMPT_LIMITS.fileBytes)
  ) {
    throw new Error(UI_TEXT.promptFileInvalid)
  }
  const handle = await open(file, 'r')
  try {
    const stat = await handle.stat({ bigint: true })
    if (!sameFile(before, stat)) throw new Error(UI_TEXT.promptFileInvalid)
    const bytes = Buffer.alloc(PROMPT_LIMITS.fileBytes + 1)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    if (bytesRead > PROMPT_LIMITS.fileBytes) throw new Error(UI_TEXT.promptLimits)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}
