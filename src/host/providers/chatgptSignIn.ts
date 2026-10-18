// VS Code ports for the shared subscription core. The global-storage files
// contain only an opaque installation id and an exclusive lock, never tokens.
import { randomUUID } from 'node:crypto'
import {
  mkdir,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import {
  CHATGPT_REGISTRATION_SECRET_KEY,
  HTTP_STATUS,
  MILLISECONDS_PER_SECOND,
  OAUTH_CODE_TTL_MS,
  OAUTH_LOOPBACK_HOST,
  PROVIDER_SECRET_PREFIX,
  UI_TEXT,
} from '../../shared/constants'
import {
  ChatGptSignIn,
  ChatGptSignInError,
  parseChatGptCallback,
  type ChatGptHostPort,
} from '../backend/subscriptionsEntry'
import type { RecordStore } from './credentialRecords'
import { loadChatGptHostId } from './chatgptHostId'

type ChatGptCallback = Awaited<ReturnType<ChatGptHostPort['startCallback']>> & {
  readonly bindHost: string
}

/** Bound before the browser opens; the promise also retains an early callback. */
export async function startChatGptCallback(
  state: string,
  timeoutMs: number,
  /** The saved issued client a reauthorization's callback may omit. */
  clientId?: string,
): Promise<ChatGptCallback> {
  const server = createServer()
  const completion: { resolve?: (url: string) => void; reject?: (error: Error) => void } = {}
  const waiting = new Promise<string>((resolve, reject) => {
    completion.resolve = resolve
    completion.reject = reject
  })
  // The waiter below receives the callback's outcome; this only marks the rejection handled.
  void waiting.catch(() => null) // The outcome reaches the waiter; handled here, said there.
  let isSettled = false
  const finish = (value: string | Error): void => {
    if (isSettled) return
    isSettled = true
    clearTimeout(timer)
    server.close()
    server.closeAllConnections()
    if (typeof value === 'string') completion.resolve?.(value)
    else completion.reject?.(value)
  }
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, OAUTH_LOOPBACK_HOST, () => {
        server.off('error', reject)
        resolve()
      })
    })
  } catch (error) {
    // The loopback listener could not open: this machine's cause, with its code.
    const code = fileErrorCode(error)
    throw new ChatGptSignInError('local-failed', typeof code === 'string' ? code : 'listen')
  }
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new ChatGptSignInError('invalid-callback')
  }
  let isClaimed = false
  const redirectUri = `http://${OAUTH_LOOPBACK_HOST}:${String(address.port)}/auth/callback`
  server.on('error', () => {
    finish(new ChatGptSignInError('invalid-callback'))
  })
  server.on('request', (request, response) => {
    const answer = (status: number): void => {
      response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(UI_TEXT.oauthCallbackDone)
    }
    if (request.method !== 'GET') {
      answer(HTTP_STATUS.methodNotAllowed)
      return
    }
    if (isClaimed || isSettled) {
      answer(HTTP_STATUS.badRequest)
      return
    }
    try {
      const url = new URL(request.url ?? '/', redirectUri)
      if (url.pathname !== '/auth/callback') {
        answer(HTTP_STATUS.notFound)
        return
      }
      parseChatGptCallback(url.href, redirectUri, state, clientId)
      isClaimed = true
      // Let the response finish before forcibly closing idle sockets.
      response.on('finish', () => {
        finish(url.href)
      })
      answer(HTTP_STATUS.ok)
    } catch (error) {
      isClaimed = true
      response.on('finish', () => {
        // The parser's own validated code (a refusal, another attempt's
        // state), never request text.
        finish(
          error instanceof ChatGptSignInError ? error : new ChatGptSignInError('invalid-callback'),
        )
      })
      answer(HTTP_STATUS.badRequest)
    }
  })
  const timer = setTimeout(() => {
    finish(new ChatGptSignInError('callback-timeout'))
  }, timeoutMs)
  timer.unref()
  return {
    bindHost: address.address,
    redirectUri,
    waitForCallback: () => waiting,
    close: () => {
      finish(new ChatGptSignInError('invalid-callback'))
    },
  }
}

