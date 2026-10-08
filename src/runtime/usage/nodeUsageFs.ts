// The same private data folder is injected by VSIX, ACP, native runtimes and CLI.
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  CHECKPOINT_STORAGE_MODE,
  CHECKPOINT_JOURNAL_FILE_MODE,
  USAGE_FOLDER,
} from '../../shared/constants'
import type { UsageFs, UsageFileStat, UsageLock } from '../../core/usage/journalStore'
import { createFileExclusively, isNameTaken, writeFileAtomically } from '../../host/fsAtomic'
import { canonicalPath } from '../../host/canonicalPath'

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}
export class NodeUsageFs implements UsageFs {
  private root: Promise<string> | undefined
  public constructor(
    private readonly dataFolder: string,
    private readonly now: () => number = Date.now,
  ) {}
  private trustedRoot(): Promise<string> {
    // Resolve trusted ancestors once (e.g. macOS /var → /private/var), before
    // checking each component inside the store for links on every operation.
    return (this.root ??= canonicalPath(this.dataFolder))
  }
  private async resolve(relative: string): Promise<string> {
    const parts = relative.split('/')
    if (
      parts[0] !== USAGE_FOLDER ||
      parts.some((part) => !/^[\w.-]+$/.test(part) || part === '.' || part === '..')
    ) {
      throw new Error('invalidUsagePath')
    }
    return path.join(await this.trustedRoot(), ...parts)
  }
  /** Refuse linked ancestors, including on reads, so another folder is never consulted. */
  private async checkPath(file: string): Promise<void> {
    const root = await this.trustedRoot()
    let current = root
    for (const part of ['', ...path.relative(root, file).split(path.sep)]) {
      current = path.join(current, part)
      try {
        const stat = await lstat(current)
        if (stat.isSymbolicLink()) throw new Error('linkedUsagePath')
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error
      }
    }
  }
  private async prepare(file: string): Promise<void> {
    await this.checkPath(file)
    await mkdir(path.dirname(file), { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    await this.checkPath(file)
  }
  private async lockState(relative: string) {
    const folder = relative.slice(0, relative.lastIndexOf('/'))
    const content = await readFile(await this.resolve(`${relative}.epoch`), 'utf8')
    const epoch = content.trim()
    if (!/^[\w-]+$/.test(epoch)) throw new Error('invalidUsageLock')
    const name = `${path.basename(relative)}.${epoch}`
    const names = await this.list(folder)
    const claims = names.filter(
      (entry) => entry.startsWith(`${name}.`) && /^\d+$/.test(entry.slice(name.length + 1)),
    )
    let generation = 0
    for (const entry of claims)
      generation = Math.max(generation, Number(entry.slice(name.length + 1)))
    if (!Number.isSafeInteger(generation + 1)) throw new Error('invalidUsageLock')
    return {
      folder,
      names,
      epoch,
      generation,
      claim: `${relative}.${epoch}.${String(generation)}`,
    }
  }
  public async list(folder: string): Promise<readonly string[]> {
    const file = await this.resolve(folder)
    await this.checkPath(file)
    try {
      const entries = await readdir(file, { withFileTypes: true })
      return entries
        .filter((entry) => !entry.isSymbolicLink())
        .map((entry) => entry.name)
        .toSorted((a, b) => a.localeCompare(b))
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return []
      throw error
    }
  }
  public async stat(relative: string): Promise<UsageFileStat | undefined> {
    const file = await this.resolve(relative)
    await this.checkPath(file)
    try {
      const stat = await lstat(file)
      if (!stat.isFile()) throw new Error('invalidUsageFile')
      return { size: stat.size, mtimeMs: stat.mtimeMs }
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return undefined
      throw error
    }
  }
  public async read(relative: string, offset: number, length?: number): Promise<Uint8Array> {
    const file = await this.resolve(relative)
    await this.checkPath(file)
    const handle = await open(
      file,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    )
    try {
      if (length === undefined) return await handle.readFile()
      const bytes = new Uint8Array(length)
      let count = 0
      while (count < length) {
        const result = await handle.read(bytes, count, length - count, offset + count)
        if (result.bytesRead === 0) break
        count += result.bytesRead
      }
      return bytes.subarray(0, count)
    } finally {
      await handle.close()
    }
  }
  public async append(relative: string, line: string, isDurable = false): Promise<void> {
    const file = await this.resolve(relative)
    await this.prepare(file)
    const handle = await open(
      file,
      constants.O_WRONLY |
        constants.O_APPEND |
        constants.O_CREAT |
        (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
      CHECKPOINT_JOURNAL_FILE_MODE,
    )
    try {
      await handle.writeFile(line, 'utf8')
      if (isDurable) await handle.sync()
    } finally {
      await handle.close()
    }
  }
  public async writeFileAtomically(relative: string, text: string): Promise<void> {
    const file = await this.resolve(relative)
    await this.prepare(file)
    await writeFileAtomically(file, text, {
      sleep: delay,
      expectedCanonicalPath: file,
      // Flush the closed stage through its own handle before atomic publication.
      // The helper retains its identity/path/mode guards and Windows retries;
      // no retry unlinks the destination or writes through its live path.
      rename: async (from, to) => {
        const handle = await open(
          from,
          constants.O_WRONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
        )
        try {
          await handle.sync()
        } finally {
          await handle.close()
        }
        await rename(from, to)
      },
    })
  }
  public async remove(relative: string): Promise<void> {
    const file = await this.resolve(relative)
    await this.checkPath(file)
    await rm(file, { recursive: true, force: true })
  }
  public async acquireLock(relative: string, staleMs: number): Promise<UsageLock | undefined> {
    await this.prepare(await this.resolve(relative))
    const anchor = `${relative}.epoch`
    if ((await this.stat(anchor)) === undefined) {
      const legacy = await this.stat(relative)
      if (legacy !== undefined && this.now() - legacy.mtimeMs <= staleMs) return undefined
      try {
        await createFileExclusively(await this.resolve(anchor), randomUUID(), {
          mode: CHECKPOINT_JOURNAL_FILE_MODE,
          expectedDirectory: path.dirname(await this.resolve(relative)),
          warn: (_file, _isPublished, error) => {
            throw error
          },
        })
      } catch (error) {
        if (!isNameTaken(error)) throw error
      }
    }
    const previous = await this.lockState(relative)
    const stat = await this.stat(previous.claim)
    if (stat !== undefined) {
      let previousToken: string
      try {
        const content = await readFile(await this.resolve(previous.claim), 'utf8')
        previousToken = content.trim()
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return undefined
        throw error
      }
      if (previousToken !== '' && !/^[\w-]+$/.test(previousToken))
        throw new Error('invalidUsageLock')
      const isReleased =
        previousToken !== '' &&
        (await this.stat(`${previous.claim}.${previousToken}.released`)) !== undefined
      if (!isReleased && this.now() - stat.mtimeMs <= staleMs) return undefined
    }
    const generation = previous.generation + 1
    const claim = `${relative}.${previous.epoch}.${String(generation)}`
    const file = await this.resolve(claim)
    const token = randomUUID()
    try {
      const handle = await open(file, 'wx', CHECKPOINT_JOURNAL_FILE_MODE)
      try {
        await handle.writeFile(token, 'utf8')
      } finally {
        await handle.close()
      }
    } catch (error) {
      if (errorCode(error) === 'EEXIST') return undefined
      throw error
    }
    const isHeld = async (): Promise<boolean> => {
      try {
        const current = await this.lockState(relative)
        return (
          current.generation === generation &&
          current.epoch === previous.epoch &&
          (await readFile(file, 'utf8')) === token &&
          (await this.stat(`${claim}.${token}.released`)) === undefined
        )
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return false
        throw error
      }
    }
    // Publishing the successor comes first. Cleanup touches only observed
    // older generation names; delayed contenders must pass isHeld too.
    if (!(await isHeld())) return undefined
    for (const name of previous.names) {
      const prefix = `${path.basename(relative)}.${previous.epoch}.`
      if (name.startsWith(prefix) && /^\d+(?:\.|$)/.test(name.slice(prefix.length))) {
        await this.remove(`${previous.folder}/${name}`)
      }
    }
    if (!(await isHeld())) return undefined
    return {
      token,
      generation,
      isHeld,
      release: async () => {
        // Even if this owner pauses after the check, only its own immutable
        // token gets a release marker. It never unlinks a shared lock path.
        if (await isHeld()) await this.append(`${claim}.${token}.released`, '')
      },
    }
  }
}
