import { execResourceFile } from '../resources/admission'
import * as z from 'zod/mini'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  CHECKPOINT_STORAGE_MODE,
  REPORT_HISTORY_MAX_PER_KIND,
  REPORT_MAX_ID_CHARS,
  REPORT_PROCESS_START_FIELD_INDEX,
  REPORT_WRITER_LOCK_WAIT_MS,
  REPORT_WRITER_LOCK_BACKOFF_MS,
  REPORT_WRITER_LOCK_BACKOFF_MAX_MS,
  REPORT_WRITER_LOCK_PROBE_MS,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
  REPORT_MAX_SOURCES,
  REPORT_MAX_TEXT_CHARS,
  REPORT_STORAGE_FILE_MODE,
  REPORT_STORAGE_LINK_COUNT,
  REPORT_STORAGE_KEY_PATTERN,
  UI_TEXT,
} from '../../shared/constants'
import { reportsMethods, type ReportsHostPort } from '../../shared/hostApi/reports'
import {
  reportDocumentSchema,
  type ReportDocument,
  type ReportKind,
} from '../../shared/reportSchema'
import { handleIdentity, lstatIdentity, sameFile } from '../fs/fileIdentity'
import { withoutCredentials } from '../credentialEnvironment'
import { compareReports } from './diff'

/** R supplies canonical, scrubbed JSON and verifies the saved content hash on decode. */
export interface ReportHistoryCodec {
  encode(document: ReportDocument): string
  decode(json: string): ReportDocument
}

interface ReportFiles {
  list(): Promise<string[]>
  read(name: string): Promise<string | undefined>
  /** Modification time in milliseconds; undefined when the file vanished. */
  stat(name: string): Promise<number | undefined>
  write(name: string, text: string): Promise<void>
  remove(name: string): Promise<void>
}

interface SavedReport {
  id: string
  document: ReportDocument
  savedAt: number
}

function compareSavedReports(a: SavedReport, b: SavedReport): number {
  const date = Date.parse(b.document.header.asOf) - Date.parse(a.document.header.asOf)
  if (date !== 0) return date
  // Equal stamps keep the actual save order; the id breaks only exact ties.
  if (a.savedAt !== b.savedAt) return b.savedAt - a.savedAt
  if (a.id < b.id) return -1
  return a.id > b.id ? 1 : 0
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function validName(name: string): void {
  if (!REPORT_STORAGE_KEY_PATTERN.test(name)) throw new Error(UI_TEXT.reportUi.generationFailed)
}

const lockOwnerSchema = z.strictObject({
  pid: z.int().check(z.positive()),
  startedAt: z.string().check(z.minLength(1), z.maxLength(REPORT_MAX_ID_CHARS)),
  token: z.uuid(),
})
const execFileAsync = execResourceFile
const processBirth: { own?: Promise<string | undefined> } = {}

/** OS birth identity, so a reused PID never keeps an abandoned writer lock alive. */
async function processStart(pid: number, probeBudgetMs: number): Promise<string | undefined> {
  try {
    process.kill(pid, 0)
  } catch (error: unknown) {
    if (hasCode(error, 'ESRCH')) return
    throw error
  }
  if (process.platform === 'linux') {
    try {
      const stat = await readFile(`/proc/${String(pid)}/stat`, 'utf8')
      const fields = stat
        .slice(stat.lastIndexOf(')') + 1)
        .trim()
        .split(/\s+/)
      const startedAt = fields[REPORT_PROCESS_START_FIELD_INDEX]
      if (startedAt === undefined || !/^\d+$/.test(startedAt))
        throw new Error(UI_TEXT.reportUi.saveFailed)
      return startedAt
    } catch (error: unknown) {
      if (hasCode(error, 'ENOENT') || hasCode(error, 'ESRCH')) return
      throw error
    }
  }
  const env = { ...withoutCredentials(process.env), LC_ALL: 'C', TZ: 'UTC' }
  let file = '/bin/ps'
  let args = ['-o', 'lstart=', '-p', String(pid)]
  if (process.platform === 'win32') {
    const systemRoot = process.env['SystemRoot']
    if (systemRoot === undefined) throw new Error(UI_TEXT.reportUi.saveFailed)
    file = path.win32.join(systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH)
    args = [
      ...WINDOWS_POWERSHELL_COMMAND_ARGS,
      // Module discovery can consume the probe deadline on a cold/loaded rig.
      `try { [Diagnostics.Process]::GetProcessById(${String(pid)}).StartTime.ToFileTimeUtc() } catch [ArgumentException] { }`,
    ]
  }
  const { stdout } = await execFileAsync('contained', file, args, {
    env,
    windowsHide: true,
    timeout: Math.min(REPORT_WRITER_LOCK_PROBE_MS, probeBudgetMs),
  })
  return stdout.trim() || undefined
}

async function ownStart(): Promise<string> {
  const deadline = performance.now() + REPORT_WRITER_LOCK_PROBE_MS
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const remaining = deadline - performance.now()
      if (remaining <= 0) throw new Error(UI_TEXT.reportUi.saveFailed)
      const startedAt = await processStart(
        process.pid,
        Math.max(1, Math.floor(remaining / (2 - attempt))),
      )
      if (startedAt === undefined) throw new Error(UI_TEXT.reportUi.saveFailed)
      return startedAt
    } catch (error: unknown) {
      if (attempt === 1 || performance.now() >= deadline)
        throw new Error(UI_TEXT.reportUi.saveFailed, { cause: error })
    }
  }
  throw new Error(UI_TEXT.reportUi.saveFailed)
}

