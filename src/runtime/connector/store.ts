// M124 (D106): the connector's owner-only files in the agent's data folder,
// outside every repository: one grant per connection, the kill switch, the
// audit journal and its key, and each grant's shared limits. A missing grant
// grants nothing; an unreadable kill switch counts as switched off (fail
// closed).
//
// The limits file's lock (RVM124B finding 3) follows the same protocol as
// the M123 PR store's storeLock (src/runtime/panel/pullRequests/storeLock.ts,
// m123/p4 at c212d38cf); a shared module is to be extracted later:
// - Acquire: one lock file, created exclusively (O_EXCL), holding its
//   owner's note: host, process id and start time, a random id and the
//   lease its holder keeps.
// - Time: every wait and lease is measured on this process's monotonic
//   clock, never the wall clock, so no clock step and no file age counts.
//   A waiter takes over only an instance it has itself watched, unchanged,
//   for that holder's whole lease (at most `lockHonoredMs`), so it never acts
//   before the holder's own lease has ended; or one whose owner is provably
//   gone: on this host, no process has its id, or (Linux, from /proc) the
//   one that has it started at another time; or a torn note watched for
//   `lockTornMs`. No child process is started to ask: where the system's
//   start time cannot be read without one, a live id is never proof.
// - Takeover and release move the exact instance aside with one rename and
//   compare the moved file's native identity and note id with the ones
//   judged expired (or held); a newer lock moved by mistake is linked back
//   while the name is free. So no waiter ever deletes another process's
//   live lock, even when the file system reused the old lock's inode number.
// - As storeLock's generations do: every write is the exclusive creation
//   (link) of the next generation, checked to be the newest afterwards, so a
//   holder that lost the lock without knowing it can never land a stale
//   debit; it refuses instead.
import { randomBytes, randomUUID } from 'node:crypto'
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import * as z from 'zod/mini'
import {
  CONNECTOR_FILE_MODE,
  CONNECTOR_FOLDER,
  CONNECTOR_FOLDER_MODE,
  CONNECTOR_LIMITS,
  MILLISECONDS_PER_SECOND,
} from '../../shared/constants'
import {
  connectorGrantSchema,
  connectorKillSwitchSchema,
  type ConnectorGrant,
} from '../../shared/connector'
import { identityOf, sameFile, type FileIdentity } from '../../core/fs/fileIdentity'
import type { AuditPort } from '../../core/connector/audit'
import type { LimitsPort } from '../../core/connector/policy'
import type { AuthorityPort, AuthorityState } from '../../core/connector/registry'

const AUDIT_KEY_BYTES = 32
// /proc/<pid>/stat after the command's closing parenthesis: the start time
// (field 22) is the twentieth field there.
const LINUX_START_FIELD = 19
const LINUX_BOOT_TIME = /^btime (\d+)$/mu

const limitStateSchema = z.strictObject({
  tokens: z.number(),
  last: z.number(),
  leases: z.array(
    z.strictObject({ id: z.string(), kind: z.enum(['read', 'pending']), until: z.number() }),
  ),
})
const lockNoteSchema = z.strictObject({
  host: z.string(),
  pid: z.number(),
  start: z.number(),
  id: z.string(),
  leaseMs: z.number(),
})
type LockNote = z.infer<typeof lockNoteSchema>

function codeOf(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined
}

function isMissing(error: unknown): boolean {
  return codeOf(error) === 'ENOENT'
}

/** When a process started, from /proc (Linux only; no child process is asked elsewhere). */
async function linuxStart(pid: number): Promise<number | undefined> {
  if (process.platform !== 'linux') return undefined
  try {
    const fields = await readFile(`/proc/${String(pid)}/stat`, 'utf8')
    const ticks = Number(
      fields
        .slice(fields.lastIndexOf(')') + 1)
        .trim()
        .split(' ', LINUX_START_FIELD + 1)[LINUX_START_FIELD],
    )
    const boot = Number(LINUX_BOOT_TIME.exec(await readFile('/proc/stat', 'utf8'))?.[1])
    return Number.isSafeInteger(ticks) && Number.isSafeInteger(boot)
      ? boot * MILLISECONDS_PER_SECOND +
          Math.round((ticks * MILLISECONDS_PER_SECOND) / CONNECTOR_LIMITS.linuxClockTicks)
      : undefined
  } catch {
    return undefined
  }
}

async function readOwnStart(): Promise<number> {
  return (await linuxStart(process.pid)) ?? Math.round(performance.timeOrigin)
}

const own: { start?: Promise<number> } = {}
/** This process's start, read once and the same way another process's is. */
function startOfThisProcess(): Promise<number> {
  own.start ??= readOwnStart()
  return own.start
}

