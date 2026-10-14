// One person-scoped grant lock serializes OS-store grant mutations across
// processes: an exclusive named pipe on Windows, a Unix domain socket in a
// private per-user folder on macOS and Linux. Never a TCP port, so a
// reserved port range cannot refuse it. The OS releases the listener on
// exit, including a crash; a socket file left by a crashed process is
// replaced after a refused connection proves no holder, and the OS grants
// each bind to exactly one contender, so there are never two holders.
// Contention retries to the deadline and fails closed; a local failure to
// open the listener reports its OS code, never "temporarily unavailable".
import { createHash } from 'node:crypto'
import { mkdir, unlink } from 'node:fs/promises'
import { createConnection, createServer, type Server } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  CHATGPT_GRANT_LOCK_DIR,
  CHATGPT_GRANT_LOCK_DIR_MODE,
  CHATGPT_GRANT_LOCK_FILE,
  CHATGPT_GRANT_LOCK_PIPE,
  CHATGPT_GRANT_LOCK_SCOPE_CHARS,
  CHATGPT_REFRESH_LOCK_RETRY_MS,
  OAUTH_CODE_TTL_MS,
} from '../shared/constants'
import { ChatGptSignInError } from '../core/providers/subscriptions/chatgpt'
import { StoreUnavailableError } from './keyStore'

export interface ChatGptLockOptions {
  /** POSIX only: the folder holding the socket file. Tests isolate with this. */
  readonly directory?: string
  /** Windows only: the name within the `\\.\pipe\` namespace. Tests isolate with this. */
  readonly pipeName?: string
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

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
function lockScope(): string {
  const getuid = process.getuid
  const who = getuid === undefined ? `user:${userInfo().username}` : `uid:${String(getuid())}`
  return createHash('sha256').update(who).digest('hex').slice(0, CHATGPT_GRANT_LOCK_SCOPE_CHARS)
}

async function lockTarget(directory?: string, pipeName?: string): Promise<string> {
  try {
    if (process.platform === 'win32')
      return `\\\\.\\pipe\\${pipeName ?? `${CHATGPT_GRANT_LOCK_PIPE}-${lockScope()}`}`
    const folder = directory ?? path.join(tmpdir(), `${CHATGPT_GRANT_LOCK_DIR}-${lockScope()}`)
    await mkdir(folder, { recursive: true, mode: CHATGPT_GRANT_LOCK_DIR_MODE })
    return path.join(folder, CHATGPT_GRANT_LOCK_FILE)
  } catch (error) {
    if (error instanceof ChatGptSignInError) throw error
    throw new ChatGptSignInError('lock-unavailable', osReason(error))
  }
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
    throw new ChatGptSignInError('lock-unavailable', osReason(error))
  }
}

/**
 * A bound socket path with no listener is a crashed holder's file: a live
 * holder answers the connection. Anything but refusal or absence while
 * probing is a local failure, reported with its OS code.
 */
async function probe(target: string): Promise<'live' | 'stale'> {
  const code = await new Promise<string | undefined>((resolve) => {
    const client = createConnection(target)
    client.once('connect', () => {
      client.destroy()
      resolve(undefined)
    })
    client.once('error', (error: NodeJS.ErrnoException) => {
      client.destroy()
      resolve(errorCode(error) ?? 'unknown')
    })
  })
  if (code === undefined) return 'live'
  if (['ECONNREFUSED', 'ENOENT', 'ENOTSOCK'].includes(code)) return 'stale'
  throw new ChatGptSignInError('lock-unavailable', code)
}

async function acquire(target: string, signal: AbortSignal): Promise<Server | undefined> {
  const first = await tryListen(target)
  if (first !== 'in-use') return first
  // A named pipe that exists has a live holder: the OS removes a crashed
  // process's pipe with its last handle. A socket file may outlive one.
  if (process.platform === 'win32') return undefined
  signal.throwIfAborted()
  if ((await probe(target)) === 'live') return undefined
  try {
    await unlink(target)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT')
      throw new ChatGptSignInError('lock-unavailable', osReason(error))
  }
  const second = await tryListen(target)
  return second === 'in-use' ? undefined : second
}

/** One person-scoped grant lock; no token, identity, file or child is involved. */
export async function withChatGptRefreshLock<T>(
  work: () => Promise<T>,
  options: ChatGptLockOptions = {},
): Promise<T> {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? OAUTH_CODE_TTL_MS)
  const signal =
    options.signal === undefined ? deadline : AbortSignal.any([deadline, options.signal])
  const target = await lockTarget(options.directory, options.pipeName)
  try {
    for (;;) {
      signal.throwIfAborted()
      const server = await acquire(target, signal)
      if (server !== undefined) {
        try {
          signal.throwIfAborted()
          return await work()
        } finally {
          await new Promise<void>((resolve) =>
            server.close(() => {
              resolve()
            }),
          )
        }
      }
      await delay(CHATGPT_REFRESH_LOCK_RETRY_MS, undefined, { signal })
    }
  } catch (error) {
    if (error instanceof ChatGptSignInError) throw error
    if (error instanceof StoreUnavailableError) throw new ChatGptSignInError('store-unavailable')
    throw new ChatGptSignInError('request-failed')
  }
}