async function startOf(
  pid: number,
  probeBudgetMs = REPORT_WRITER_LOCK_PROBE_MS,
): Promise<string | undefined> {
  if (pid !== process.pid) return await processStart(pid, probeBudgetMs)
  processBirth.own ??= ownStart()
  const pending = processBirth.own
  try {
    return await pending
  } catch (error: unknown) {
    if (processBirth.own === pending) delete processBirth.own
    throw error
  }
}

/** Shared owner-only storage for history and checks; all mutations hold a bucket lock. */
export class ReportStorage {
  public constructor(private readonly agentDataFolder: string) {}

  public async transaction<T>(
    parts: readonly string[],
    isWriting: boolean,
    work: (files: ReportFiles) => Promise<T>,
  ): Promise<T> {
    for (const part of parts) validName(part)
    const root = path.resolve(this.agentDataFolder)
    if (isWriting) await mkdir(root, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    let directory = root
    let isMissing = false
    for (const part of ['', 'reports', 'v1', ...parts]) {
      directory = path.join(directory, part)
      if (isWriting) {
        try {
          await mkdir(directory, { mode: CHECKPOINT_STORAGE_MODE })
        } catch (error: unknown) {
          if (!hasCode(error, 'EEXIST')) throw error
        }
      }
      try {
        const info = await lstat(directory)
        if (!info.isDirectory() || info.isSymbolicLink())
          throw new Error(UI_TEXT.reportUi.generationFailed)
      } catch (error: unknown) {
        if (isWriting || !hasCode(error, 'ENOENT')) throw error
        isMissing = true
        break
      }
    }
    const realDirectory = isMissing ? undefined : await realpath(directory)
    const canonical = realDirectory?.replaceAll('\\', '/')
    const confined = async () => {
      if (canonical === undefined) throw new Error(UI_TEXT.reportUi.generationFailed)
      const info = await lstat(directory)
      const actual = await realpath(directory)
      if (info.isSymbolicLink() || actual.replaceAll('\\', '/') !== canonical)
        throw new Error(UI_TEXT.reportUi.generationFailed)
      // An ancestor must not have become a link into a different tree.
      let ancestor = directory
      while (ancestor.replaceAll('\\', '/') !== root.replaceAll('\\', '/')) {
        ancestor = path.dirname(ancestor)
        const info = await lstat(ancestor)
        if (info.isSymbolicLink()) throw new Error(UI_TEXT.reportUi.generationFailed)
      }
    }
    const fileFor = (name: string) => {
      validName(name)
      return path.join(directory, name)
    }
    const regular = async (file: string) => {
      const info = await lstatIdentity(file)
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.nlink !== BigInt(REPORT_STORAGE_LINK_COUNT)
      )
        throw new Error(UI_TEXT.reportUi.generationFailed)
      return info
    }
    const files: ReportFiles = {
      async list() {
        if (isMissing) return []
        await confined()
        return await readdir(directory)
      },
      async stat(name) {
        if (isMissing) return
        await confined()
        try {
          const info = await lstat(fileFor(name))
          return info.mtimeMs
        } catch (error: unknown) {
          if (hasCode(error, 'ENOENT')) return
          throw error
        }
      },
      async read(name) {
        if (isMissing) return
        const file = fileFor(name)
        await confined()
        try {
          const held = await regular(file)
          const handle = await open(
            file,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          )
          try {
            const actual = await handleIdentity(handle)
            // A bounded allocation even for a corrupt or growing file.
            const maximum = REPORT_MAX_TEXT_CHARS * REPORT_MAX_SOURCES
            if (
              !sameFile(held, actual) ||
              !actual.isFile() ||
              actual.nlink !== BigInt(REPORT_STORAGE_LINK_COUNT) ||
              actual.size > BigInt(maximum)
            )
              throw new Error(UI_TEXT.reportUi.generationFailed)
            const bytes = Buffer.alloc(Number(actual.size) + 1)
            let size = 0
            while (size < bytes.length) {
              const read = await handle.read(bytes, size, bytes.length - size, size)
              if (read.bytesRead === 0) break
              size += read.bytesRead
            }
            await confined()
            if (size > Number(actual.size) || !sameFile(actual, await regular(file)))
              throw new Error(UI_TEXT.reportUi.generationFailed)
            return bytes.subarray(0, size).toString('utf8')
          } finally {
            await handle.close()
          }
        } catch (error: unknown) {
          if (hasCode(error, 'ENOENT')) return
          throw error
        }
      },
      async write(name, text) {
        if (!isWriting || Buffer.byteLength(text) > REPORT_MAX_TEXT_CHARS * REPORT_MAX_SOURCES)
          throw new Error(UI_TEXT.reportUi.saveFailed)
        const target = fileFor(name)
        await confined()
        try {
          await regular(target)
        } catch (error: unknown) {
          if (!hasCode(error, 'ENOENT')) throw error
        }
        const stage = fileFor(`stage-${randomUUID()}`)
        const handle = await open(stage, 'wx', REPORT_STORAGE_FILE_MODE)
        const identity = await handleIdentity(handle)
        const cleanup = async () => {
          await confined()
          try {
            if (sameFile(identity, await regular(stage))) await unlink(stage)
          } catch (error: unknown) {
            if (!hasCode(error, 'ENOENT')) throw error
          }
        }
        try {
          try {
            await confined()
            await handle.writeFile(text, 'utf8')
            await handle.sync()
          } finally {
            await handle.close()
          }
          await confined()
          if (!sameFile(identity, await regular(stage)))
            throw new Error(UI_TEXT.reportUi.saveFailed)
          await rename(stage, target)
        } finally {
          await cleanup()
        }
      },
      async remove(name) {
        if (!isWriting) throw new Error(UI_TEXT.reportUi.saveFailed)
        await confined()
        const file = fileFor(name)
        await regular(file)
        await unlink(file)
      },
    }
    if (!isWriting) return await work(files)
    const lock = fileFor('writer.lock')
    const startedAt = await startOf(process.pid)
    if (startedAt === undefined) throw new Error(UI_TEXT.reportUi.saveFailed)
    const owner = lockOwnerSchema.parse({ pid: process.pid, startedAt, token: randomUUID() })
    const deadline = performance.now() + REPORT_WRITER_LOCK_WAIT_MS
    let backoff = REPORT_WRITER_LOCK_BACKOFF_MS
    const readOwner = async (name: string) => {
      const text = await files.read(name)
      if (text === undefined) return
      try {
        const parsed = lockOwnerSchema.safeParse(JSON.parse(text))
        return parsed.success ? parsed.data : undefined
      } catch {
        // An incomplete record cannot establish that its exact owner is dead.
        return
      }
    }
    const tombstones = async () => {
      const names = await files.list()
      return names.filter((name) => name.startsWith('lease-'))
    }
    const isDead = async (recorded: z.infer<typeof lockOwnerSchema>) =>
      (await startOf(recorded.pid, Math.max(1, Math.floor(deadline - performance.now())))) !==
      recorded.startedAt
    // Rename creates a barrier at the same instant the lock name becomes free.
    // Unique tombstone names are never reused, so deletion cannot hit a replacement.
    const didRetire = async (
      name: string,
      token: string,
      ownIdentity?: Awaited<ReturnType<typeof handleIdentity>>,
    ): Promise<boolean> => {
      const tomb = `lease-${randomUUID()}`
      await confined()
      await regular(fileFor(name))
      await rename(fileFor(name), fileFor(tomb))
      const moved = await readOwner(tomb)
      if (
        moved?.token === token ||
        (moved === undefined &&
          ownIdentity !== undefined &&
          sameFile(ownIdentity, await regular(fileFor(tomb))))
      ) {
        await confined()
        await unlink(fileFor(tomb))
        return true
      }
      // This may replace a tentative creator, which must recheck its identity
      // and every pending tombstone before work. It cannot replace active work:
      // the tombstone has blocked admission since the original rename.
      await confined()
      await rename(fileFor(tomb), lock)
      return false
    }
    const recoverTombstones = async () => {
      const names = await tombstones()
      for (const name of names) {
        const recorded = await readOwner(name)
        if (recorded === undefined) continue
        await confined()
        if (await isDead(recorded)) await unlink(fileFor(name))
        else await rename(fileFor(name), lock)
      }
    }
    const pause = async () => {
      const remaining = deadline - performance.now()
      if (remaining <= 0) throw new Error(UI_TEXT.reportUi.saveFailed)
      await delay(Math.min(backoff, remaining))
      backoff = Math.min(backoff * 2, REPORT_WRITER_LOCK_BACKOFF_MAX_MS)
    }
    for (;;) {
      await confined()
      try {
        await recoverTombstones()
      } catch {
        // A concurrent recovery can consume a unique tombstone; failed reads
        // supply no deletion authority. Every retry stays inside the deadline.
        await pause()
        continue
      }
      let handle
      try {
        handle = await open(lock, 'wx', REPORT_STORAGE_FILE_MODE)
      } catch (error: unknown) {
        if (!hasCode(error, 'EEXIST')) throw error
        try {
          const recorded = await readOwner('writer.lock')
          if (recorded !== undefined && (await isDead(recorded)))
            await didRetire('writer.lock', recorded.token)
        } catch {
          // No failed or changing owner read authorizes removal.
        }
        await pause()
        continue
      }
      const identity = await handleIdentity(handle)
      const release = async () => {
        const releaseDeadline = performance.now() + REPORT_WRITER_LOCK_WAIT_MS
        for (;;) {
          // Recovery may have moved our lease. Retiring its unique name cancels
          // any delayed restore, so a released token cannot be resurrected.
          const names = await tombstones()
          names.push('writer.lock')
          for (const name of names) {
            try {
              if (name !== 'writer.lock') {
                const recorded = await readOwner(name)
                if (recorded?.token !== owner.token) continue
              }
              if (await didRetire(name, owner.token, identity)) return
            } catch (error: unknown) {
              if (!hasCode(error, 'ENOENT')) throw error
            }
          }
          if (performance.now() >= releaseDeadline) throw new Error(UI_TEXT.reportUi.saveFailed)
          await delay(REPORT_WRITER_LOCK_BACKOFF_MS)
        }
      }
      const releaseOwned = async () => {
        const names = [...(await tombstones()), 'writer.lock']
        for (const name of names) {
          try {
            if (sameFile(identity, await regular(fileFor(name)))) {
              await release()
              return
            }
          } catch (error: unknown) {
            if (!hasCode(error, 'ENOENT')) throw error
          }
        }
      }
      let isHandleOpen = true
      try {
        await handle.writeFile(JSON.stringify(owner), 'utf8')
        await handle.sync()
        // Windows cannot replace an open destination with MoveFileEx. Publish
        // the complete lease, then close before another recoverer restores it.
        await handle.close()
        isHandleOpen = false
        await confined()
        if (!sameFile(identity, await regular(lock))) throw new Error(UI_TEXT.reportUi.saveFailed)
        const pending = await tombstones()
        if (pending.length > 0) {
          await pause()
          continue
        }
        // Restoring a live tombstone can displace us while the scan is pending.
        if (!sameFile(identity, await regular(lock))) throw new Error(UI_TEXT.reportUi.saveFailed)
        return await work(files)
      } finally {
        // A restore can displace a tentative creator. Its unlinked inode owns
        // no lease to release and cannot authorize deleting the restored one.
        if (isHandleOpen) await handle.close()
        await releaseOwned()
      }
    }
  }
}