/** Provably gone: on this host, no process has its id, or the one that has it started at another time. */
async function isOwnerGone(note: LockNote): Promise<boolean> {
  if (note.host !== hostname()) return false
  let start: number | undefined
  if (note.pid === process.pid) start = await startOfThisProcess()
  else {
    try {
      process.kill(note.pid, 0)
    } catch (error: unknown) {
      // EPERM: the process exists; it is someone else's.
      return codeOf(error) === 'ESRCH'
    }
    start = await linuxStart(note.pid)
  }
  return (
    start !== undefined && Math.abs(start - note.start) > CONNECTOR_LIMITS.processStartToleranceMs
  )
}

type Seen = 'gone' | 'changing' | { readonly identity: FileIdentity; readonly note?: LockNote }

/** The lock as it is: one instance, read whole between two identical samples. */
async function observe(lock: string): Promise<Seen> {
  try {
    const before = await lstat(lock, { bigint: true })
    const bytes = await readFile(lock, 'utf8')
    const after = await lstat(lock, { bigint: true })
    if (
      !sameFile(before, after) ||
      before.mtimeNs !== after.mtimeNs ||
      before.size !== after.size ||
      !after.isFile()
    )
      return 'changing'
    let note: LockNote | undefined
    try {
      note = lockNoteSchema.parse(JSON.parse(bytes))
    } catch {
      note = undefined
    }
    return { identity: identityOf(after), ...(note !== undefined && { note }) }
  } catch (error: unknown) {
    if (isMissing(error)) return 'gone'
    throw error
  }
}

/**
 * Moves the instance `identity` (with note `noteId`) out of the lock's name
 * with one rename. True when that very instance left (or the name was
 * already free); a newer instance moved by mistake goes back, only while
 * the name is free. The note's random id is compared as well as the native
 * identity: a file system may give a removed lock's inode number to the next
 * lock created (seen on ext4), so identity alone can mistake a fresh lock
 * for the expired one.
 */
async function hasRetired(
  lock: string,
  identity: FileIdentity,
  noteId: string | undefined,
): Promise<boolean> {
  const aside = `${lock}.${randomUUID()}.retired`
  try {
    await rename(lock, aside)
  } catch (error: unknown) {
    if (isMissing(error)) return true
    // Windows refuses while a scanner holds the file: try again later.
    if (['EPERM', 'EACCES', 'EBUSY'].includes(String(codeOf(error)))) return false
    throw error
  }
  let moved: Seen
  try {
    moved = await observe(aside)
  } catch {
    moved = 'gone'
  }
  const isThatInstance =
    typeof moved === 'object' && sameFile(moved.identity, identity) && moved.note?.id === noteId
  try {
    if (typeof moved === 'object' && !isThatInstance) await link(aside, lock)
  } catch {
    // The name was taken again meanwhile: that owner's isHeld fails; the generations fence it.
  }
  await removeQuietly(aside)
  return isThatInstance
}

/** Leftovers are swept by the next writer; a failed removal changes nothing. */
async function removeQuietly(file: string): Promise<void> {
  try {
    await unlink(file)
  } catch {
    // Already gone, or held for a moment by a scanner.
  }
}

interface Held {
  /** Still this instance, its lease running: checked right before the write. */
  readonly isHeld: () => Promise<boolean>
  /** Removes this instance only; a lock someone took over stays theirs. */
  readonly release: () => Promise<void>
}