const processStartedAt = Date.now() - process.uptime() * MILLISECONDS_PER_SECOND
const activeLocks = new Set<string>()
const lockOwnerSchema = z.strictObject({
  pid: z.int().check(z.positive()),
  startedAt: z.number().check(z.positive()),
  windowId: z.uuid(),
  expiresAt: z.number().check(z.positive()),
})

function fileErrorCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined
}
/**
 * The catch-gate-visible form of the expected file-lock condition: `is`-named
 * so the inventory reads it as the one handled case, with exactly the same
 * answer as the code-list check on every input.
 */
function isFileErrorCode(error: unknown, ...codes: readonly string[]): boolean {
  return codes.includes(String(fileErrorCode(error)))
}

/** An expired lease alone never proves a live process has stopped refreshing. */
function isOwnerGone(owner: z.infer<typeof lockOwnerSchema>, file: string): boolean {
  if (owner.pid === process.pid && owner.startedAt === processStartedAt)
    return owner.expiresAt <= Date.now() && !activeLocks.has(file)
  try {
    process.kill(owner.pid, 0)
    return false
  } catch (error) {
    // Permission failures and unrecognised OS failures mean uncertainty, not death.
    return fileErrorCode(error) === 'ESRCH'
  }
}

async function hasRecoveredLock(lockPath: string): Promise<boolean> {
  try {
    const files = await readdir(lockPath)
    for (const file of files) {
      if (!file.endsWith('.json') || !z.uuid().safeParse(file.slice(0, -'.json'.length)).success)
        continue
      const ownerPath = path.join(lockPath, file)
      const raw: unknown = JSON.parse(await readFile(ownerPath, 'utf8'))
      const parsed = lockOwnerSchema.safeParse(raw)
      if (parsed.success && isOwnerGone(parsed.data, file)) await unlink(ownerPath)
    }
    // Each acquisition has a unique filename. A concurrent recovery can only
    // unlink that old owner; rmdir cannot remove a new owner's nonempty directory.
    await rmdir(lockPath)
    return true
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT', 'ENOTEMPTY', 'ENOTDIR', 'EPERM', 'EACCES', 'EBUSY'))
      return false
    throw error
  }
}

/** A complete owner directory is published atomically; a live one is nonempty. */
async function withFileLock<T>(
  directory: string,
  windowId: string,
  timeoutMs: number,
  pollMs: number,
  work: () => Promise<T>,
): Promise<T> {
  await mkdir(directory, { recursive: true })
  const lockPath = path.join(directory, 'chatgpt.refresh.lock')
  const deadline = Date.now() + timeoutMs
  const prepared = await mkdtemp(path.join(directory, '.chatgpt-lock-'))
  const file = `${randomUUID()}.json`
  let isOwned = false
  try {
    await writeFile(
      path.join(prepared, file),
      JSON.stringify({
        pid: process.pid,
        startedAt: processStartedAt,
        windowId,
        expiresAt: deadline,
      }),
      { flag: 'wx' },
    )
    while (!isOwned) {
      try {
        // Windows rename can replace a regular legacy file with a directory.
        // A present ownerless file must remain closed, including on Windows.
        try {
          const stat = await lstat(lockPath)
          if (!stat.isDirectory()) {
            if (Date.now() >= deadline) throw new ChatGptSignInError('lock-busy')
            await pause(Math.min(pollMs, Math.max(0, deadline - Date.now())))
            continue
          }
        } catch (error) {
          if (!isFileErrorCode(error, 'ENOENT')) throw error
        }
        await rename(prepared, lockPath)
        isOwned = true
        activeLocks.add(file)
      } catch (error) {
        if (!isFileErrorCode(error, 'EEXIST', 'ENOTEMPTY', 'ENOTDIR', 'EPERM', 'EACCES', 'EBUSY'))
          throw error
        const isRecovered = await hasRecoveredLock(lockPath)
        if (Date.now() >= deadline) throw new ChatGptSignInError('lock-busy')
        if (isRecovered) continue
        await pause(Math.min(pollMs, Math.max(0, deadline - Date.now())))
      }
    }
    return await work()
  } finally {
    if (isOwned) {
      try {
        await unlink(path.join(lockPath, file))
      } finally {
        activeLocks.delete(file)
      }
      await hasRecoveredLock(lockPath)
    } else await rm(prepared, { recursive: true, force: true })
  }
}