interface HistoryScope {
  readonly workspaceKey: string
  readonly kind: ReportKind
}

/** Authorization precedes storage access on every surface, including saved-id comparison. */
export class ReportHistory implements Pick<ReportsHostPort, 'history' | 'get' | 'compare'> {
  public constructor(
    private readonly deps: {
      readonly storage: ReportStorage
      readonly codec: ReportHistoryCodec
      readonly keepHistory: () => boolean
      readonly authorize: (scope: HistoryScope) => Promise<void>
    },
  ) {}

  private async entries(files: ReportFiles, kind: ReportKind) {
    const entries: SavedReport[] = []
    const names = await files.list()
    for (const name of names) {
      if (!/^[a-f0-9]+\.json$/.test(name)) continue
      const savedAt = await files.stat(name)
      if (savedAt === undefined) continue
      const text = await files.read(name)
      if (text === undefined) continue
      const document = reportDocumentSchema.parse(this.deps.codec.decode(text))
      const id = createHash('sha256').update(text).digest('hex')
      if (name !== `${id}.json` || document.header.kind !== kind)
        throw new Error(UI_TEXT.reportUi.generationFailed)
      entries.push({ id, document, savedAt })
    }
    return entries.toSorted(compareSavedReports)
  }

  private async retainedEntries(files: ReportFiles, kind: ReportKind) {
    const saved = await this.entries(files, kind)
    if (saved.length > REPORT_HISTORY_MAX_PER_KIND)
      throw new Error(UI_TEXT.reportUi.generationFailed)
    return saved
  }