/** Takes the lock at `lock` as storeLock does; throws ELOCKED past the wait. */
async function acquire(lock: string): Promise<Held> {
  const deadline = performance.now() + CONNECTOR_LIMITS.lockWaitMs
  let watch: { identity: FileIdentity; noteId?: string; since: number; isGone: boolean } | undefined
  for (;;) {
    // Before the create: the holder's lease never outlasts what a waiter waits out.
    const heldSince = performance.now()
    const note: LockNote = {
      host: hostname(),
      pid: process.pid,
      start: await startOfThisProcess(),
      id: randomUUID(),
      leaseMs: CONNECTOR_LIMITS.lockLeaseMs,
    }
    let isCreated = false
    try {
      // Not flushed: the lock's existence excludes; a crash-torn note is watched out.
      await writeFile(lock, JSON.stringify(note), { flag: 'wx', mode: CONNECTOR_FILE_MODE })
      isCreated = true
    } catch (error: unknown) {
      if (codeOf(error) !== 'EEXIST') throw error
    }
    const seen = await observe(lock)
    if (isCreated && typeof seen === 'object' && seen.note?.id === note.id) {
      const { identity } = seen
      return {
        isHeld: async () => {
          if (performance.now() - heldSince >= note.leaseMs) return false
          const now = await observe(lock)
          return (
            typeof now === 'object' && sameFile(now.identity, identity) && now.note?.id === note.id
          )
        },
        release: async () => {
          try {
            const now = await observe(lock)
            if (typeof now === 'object' && sameFile(now.identity, identity))
              await hasRetired(lock, identity, note.id)
          } catch {
            // Unreleased, it expires with its lease; nothing else depends on it.
          }
        },
      }
    }
    if (seen === 'gone') continue
    if (!isCreated && typeof seen === 'object') {
      if (
        watch === undefined ||
        !sameFile(watch.identity, seen.identity) ||
        watch.noteId !== seen.note?.id
      )
        watch = {
          identity: seen.identity,
          ...(seen.note !== undefined && { noteId: seen.note.id }),
          since: performance.now(),
          isGone: seen.note !== undefined && (await isOwnerGone(seen.note)),
        }
      const watched = performance.now() - watch.since
      const isExpired =
        seen.note === undefined
          ? watched >= CONNECTOR_LIMITS.lockTornMs
          : watch.isGone || watched >= Math.min(seen.note.leaseMs, CONNECTOR_LIMITS.lockHonoredMs)
      if (isExpired && (await hasRetired(lock, seen.identity, seen.note?.id))) {
        watch = undefined
        continue
      }
    }
    if (performance.now() >= deadline) throw new Error('ELOCKED')
    await sleep(CONNECTOR_LIMITS.lockPollMs)
  }
}

/** The newest generation of `connectionId`'s limits in `names`, -1 when none. */
function newestGeneration(names: readonly string[], connectionId: string): number {
  let newest = -1
  for (const name of names) {
    const match = /^(.+)\.(\d+)\.json$/u.exec(name)
    if (match?.[1] === connectionId) newest = Math.max(newest, Number(match[2]))
  }
  return newest
}

export class ConnectorStore {
  private readonly root: string

  public constructor(dataFolder: string) {
    this.root = path.join(dataFolder, CONNECTOR_FOLDER)
  }

  private async folder(...segments: string[]): Promise<string> {
    const folder = path.join(this.root, ...segments)
    await mkdir(folder, { recursive: true, mode: CONNECTOR_FOLDER_MODE })
    return folder
  }

  private grantFile(connectionId: string): string {
    return path.join(this.root, 'grants', `${connectionId}.json`)
  }

  /** The current grant, or undefined: missing, malformed or unreadable grants grant nothing. */
  public async grant(connectionId: string): Promise<ConnectorGrant | undefined> {
    try {
      const value: unknown = JSON.parse(await readFile(this.grantFile(connectionId), 'utf8'))
      const parsed = connectorGrantSchema.safeParse(value)
      return parsed.success && parsed.data.connectionId === connectionId ? parsed.data : undefined
    } catch {
      return undefined
    }
  }

  public async grants(): Promise<readonly ConnectorGrant[]> {
    let names: string[]
    try {
      names = await readdir(path.join(this.root, 'grants'))
    } catch (error: unknown) {
      if (isMissing(error)) return []
      throw error
    }
    const found = await Promise.all(
      names
        .filter((name) => name.endsWith('.json'))
        .map((name) => this.grant(name.slice(0, -'.json'.length))),
    )
    return found.filter((grant) => grant !== undefined)
  }

  /** Written whole (temporary file, then rename), owner-only. */
  public async saveGrant(grant: ConnectorGrant): Promise<void> {
    const parsed = connectorGrantSchema.parse(grant)
    await this.folder('grants')
    const target = this.grantFile(parsed.connectionId)
    const temp = `${target}.${randomBytes(CONNECTOR_LIMITS.idBytes).toString('hex')}.tmp`
    try {
      await writeFile(temp, `${JSON.stringify(parsed, undefined, 2)}\n`, {
        mode: CONNECTOR_FILE_MODE,
        flag: 'wx',
      })
      await rename(temp, target)
    } finally {
      await rm(temp, { force: true })
    }
  }

  /**
   * The connection's live authority (design §3a): its grant and the kill
   * switch as last read. A change to either file is read at once (a watch
   * on this folder, while it exists) and `refresh` reads them again; a
   * reading that finishes after a newer one is dropped. Until the first
   * reading it is switched off (fail closed).
   */
  public authority(connectionId: string): AuthorityPort {
    let state: AuthorityState = { grant: undefined, killed: true }
    let started = 0
    let applied = 0
    const listeners = new Set<() => void>()
    const refresh = async () => {
      const reading = ++started
      const [grant, killed] = await Promise.all([this.grant(connectionId), this.isKilled()])
      if (reading < applied) return
      applied = reading
      const isChanged = JSON.stringify(state) !== JSON.stringify({ grant, killed })
      state = { grant, killed }
      if (isChanged) for (const changed of listeners) changed()
    }
    const watched = new Set(['kill-switch.json', path.join('grants', `${connectionId}.json`)])
    return {
      current: () => state,
      refresh,
      watch: (changed) => {
        listeners.add(changed)
        let watcher: FSWatcher | undefined
        try {
          watcher = watch(this.root, { recursive: true }, (_event, name) => {
            if (name !== null && watched.has(name)) void refresh()
          })
          watcher.on('error', () => {
            watcher?.close()
          })
        } catch {
          // No folder yet: the refresh before every gate keeps it current.
        }
        return () => {
          listeners.delete(changed)
          watcher?.close()
        }
      },
    }
  }

