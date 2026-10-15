// A cross-process lock by name: an exclusive named pipe on Windows, Unix domain
// sockets in a private per-user folder on macOS and Linux. Never a TCP port, so
// a reserved port range cannot refuse it. The OS releases a listener on exit,
// including a crash.
//
// POSIX ownership (docs/certification/chatgpt-grant-lock.md, "PLANFIX R2"): a
// socket file outlives a crashed holder, and no operating system can remove
// "that file, if it is still the stale one" in one step, so no contender ever
// recovers a shared name. Each contender binds a socket of its own, under a
// random name that nobody else binds or removes, then looks at every other
// entry: a live one means another holder, and it gives its own up and waits.
// Of two contenders that both pass, one's look would have preceded the other's
// listener, which is a contradiction, so at most one holds. A dead entry (it
// refuses a connection) never blocks; it is removed only once it is older than
// the time a bind needs to become a listener, so a file being born is never
// taken. The grant lock (chatGptRefreshLock.ts) and the credential store's
// per-account owner (keyStore.ts) are two names on this mechanism.
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { lstat, mkdir, readdir, unlink } from 'node:fs/promises'
import { createConnection, createServer, type Server } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  CHATGPT_GRANT_LOCK_DIR_MODE,
  CHATGPT_GRANT_LOCK_SCOPE_CHARS,
  CHATGPT_REFRESH_LOCK_RETRY_MS,
  NAMED_LOCK_ENTRY_BYTES,
  NAMED_LOCK_GARBAGE_MIN_AGE_MS,
  OAUTH_CODE_TTL_MS,
} from '../shared/constants'

/**
 * Why a lock was not had: it could not be opened (`unavailable`, with the
 * operating system's code as `reason`), another holder kept it past the
 * deadline (`busy`), or the caller gave up (`cancelled`). The mechanism knows
 * nothing of any one caller; each caller says it in its own words.
 */
export class NamedLockError extends Error {
  public constructor(
    public readonly kind: 'unavailable' | 'busy' | 'cancelled',
    public readonly reason?: string,
  ) {
    super(`namedLock.${kind}`)
    this.name = 'NamedLockError'
  }
}

export interface NamedLockOptions {
  /** POSIX only: the folder holding the socket files. Tests isolate with this. */
  readonly directory?: string
  /** Windows only: the name within the `\\.\pipe\` namespace. Tests isolate with this. */
  readonly pipeName?: string
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

/** Where one lock lives: a pipe name (Windows), a folder and a file name (POSIX). */
export interface NamedLockNames {
  readonly pipe: string
  readonly folder: string
  readonly file: string
}

/** One acquired lock; releasing it closes the listener and removes this holder's own file. */
interface Held {
  readonly release: () => Promise<void>
}

/** One try at the lock: the holder, or undefined when another holds it. */
type Attempt = (signal: AbortSignal) => Promise<Held | undefined>

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

/** The OS code when it has one; never a credential, token or account text. */
function osReason(error: unknown): string {
  return errorCode(error) ?? (error instanceof Error ? error.message : 'unknown')
}

/** The person holding this OS credential store: their uid, else their name. */
export function personScope(): string {
  const getuid = process.getuid
  const who = getuid === undefined ? `user:${userInfo().username}` : `uid:${String(getuid())}`
  return createHash('sha256').update(who).digest('hex').slice(0, CHATGPT_GRANT_LOCK_SCOPE_CHARS)
}

/** One contender's own socket file: the lock's file name, a dot, and a random suffix nobody else uses. */
function socketEntryPath(directory: string, file: string, suffix: string): string {
  return path.join(directory, `${file}.${suffix}`)
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })
}

async function tryListen(target: string): Promise<Server | 'in-use'> {
  const server = createServer((socket) => {
    socket.on('error', () => socket.destroy())
    socket.destroy()
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(target, () => {
        server.off('error', reject)
        resolve()
      })
    })
    return server
  } catch (error) {
    server.close()
    if (errorCode(error) === 'EADDRINUSE') return 'in-use'
    throw new NamedLockError('unavailable', osReason(error))
  }
}

/** A Windows named pipe that exists has a live holder: the OS removes a crashed process's pipe with its last handle. */
async function acquirePipe(target: string): Promise<Held | undefined> {
  const server = await tryListen(target)
  return server === 'in-use' ? undefined : { release: () => closeServer(server) }
}

const LIVE_LISTENER_CODES = new Set(['EAGAIN', 'ECONNRESET'])
const DEAD_ENTRY_CODES = new Set(['ECONNREFUSED', 'ENOENT', 'ENOTSOCK'])

/**
 * Whether a socket file has a listener. A refused connection or a missing or
 * foreign file is a dead entry. A full backlog, or a connection the listener
 * accepted and dropped (every lock listener drops what connects to it: the
 * measured `ECONNRESET`), is a live listener. Any other failure is a local
 * failure, reported with its OS code.
 */