  public async save(workspaceKey: string, input: ReportDocument) {
    if (!this.deps.keepHistory()) return { status: 'disabled' as const }
    const document = reportDocumentSchema.parse(input)
    const scope = reportsMethods['reports/history'].params.parse({
      workspaceKey,
      kind: document.header.kind,
    })
    await this.deps.authorize(scope)
    const text = this.deps.codec.encode(document)
    const verified = reportDocumentSchema.parse(this.deps.codec.decode(text))
    if (verified.header.kind !== scope.kind) throw new Error(UI_TEXT.reportUi.saveFailed)
    const id = createHash('sha256').update(text).digest('hex')
    await this.deps.storage.transaction(
      ['history', workspaceKey, scope.kind],
      true,
      async (files) => {
        // Refuse a corrupt bucket before a failed save can grow it.
        const previous = await this.entries(files, scope.kind)
        // The new file's stamp is the newest by construction; rank it so the
        // retention decision below matches the order the next listing reads.
        const savedAt = Math.max(Date.now(), ...previous.map((entry) => entry.savedAt))
        const entries = [
          ...previous.filter((entry) => entry.id !== id),
          { id, document: verified, savedAt },
        ].toSorted(compareSavedReports)
        const retained = entries.slice(0, REPORT_HISTORY_MAX_PER_KIND)
        if (retained.every((entry) => entry.id !== id)) throw new Error(UI_TEXT.reportUi.saveFailed)
        const retainedIds = new Set(retained.map((entry) => entry.id))
        // Prune before publishing: a denied deletion cannot grow the bucket.
        // This also retries any excess artifacts left by an older writer.
        for (const entry of previous)
          if (!retainedIds.has(entry.id)) await files.remove(`${entry.id}.json`)
        await files.write(`${id}.json`, text)
      },
    )
    return { status: 'saved' as const, entry: { id, header: verified.header } }
  }

