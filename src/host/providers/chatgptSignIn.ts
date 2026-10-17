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
  HTTP_STATUS,
  MILLISECONDS_PER_SECOND,
  OAUTH_CODE_TTL_MS,
  OAUTH_LOOPBACK_HOST,
  PKCE_STATE_BYTES,
  PROVIDER_SECRET_PREFIX,
  UI_TEXT,
} from '../../shared/constants'
import { isPkceState, pkceRandom } from '../backend/providersEntry'
import {
  ChatGptSignIn,
  ChatGptSignInError,
  parseChatGptCallback,
  type ChatGptHostPort,
} from '../backend/subscriptionsEntry'
import type { RecordStore } from './credentialRecords'

type ChatGptCallback = Awaited<ReturnType<ChatGptHostPort['startCallback']>> & {
  readonly bindHost: string
}

/** Bound before the browser opens; the promise also retains an early callback. */
export async function startChatGptCallback(
  state: string,
  timeoutMs: number,
): Promise<ChatGptCallback> {
  const server = createServer()
  const completion: { resolve?: (url: string) => void; reject?: (error: Error) => void } = {}
  const waiting = new Promise<string>((resolve, reject) => {
    completion.resolve = resolve
    completion.reject = reject
  })
  void waiting.catch(() => null)
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
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, OAUTH_LOOPBACK_HOST, () => {
      server.off('error', reject)
      resolve()
    })
  })
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
      parseChatGptCallback(url.href, redirectUri, state)
      isClaimed = true
      // Let the response finish before forcibly closing idle sockets.
      response.on('finish', () => {
        finish(url.href)
      })
      answer(HTTP_STATUS.ok)
    } catch {
      isClaimed = true
      response.on('finish', () => {
        finish(new ChatGptSignInError('invalid-callback'))
      })
      answer(HTTP_STATUS.badRequest)
    }
  })
  const timer = setTimeout(() => {
    finish(new ChatGptSignInError('invalid-callback'))
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
    if (
      ['ENOENT', 'ENOTEMPTY', 'ENOTDIR', 'EPERM', 'EACCES', 'EBUSY'].includes(
        String(fileErrorCode(error)),
      )
    )
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
            if (Date.now() >= deadline) throw new ChatGptSignInError('request-failed')
            await pause(Math.min(pollMs, Math.max(0, deadline - Date.now())))
            continue
          }
        } catch (error) {
          if (fileErrorCode(error) !== 'ENOENT') throw error
        }
        await rename(prepared, lockPath)
        isOwned = true
        activeLocks.add(file)
      } catch (error) {
        if (
          !['EEXIST', 'ENOTEMPTY', 'ENOTDIR', 'EPERM', 'EACCES', 'EBUSY'].includes(
            String(fileErrorCode(error)),
          )
        )
          throw error
        const isRecovered = await hasRecoveredLock(lockPath)
        if (Date.now() >= deadline) throw new ChatGptSignInError('request-failed')
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
    const hostId = await withRefreshLock(async () => {
      const hostIdPath = path.join(directory, 'chatgpt.host-id')
      try {
        const stored = await readFile(hostIdPath, 'utf8')
        if (!isPkceState(stored)) throw new ChatGptSignInError('invalid-token')
        return stored
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      }
      const id = pkceRandom(PKCE_STATE_BYTES)
      await writeFile(hostIdPath, id, { flag: 'wx' })
      return id
    })
    const key = `${PROVIDER_SECRET_PREFIX}chatgpt`
    return new ChatGptSignIn({
      hostId,
      fetch: deps.fetch,
      now: Date.now,
      withRefreshLock,
      openBrowser: async (url) => {
        const isOpened = await (deps.openExternal ?? vscode.env.openExternal)(vscode.Uri.parse(url))
        if (!isOpened) throw new ChatGptSignInError('request-failed')
      },
      startCallback: async (state, timeoutMs) => {
        if (deps.isRemote) throw new ChatGptSignInError('invalid-callback')
        return await startChatGptCallback(state, timeoutMs)
      },
      readRecord: async () => {
        const stored = await deps.secrets.get(key)
        if (stored === undefined) return
        const parsed: unknown = JSON.parse(stored)
        return parsed
      },
      writeRecord: async (record) => {
        await deps.secrets.store(key, JSON.stringify(record))
      },
      deleteRecord: async () => {
        await deps.secrets.delete(key)
      },
    })
  } catch {
    throw new ChatGptSignInError('request-failed')
  }
}