async function isLive(file: string): Promise<boolean> {
  const code = await new Promise<string | undefined>((resolve) => {
    const client = createConnection(file)
    client.once('connect', () => {
      client.destroy()
      resolve(undefined)
    })
    client.once('error', (error: NodeJS.ErrnoException) => {
      client.destroy()
      resolve(errorCode(error) ?? 'unknown')
    })
  })
  if (code === undefined || LIVE_LISTENER_CODES.has(code)) return true
  if (DEAD_ENTRY_CODES.has(code)) return false
  throw new NamedLockError('unavailable', code)
}

/**
 * Removes a dead entry once it is older than a bind needs to become a
 * listener. Its name is random and was bound once, so nobody binds it again;
 * a younger one may be a file in the middle of being born, and stays.
 */
async function removeIfGarbage(file: string): Promise<void> {
  try {
    const found = await lstat(file)
    if (Date.now() - found.mtimeMs >= NAMED_LOCK_GARBAGE_MIN_AGE_MS) await unlink(file)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw new NamedLockError('unavailable', osReason(error))
  }
}

/** Whether another process holds, or is trying to hold, this lock: any other entry with a listener. */
async function hasLiveContender(
  directory: string,
  file: string,
  own: string,
  signal: AbortSignal,
): Promise<boolean> {
  let names: string[]
  try {
    names = await readdir(directory)
  } catch (error) {
    throw new NamedLockError('unavailable', osReason(error))
  }
  for (const name of names) {
    const other = path.join(directory, name)
    if (other === own || !name.startsWith(`${file}.`)) continue
    signal.throwIfAborted()
    if (await isLive(other)) return true
    await removeIfGarbage(other)
  }
  return false
}

async function acquireSocket(
  directory: string,
  file: string,
  signal: AbortSignal,
): Promise<Held | undefined> {
  const own = socketEntryPath(directory, file, randomBytes(NAMED_LOCK_ENTRY_BYTES).toString('hex'))
  const server = await tryListen(own)
  // Another contender drew the same random name: nothing was bound, try again under a new one.
  if (server === 'in-use') return undefined
  const held: Held = {
    release: async () => {
      await closeServer(server)
      try {
        await unlink(own)
      } catch {
        // A file left behind is a dead entry: the next contender removes it once it is old.
      }
    },
  }
  try {
    if (!(await hasLiveContender(directory, file, own, signal))) return held
  } catch (error) {
    await held.release()
    throw error
  }
  await held.release()
  return undefined
}

async function openAttempt(names: NamedLockNames, options: NamedLockOptions): Promise<Attempt> {
  if (process.platform === 'win32') {
    const pipe = `\\\\.\\pipe\\${options.pipeName ?? names.pipe}`
    return () => acquirePipe(pipe)
  }
  let folder: string
  try {
    folder = options.directory ?? path.join(tmpdir(), names.folder)
    await mkdir(folder, { recursive: true, mode: CHATGPT_GRANT_LOCK_DIR_MODE })
  } catch (error) {
    throw new NamedLockError('unavailable', osReason(error))
  }
  return (signal) => acquireSocket(folder, names.file, signal)
}

/** Why the wait ended: the caller gave up, or another holder kept the lock past the deadline. */
function endOfWait(options: NamedLockOptions): NamedLockError {
  return new NamedLockError(options.signal?.aborted === true ? 'cancelled' : 'busy')
}

async function acquireLock(
  attempt: Attempt,
  signal: AbortSignal,
  options: NamedLockOptions,
): Promise<Held> {
  try {
    for (;;) {
      signal.throwIfAborted()
      const held = await attempt(signal)
      if (held !== undefined) return held
      // Contenders that looked at each other both gave way: a random wait lets one of them through.
      const wait = CHATGPT_REFRESH_LOCK_RETRY_MS + randomInt(CHATGPT_REFRESH_LOCK_RETRY_MS)
      await delay(wait, undefined, { signal })
    }
  } catch (error) {
    if (signal.aborted && !(error instanceof NamedLockError)) throw endOfWait(options)
    throw error
  }
}

/**
 * Runs `work` as the one holder of the named lock. Errors of `work` are
 * thrown as they are. A lock that cannot be opened for a local reason is
 * `NamedLockError('unavailable')` with its OS code; a wait that
 * outlasts the deadline is `'lock-busy'` and one the caller cancels is
 * `'cancelled'`, so neither reads as a provider outage.
 */
export async function withNamedLock<T>(
  work: () => Promise<T>,
  names: NamedLockNames,
  options: NamedLockOptions = {},
): Promise<T> {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? OAUTH_CODE_TTL_MS)
  const signal =
    options.signal === undefined ? deadline : AbortSignal.any([deadline, options.signal])
  const attempt = await openAttempt(names, options)
  const held = await acquireLock(attempt, signal, options)
  try {
    if (signal.aborted) throw endOfWait(options)
    return await work()
  } finally {
    await held.release()
  }
}