  public async history(
    input: Parameters<ReportsHostPort['history']>[0],
  ): ReturnType<ReportsHostPort['history']> {
    try {
      const scope = reportsMethods['reports/history'].params.parse(input)
      await this.deps.authorize(scope)
      const entries = await this.deps.storage.transaction(
        ['history', scope.workspaceKey, scope.kind],
        false,
        async (files) => {
          const saved = await this.retainedEntries(files, scope.kind)
          return saved
            .slice(0, REPORT_HISTORY_MAX_PER_KIND)
            .map(({ id, document }) => ({ id, header: document.header }))
        },
      )
      return { status: 'listed', entries }
    } catch {
      return { status: 'failed', reason: UI_TEXT.reportUi.generationFailed }
    }
  }

  public async get(
    input: Parameters<ReportsHostPort['get']>[0],
  ): ReturnType<ReportsHostPort['get']> {
    try {
      const scope = reportsMethods['reports/get'].params.parse(input)
      await this.deps.authorize(scope)
      const document = await this.deps.storage.transaction(
        ['history', scope.workspaceKey, scope.kind],
        false,
        async (files) => {
          const saved = await this.retainedEntries(files, scope.kind)
          return saved.find((entry) => entry.id === scope.id)?.document
        },
      )
      if (document !== undefined) return { status: 'retrieved', document }
    } catch {
      // Malformed, redirected and foreign history is unavailable, never regenerated.
    }
    return { status: 'failed', reason: UI_TEXT.reportUi.generationFailed }
  }

  public async compare(
    input: Parameters<ReportsHostPort['compare']>[0],
  ): ReturnType<ReportsHostPort['compare']> {
    try {
      const scope = reportsMethods['reports/compare'].params.parse(input)
      const from = await this.get({
        workspaceKey: scope.workspaceKey,
        kind: scope.kind,
        id: scope.fromId,
      })
      const to = await this.get({
        workspaceKey: scope.workspaceKey,
        kind: scope.kind,
        id: scope.toId,
      })
      if (from.status === 'retrieved' && to.status === 'retrieved')
        return { status: 'compared', diff: compareReports(from.document, to.document) }
    } catch {
      // Both saved ids must remain inside the authorized workspace and kind.
    }
    return { status: 'failed', reason: UI_TEXT.reportUi.generationFailed }
  }
}