  /** Switched off when the file says so, or when it cannot be read or parsed. */
  public async isKilled(): Promise<boolean> {
    try {
      const value: unknown = JSON.parse(
        await readFile(path.join(this.root, 'kill-switch.json'), 'utf8'),
      )
      return connectorKillSwitchSchema.parse(value).on
    } catch (error: unknown) {
      return !isMissing(error)
    }
  }

  public async setKilled(isOn: boolean, nowIso: string): Promise<void> {
    await this.folder()
    await writeFile(
      path.join(this.root, 'kill-switch.json'),
      `${JSON.stringify({ on: isOn, at: nowIso })}\n`,
      { mode: CONNECTOR_FILE_MODE },
    )
  }

  /**
   * The connection's limit state, shared by every server process of that
   * connection and kept across restarts: `limits/<id>.<generation>.json`,
   * changed under the lock above and published as the next generation by an
   * exclusive link. Any failure (a busy lock, a lost lock, an unreadable
   * state) throws, and the caller refuses.
   */
  public limits(connectionId: string): LimitsPort {
    return {
      update: async (change) => {
        const folder = await this.folder('limits')
        const held = await acquire(path.join(folder, `${connectionId}.json.lock`))
        const temp = path.join(folder, `${connectionId}.${randomUUID()}.tmp`)
        try {
          const names = await readdir(folder)
          const current = newestGeneration(names, connectionId)
          const file = (generation: number) =>
            path.join(folder, `${connectionId}.${String(generation)}.json`)
          const saved =
            current < 0
              ? undefined
              : limitStateSchema.parse(JSON.parse(await readFile(file(current), 'utf8')))
          const [next, value] = change(saved)
          if (!(await held.isHeld())) throw new Error('ELOCKED')
          // Rate state, not a journal: not flushed (the audit journal is the durable record).
          await writeFile(temp, JSON.stringify(next), { mode: CONNECTOR_FILE_MODE, flag: 'wx' })
          // EEXIST: someone published this generation; this view is stale.
          await link(temp, file(current + 1))
          // A newer generation than ours: we wrote from a stale view.
          if (newestGeneration(await readdir(folder), connectionId) !== current + 1)
            throw new Error('ESTALE')
          for (const name of names)
            if (newestGeneration([name], connectionId) >= 0)
              await removeQuietly(path.join(folder, name))
          return value
        } finally {
          await rm(temp, { force: true })
          await held.release()
        }
      },
    }
  }

  /** Bounded JSONL: one live segment and one older one, pruned after the retention. */
  public audit(connectionId: string, now: () => number): AuditPort {
    return {
      key: async () => {
        const file = path.join(await this.folder(), 'audit.key')
        try {
          const handle = await open(file, 'wx', CONNECTOR_FILE_MODE)
          try {
            await handle.writeFile(randomBytes(AUDIT_KEY_BYTES))
          } finally {
            await handle.close()
          }
        } catch (error: unknown) {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
        }
        const key = await readFile(file)
        if (key.length !== AUDIT_KEY_BYTES) throw new Error('EAUDIT_KEY')
        return key
      },
      append: async (line) => {
        const folder = await this.folder('audit')
        const live = path.join(folder, `${connectionId}.jsonl`)
        const older = path.join(folder, `${connectionId}.1.jsonl`)
        let size = 0
        try {
          const info = await stat(live)
          size = info.size
        } catch (error: unknown) {
          if (!isMissing(error)) throw error
        }
        if (size + Buffer.byteLength(line) > CONNECTOR_LIMITS.auditSegmentBytes) {
          await rename(live, older)
        }
        try {
          const info = await stat(older)
          if (now() - info.mtimeMs > CONNECTOR_LIMITS.auditRetentionMs)
            await rm(older, { force: true })
        } catch (error: unknown) {
          if (!isMissing(error)) throw error
        }
        const handle = await open(live, 'a', CONNECTOR_FILE_MODE)
        try {
          await handle.appendFile(line, 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
      },
    }
  }
}