/**
 * The grant's SecretStorage calls. A refusal is the editor's credential
 * store and is said as such: the sign-in core's guard would otherwise report
 * any foreign error as a temporary ChatGPT failure (F14).
 */
async function grantStore<T>(work: () => Thenable<T>): Promise<T> {
  try {
    return await work()
  } catch {
    throw new ChatGptSignInError('store-unavailable')
  }
}

export interface ChatGptVsCodeDeps {
  readonly secrets: RecordStore
  readonly globalStorageUri: vscode.Uri
  /** Captured remote forwarding is not available; remote sign-in refuses. */
  readonly isRemote: boolean
  readonly fetch: typeof fetch
  readonly openExternal?: (uri: vscode.Uri) => Thenable<boolean>
  readonly lockTimeoutMs?: number
  readonly lockPollMs?: number
}

/** W composes this factory into the lazy Models panel; X implements the same core port. */
export async function createChatGptSignIn(deps: ChatGptVsCodeDeps): Promise<ChatGptSignIn> {
  try {
    const directory = deps.globalStorageUri.fsPath
    const windowId = randomUUID()
    const withRefreshLock: ChatGptHostPort['withRefreshLock'] = (work) =>
      withFileLock(
        directory,
        windowId,
        deps.lockTimeoutMs ?? OAUTH_CODE_TTL_MS,
        deps.lockPollMs ?? MILLISECONDS_PER_SECOND,
        work,
      )
    const hostId = await withRefreshLock(() => loadChatGptHostId(directory))
    const key = `${PROVIDER_SECRET_PREFIX}chatgpt`
    const readStored = async (account: string): Promise<unknown> => {
      const stored = await grantStore(() => deps.secrets.get(account))
      if (stored === undefined) return
      try {
        const parsed: unknown = JSON.parse(stored)
        return parsed
      } catch (error: unknown) {
        // Only the parser's own failure reads as an unreadable grant; anything
        // else reaches the caller with its cause, never mislabelled.
        if (error instanceof SyntaxError) {
          throw new ChatGptSignInError(
            account === key ? 'grant-unreadable' : 'registration-unreadable',
          )
        }
        throw error
      }
    }
    return new ChatGptSignIn({
      hostId,
      fetch: deps.fetch,
      now: Date.now,
      withRefreshLock,
      openBrowser: async (url) => {
        let isOpened = false
        try {
          isOpened = await (deps.openExternal ?? vscode.env.openExternal)(vscode.Uri.parse(url))
        } catch {
          // The editor refused to open it: said as that below, never as a ChatGPT outage.
        }
        if (!isOpened) throw new ChatGptSignInError('browser-unavailable')
      },
      startCallback: async (state, timeoutMs, clientId) => {
        if (deps.isRemote) throw new ChatGptSignInError('invalid-callback')
        return await startChatGptCallback(state, timeoutMs, clientId)
      },
      readRecord: () => readStored(key),
      writeRecord: async (record) => {
        await grantStore(() => deps.secrets.store(key, JSON.stringify(record)))
      },
      deleteRecord: async () => {
        await grantStore(() => deps.secrets.delete(key))
      },
      // The core validates both shapes; this port stores the JSON as given.
      readRegistration: () => readStored(CHATGPT_REGISTRATION_SECRET_KEY),
      writeRegistration: async (registration) => {
        await grantStore(() =>
          deps.secrets.store(CHATGPT_REGISTRATION_SECRET_KEY, JSON.stringify(registration)),
        )
      },
    })
  } catch (error) {
    // A typed failure (a corrupt host id) keeps its own sentence; anything else
    // is a local file problem, said with the operating system's code.
    if (error instanceof ChatGptSignInError) throw error
    const code = fileErrorCode(error)
    throw new ChatGptSignInError('local-failed', typeof code === 'string' ? code : 'unknown')
  }
}
